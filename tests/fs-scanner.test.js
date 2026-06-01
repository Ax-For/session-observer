const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { forEachCompleteJsonlLine } = require("../server/fs-scanner");

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
