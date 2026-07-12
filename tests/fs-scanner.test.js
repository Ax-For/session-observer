const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  forEachCompleteJsonlLine,
  forEachCompleteJsonlLineReverse,
  readJsonlLineAtOffset,
} = require("../server/fs-scanner");

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

test("forEachCompleteJsonlLineReverse can skip line counting and expose byte offsets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-scan-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ id: 1 }),
    JSON.stringify({ id: 2 }),
    JSON.stringify({ id: 3 }),
    "{\"id\":",
  ].join("\n"));

  const lines = [];
  const result = forEachCompleteJsonlLineReverse(file, (line, lineNumber, locator) => {
    lines.push({ line, lineNumber, locator });
    return lines.length < 2;
  }, { countLines: false });

  assert.equal(result.lineCount, null);
  assert.equal(result.stoppedEarly, true);
  assert.deepEqual(lines.map((entry) => entry.line), [
    JSON.stringify({ id: 3 }),
    JSON.stringify({ id: 2 }),
  ]);
  assert.deepEqual(lines.map((entry) => entry.lineNumber), [null, null]);
  assert.equal(readJsonlLineAtOffset(file, lines[0].locator.byteOffset), JSON.stringify({ id: 3 }));
  assert.equal(readJsonlLineAtOffset(file, lines[1].locator.byteOffset), JSON.stringify({ id: 2 }));
});

test("forEachCompleteJsonlLineReverse truncates oversized lines for reverse list scans", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-scan-"));
  const file = path.join(dir, "events.jsonl");
  const large = JSON.stringify({ id: 2, output: "x".repeat(200000) });
  fs.writeFileSync(file, [
    JSON.stringify({ id: 1 }),
    large,
    JSON.stringify({ id: 3 }),
  ].join("\n") + "\n");

  const lines = [];
  const result = forEachCompleteJsonlLineReverse(file, (line, lineNumber, locator) => {
    lines.push({ line, lineNumber, locator });
    return lines.length < 2;
  }, { countLines: false, maxLineBytes: 256 });

  assert.equal(result.stoppedEarly, true);
  assert.equal(lines[0].line, JSON.stringify({ id: 3 }));
  assert.equal(lines[1].locator.truncated, true);
  assert.equal(lines[1].locator.byteOffset, Buffer.byteLength(`${JSON.stringify({ id: 1 })}\n`));
  assert.equal(lines[1].locator.byteLength, Buffer.byteLength(large));
  assert.ok(lines[1].line.length < large.length);
  assert.equal(readJsonlLineAtOffset(file, lines[1].locator.byteOffset), large);
});

test("readJsonlLineAtOffset refuses records larger than the detail byte limit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-offset-limit-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, `${"x".repeat(1024)}\n`);

  assert.equal(readJsonlLineAtOffset(file, 0, 128), "");
  assert.equal(readJsonlLineAtOffset(file, 0, 2048), "x".repeat(1024));
});
