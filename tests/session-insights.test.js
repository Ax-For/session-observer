const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildDataConfidence,
  buildExecutionReplay,
  compareSessions,
  deriveSessionOutcome,
} = require("../shared/session-insights");

test("execution replay orders steps and identifies slow and failed operations", () => {
  const replay = buildExecutionReplay([
    { eventId: "result", time: "2026-07-12T10:00:12Z", callType: "Tool_Result", content: "error: failed" },
    { eventId: "prompt", time: "2026-07-12T10:00:00Z", callType: "Prompt", content: "Fix it" },
    { eventId: "tool", time: "2026-07-12T10:00:02Z", callType: "Tool_Call", toolName: "exec_command" },
  ]);

  assert.deepEqual(replay.steps.map((step) => step.id), ["prompt", "tool", "result"]);
  assert.equal(replay.durationMs, 12000);
  assert.equal(replay.errors, 1);
  assert.deepEqual(replay.slowestStepIds, ["tool", "prompt"]);
});

test("execution replay recognizes Codex custom tool records hidden under raw events", () => {
  const replay = buildExecutionReplay([
    { eventId: "call", time: "2026-07-12T10:00:00Z", callType: "Raw", content: "{type: custom_tool_call, name: exec_command}" },
    { eventId: "output", time: "2026-07-12T10:00:01Z", callType: "Raw", content: "{type: custom_tool_call_output, output: ok}" },
  ]);
  assert.deepEqual(replay.steps.map((step) => step.kind), ["tool-call", "tool-result"]);
  assert.equal(replay.toolSteps, 1);
});

test("execution replay removes adjacent mirrored agent records only", () => {
  const replay = buildExecutionReplay([
    { eventId: "agent-a", time: "2026-07-12T10:00:00Z", callType: "Agent", content: "same answer" },
    { eventId: "agent-b", time: "2026-07-12T10:00:01Z", callType: "Agent", content: "same answer" },
    { eventId: "agent-c", time: "2026-07-12T10:01:00Z", callType: "Agent", content: "same answer" },
  ]);
  assert.deepEqual(replay.steps.map((step) => step.id), ["agent-a", "agent-c"]);
});

test("session comparison exposes deterministic deltas", () => {
  const comparison = compareSessions(
    { count: 10, toolCalls: 2, toolErrors: 1, editedFiles: ["a"], aggregateToken: { effectiveTotal: 100 } },
    { count: 16, toolCalls: 4, toolErrors: 0, editedFiles: ["a", "b"], aggregateToken: { effectiveTotal: 80 } },
  );
  assert.equal(comparison.delta.events, 6);
  assert.equal(comparison.delta.tokens, -20);
  assert.equal(comparison.delta.editedFiles, 1);
});

test("outcomes prefer explicit local review and confidence reports coverage", () => {
  const outcome = deriveSessionOutcome({ toolErrors: 2, agent: 1, editedFiles: ["a"] }, { outcome: "partial" });
  assert.equal(outcome.status, "partial");
  assert.equal(outcome.reviewed, true);

  const confidence = buildDataConfidence({
    totalTokens: 100,
    knownTokenTotal: 80,
    sessionsTotal: 10,
    sessionsWithTokens: 9,
    totalFiles: 10,
    reusedFiles: 10,
    unknownModels: ["custom"],
  });
  assert.equal(confidence.score, 87);
  assert.equal(confidence.level, "medium");
  assert.deepEqual(confidence.unknownModels, ["custom"]);
});
