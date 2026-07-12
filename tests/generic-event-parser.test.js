const assert = require("node:assert/strict");
const test = require("node:test");
const { parseGenericLineToEvent } = require("../shared/generic-event-parser");

test("generic JSONL adapter normalizes dialogue and token usage", () => {
  const events = parseGenericLineToEvent({
    session_id: "custom-1",
    timestamp: "2026-07-12T12:00:00Z",
    model: "local-model",
    message: { role: "assistant", content: "done" },
    usage: { input_tokens: 12, output_tokens: 4, cached_tokens: 8 },
  }, { sourceType: "custom", sourceFile: "/tmp/custom.jsonl" });
  assert.equal(events[0].callType, "Agent");
  assert.equal(events[0].content, "done");
  assert.equal(events[1].callType, "Token_Usage");
  assert.equal(events[1].tokenUsage.cacheReadInput, 8);
});
