const assert = require("node:assert/strict");
const { test } = require("node:test");

const { compactLargeJsonlLine } = require("../server/jsonl-compact");

test("compactLargeJsonlLine leaves small records unchanged", () => {
  const line = JSON.stringify({
    type: "response_item",
    payload: { type: "function_call_output", output: "short" },
  });

  assert.equal(compactLargeJsonlLine(line), line);
});

test("compactLargeJsonlLine replaces oversized output and keeps valid JSON", () => {
  const line = JSON.stringify({
    timestamp: "2026-06-01T00:00:00.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call-1",
      output: "x".repeat(5000),
    },
  });

  const compacted = compactLargeJsonlLine(line, { threshold: 256, maxValueLength: 120 });
  const parsed = JSON.parse(compacted);

  assert.equal(parsed.timestamp, "2026-06-01T00:00:00.000Z");
  assert.equal(parsed.payload.call_id, "call-1");
  assert.match(parsed.payload.output, /^\[output omitted for summary: 5000 chars\]$/);
  assert.ok(compacted.length < 400);
});

test("compactLargeJsonlLine handles escaped quotes inside large strings", () => {
  const raw = `${"x".repeat(1000)}\\"quoted\\"${"y".repeat(1000)}`;
  const line = `{"payload":{"arguments":"${raw}","name":"Tool"},"type":"response_item"}`;

  const compacted = compactLargeJsonlLine(line, { threshold: 256, maxValueLength: 120 });
  const parsed = JSON.parse(compacted);

  assert.equal(parsed.payload.name, "Tool");
  assert.match(parsed.payload.arguments, /^\[arguments omitted for summary:/);
});

test("compactLargeJsonlLine replaces oversized array fields before JSON.parse", () => {
  const line = JSON.stringify({
    timestamp: "2026-06-01T00:00:00.000Z",
    type: "compacted",
    payload: {
      message: "",
      replacement_history: [
        { role: "assistant", content: "x".repeat(5000) },
        { role: "tool", content: "y".repeat(5000) },
      ],
    },
  });

  const compacted = compactLargeJsonlLine(line, { threshold: 256, maxValueLength: 120 });
  const parsed = JSON.parse(compacted);

  assert.equal(parsed.type, "compacted");
  assert.match(parsed.payload.replacement_history, /^\[replacement_history omitted for summary:/);
  assert.ok(compacted.length < 500);
});
