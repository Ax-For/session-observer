const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { createQueryExecutor } = require("../server/query-executor");

test("query cancellation stops only the active worker and the queued operation recovers", async (t) => {
  const executor = createQueryExecutor({ workerFile: path.join(__dirname, "support/query-worker.cjs"), timeoutMs: 5000 });
  t.after(() => executor.close());
  const controller = new AbortController();
  const stalled = executor.run("wait", [], { signal: controller.signal });
  const queued = executor.run("echo", ["recovered"]);
  const rejected = assert.rejects(stalled, /cancelled/);
  controller.abort();
  await rejected;
  assert.deepEqual(await queued, ["recovered"]);
  assert.equal(executor.state().queued, 0);
  assert.equal(executor.state().history[1].status, "cancelled");
});

test("worker errors and timeout do not poison later requests", async (t) => {
  const executor = createQueryExecutor({ workerFile: path.join(__dirname, "support/query-worker.cjs"), timeoutMs: 150 });
  t.after(() => executor.close());
  await assert.rejects(executor.run("fail"), /fixture failure/);
  await assert.rejects(executor.run("wait"), /timed out/);
  assert.deepEqual(await executor.run("echo", [42]), [42]);
});

test("real query process reopens an event after losing every in-memory locator", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "observer-worker-"));
  const sources = path.join(root, ".codex/sessions");
  fs.mkdirSync(sources, { recursive: true });
  const file = path.join(sources, "rollout-00000000-0000-0000-0000-000000000099.jsonl");
  fs.writeFileSync(file, [
    { timestamp: "2026-01-01T00:00:00Z", type: "session_meta", payload: { id: "00000000-0000-0000-0000-000000000099", title: "Fixture" } },
    { timestamp: "2026-01-01T00:00:00Z", type: "turn_context", payload: { model: "gpt-5.5", cwd: "/fixture/project" } },
    { timestamp: "2026-01-01T00:00:01Z", type: "event_msg", payload: { type: "agent_message", message: "Full answer" } },
  ].map(JSON.stringify).join("\n") + "\n");
  const executor = createQueryExecutor({ env: { CODEX_SESSIONS_DIR: sources, CLAUDE_PROJECTS_DIR: path.join(root, "empty"),
    CODEX_STATE_DB: path.join(root, "none.sqlite"), CODEX_SESSION_INDEX: path.join(root, "none.jsonl"), OBSERVER_RUNTIME_DIR: path.join(root, "runtime") } });
  t.after(() => { executor.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const filters = { order: "desc", mode: "raw", limit: 10, offset: 0, includeSummary: true, quickFilter: "all", query: "" };
  const page = await executor.run("queryEvents", [filters]);
  const event = page.events.find((item) => item.callType === "Agent");
  assert.ok(event.eventId.startsWith("v3:"));
  executor.reset();
  const detail = await executor.run("getEventDetail", [event.eventId]);
  assert.equal(detail.content, "Full answer");
  assert.equal(detail.sessionId, event.sessionId);
  assert.equal(detail.model, "gpt-5.5");
  assert.equal(detail.cwd, "/fixture/project");
});
