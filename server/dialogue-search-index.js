const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const fsScanner = require("./fs-scanner");
const { encodeReference, encodeCursor, decodeCursor } = require("./event-reference");
const { readCompactJsonRecord } = require("./compact-json-record");
const { streamDialogueText } = require("./dialogue-text");
const { isDshCompressed } = require("./zstd-frames");

const CHUNK_SIZE = 16384;
const MAX_QUERY_LENGTH = 512;
const SCHEMA_VERSION = 6;
const chunkText = (value) => Buffer.from(value).toString("utf16le");
function loadSqlite() { try { return require("node:sqlite").DatabaseSync; } catch { return null; } }
function startOfTodayMs(nowMs = Date.now()) { const date = new Date(nowMs); date.setHours(0, 0, 0, 0); return date.getTime(); }
function fingerprint(file, length) {
  const fd = fs.openSync(file, "r");
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(4096);
  try {
    for (const offset of new Set([0, Math.max(0, Math.floor(length / 2) - 2048), Math.max(0, length - 4096)])) {
      const size = fs.readSync(fd, buffer, 0, Math.min(buffer.length, length - offset), offset);
      hash.update(buffer.subarray(0, size));
    }
    return hash.digest("hex");
  } finally { fs.closeSync(fd); }
}

function createDialogueSearchIndex(options = {}) {
  const DatabaseSync = options.DatabaseSync || loadSqlite();
  const enabled = options.enabled === true && Boolean(DatabaseSync) && Boolean(options.file);
  let database;
  let lastSync = {};
  function db() {
    if (!enabled) return null;
    if (database) return database;
    fs.mkdirSync(path.dirname(options.file), { recursive: true });
    database = new DatabaseSync(options.file);
    fs.chmodSync(options.file, 0o600);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE; PRAGMA mmap_size=0; PRAGMA foreign_keys=ON;");
    if (database.prepare("PRAGMA user_version").get().user_version !== SCHEMA_VERSION) {
      database.exec("DROP TABLE IF EXISTS dialogue_fts; DROP TABLE IF EXISTS indexed_files; DROP TABLE IF EXISTS chunks; DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS files; PRAGMA user_version=" + SCHEMA_VERSION);
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS files (file TEXT PRIMARY KEY, signature TEXT, size INTEGER, offset INTEGER, line INTEGER,
        guard TEXT, context TEXT, skipped INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, file TEXT NOT NULL, session_id TEXT, time TEXT,
        platform TEXT, model TEXT, cwd TEXT, call_type TEXT, extra TEXT, title TEXT, source_line INTEGER, length INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS messages_file ON messages(file);
      CREATE INDEX IF NOT EXISTS messages_session_time ON messages(session_id, time, id);
      CREATE INDEX IF NOT EXISTS messages_time ON messages(time, id);
      CREATE TABLE IF NOT EXISTS chunks (id TEXT REFERENCES messages(id) ON DELETE CASCADE, position INTEGER, content BLOB, folded TEXT,
        PRIMARY KEY(id, position)) WITHOUT ROWID;
    `);
    return database;
  }
  function indexRecord(record) {
    const connection = db();
    if (!connection || !fs.existsSync(record.file)) return {};
    const stat = fs.statSync(record.file);
    const signature = stat.size + ":" + stat.mtimeMs + ":" + stat.ino;
    const previous = connection.prepare("SELECT * FROM files WHERE file=?").get(record.file);
    if (previous?.signature === signature) return { reused: true };
    const compressed = isDshCompressed(record.file);
    const append = Boolean(!compressed && previous && previous.signature.split(":").at(-1) === String(stat.ino) && stat.size >= previous.size && stat.size > previous.offset
      && previous.guard === fingerprint(record.file, previous.offset));
    const { adapter, parser } = fsScanner.resolveParserForFile(record.file, options.parsers || {});
    if (!parser) return {};
    const context = append ? JSON.parse(previous.context) : {
      model: "unknown", sessionId: record.file.match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/i)?.[1] || "unknown",
      sourceFile: record.file, sourceType: adapter.key, compactContent: true,
    };
    let offset = append ? previous.offset : 0;
    let lineNumber = append ? previous.line : 0;
    let skipped = append ? previous.skipped : 0;
    let rows = 0;
    const insertMessage = connection.prepare("INSERT OR REPLACE INTO messages(id,file,session_id,time,platform,model,cwd,call_type,extra,title,source_line) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    const insertChunk = connection.prepare("INSERT INTO chunks VALUES(?,?,?,?)");
    connection.exec("BEGIN IMMEDIATE");
    try {
      if (!append) connection.prepare("DELETE FROM messages WHERE file=?").run(record.file);
      fsScanner.forEachCompleteJsonlLine(record.file, (line, number, locator) => {
        offset = locator.byteOffset + locator.byteLength + 1;
        lineNumber = number;
        if (!line.trim()) return;
        let obj;
        let events;
        try {
          obj = locator.truncated ? readCompactJsonRecord(record.file, locator.byteOffset, locator.byteLength, { stringLimit: 2048 }).value : JSON.parse(line);
          const parsed = parser(obj, context);
          events = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
        } catch { skipped += 1; return; }
        events.forEach((event, eventIndex) => {
          if (!["Prompt", "User", "Agent"].includes(event.callType)) return;
          const id = encodeReference(record.file, locator.byteOffset, eventIndex, locator.byteLength, event);
          connection.exec("SAVEPOINT message");
          try {
            insertMessage.run(id, record.file, event.sessionId || context.sessionId, event.time || "", event.sourceType || adapter.key,
              event.model || context.model || "unknown", event.cwd || context.cwd || "", event.callType, event.extra || "", event.sessionTitle || "", number);
            let pending = "";
            let position = 0;
            let length = 0;
            const digest = crypto.createHash("sha256");
            const emit = (text) => {
              length += text.length;
              digest.update(text);
              pending += text;
              while (pending.length >= CHUNK_SIZE + MAX_QUERY_LENGTH) {
                const piece = pending.slice(0, CHUNK_SIZE + MAX_QUERY_LENGTH);
                insertChunk.run(id, position, Buffer.from(piece, "utf16le"), piece.toLowerCase());
                pending = pending.slice(CHUNK_SIZE);
                position += CHUNK_SIZE;
              }
            };
            streamDialogueText(record.file, locator, obj, event.content || event.summary, emit, event);
            if (pending) insertChunk.run(id, position, Buffer.from(pending, "utf16le"), pending.toLowerCase());
            const hash = digest.digest("hex");
            const previousDialogue = context.previousDialogue;
            const mirror = adapter.key === "codex" && previousDialogue?.hash === hash && previousDialogue.role === event.callType
              && previousDialogue.extra !== event.extra && Math.abs(Date.parse(previousDialogue.time) - Date.parse(event.time)) <= 2000;
            if (!length || mirror) connection.prepare("DELETE FROM messages WHERE id=?").run(id);
            else {
              connection.prepare("UPDATE messages SET length=? WHERE id=?").run(length, id);
              context.previousDialogue = { hash, role: event.callType, extra: event.extra, time: event.time };
              rows += 1;
            }
            connection.exec("RELEASE message");
          } catch (error) {
            connection.exec("ROLLBACK TO message; RELEASE message");
            if (/SQLITE|database|disk/i.test(String(error.code || error.message))) throw error;
            skipped += 1;
          }
        });
      }, { maxLineBytes: 128 * 1024, startOffset: offset, endOffset: stat.size, initialLineNumber: lineNumber });
      const after = fs.statSync(record.file);
      if (after.ino !== stat.ino || after.size < stat.size || (after.size === stat.size && after.mtimeMs !== stat.mtimeMs)) throw new Error("Source changed during dialogue caching; retry search");
      if (compressed) offset = stat.size;
      connection.prepare("INSERT OR REPLACE INTO files VALUES(?,?,?,?,?,?,?,?)").run(record.file, signature, stat.size, offset, lineNumber,
        fingerprint(record.file, offset), JSON.stringify(context), skipped);
      connection.exec("COMMIT");
    } catch (error) { connection.exec("ROLLBACK"); throw error; }
    return { indexed: true, appended: append, rows };
  }
  function ensureFiles(records) {
    if (!enabled) return { enabled: false };
    const connection = db();
    const live = new Set(records.filter((record) => fs.existsSync(record.file)).map((record) => record.file));
    for (const row of connection.prepare("SELECT file FROM files").all()) {
      if (live.has(row.file)) continue;
      connection.prepare("DELETE FROM messages WHERE file=?").run(row.file);
      connection.prepare("DELETE FROM files WHERE file=?").run(row.file);
    }
    const result = { enabled: true, indexedFiles: 0, reusedFiles: 0, appendedFiles: 0, rows: 0 };
    for (const [index, record] of records.entries()) {
      const item = indexRecord(record);
      result.indexedFiles += Number(Boolean(item.indexed));
      result.reusedFiles += Number(Boolean(item.reused));
      result.appendedFiles += Number(Boolean(item.appended));
      result.rows += item.rows || 0;
      options.onProgress?.({ phase: "dialogue-cache", completedFiles: index + 1, totalFiles: records.length, ...result });
    }
    lastSync = result;
    for (const suffix of ["", "-wal", "-shm"]) { try { fs.chmodSync(options.file + suffix, 0o600); } catch { /* SQLite sidecars are optional. */ } }
    return result;
  }
  function readBody(id, { offset = 0, limit = 65536 } = {}) {
    const connection = db();
    const row = connection?.prepare("SELECT length FROM messages WHERE id=?").get(id);
    if (!row) return null;
    offset = Math.max(0, Math.min(row.length, Number(offset) || 0));
    limit = Math.max(1, Math.min(65536, Number(limit) || 65536));
    const start = Math.floor(offset / CHUNK_SIZE) * CHUNK_SIZE;
    const pieces = connection.prepare("SELECT position, content FROM chunks WHERE id=? AND position>=? AND position<? ORDER BY position").all(id, start, offset + limit);
    const content = pieces.map((piece, index) => index < pieces.length - 1 ? chunkText(piece.content).slice(0, CHUNK_SIZE) : chunkText(piece.content)).join("").slice(offset - start, offset - start + limit);
    return { content, offset, totalLength: row.length, nextOffset: offset + content.length, hasMore: offset + content.length < row.length };
  }
  function toEvent(row, needle = "") {
    const chunk = needle ? db().prepare("SELECT position, content FROM chunks WHERE id=? AND instr(folded,?)>0 ORDER BY position LIMIT 1").get(row.id, needle) : null;
    const hitOffset = chunk ? chunk.position + Math.max(0, chunkText(chunk.content).toLowerCase().indexOf(needle)) : 0;
    const body = readBody(row.id, { offset: Math.max(0, hitOffset - 100), limit: Math.max(600, needle.length + 200) });
    return { eventId: row.id, sessionId: row.session_id, sourceFile: row.file, sourceLine: row.source_line, time: row.time,
      sourceType: row.platform, model: row.model, cwd: row.cwd, callType: row.call_type, extra: row.extra, sessionTitle: row.title,
      content: body.content, contentLength: row.length, contentTruncated: body.content.length < row.length,
      excerptOffset: body.offset, matchOffset: hitOffset, searchIndexed: true };
  }
  function query(text, filters = {}) {
    const connection = db();
    const needle = String(text || "").trim().toLowerCase();
    if (needle.length > MAX_QUERY_LENGTH) throw new Error("Search text must be 512 characters or fewer");
    if (!connection || !needle) return { events: [], sessions: [], totalMatching: 0, page: { hasMore: false } };
    const where = ["EXISTS(SELECT 1 FROM chunks c WHERE c.id=m.id AND instr(c.folded,?)>0)"];
    const params = [needle];
    if (filters.quickFilter && filters.quickFilter !== "all") where.push("0");
    for (const [column, value] of [["platform", filters.platform], ["model", filters.model], ["call_type", filters.type], ["session_id", filters.sessionId]]) {
      if (value) { where.push("m." + column + "=?"); params.push(value); }
    }
    for (const [value, operator] of [[filters.startMs, ">="], [filters.endMs, "<="]]) {
      if (value != null) { where.push("m.time " + operator + " ?"); params.push(new Date(value).toISOString()); }
    }
    const base = "FROM messages m WHERE " + where.join(" AND ");
    const sessions = connection.prepare("SELECT session_id AS sessionId, platform AS sourceType, COUNT(*) AS matchCount, MAX(time) AS lastEventTime " + base + " GROUP BY session_id,platform ORDER BY lastEventTime DESC").all(...params);
    const totalMatching = sessions.reduce((sum, session) => sum + session.matchCount, 0);
    const order = filters.order === "asc" ? "asc" : "desc";
    const cursor = decodeCursor(filters.cursor, order);
    let cursorClause = "";
    if (cursor) {
      const op = order === "asc" ? ">" : "<";
      cursorClause = " AND (m.time " + op + " ? OR (m.time=? AND m.id " + op + " ?))";
      params.push(cursor.time, cursor.time, cursor.eventId);
    }
    const offset = cursor ? 0 : Math.max(0, Number(filters.offset) || 0);
    const limit = Math.max(1, Math.min(1000, Number(filters.limit) || 250));
    const rows = connection.prepare("SELECT m.* " + base + cursorClause + " ORDER BY m.time " + order + ", m.id " + order + " LIMIT ? OFFSET ?").all(...params, limit + 1, offset);
    const events = rows.slice(0, limit).map((row) => toEvent(row, needle));
    const hasMore = rows.length > limit;
    return { events, sessions, totalMatching, totalVisible: totalMatching, page: { offset, limit, total: totalMatching, totalIsEstimate: false,
      hasMore, nextOffset: offset + events.length, nextCursor: hasMore ? encodeCursor(events.at(-1), order) : null },
    scan: { searchMode: "dialogue-cache", ...lastSync, oversizedLines: state().skipped } };
  }
  function context(id) {
    const connection = db();
    const target = connection?.prepare("SELECT * FROM messages WHERE id=?").get(id);
    if (!target) return null;
    const before = connection.prepare("SELECT * FROM messages WHERE session_id=? AND (time<? OR (time=? AND id<?)) ORDER BY time DESC,id DESC LIMIT 10").all(target.session_id, target.time, target.time, id);
    const after = connection.prepare("SELECT * FROM messages WHERE session_id=? AND (time>? OR (time=? AND id>?)) ORDER BY time,id LIMIT 10").all(target.session_id, target.time, target.time, id);
    return { targetEventId: id, sessionId: target.session_id, events: [...before.reverse(), target, ...after].map((row) => toEvent(row)), hasEarlier: before.length === 10, hasLater: after.length === 10 };
  }
  function state() {
    const connection = db();
    if (!connection) return { enabled: false, mode: "scan", reason: DatabaseSync ? "disabled" : "node-sqlite-unavailable" };
    return { enabled: true, mode: "dialogue-cache", files: connection.prepare("SELECT COUNT(*) n FROM files").get().n,
      rows: connection.prepare("SELECT COUNT(*) n FROM messages").get().n,
      skipped: connection.prepare("SELECT COALESCE(SUM(skipped),0) n FROM files").get().n, file: options.file };
  }
  const archiveRecords = (records, nowMs) => records.filter((record) => record.mtimeMs < startOfTodayMs(nowMs));
  return { ensureFiles, indexRecord, query, readBody, context, state, archiveRecords,
    ensureArchives: (records, nowMs) => ensureFiles(archiveRecords(records, nowMs)),
    search: (text, filters) => query(text, filters).events,
    close: () => { database?.close(); database = null; } };
}
module.exports = { createDialogueSearchIndex, startOfTodayMs };
