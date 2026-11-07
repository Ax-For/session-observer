const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { zstdCompressSync } = require("node:zlib");
const { createPerformanceHistory } = require("../server/performance-history");
const { parseHistoryFilters, historyCsv } = require("../server/history-query");
const { localDay, dayOffset, emptyRecord } = require("../server/performance-score");

const encode = (rows) => rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
function rollout(day, model = "test-model") {
  const ms = new Date(`${day}T12:00:00`).getTime();
  const row = (offset, type, payload) => ({ timestamp: new Date(ms + offset).toISOString(), type, payload });
  return [row(-1000, "session_meta", { id: `session-${day}`, cwd: "/private/PROJECT-NAME" }),
    row(0, "turn_context", { model, effort: "high", service_tier: "priority" }),
    row(0, "event_msg", { type: "task_started" }),
    row(1000, "response_item", { type: "message", role: "assistant", content: [{ type: "output_text", text: "PRIVATE-TEXT".repeat(20000) }] }),
    row(4000, "token_usage_record", { response_id: `PRIVATE-RESPONSE-${day}`, usage: { input_tokens: 1200, cached_input_tokens: 800, output_tokens: 200, reasoning_output_tokens: 80 } }),
    row(4500, "event_msg", { type: "task_complete" })];
}

test("streamed Codex archives, including concatenated frames, populate older daily history and remain counted once after moves and removal", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const today = localDay();
  const oldDay = dayOffset(today, -61), recent = dayOffset(today, -3);
  const recentFile = path.join(root, "recent.jsonl");
  const packed = path.join(root, "old.jsonl.zst");
  const broken = path.join(root, "broken.jsonl.zst");
  const records = rollout(oldDay, '=HYPERLINK("https://example.invalid")');
  fs.writeFileSync(recentFile, encode(rollout(recent)));
  fs.writeFileSync(packed, Buffer.concat([
    zstdCompressSync(Buffer.from(encode(records.slice(0, 4)))),
    Buffer.from([0x50, 0x2a, 0x4d, 0x18, 0x03, 0, 0, 0, 1, 2, 3]),
    zstdCompressSync(Buffer.from(encode(records.slice(4)))),
  ]));
  fs.writeFileSync(broken, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01]));
  const files = [recentFile, packed, broken];
  const options = { file: path.join(root, "daily.sqlite"), clock: () => new Date(`${today}T23:59:59`).getTime(),
    listFiles: () => files.filter(fs.existsSync).map((file) => { const stat = fs.statSync(file); return { file, sourceType: "codex", format: file.endsWith(".zst") ? "zstd" : "jsonl", size: stat.size, signature: `${file}:${stat.size}:${stat.mtimeMs}` }; }) };
  const history = createPerformanceHistory(options);
  const scan = await history.refresh();
  assert.equal(scan.status, "partial");
  assert.equal(scan.coverage.failedFiles, 1);
  assert.equal(scan.coverage.compactedLines, 2);
  assert.equal(scan.models[0].n, 1); // older usage does not change the comparison window
  const filters = { from: oldDay, to: today, source: "codex" };
  const result = history.read(filters);
  assert.equal(result.totals.requests, 2);
  assert.equal(result.totals.input, 2400);
  assert.equal(result.totals.cachedInput, 1600);
  assert.equal(result.totals.output, 400);
  assert.equal(result.totals.outputTokS, 50);
  assert.equal(result.days.find((row) => row.day === oldDay).output, 200);
  assert.deepEqual(result.modes.find((row) => row.kind === "tier"), { kind: "tier", value: "fast", evidence: "selected", requests: 2, measured: 2, outputTokS: 50 });
  const csv = historyCsv(history.read({ ...filters, model: records[1].payload.model }, { exportAll: true }));
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/);
  assert.doesNotMatch(csv, /PRIVATE-|PROJECT-NAME|\.jsonl/);

  const moved = path.join(root, "moved.jsonl.zst");
  fs.writeFileSync(moved, zstdCompressSync(fs.readFileSync(recentFile)));
  files.push(moved);
  fs.rmSync(recentFile);
  fs.rmSync(packed);
  fs.rmSync(broken);
  const restarted = createPerformanceHistory(options);
  const rescanned = await restarted.refresh();
  assert.equal(rescanned.status, "ready");
  assert.ok(rescanned.coverage.duplicateRecords >= 1);
  assert.deepEqual(restarted.read(filters).totals, result.totals);
  assert.equal(rescanned.models[0].n, 1);
});

test("history filters accept calendar ranges and reject unsupported sources, paths and invalid dates", () => {
  assert.deepEqual(parseHistoryFilters(new URLSearchParams("from=2024-02-29&to=2024-03-02&source=claude&model=sample&offset=30")),
    { from: "2024-02-29", to: "2024-03-02", source: "claude", model: "sample", offset: 30 });
  for (const query of ["from=2026-02-29", "source=../claude", "from=2024-03-02&to=2024-03-01", "offset=-1", "path=/tmp/session.jsonl"]) {
    assert.throws(() => parseHistoryFilters(new URLSearchParams(query)), RangeError);
  }
});

test("upgrading keeps a recent legacy score sample until its archived source becomes readable", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-legacy-history-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const today = localDay(), day = dayOffset(today, -1), rows = rollout(day);
  const file = path.join(root, "daily.sqlite"), archived = path.join(root, "new-archive.jsonl.zst");
  const db = new DatabaseSync(file);
  const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
  const owner = hash(path.join(root, "old-session.jsonl"));
  db.exec("CREATE TABLE perf_files(id TEXT,version TEXT); CREATE TABLE perf_days(file_id TEXT,day TEXT,value TEXT); CREATE TABLE perf_claims(key TEXT,owner TEXT,day TEXT)");
  db.prepare("INSERT INTO perf_files VALUES(?,?)").run(owner, `2:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  db.prepare("INSERT INTO perf_days VALUES(?,?,?)").run(owner, day, JSON.stringify({ ...emptyRecord(), day, sourceType: "codex", model: "test-model", n: 1, outputSum: 200, durationMsSum: 4000 }));
  db.prepare("INSERT INTO perf_claims VALUES(?,?,?)").run(hash(JSON.stringify(["codex", rows[4].payload.response_id])), owner, day);
  db.close();
  const history = createPerformanceHistory({ file, clock: () => new Date(`${today}T23:59:59`).getTime(), listFiles: () => fs.existsSync(archived)
    ? [{ file: archived, size: fs.statSync(archived).size, signature: "archive", sourceType: "codex", format: "zstd" }] : [] });
  assert.equal((await history.refresh()).models[0].n, 1);
  assert.equal(history.read().totals.requests, 0, "legacy scores cannot reconstruct full usage");
  fs.writeFileSync(archived, zstdCompressSync(Buffer.from(encode(rows))));
  assert.equal((await history.refresh()).models[0].n, 1);
  assert.equal(history.read().totals.requests, 1);
});

test("a large first scan yields between files and the next slice advances past a changed active log", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-history-slices-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const today = localDay(), recent = dayOffset(today, -1), old = dayOffset(today, -60);
  const first = path.join(root, "active.jsonl"), second = path.join(root, "archived.jsonl.zst");
  fs.writeFileSync(first, encode(rollout(recent)));
  fs.writeFileSync(second, zstdCompressSync(Buffer.from(encode(rollout(old)))));
  const history = createPerformanceHistory({ file: path.join(root, "daily.sqlite"), scanBudgetMs: 0,
    clock: () => new Date(`${today}T23:59:59`).getTime(), listFiles: () => [first, second].map((file) => {
      const stat = fs.statSync(file);
      return { file, size: stat.size, signature: `${stat.size}:${stat.mtimeMs}`, sourceType: "codex" };
    }) });
  const partial = await history.refresh();
  assert.equal(partial.status, "loading");
  assert.deepEqual(partial.progress, { completed: 1, total: 2 });
  assert.equal(history.read({ from: old, to: today }).totals.requests, 1);
  fs.appendFileSync(first, "\n");
  const complete = await history.refresh();
  assert.equal(complete.status, "ready");
  assert.deepEqual(complete.progress, { completed: 2, total: 2 });
  assert.equal(history.read({ from: old, to: today }).totals.requests, 2);
});
