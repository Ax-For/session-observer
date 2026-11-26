const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { createPerformanceHistory } = require("../server/performance-history");
const { localDay, dayOffset } = require("../server/performance-score");
const { createLiveSpeedEngine } = require("../server/live-speed-engine");

function rows(source, session, day, count = 20) {
  const begin = new Date(`${day}T12:00:00`).getTime();
  const time = (i, offset) => new Date(begin + i * 10000 + offset).toISOString();
  const result = source === "codex" ? [{ type: "session_meta", timestamp: time(0, -1000), payload: { id: session } }] : [];
  for (let i = 0; i < count; i++) {
    if (source === "codex") result.push(
      { type: "turn_context", timestamp: time(i, 0), payload: { model: "test-model" } },
      { type: "event_msg", timestamp: time(i, 0), payload: { type: "task_started" } },
      { type: "response_item", timestamp: time(i, 1000), payload: { type: "function_call", call_id: `c${i}`, name: "exec_command", arguments: "SECRET-COMMAND" } },
      { type: "token_usage_record", timestamp: time(i, 4000), payload: { response_id: `${session}-r${i}`, usage: { input_tokens: 1000, cached_input_tokens: 950, output_tokens: 200, reasoning_output_tokens: 80 } } },
      { type: "response_item", timestamp: time(i, 4400), payload: { type: "function_call_output", call_id: `c${i}`, output: '{"exit_code":1,"content":"SECRET-OUTPUT"}' } },
      { type: "event_msg", timestamp: time(i, 4500), payload: { type: "task_complete" } },
    );
    else result.push(
      { type: "user", timestamp: time(i, 0), sessionId: session, message: { content: "SECRET-PROMPT" } },
      { type: "assistant", timestamp: time(i, 1000), sessionId: session, message: { id: `r${i}`, model: "test-model", content: [{ type: "tool_use", id: `c${i}`, name: "Read", input: { secret: "SECRET-COMMAND" } }], usage: { input_tokens: 50, cache_read_input_tokens: 950, output_tokens: 8 } } },
      { type: "assistant", timestamp: time(i, 4000), sessionId: session, message: { id: `r${i}`, model: "test-model", stop_reason: "tool_use", content: [{ type: "tool_use", id: `c${i}`, name: "Read", input: {} }], usage: { input_tokens: 50, cache_read_input_tokens: 950, output_tokens: 200, output_tokens_details: { thinking_tokens: 80 } } } },
      { type: "user", timestamp: time(i, 4400), sessionId: session, toolEndsTurn: true, message: { content: [{ type: "tool_result", tool_use_id: `c${i}`, is_error: true, content: "SECRET-OUTPUT" }] } },
    );
  }
  return result;
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-performance-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const roots = ["codex", "claude"].map((sourceType) => { const dir = path.join(root, sourceType); fs.mkdirSync(dir); return { sourceType, path: dir }; });
  const files = [];
  const write = (source, name, records) => {
    const file = path.join(roots.find((r) => r.sourceType === source).path, `${name}.jsonl`);
    fs.writeFileSync(file, records.map((r) => typeof r === "string" ? r : JSON.stringify(r)).join("\n") + "\n");
    if (!files.includes(file)) files.push(file);
    return file;
  };
  const now = new Date(`${localDay()}T23:59:59`).getTime();
  const dbFile = path.join(root, "history.sqlite");
  const options = { file: dbFile, roots, clock: () => now, listFiles: () => files.filter((f) => fs.existsSync(f)).map((file) => {
    const s = fs.statSync(file); return { file, size: s.size, signature: `${file}:${s.size}:${s.mtimeMs}` };
  }) };
  return { write, options, dbFile, now, today: localDay(now) };
}

test("whole-file Codex and Claude histories produce matching normalized facts, cache safely, and exclude today", async (t) => {
  const f = fixture(t), yesterday = dayOffset(f.today, -1);
  f.write("codex", "a", rows("codex", "a", yesterday));
  f.write("claude", "b", rows("claude", "b", yesterday));
  f.write("codex", "today", rows("codex", "today", f.today));
  const history = createPerformanceHistory(f.options);
  const first = await history.refresh();
  assert.equal(first.status, "ready"); assert.equal(first.models.length, 2);
  for (const model of first.models) {
    assert.equal(model.n, 20); assert.equal(model.tools, 20); assert.ok(model.score > 0);
    assert.equal(model.components.find((r) => r.id === "T").measure, 50);
    assert.equal(model.components.find((r) => r.id === "H").measure, 0.95);
    assert.equal(model.components.find((r) => r.id === "R").measure, 20);
    assert.equal(model.components.find((r) => r.id === "S").measure, 0);
    assert.equal(model.trend.filter((r) => r.score != null).length, 1);
  }
  const cached = await history.refresh(); assert.equal(cached.coverage.cached, 3); assert.equal(cached.coverage.scanned, 0);
  assert.equal(fs.statSync(f.dbFile).mode & 0o777, 0o600);
  assert.deepEqual(cached.models, first.models);
  const db = new DatabaseSync(f.dbFile);
  const contents = db.prepare("SELECT value FROM history_days").all().map((r) => r.value).join("") + JSON.stringify(db.prepare("SELECT * FROM history_files").all());
  assert.equal(contents.includes("SECRET"), false); assert.equal(contents.includes(".jsonl"), false);
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name),
    ["history_claims", "history_days", "history_files", "history_legacy_replaced", "history_meta"]);
  assert.ok(db.prepare("SELECT key FROM history_claims").all().every((r) => /^[a-f0-9]{64}$/.test(r.key)));
  db.close();
  const advanced = await createPerformanceHistory({ ...f.options, clock: () => new Date(`${dayOffset(f.today, 1)}T23:59:59`).getTime() }).refresh();
  assert.equal(advanced.models.find((r) => r.sourceType === "codex").n, 40);
});

test("copied Claude histories cannot inflate cached baselines or duplicate their tool actions", async (t) => {
  const f = fixture(t), records = rows("claude", "original", dayOffset(f.today, -1));
  f.write("claude", "original", records);
  const history = createPerformanceHistory(f.options);
  const first = (await history.refresh()).models[0];
  f.write("claude", "copy", records.map((r) => ({ ...r, sessionId: "copy" })));
  const result = await history.refresh();
  assert.equal(result.models[0].n, 20); assert.equal(result.models[0].tools, 20);
  assert.equal(result.models[0].score, first.score); assert.ok(result.coverage.duplicateRecords > 0);
});

test("changed files replace their contributions, compact large payloads, and disclose malformed/incomplete rows", async (t) => {
  const f = fixture(t), day = dayOffset(f.today, -1);
  const file = f.write("claude", "a", rows("claude", "a", day, 19));
  const history = createPerformanceHistory(f.options);
  assert.equal((await history.refresh()).models[0].score, null);
  const records = rows("claude", "a", day, 20);
  records[1].message.content.unshift({ type: "image", source: { data: "x".repeat(512 * 1024) } });
  f.write("claude", "a", [...records, "malformed"]);
  fs.appendFileSync(file, '{"partial":');
  const result = await history.refresh();
  assert.equal(result.models[0].n, 20); assert.ok(result.models[0].score > 0);
  assert.equal(result.coverage.compactedLines, 1); assert.equal(result.coverage.skippedLines, 1); assert.equal(result.coverage.partialFiles, 1);
  fs.unlinkSync(file);
  assert.equal((await history.refresh()).models[0].n, 20);
});

test("live parsing uses first content, cache/reasoning and first tool results without duplicating snapshots", () => {
  const day = localDay(), records = rows("claude", "live", day, 3);
  const now = new Date(`${day}T12:00:25`).getTime();
  const engine = createLiveSpeedEngine({ clock: () => now }), context = { file: "live.jsonl" };
  for (const row of records) engine.ingest(row, context, "claude");
  engine.ingest(records.at(-1), context, "claude");
  const p = engine.snapshot().agents[0].performance;
  assert.equal(p.n, 3); assert.equal(p.tools, 3); assert.equal(p.provisional, true);
  assert.equal(p.components.filter((r) => r.present).length, 7);
  assert.equal(p.components.find((r) => r.id === "L").measure, 1000);
  assert.equal(p.components.find((r) => r.id === "H").measure, 0.95);
});
