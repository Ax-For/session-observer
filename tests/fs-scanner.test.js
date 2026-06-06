const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { forEachCompleteJsonlLine, forEachCompleteJsonlLineReverse } = require("../server/fs-scanner");

test("forEachCompleteJsonlLine streams only complete lines and returns the trailing partial", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-scan-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ id: 1 }),
    JSON.stringify({ id: 2 }),
    "{\"id\":",
  ].join("\n"));

  const lines = [];
  const result = forEachCompleteJsonlLine(file, (line, lineNumber) => {
    lines.push({ line, lineNumber });
  });

  assert.deepEqual(lines, [
    { line: JSON.stringify({ id: 1 }), lineNumber: 1 },
    { line: JSON.stringify({ id: 2 }), lineNumber: 2 },
  ]);
  assert.deepEqual(result, {
    lineCount: 2,
    tailBuffer: "{\"id\":",
    endedWithNewline: false,
  });
});

test("forEachCompleteJsonlLine reports when a file ends on a line boundary", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-scan-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, `${JSON.stringify({ id: 1 })}\n`);

  const lines = [];
  const result = forEachCompleteJsonlLine(file, (line, lineNumber) => {
    lines.push({ line, lineNumber });
  });

  assert.deepEqual(lines, [
    { line: JSON.stringify({ id: 1 }), lineNumber: 1 },
  ]);
  assert.deepEqual(result, {
    lineCount: 1,
    tailBuffer: "",
    endedWithNewline: true,
  });
});

test("forEachCompleteJsonlLineReverse streams complete lines from newest to oldest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-scan-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ id: 1 }),
    JSON.stringify({ id: 2 }),
    JSON.stringify({ id: 3 }),
    "{\"id\":",
  ].join("\n"));

  const lines = [];
  const result = forEachCompleteJsonlLineReverse(file, (line, lineNumber) => {
    lines.push({ line, lineNumber });
    return lines.length < 2;
  });

  assert.deepEqual(lines, [
    { line: JSON.stringify({ id: 3 }), lineNumber: 3 },
    { line: JSON.stringify({ id: 2 }), lineNumber: 2 },
  ]);
  assert.equal(result.stoppedEarly, true);
  assert.equal(result.lineCount, 3);
  assert.equal(result.endedWithNewline, false);
});
