const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createLiveSpeedEngine } = require("./live-speed-engine");
const { forEachCompleteJsonlLine } = require("./fs-scanner");
const { readCompactJsonRecord } = require("./compact-json-record");
const { readCompressedJsonl } = require("./compressed-jsonl");
const { locationFor } = require("./source-locations");
const { localDay, dayOffset, createDayRecorder, pooled, addRecord, emptyRecord, timed } = require("./performance-score");
const { validDay, createUsageRecorder, readHistory } = require("./history-query");
const { PRICING_VERSION } = require("../shared/token-pricing");
const { NATIVE_SOURCE_TYPES } = require("../shared/source-adapters");
const { readDailyPeaks } = require("./live-speed-peaks");
const { isDshCompressed } = require("./zstd-frames");

const VERSION = 4;
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const dayKey = (row) => JSON.stringify([row.day, row.sourceType, row.model]);
const coverageFields = ["skippedLines", "compactedLines", "identifiedResponses", "measuredResponses", "partialFiles", "duplicateRecords"];
const emptyCoverage = () => Object.fromEntries(coverageFields.map((key) => [key, 0]));

function stageStore(db, kind) {
  const get = db.prepare("SELECT value FROM history_stage WHERE kind=? AND key=?");
  const set = db.prepare("INSERT INTO history_stage(kind,key,value,completed) VALUES(?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value,completed=excluded.completed");
  return { get: (key) => { const row = get.get(kind, key); return row ? JSON.parse(row.value) : undefined; },
    set: (key, value) => set.run(kind, key, JSON.stringify(value), value.completionOrder || 0), size: 0 };
}

function createSchema(db) {
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE; PRAGMA mmap_size=0;
    CREATE TABLE IF NOT EXISTS history_files(id TEXT PRIMARY KEY, signature TEXT, version TEXT, coverage TEXT);
    CREATE TABLE IF NOT EXISTS history_days(file_id TEXT, day TEXT, source TEXT, model TEXT, value TEXT, PRIMARY KEY(file_id,day,source,model));
    CREATE INDEX IF NOT EXISTS history_days_by_date ON history_days(day,source,model);
    CREATE TABLE IF NOT EXISTS history_claims(key TEXT PRIMARY KEY, owner TEXT);
    CREATE TABLE IF NOT EXISTS history_meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS history_legacy_replaced(owner TEXT, day TEXT, PRIMARY KEY(owner,day));
    CREATE TEMP TABLE history_stage(kind TEXT,key TEXT,value TEXT,completed INTEGER,PRIMARY KEY(kind,key)) WITHOUT ROWID;
  `);
}

async function scanFile(db, record, now, coverage) {
  const responses = stageStore(db, "response"), actions = stageStore(db, "action");
  const engine = createLiveSpeedEngine({ clock: () => now, retentionMs: Infinity, maxResponses: Infinity, maxActions: Infinity, responseStore: responses, actionStore: actions });
  const context = { file: record.file };
  const ingest = (value, compacted) => {
    if (compacted) coverage.compactedLines++;
    try { engine.ingest(value, context, record.sourceType); }
    catch (error) {
      if (error.code?.startsWith("ERR_SQLITE")) throw error;
      coverage.skippedLines++;
    }
  };
  if (record.format === "zstd" || record.file.endsWith(".jsonl.zst")) {
    return readCompressedJsonl(record.file, record.size, ingest, { allowPartial: isDshCompressed(record.file), onMalformed: () => coverage.skippedLines++ });
  }
  return forEachCompleteJsonlLine(record.file, (line, _number, locator) => {
    if (!line.trim()) return;
    let value;
    try { value = locator.truncated ? readCompactJsonRecord(record.file, locator.byteOffset, locator.byteLength, { stringLimit: 8192 }).value : JSON.parse(line); }
    catch { coverage.skippedLines++; return; }
    ingest(value, locator.truncated);
  }, { maxLineBytes: 128 * 1024, endOffset: record.size, regularFileOnly: true });
}

function recordDays(db, fileId, today, coverage, legacy) {
  const claim = db.prepare("INSERT INTO history_claims VALUES(?,?) ON CONFLICT(key) DO NOTHING");
  const owner = db.prepare("SELECT owner FROM history_claims WHERE key=?");
  const original = legacy && db.prepare("SELECT owner,day FROM perf_claims WHERE key=?");
  const replace = legacy && db.prepare("INSERT OR IGNORE INTO history_legacy_replaced VALUES(?,?)");
  const performance = createDayRecorder({ lastDay: today });
  const usage = createUsageRecorder();
  for (const row of db.prepare("SELECT kind,value FROM history_stage ORDER BY completed,key").iterate()) {
    const value = JSON.parse(row.value), isResponse = row.kind === "response";
    if (!isResponse && value.resultMs == null) continue;
    const day = localDay(isResponse ? value.endMs : value.resultMs);
    if (!validDay(day) || day > today) continue;
    const identity = isResponse ? [value.nativeId ? "response" : "fallback", value.sourceType, value.nativeId || value.id]
      : ["action", value.sourceType, value.callId, value.callMs];
    const key = hash(JSON.stringify(identity));
    claim.run(key, fileId);
    if (owner.get(key)?.owner !== fileId) { if (isResponse) coverage.duplicateRecords++; continue; }
    if (isResponse) {
      coverage.identifiedResponses++;
      usage.add(value, day);
      if (original && value.nativeId && timed(value)) {
        const older = original.get(hash(JSON.stringify([value.sourceType, value.nativeId])));
        // A previously archived file may have a different path. Prefer rebuilt
        // measurements over its old per-day aggregate if it is now readable.
        if (older) replace.run(older.owner, older.day);
      }
    }
    performance.add(row.kind, value);
  }
  const performanceRows = performance.records();
  coverage.measuredResponses = performanceRows.reduce((n, row) => n + row.n, 0);
  const records = new Map(usage.records().map((row) => [dayKey(row), row]));
  for (const row of performanceRows) records.set(dayKey(row), { ...records.get(dayKey(row)), ...row });
  return records.values();
}

function baselineModels(db, firstDay, today, timezone, legacy) {
  const groups = new Map();
  function add({ value }) {
    const row = JSON.parse(value);
    if (!row.n && !row.toolN) return;
    const key = JSON.stringify([row.sourceType, row.model]);
    if (!groups.has(key)) groups.set(key, { sourceType: row.sourceType, model: row.model, days: new Map() });
    const days = groups.get(key).days;
    if (!days.has(row.day)) days.set(row.day, emptyRecord());
    addRecord(days.get(row.day), row);
  }
  for (const row of db.prepare("SELECT value FROM history_days WHERE day>=? AND day<?").iterate(firstDay, today)) add(row);
  if (legacy) for (const row of db.prepare(`SELECT d.value FROM perf_days d JOIN perf_files f ON f.id=d.file_id
    WHERE f.version=? AND d.day>=? AND d.day<?
    AND NOT EXISTS (SELECT 1 FROM history_files h WHERE h.id=d.file_id)
    AND NOT EXISTS (SELECT 1 FROM history_legacy_replaced l WHERE l.owner=d.file_id AND l.day=d.day)`).iterate(`2:${timezone}`, firstDay, today)) add(row);
  return [...groups.values()].map(({ sourceType, model, days }) => ({ sourceType, model, ...pooled([...days.values()]), days: days.size,
    trend: Array.from({ length: 14 }, (_, i) => {
      const day = dayOffset(firstDay, i), record = days.get(day);
      const { score, n } = pooled(record ? [record] : []);
      return { day, score, n };
    }),
  })).sort((a, b) => a.sourceType.localeCompare(b.sourceType) || b.n - a.n || a.model.localeCompare(b.model));
}

function createPerformanceHistory({ file, peakFile, listFiles, roots = [], clock = Date.now, onProgress = () => {}, loadPrices = () => "builtin", scanBudgetMs = Infinity }) {
  let cycle;
  async function refresh() {
    const { DatabaseSync } = require("node:sqlite");
    const now = clock(), today = localDay(now), firstDay = dayOffset(today, -14), lastDay = dayOffset(today, -1);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const version = `${VERSION}:${timezone}:${PRICING_VERSION}:${loadPrices()}`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Establish the mode before SQLite opens the file and creates its journal.
    fs.closeSync(fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600));
    fs.chmodSync(file, 0o600);
    const db = new DatabaseSync(file);
    try {
      createSchema(db);
      const legacy = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('perf_files','perf_days','perf_claims')").get().n === 3;
      if (!cycle || cycle.today !== today || cycle.version !== version) {
        const eligible = listFiles().map((record) => ({ ...record, sourceType: record.sourceType || locationFor(record.file, roots)?.sourceType }))
          .filter((record) => NATIVE_SOURCE_TYPES.includes(record.sourceType));
        cycle = { today, version, eligible, index: 0, diagnostics: { files: eligible.length,
          archives: eligible.filter((row) => row.archive || row.file.endsWith(".jsonl.zst")).length,
          scanned: 0, cached: 0, failedFiles: 0, ...emptyCoverage() } };
      }
      const { eligible, diagnostics } = cycle;
      const readFile = db.prepare("SELECT signature,version,coverage FROM history_files WHERE id=?");
      const saveFile = db.prepare("INSERT INTO history_files VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET signature=excluded.signature,version=excluded.version,coverage=excluded.coverage");
      const saveDay = db.prepare("INSERT INTO history_days VALUES(?,?,?,?,?)");
      const deleteDays = db.prepare("DELETE FROM history_days WHERE file_id=?");
      const started = performance.now(), firstIndex = cycle.index;
      while (cycle.index < eligible.length && (cycle.index === firstIndex || performance.now() - started < scanBudgetMs)) {
        const index = cycle.index++, record = eligible[index];
        const id = hash(record.file);
        let stat;
        try { stat = fs.lstatSync(record.file); if (!stat.isFile()) throw new Error(); } catch { diagnostics.failedFiles++; continue; }
        const signature = hash(`${record.signature}:${record.sourceType}:${stat.dev}:${stat.ino}:${stat.ctimeMs}`);
        const previous = readFile.get(id);
        if (previous?.signature === signature && previous.version === version) {
          diagnostics.cached++;
          const coverage = JSON.parse(previous.coverage);
          for (const key of coverageFields) diagnostics[key] += coverage[key] || 0;
          continue;
        }
        onProgress({ kind: "performance-baseline", current: index + 1, total: eligible.length });
        db.exec("DELETE FROM history_stage; BEGIN;");
        try {
          const coverage = emptyCoverage();
          const scan = await scanFile(db, record, now, coverage);
          coverage.partialFiles = scan.endedWithNewline || record.size === 0 ? 0 : 1;
          const records = recordDays(db, id, today, coverage, legacy);
          deleteDays.run(id);
          for (const row of records) saveDay.run(id, row.day, row.sourceType, row.model, JSON.stringify(row));
          saveFile.run(id, coverage.partialFiles ? "partial" : signature, version, JSON.stringify(coverage));
          db.exec("COMMIT;");
          diagnostics.scanned++;
          for (const key of coverageFields) diagnostics[key] += coverage[key];
        } catch {
          db.exec("ROLLBACK;"); diagnostics.failedFiles++;
        }
      }
      db.exec("DROP TABLE history_stage;");
      const progress = { completed: cycle.index, total: eligible.length };
      const status = progress.completed < progress.total ? "loading" : diagnostics.failedFiles || diagnostics.skippedLines || diagnostics.partialFiles ? "partial" : "ready";
      const scan = { status, generatedAt: now, timezone, progress, coverage: { ...diagnostics } };
      db.prepare("INSERT OR REPLACE INTO history_meta VALUES('scan',?)").run(JSON.stringify(scan));
      const models = baselineModels(db, firstDay, today, timezone, legacy);
      if (status !== "loading") cycle = null;
      return { ...scan, today, firstDay, lastDay, models };
    } catch (error) { cycle = null; throw error; }
    finally { db.close(); }
  }

  function read(filters, options) {
    const { DatabaseSync } = require("node:sqlite");
    const settings = { now: clock(), readPeaks: (range) => readDailyPeaks(peakFile, range), ...options };
    if (!fs.existsSync(file)) return readHistory(null, filters, settings);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec("PRAGMA cache_size=-2048; PRAGMA temp_store=FILE; PRAGMA mmap_size=0;");
      return readHistory(db, filters, settings);
    } finally { db.close(); }
  }

  return { refresh, read };
}

module.exports = { createPerformanceHistory };
