const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTraceModel,
  summarizeTraceModel,
} = require("../shared/trace-model");

test("buildTraceModel creates session, turn, llm, tool, and token spans", () => {
  const model = buildTraceModel([
    {
      eventId: "evt-user",
      time: "2026-05-30T10:00:00.000Z",
      sessionId: "sess-1",
      turnId: "turn-1",
      callType: "Prompt",
      sourceType: "codex",
      model: "gpt-5.4",
      cwd: "/repo",
      content: "Fix the bug",
    },
    {
      eventId: "evt-tool",
      time: "2026-05-30T10:00:03.000Z",
      sessionId: "sess-1",
      turnId: "turn-1",
      callType: "Tool_Call",
      toolName: "Read",
      sourceType: "codex",
      model: "gpt-5.4",
      cwd: "/repo",
      content: "{}",
    },
    {
      eventId: "evt-token",
      time: "2026-05-30T10:00:06.000Z",
      sessionId: "sess-1",
      turnId: "turn-1",
      callType: "Token_Usage",
      sourceType: "codex",
      model: "gpt-5.4",
      cwd: "/repo",
      tokenUsage: { input: 100, output: 20, total: 120, cacheReadInput: 40 },
    },
  ]);

  assert.equal(model.traces.length, 1);
  assert.equal(model.traces[0].traceId, "sess-1");
  assert.equal(model.spans.filter((span) => span.kind === "session").length, 1);
  assert.equal(model.spans.filter((span) => span.kind === "turn").length, 1);
  assert.equal(model.spans.filter((span) => span.kind === "llm").length, 1);
  assert.equal(model.spans.filter((span) => span.kind === "tool").length, 1);
  assert.equal(model.spans.filter((span) => span.kind === "token").length, 1);
  assert.deepEqual(model.spans.find((span) => span.kind === "token").metrics, {
    input: 100,
    output: 20,
    total: 120,
    cacheReadInput: 40,
    cacheCreationInput: 0,
    reasoningOutput: 0,
  });
});

test("summarizeTraceModel reports depth, tool, and token coverage", () => {
  const summary = summarizeTraceModel(buildTraceModel([
    { eventId: "a", sessionId: "s", turnId: "t", callType: "Prompt", time: "2026-05-30T10:00:00Z" },
    { eventId: "b", sessionId: "s", turnId: "t", callType: "Tool_Call", toolName: "Bash", time: "2026-05-30T10:00:01Z" },
    { eventId: "c", sessionId: "s", turnId: "t", callType: "Token_Usage", tokenUsage: { total: 15 }, time: "2026-05-30T10:00:02Z" },
  ]));

  assert.equal(summary.traces, 1);
  assert.equal(summary.spans, 5);
  assert.equal(summary.toolSpans, 1);
  assert.equal(summary.tokenSpans, 1);
  assert.equal(summary.maxDepth, 3);
});
