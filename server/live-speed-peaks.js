const fs = require("node:fs");
const path = require("node:path");
const { localDay } = require("./performance-score");

function createPeakRecorder(file) {
  let db, upsert, day;
  let peaks = new Map();

  function observe({ generatedAt, measured, sources }) {
    if (!(measured > 0) || !Number.isFinite(measured)) return;
    const sampleDay = localDay(generatedAt);
    if (!db) {
      const { DatabaseSync } = require("node:sqlite");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.closeSync(fs.openSync(file, fs.constants.O_CREAT | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600));
      db = new DatabaseSync(file);
      db.exec("PRAGMA busy_timeout=500; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS peaks (day TEXT, source TEXT, peak REAL, PRIMARY KEY(day,source)) WITHOUT ROWID");
      upsert = db.prepare("INSERT INTO peaks VALUES(?,?,?) ON CONFLICT(day,source) DO UPDATE SET peak=max(peaks.peak,excluded.peak)");
    }
    if (day !== sampleDay) {
      day = sampleDay;
      peaks = new Map(db.prepare("SELECT source,peak FROM peaks WHERE day=?").all(day).map((row) => [row.source, row.peak]));
    }
    const updates = [{ sourceType: "", measured }, ...sources]
      .filter((row) => Number.isFinite(row.measured) && row.measured > (peaks.get(row.sourceType) || 0));
    if (!updates.length) return;
    db.exec("BEGIN");
    try {
      for (const row of updates) upsert.run(day, row.sourceType, row.measured);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    for (const row of updates) peaks.set(row.sourceType, row.measured);
  }

  return { observe, close: () => db?.close() };
}

function readDailyPeaks(file, { from, to, source = "" }) {
  if (!file || !fs.existsSync(file)) return new Map();
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=500;");
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='peaks' AND type='table'").get()) return new Map();
    return new Map(db.prepare("SELECT day,peak FROM peaks WHERE day BETWEEN ? AND ? AND source=? ORDER BY day")
      .all(from, to, source).map((row) => [row.day, row.peak]));
  } finally { db.close(); }
}

module.exports = { createPeakRecorder, readDailyPeaks };
