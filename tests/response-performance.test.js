const test = require("node:test");
const assert = require("node:assert/strict");
const { buildResponsePerformance } = require("../shared/response-performance");
const core = require("../shared/observer-core");
const { makeIndexedEvent } = require("../server/index-manager");

const time = (seconds) => new Date(Date.UTC(2026, 10, 7) + seconds * 1000).toISOString();
function parse(rows, source = "codex", context = {}) {
  Object.assign(context, { compactContent: true, sourceFile: `${source}.jsonl`, sessionId: "s" });
  return rows.flatMap((row, i) => {
    const result = source === "codex" ? core.parseCodexLineToEvent(row, context) : core.parseClaudeCodeLineToEvent(row, context);
    return [result].flat().filter(Boolean).map((event, j) => makeIndexedEvent({ ...event, eventId: `${i}-${j}` }));
  });
}
const input = (s, type = "user") => ({ type: "response_item", timestamp: time(s), payload: { type: "message", role: type, content: [{ type: "input_text", text: "fixture" }] } });
const usage = (s, id, output = 100) => ({ type: "token_usage_record", timestamp: time(s), payload: { response_id: id, usage: { output_tokens: output } } });
const claude = (s, id, output, stop_reason) => ({ type: "assistant", timestamp: time(s), sessionId: "s", message: {
  id, model: "fixture-model", stop_reason, content: [{ type: "text", text: "fixture" }], usage: { output_tokens: output },
} });

test("Codex response speed excludes tool execution and deduplicates modern and legacy usage", () => {
  const rows = [input(0), input(2, "assistant"), usage(4, "r1", 100), usage(4.1, "r1", 100),
    { type: "event_msg", timestamp: time(4.2), payload: { type: "token_count", info: { last_token_usage: { output_tokens: 100, total_tokens: 100 } } } },
    { type: "response_item", timestamp: time(14), payload: { type: "function_call_output", output: "done", call_id: "call" } },
    input(16, "assistant"), usage(20, "r2", 300)];
  const result = buildResponsePerformance(parse(rows));
  assert.equal(result.responses.length, 2);
  assert.equal(result.measuredResponses, 2);
  assert.equal(result.outputTokens, 400);
  assert.equal(result.durationMs, 10000);
  assert.equal(result.outputTokensPerSecond, 40);
  assert.equal(result.firstContentP50Ms, 2000);
  assert.equal(result.responses[1].durationMs, 6000);
});

test("Claude snapshots merge once, preserve request start and require a final response", () => {
  const result = buildResponsePerformance(parse([
    { type: "user", timestamp: time(0), message: { content: "fixture" } },
    { type: "api-request", timestamp: time(1) }, claude(2, "a", 8, null), claude(5, "a", 200, "end_turn"),
    { type: "user", timestamp: time(10), message: { content: "fixture" } }, claude(12, "b", 8, null),
    claude(13, "a", 200, "end_turn"),
  ], "claude"));
  assert.equal(result.responses.length, 2);
  assert.equal(result.measuredResponses, 1);
  // A repeated final snapshot does not extend the measured interval.
  assert.equal(result.outputTokensPerSecond, 50);
  assert.equal(result.firstContentP50Ms, 1000);
  assert.equal(result.responses[1].reason, "unfinished");
});

test("missing starts, aborted requests and long intervals never produce fabricated speeds", () => {
  const result = buildResponsePerformance(parse([
    usage(2, "missing"), input(5), { type: "event_msg", timestamp: time(6), payload: { type: "turn_aborted" } },
    usage(7, "aborted"), input(10), input(20, "assistant"), usage(1000, "long"),
  ]));
  assert.equal(result.measuredResponses, 0);
  assert.equal(result.outputTokensPerSecond, null);
  assert.deepEqual(result.responses.map((r) => r.reason), ["missing-start", "missing-start", "invalid-interval"]);
});

test("legacy duplicate cumulative snapshots are skipped but equal outputs from distinct requests survive", () => {
  const legacy = (s, total) => ({ type: "event_msg", timestamp: time(s), payload: { type: "token_count", info: {
    total_token_usage: { input_tokens: 0, output_tokens: total, total_tokens: total }, last_token_usage: { input_tokens: 0, output_tokens: 100, total_tokens: 100 },
  } } });
  const result = buildResponsePerformance(parse([input(0), input(1, "assistant"), legacy(2, 100), legacy(3, 100),
    input(4), input(5, "assistant"), legacy(6, 200)]));
  assert.equal(result.measuredResponses, 2);
  assert.equal(result.outputTokensPerSecond, 50);
});

test("copied parent history is excluded and a truncated window stays explicitly unmeasured", () => {
  const context = {};
  const rows = [
    { type: "session_meta", timestamp: time(100), ordinal: 0, payload: { id: "child", subagent_history_start_ordinal: 4 } },
    { ...input(101), ordinal: 1 }, { ...usage(102, "copied"), ordinal: 2 },
    { ...input(103), ordinal: 4 }, { ...input(104, "assistant"), ordinal: 5 }, { ...usage(105, "own"), ordinal: 6 },
  ];
  const events = parse(rows, "codex", context);
  assert.equal(buildResponsePerformance(events).responses.length, 1);
  assert.equal(buildResponsePerformance(events.slice(-1)).responses[0].reason, "missing-start");
});

test("short valid intervals are floored at 500 ms; zero output and missing usage stay distinct", () => {
  const result = buildResponsePerformance(parse([input(0), input(0.05, "assistant"), usage(0.1, "fast", 100),
    input(2), usage(3, "zero", 0)]));
  assert.equal(result.responses[0].outputTokensPerSecond, 200);
  assert.equal(result.responses[0].durationAdjusted, true);
  assert.equal(result.responses[1].outputTokensPerSecond, 0);
  const incomplete = buildResponsePerformance(parse([input(0), usage(1, "no-usage", undefined)].map((r) => r.type === "token_usage_record" ? { ...r, payload: { response_id: "no-usage", usage: {} } } : r)));
  assert.equal(incomplete.responses[0].reason, "missing-usage");
});

test("a transition to modern usage preserves older legacy responses", () => {
  const legacy = { type: "event_msg", timestamp: time(2), payload: { type: "token_count", info: {
    last_token_usage: { input_tokens: 0, output_tokens: 100, total_tokens: 100 },
    total_token_usage: { output_tokens: 100, total_tokens: 100 },
  } } };
  const result = buildResponsePerformance(parse([input(0), input(1, "assistant"), legacy, input(4), input(5, "assistant"), usage(6, "modern")]));
  assert.equal(result.measuredResponses, 2);
  assert.equal(result.outputTokens, 200);
});

test("legacy output is derived from cumulative deltas when available", () => {
  const legacy = (s, total) => ({ type: "event_msg", timestamp: time(s), payload: { type: "token_count", info: {
    last_token_usage: { input_tokens: 0, output_tokens: 100, total_tokens: 100 },
    total_token_usage: { output_tokens: total, total_tokens: total },
  } } });
  const result = buildResponsePerformance(parse([input(0), legacy(2, 100), input(4), legacy(6, 150)]));
  assert.equal(result.outputTokens, 150);
  assert.equal(result.responses[1].outputTokens, 50);
});

test("metadata, malformed timestamps and synthetic Claude messages never become measured responses", () => {
  const events = parse([
    { type: "turn_context", timestamp: time(0), payload: { model: "fixture-model" } },
    input(1), { ...usage(2, "invalid"), timestamp: "not-a-timestamp" },
  ]);
  assert.equal(buildResponsePerformance(events).responses.length, 0);
  const synthetic = claude(2, "synthetic", 100, "end_turn");
  synthetic.message.model = "<synthetic>";
  const result = buildResponsePerformance(parse([{ type: "user", timestamp: time(0), message: { content: "fixture" } }, synthetic], "claude"));
  assert.equal(result.responses.length, 0);
  assert.equal(result.outputTokensPerSecond, null);
});
