const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPeakRecorder, readDailyPeaks } = require("../server/live-speed-peaks");
const { readHistory, historyCsv } = require("../server/history-query");

test("observed peaks survive a restart, keep source scopes separate and leave unobserved days blank", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-peaks-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "peaks.sqlite");
  const at = (day) => new Date(2026, 10, day, 12).getTime();
  const sample = (day, measured, codex, dsh) => ({ generatedAt: at(day), measured, estimated: 10000, sources: [
    { sourceType: "codex", measured: codex }, { sourceType: "dsh", measured: dsh },
  ] });
  const days = { from: "2026-11-05", to: "2026-11-07" };
  assert.equal(readDailyPeaks(file, days).size, 0);
  const first = createPeakRecorder(file);
  first.observe(sample(5, 50, 40, 10));
  first.observe(sample(5, 45, 20, 25));
  first.close();
  const second = createPeakRecorder(file);
  second.observe(sample(5, 12, 7, 5));
  second.observe(sample(6, 0, 0, 0));
  second.observe(sample(7, 8, 8, 0));
  second.close();
  assert.deepEqual([...readDailyPeaks(file, days)], [["2026-11-05", 50], ["2026-11-07", 8]]);
  assert.deepEqual([...readDailyPeaks(file, { ...days, source: "dsh" })], [["2026-11-05", 25]]);
  const readPeaks = (range) => readDailyPeaks(file, range);
  const history = readHistory(null, { ...days, source: "dsh" }, { now: at(7), readPeaks });
  assert.deepEqual(history.days.map((day) => [day.day, day.peakOnly, day.peakOutputTokS]), [["2026-11-05", true, 25]]);
  assert.equal(historyCsv(history).trim().split("\r\n").at(-1).split(",").at(-1), "25.00");
  assert.equal(readHistory(null, { ...days, model: "test" }, { now: at(7), readPeaks }).totalDays, 0);
});
