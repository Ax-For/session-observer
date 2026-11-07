const test = require("node:test");
const assert = require("node:assert/strict");
const { parseQwenCodeLineToEvent, tokenInputTotal, tokenCountedTotal } = require("../shared/observer-core");
const { buildResponsePerformance } = require("../shared/response-performance");
const { createLiveSpeedEngine } = require("../server/live-speed-engine");

const now = Date.parse("2026-11-07T08:00:10Z");
const row = (offset, type, uuid, fields = {}) => ({
  type, uuid, timestamp: new Date(now + offset).toISOString(), sessionId: "qwen-test", cwd: "/work/demo", ...fields,
});
const telemetry = (offset, uuid, event) => row(offset, "system", uuid, { subtype: "ui_telemetry", systemPayload: { uiEvent: event } });
const usage = { promptTokenCount: 120, cachedContentTokenCount: 70, candidatesTokenCount: 30, thoughtsTokenCount: 10, totalTokenCount: 150 };

test("Qwen Code parses native messages, tools and usage and pairs completed timing without double counting", () => {
  const rows = [
    row(-7000, "user", "u1", { message: { parts: [{ text: "Inspect the project" }] } }),
    telemetry(-4010, "telemetry", { "event.name": "qwen-code.api_response", status_code: 200, duration_ms: 2000 }),
    row(-4000, "assistant", "a1", { parentUuid: "telemetry", model: "qwen3-max", usageMetadata: usage,
      message: { parts: [{ functionCall: { id: "call-1", name: "read_file", args: { file_path: "src/index.js" } } }] } }),
    row(-3100, "tool_result", "r1", {
      message: { parts: [{ functionResponse: { id: "call-1", name: "read_file", response: { error: "Missing" } } }] },
    }),
    telemetry(-5, "telemetry-2", { "event.name": "qwen-code.api_response", status_code: 200, duration_ms: 1500 }),
    row(0, "assistant", "a2", { parentUuid: "telemetry-2", model: "qwen3-max",
      usageMetadata: { ...usage, totalTokenCount: 160 },
      message: { parts: [{ text: "Checking", thought: true }, { text: "The file is missing." }] } }),
  ];
  const context = { sourceFile: "qwen.jsonl" };
  const events = rows.flatMap((obj) => parseQwenCodeLineToEvent(obj, context));
  assert.deepEqual(events.map((e) => e.callType), ["Prompt", "Tool_Call", "Token_Usage", "Tool_Result", "Thinking", "Agent", "Token_Usage"]);
  const result = events.find((e) => e.callType === "Tool_Result");
  assert.equal(result.callId, "call-1");
  assert.equal(result.isError, true);
  assert.equal(events.find((e) => e.callType === "Agent").content, "The file is missing.");
  const usages = events.filter((e) => e.tokenUsage);
  assert.deepEqual(usages.map((e) => tokenInputTotal(e.tokenUsage, e.sourceType)), [120, 120]);
  assert.deepEqual(usages.map((e) => tokenCountedTotal(e.tokenUsage, e.sourceType)), [150, 160]);
  const detail = buildResponsePerformance(events);
  assert.deepEqual(detail.responses.map((r) => [r.outputTokens, r.durationMs, r.firstContentMs]), [[30, 2000, null], [40, 1500, null]]);

  const engine = createLiveSpeedEngine({ clock: () => now });
  const liveContext = { file: "qwen.jsonl" };
  for (const obj of rows) engine.ingest(obj, liveContext, "qwen");
  engine.ingest(rows.at(-1), liveContext, "qwen");
  const snapshot = engine.snapshot();
  assert.equal(snapshot.measuredResponses, 2);
  const qwen = snapshot.sources.find((s) => s.sourceType === "qwen");
  assert.equal(qwen.measured, 40 / 3);
  assert.equal(qwen.rates.total.measured, 160 / 3);
  assert.equal(qwen.rates.reasoning.measured, 10 / 3);
  assert.equal(qwen.rates.cost.available, false);
  assert.equal(snapshot.agents[0].phase, "idle");
});

test("Qwen Code uses current request lifecycle records and leaves missing starts unmeasured", () => {
  const engine = createLiveSpeedEngine({ clock: () => now });
  const context = { file: "qwen.jsonl" };
  const model = "qwen3-max";
  const assistant = (offset, uuid, fields = {}) => row(offset, "assistant", uuid, { model, usageMetadata: usage, ...fields });
  engine.ingest(assistant(-10000, "no-start"), context, "qwen");
  const started = { "event.name": "request_lifecycle", v: 1, kind: "request", executionId: "r", sessionId: "qwen-test",
    promptId: "prompt", model, startedAt: now - 2200 };
  engine.ingest(telemetry(-2100, "start", { ...started, phase: "started" }), context, "qwen");
  assert.equal(engine.snapshot().agents[0].phase, "generating");
  engine.ingest(telemetry(-300, "done", { ...started, phase: "ended", outcome: "success", durationMs: 1900 }), context, "qwen");
  engine.ingest(assistant(0, "completed", { promptId: "prompt", parentUuid: "done" }), context, "qwen");
  const snapshot = engine.snapshot();
  assert.equal(snapshot.measuredResponses, 1);
  assert.equal(snapshot.unmeasuredResponses, 1);
  assert.equal(snapshot.sources.find((s) => s.sourceType === "qwen").measured, 10);
});
