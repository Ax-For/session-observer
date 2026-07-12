const fs = require("fs");
const path = require("path");
const ObserverCore = require("../shared/observer-core");
const fsScanner = require("./fs-scanner");

function loadSqlite() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch {
    return null;
  }
}

function sessionIdFromFile(file) {
  return String(file || "").match(/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?:\.jsonl)?$/i)?.[1] || "unknown";
}

function normalizeParsedEvents(parsed) {
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed.filter(Boolean) : [parsed];
}

function isDialogue(event) {
  return event?.callType === "Prompt" || event?.callType === "User" || event?.callType === "Agent";
}

function startOfTodayMs(nowMs = Date.now()) {
  const date = new Date(nowMs);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function createDialogueSearchIndex(options = {}) {
  const DatabaseSync = options.DatabaseSync || loadSqlite();
  const enabled = options.enabled === true && Boolean(DatabaseSync) && Boolean(options.file);
  const parsers = options.parsers || {};
  let database = null;

  function db() {
    if (!enabled) return null;
    if (database) return database;
    fs.mkdirSync(path.dirname(options.file), { recursive: true });
    database = new DatabaseSync(options.file);
    database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;");
    database.exec(`
      CREATE TABLE IF NOT EXISTS indexed_files (
        source_file TEXT PRIMARY KEY,
        signature TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS dialogue_fts USING fts5(
        event_id UNINDEXED,
        session_id UNINDEXED,
        source_file UNINDEXED,
        source_line UNINDEXED,
        time UNINDEXED,
        source_type UNINDEXED,
        model UNINDEXED,
        cwd UNINDEXED,
        call_type UNINDEXED,
        content,
        tokenize = 'unicode61'
      );
    `);
    return database;
  }

  function archiveRecords(records, nowMs = Date.now()) {
    const cutoff = startOfTodayMs(nowMs);
    return (records || []).filter((record) => Number(record?.mtimeMs) < cutoff);
  }

  function indexRecord(record) {
    const connection = db();
    if (!connection) return { indexed: false, rows: 0 };
    const existing = connection.prepare("SELECT signature FROM indexed_files WHERE source_file = ?").get(record.file);
    if (existing?.signature === record.signature) return { indexed: false, reused: true, rows: 0 };
    const { adapter, parser } = fsScanner.resolveParserForFile(record.file, parsers);
    if (!parser) return { indexed: false, rows: 0 };
    const remove = connection.prepare("DELETE FROM dialogue_fts WHERE source_file = ?");
    const insert = connection.prepare(`INSERT INTO dialogue_fts (
      event_id, session_id, source_file, source_line, time, source_type, model, cwd, call_type, content
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const remember = connection.prepare(`INSERT INTO indexed_files (source_file, signature, indexed_at)
      VALUES (?, ?, ?) ON CONFLICT(source_file) DO UPDATE SET signature=excluded.signature, indexed_at=excluded.indexed_at`);
    const context = {
      model: "unknown",
      sessionId: sessionIdFromFile(record.file),
      sourceFile: record.file,
      sourceType: adapter.key,
      cwd: "",
      sessionTitle: "",
      compactContent: false,
    };
    let rows = 0;
    connection.exec("BEGIN IMMEDIATE");
    try {
      remove.run(record.file);
      fsScanner.forEachCompleteJsonlLine(record.file, (line, lineNumber) => {
        if (!line) return;
        try {
          const parsed = normalizeParsedEvents(parser(JSON.parse(line), context));
          parsed.filter(isDialogue).forEach((event, eventIndex) => {
            const content = String(event.content || event.summary || "").trim();
            if (!content) return;
            insert.run(
              event.eventId || `${record.file}:${lineNumber}:${eventIndex}`,
              event.sessionId || context.sessionId,
              record.file,
              lineNumber,
              event.time || "",
              event.sourceType || adapter.key,
              event.model || context.model || "unknown",
              event.cwd || context.cwd || "",
              event.callType || "",
              content,
            );
            rows += 1;
          });
        } catch {
          // A malformed source line should not invalidate the rest of the archive.
        }
      });
      remember.run(record.file, record.signature, new Date().toISOString());
      connection.exec("COMMIT");
    } catch (error) {
      connection.exec("ROLLBACK");
      throw error;
    }
    return { indexed: true, rows };
  }

  function ensureArchives(records, nowMs = Date.now()) {
    if (!enabled) return { enabled: false, indexedFiles: 0, reusedFiles: 0, rows: 0 };
    let indexedFiles = 0;
    let reusedFiles = 0;
    let rows = 0;
    for (const record of archiveRecords(records, nowMs)) {
      const result = indexRecord(record);
      if (result.indexed) indexedFiles += 1;
      if (result.reused) reusedFiles += 1;
      rows += result.rows || 0;
    }
    return { enabled: true, indexedFiles, reusedFiles, rows };
  }

  function search(query, filters = {}) {
    const connection = db();
    const needle = String(query || "").trim();
    if (!connection || !needle) return [];
    const where = ["dialogue_fts MATCH ?"];
    const params = [`"${needle.replace(/"/g, '""')}"`];
    for (const [column, value] of [
      ["source_type", filters.platform],
      ["model", filters.model],
      ["call_type", filters.type],
      ["session_id", filters.sessionId],
    ]) {
      if (!value) continue;
      where.push(`${column} = ?`);
      params.push(value);
    }
    if (filters.startMs != null) {
      where.push("time >= ?");
      params.push(new Date(filters.startMs).toISOString());
    }
    if (filters.endMs != null) {
      where.push("time <= ?");
      params.push(new Date(filters.endMs).toISOString());
    }
    const limit = Math.max(1, Math.min(1000, Number(filters.limit) || 250));
    const rows = connection.prepare(`SELECT event_id, session_id, source_file, source_line, time,
      source_type, model, cwd, call_type, content
      FROM dialogue_fts WHERE ${where.join(" AND ")}
      ORDER BY time ${filters.order === "asc" ? "ASC" : "DESC"} LIMIT ?`).all(...params, limit);
    return rows.map((row) => ({
      eventId: row.event_id,
      sessionId: row.session_id,
      sourceFile: row.source_file,
      sourceLine: Number(row.source_line) || 0,
      time: row.time,
      sourceType: row.source_type,
      model: row.model,
      cwd: row.cwd,
      callType: row.call_type,
      content: row.content,
      searchIndexed: true,
    })).filter((event) => ObserverCore.toTimeMs(event.time) != null || event.time === "");
  }

  function state() {
    const connection = db();
    if (!connection) return { enabled: false, mode: "scan", reason: DatabaseSync ? "disabled" : "node-sqlite-unavailable" };
    const files = connection.prepare("SELECT COUNT(*) AS total FROM indexed_files").get()?.total || 0;
    const rows = connection.prepare("SELECT COUNT(*) AS total FROM dialogue_fts").get()?.total || 0;
    return { enabled: true, mode: "sqlite", files, rows, file: options.file };
  }

  return { archiveRecords, ensureArchives, indexRecord, search, state };
}

module.exports = { createDialogueSearchIndex, startOfTodayMs };
