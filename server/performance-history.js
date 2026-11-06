const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createLiveSpeedEngine } = require("./live-speed-engine");
const { forEachCompleteJsonlLine } = require("./fs-scanner");
const { readCompactJsonRecord } = require("./compact-json-record");
const { localDay, dayOffset, createDayRecorder, pooled } = require("./performance-score");
const VERSION = 2;

function stageStore(db, kind) {
  const get = db.prepare("SELECT value FROM perf_stage WHERE kind=? AND key=?");
  const set = db.prepare("INSERT INTO perf_stage(kind,key,value,completed) VALUES(?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value, completed=excluded.completed");
  return { get: (key) => { const row = get.get(kind, key); return row ? JSON.parse(row.value) : undefined; },
    set: (key, value) => set.run(kind, key, JSON.stringify(value), value.completionOrder || 0), size: 0 };
}

function createPerformanceHistory({ file, listFiles, roots, clock = Date.now, onProgress = () => {} }) {
  function refresh() {
    const { DatabaseSync } = require("node:sqlite");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    const now = clock(), today = localDay(now), firstDay = dayOffset(today, -14), lastDay = dayOffset(today, -1);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const version = `${VERSION}:${timezone}`;
    try {
      fs.chmodSync(file, 0o600);
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE; PRAGMA mmap_size=0;");
      db.exec("CREATE TABLE IF NOT EXISTS perf_files(id TEXT PRIMARY KEY, signature TEXT, version TEXT, coverage TEXT); CREATE TABLE IF NOT EXISTS perf_days(file_id TEXT, day TEXT, source TEXT, model TEXT, value TEXT, PRIMARY KEY(file_id,day,source,model)); CREATE TEMP TABLE perf_stage(kind TEXT,key TEXT,value TEXT,completed INTEGER,PRIMARY KEY(kind,key)) WITHOUT ROWID;");
      db.exec("CREATE TABLE IF NOT EXISTS perf_claims(key TEXT PRIMARY KEY,owner TEXT,day TEXT);");
      const eligible = listFiles().map((record) => ({ ...record, sourceType: roots.find((root) => {
        const relative = path.relative(root.path, record.file);
        return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
      })?.sourceType })).filter((record) => record.sourceType);
      const readFile = db.prepare("SELECT signature,version,coverage FROM perf_files WHERE id=?");
      const saveFile = db.prepare("INSERT INTO perf_files VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET signature=excluded.signature,version=excluded.version,coverage=excluded.coverage");
      const saveDay = db.prepare("INSERT INTO perf_days VALUES(?,?,?,?,?)");
      const deleteDays = db.prepare("DELETE FROM perf_days WHERE file_id=?");
      const claim = db.prepare("INSERT INTO perf_claims VALUES(?,?,?) ON CONFLICT(key) DO NOTHING");
      const owner = db.prepare("SELECT owner FROM perf_claims WHERE key=?");
      const diagnostics = { files: eligible.length, scanned: 0, cached: 0, failedFiles: 0, skippedLines: 0, compactedLines: 0, identifiedResponses: 0, measuredResponses: 0, partialFiles: 0, duplicateRecords: 0 };
      for (const [index, record] of eligible.entries()) {
        const id = crypto.createHash("sha256").update(record.file).digest("hex");
        let stat;
        try { stat = fs.statSync(record.file); } catch { diagnostics.failedFiles++; continue; }
        const signature = crypto.createHash("sha256").update(`${record.signature}:${stat.dev}:${stat.ino}:${stat.ctimeMs}`).digest("hex");
        const previous = readFile.get(id);
        if (previous?.signature === signature && previous.version === version) {
          diagnostics.cached++;
          const coverage = JSON.parse(previous.coverage);
          for (const key of ["skippedLines", "compactedLines", "identifiedResponses", "measuredResponses", "partialFiles", "duplicateRecords"]) diagnostics[key] += coverage[key] || 0;
          continue;
        }
        onProgress({ kind: "performance-baseline", current: index + 1, total: eligible.length });
        db.exec("DELETE FROM perf_stage; BEGIN;");
        try {
          const responses = stageStore(db, "response"), actions = stageStore(db, "action");
          const coverage = { skippedLines: 0, compactedLines: 0, identifiedResponses: 0, measuredResponses: 0, partialFiles: 0, duplicateRecords: 0 };
          const engine = createLiveSpeedEngine({ clock: () => now, retentionMs: Infinity, maxResponses: Infinity, maxActions: Infinity, responseStore: responses, actionStore: actions,
            acceptResponse: (source, responseId, ms) => {
              const day = localDay(ms);
              if (day < firstDay || day > today) return true;
              const key = crypto.createHash("sha256").update(JSON.stringify([source, responseId])).digest("hex");
              claim.run(key, id, day);
              const accepted = owner.get(key).owner === id;
              if (!accepted) coverage.duplicateRecords++;
              return accepted;
            },
          });
          const context = { file: record.file };
          const scan = forEachCompleteJsonlLine(record.file, (line, _number, locator) => {
            if (!line.trim()) return;
            try {
              const obj = locator.truncated ? readCompactJsonRecord(record.file, locator.byteOffset, locator.byteLength, { stringLimit: 8192 }).value : JSON.parse(line);
              if (locator.truncated) coverage.compactedLines++;
              engine.ingest(obj, context, record.sourceType);
            } catch { coverage.skippedLines++; }
          }, { maxLineBytes: 128 * 1024, endOffset: record.size });
          coverage.partialFiles = scan.endedWithNewline ? 0 : 1;
          const recorder = createDayRecorder({ firstDay, lastDay: today });
          for (const row of db.prepare("SELECT kind,value FROM perf_stage WHERE completed>0 ORDER BY completed").iterate()) recorder.add(row.kind, JSON.parse(row.value));
          coverage.identifiedResponses = db.prepare("SELECT COUNT(*) AS n FROM perf_stage WHERE kind='response'").get().n;
          const records = recorder.records();
          coverage.measuredResponses = records.reduce((n, row) => n + row.n, 0);
          deleteDays.run(id);
          for (const row of records) saveDay.run(id, row.day, row.sourceType, row.model, JSON.stringify(row));
          // A partial trailing record must be retried even if a writer preserves mtime.
          saveFile.run(id, scan.endedWithNewline ? signature : "partial", version, JSON.stringify(coverage));
          db.exec("COMMIT;");
          diagnostics.scanned++;
          for (const key of Object.keys(coverage)) diagnostics[key] += coverage[key];
        } catch {
          db.exec("ROLLBACK;"); diagnostics.failedFiles++;
        }
      }
      // Only small per-day sufficient statistics survive; staged response IDs and tool facts do not.
      db.exec("DROP TABLE perf_stage;");
      db.prepare("DELETE FROM perf_days WHERE day<?").run(firstDay);
      db.prepare("DELETE FROM perf_claims WHERE day<?").run(firstDay);
      const records = db.prepare("SELECT d.value FROM perf_days d JOIN perf_files f ON f.id=d.file_id WHERE f.version=? AND d.day>=? AND d.day<? ORDER BY d.day,d.file_id,d.source,d.model").all(version, firstDay, today).map((r) => JSON.parse(r.value));
      const groups = new Map();
      for (const row of records) { const key = JSON.stringify([row.sourceType, row.model]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
      const models = [...groups.values()].map((rows) => ({ sourceType: rows[0].sourceType, model: rows[0].model, ...pooled(rows),
        days: new Set(rows.map((r) => r.day)).size,
        trend: Array.from({ length: 14 }, (_, i) => { const day = dayOffset(firstDay, i); return { day, ...pooled(rows.filter((r) => r.day === day)) }; }).map(({ day, score, n }) => ({ day, score, n })),
      })).sort((a, b) => a.sourceType.localeCompare(b.sourceType) || b.n - a.n || a.model.localeCompare(b.model));
      return { status: diagnostics.failedFiles ? "partial" : "ready", generatedAt: now, today, firstDay, lastDay, timezone, models, coverage: diagnostics };
    } finally { db.close(); }
  }
  return { refresh };
}

module.exports = { createPerformanceHistory };
