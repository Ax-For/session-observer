const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createLiveSpeedEngine } = require("../server/live-speed-engine");
const { createLiveSpeedMonitor } = require("../server/live-speed-monitor");
const base = Math.floor(Date.now() / 1000) * 1000 - 100_000;
const at = (s) => new Date(base + s * 1000).toISOString();
const start = (s) => ({ type: "event_msg", timestamp: at(s), payload: { type: "task_started" } });
const usage = (s, id, output = 100) => ({ type: "token_usage_record", timestamp: at(s), payload: { response_id: id, usage: { output_tokens: output } } });
const end = (s) => ({ type: "event_msg", timestamp: at(s), payload: { type: "task_complete" } });
const assistant = (s, id, output, stop) => ({ type: "assistant", timestamp: at(s), sessionId: "c", message: { id, model: "claude-test", usage: { output_tokens: output }, stop_reason: stop, content: [{ type: "text" }] } });

test("live rate uses 3s overlap, replaces predictions with usage and excludes tool waits", () => {
  let now = base + 100_000;
  const engine = createLiveSpeedEngine({ clock: () => now });
  const context = { file: "session.jsonl" };
  const put = (row) => engine.ingest(row, context, "codex");
  put(start(90)); put(usage(94, "reference", 200)); put(start(98));
  let snapshot = engine.snapshot();
  assert.equal(snapshot.measured, 0);
  assert.ok(Math.abs(snapshot.estimated - 100 / 3) < 1e-9);
  assert.equal(snapshot.agents[0].phase, "generating");
  put(usage(100, "current", 60));
  snapshot = engine.snapshot();
  assert.equal(snapshot.measured, 20);
  assert.equal(snapshot.estimated, 0);
  assert.equal(snapshot.agents[0].phase, "tools");
  assert.equal(snapshot.history.reduce((n, row) => n + row.measured, 0), 260);
  assert.equal(snapshot.history.reduce((n, row) => n + row.estimated, 0), 0);
  now += 5000;
  assert.equal(engine.snapshot().measured, 0);
  put(end(105)); assert.equal(engine.snapshot().agents[0].phase, "idle");
});

test("Claude repeated snapshots finalize once and do not terminate a newer request", () => {
  const engine = createLiveSpeedEngine({ clock: () => base + 20_000 });
  const context = { file: "claude.jsonl" };
  const put = (row) => engine.ingest(row, context, "claude");
  put({ type: "api-request", timestamp: at(10), sessionId: "c" });
  put(assistant(12, "r", 8)); put(assistant(14, "r", 200, "tool_use"));
  assert.equal(engine.snapshot().agents[0].phase, "tools");
  put({ type: "user", timestamp: at(18), sessionId: "c", message: { content: [] } });
  put(assistant(19, "r", 200, "tool_use"));
  let s = engine.snapshot();
  assert.equal(s.measuredResponses, 1); assert.equal(s.agents[0].phase, "generating");
  assert.ok(s.estimated > 0);
  put(assistant(20, "r2", 100, "end_turn"));
  s = engine.snapshot();
  assert.equal(s.measuredResponses, 2); assert.equal(s.agents[0].phase, "idle");
  assert.equal(s.estimated, 0);
});

test("the same native response arriving from a second source directory contributes only once to live rates", () => {
  const engine = createLiveSpeedEngine({ clock: () => base + 100_000 });
  for (const [file, sessionId] of [["original.jsonl", "original"], ["mirror.jsonl", "mirror"]]) {
    const context = { file };
    engine.ingest({ type: "user", timestamp: at(98), sessionId, message: { content: "start" } }, context, "claude");
    engine.ingest({ ...assistant(100, "native-response-id", 90, "end_turn"), sessionId }, context, "claude");
  }
  const view = engine.snapshot();
  assert.equal(view.measuredResponses, 1);
  assert.equal(view.measured, 30);
  assert.equal(view.generating, 0);
  assert.equal(view.estimated, 0);
});

test("unknown speed, stale phases, inherited history and source sums stay honest", () => {
  let now = base + 100_000;
  const engine = createLiveSpeedEngine({ clock: () => now });
  const parent = { file: "parent.jsonl" }, child = { file: "child.jsonl" };
  engine.ingest({ type: "session_meta", timestamp: at(90), payload: { id: "child", subagent_history_start_ordinal: 4, source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } } } }, child, "codex");
  engine.ingest({ type: "session_meta", timestamp: at(89), payload: { id: "copied-parent" } }, child, "codex");
  engine.ingest({ ...start(91), ordinal: 1 }, child, "codex");
  engine.ingest({ ...usage(92, "copied"), ordinal: 2 }, child, "codex");
  engine.ingest(start(98), parent, "codex");
  let s = engine.snapshot();
  assert.equal(s.measuredResponses, 0); assert.equal(s.unknown, 1); assert.equal(s.estimated, 0);
  engine.ingest(usage(100, "parent", 100), parent, "codex");
  engine.ingest({ ...start(98), ordinal: 4 }, child, "codex");
  engine.ingest({ ...usage(100, "child", 60), ordinal: 5 }, child, "codex");
  s = engine.snapshot();
  assert.ok(Math.abs(s.measured - 160 / 3) < 1e-9);
  assert.equal(s.sources.reduce((n, row) => n + row.measured, 0), s.measured);
  assert.equal(s.agents.reduce((n, row) => n + row.measured, 0), s.measured);
  assert.equal(s.agents.find((a) => a.sessionId === "child").parentSessionId, "parent");
  assert.equal(s.agents.some((a) => a.sessionId === "copied-parent"), false);
  now += 301000; assert.ok(engine.snapshot().agents.every((a) => a.phase === "idle"));
});

test("legacy cumulative deltas, duplicates and modern migration preserve exclusive output", () => {
  const engine = createLiveSpeedEngine({ clock: () => base + 10_000 });
  const context = { file: "legacy.jsonl" };
  const legacy = (s, total) => ({ type: "event_msg", timestamp: at(s), payload: { type: "token_count", info: { total_token_usage: { total_tokens: total, output_tokens: total }, last_token_usage: { output_tokens: 100 } } } });
  for (const row of [start(0), legacy(2, 100), legacy(3, 100), start(4), legacy(6, 160), start(8), usage(10, "modern", 80), legacy(10, 240)]) engine.ingest(row, context, "codex");
  const s = engine.snapshot();
  assert.equal(s.measuredResponses, 3);
  assert.equal(s.history.reduce((n, row) => n + row.measured, 0), 240);
});

test("500ms floor widens the interval without losing tokens; invalid intervals remain unmeasured", () => {
  const engine = createLiveSpeedEngine({ clock: () => base + 100_000 });
  const context = { file: "floor.jsonl" };
  for (const row of [start(98), usage(98.1, "short", 100), usage(99, "missing", 100)]) engine.ingest(row, context, "codex");
  const s = engine.snapshot();
  assert.equal(s.measuredResponses, 1); assert.equal(s.unmeasuredResponses, 1);
  assert.ok(Math.abs(s.measured - 100 / 3) < 1e-9);
  assert.ok(Math.abs(s.history.reduce((n, r) => n + r.measured, 0) - 100) < 1e-9);
  assert.equal(s.agents[0].recentRate, 200);
});

test("live monitor follows partial appends, skips huge lines, handles rotation and never reads outside roots", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-live-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "s.jsonl");
  const monitor = createLiveSpeedMonitor({ roots: [{ path: root, sourceType: "codex" }], clock: () => base + 100_000, maxLineBytes: 512 });
  t.after(() => monitor.close());
  fs.writeFileSync(file, JSON.stringify(start(98)) + "\n");
  monitor.notify(file); monitor.notify(path.join(root, "..", "outside.jsonl"));
  await monitor.tick(); assert.equal(monitor.snapshot().generating, 1);
  const line = JSON.stringify(usage(100, "r", 100));
  fs.appendFileSync(file, line.slice(0, 20)); await monitor.tick();
  assert.equal(monitor.snapshot().measuredResponses, 0);
  fs.appendFileSync(file, line.slice(20) + "\n" + "x".repeat(1024) + "\n" + JSON.stringify(end(100)) + "\n");
  await monitor.tick();
  let s = monitor.snapshot();
  assert.equal(s.measuredResponses, 1); assert.equal(s.agents[0].phase, "idle");
  assert.equal(s.monitor.skippedLines, 1); assert.equal(s.monitor.trackedFiles, 1); assert.equal(s.monitor.warming, false);
  fs.renameSync(file, file + ".old");
  fs.writeFileSync(file, JSON.stringify(start(100)) + "\n");
  await monitor.tick(); assert.equal(monitor.snapshot().generating, 1);
  fs.unlinkSync(file); await monitor.tick(); assert.equal(monitor.snapshot().monitor.trackedFiles, 0);
});

test("live monitor seeds bounded tails and closes slow SSE consumers", async (t) => {
  const { EventEmitter } = require("events");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-live-tail-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "large.jsonl");
  fs.writeFileSync(file, JSON.stringify({ type: "session_meta", timestamp: at(0), payload: { id: "tail" } }) + "\n" + "x".repeat(10000) + "\n" + [start(98), usage(100, "r")].map(JSON.stringify).join("\n") + "\n");
  const monitor = createLiveSpeedMonitor({ roots: [{ path: root, sourceType: "codex" }], clock: () => base + 100_000, seedBytes: 1024 });
  t.after(() => monitor.close());
  monitor.notify(file); await monitor.tick();
  const s = monitor.snapshot();
  assert.equal(s.monitor.truncatedFiles, 1); assert.equal(s.measuredResponses, 1); assert.equal(s.agents[0].sessionId, "tail");
  const response = new EventEmitter(); Object.assign(response, { writeHead() {}, write() {}, end() { this.ended = true; }, writableLength: 300000 });
  monitor.stream({}, response); await monitor.tick(); assert.equal(response.ended, true);
});
