const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { queryRecentEvents } = require("../server/recent-events-reader");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-recent-"));
}

function writeJsonl(file, rows, mtimeMs) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const date = new Date(mtimeMs);
  fs.utimesSync(file, date, date);
}

const parser = {
  sourceType: "codex",
  parseLine: (json, context) => ({
    id: json.id,
    time: json.time,
    sessionId: json.sessionId,
    title: json.title,
    cwd: json.cwd,
    model: json.model,
    callType: json.callType || "Agent",
    summary: json.summary || json.content,
    content: json.content,
    sourceFile: context.sourceFile,
    sourceType: "codex",
  }),
};

test("queryRecentEvents returns the newest matching events without a prebuilt index", () => {
  const dir = makeTempDir();
  const oldFile = path.join(dir, "old.jsonl");
  const newFile = path.join(dir, "new.jsonl");

  writeJsonl(oldFile, [
    {
      id: "old-1",
      time: "2026-05-01T00:00:00.000Z",
      sessionId: "old-session",
      cwd: "/repo",
      content: "older",
    },
  ], Date.parse("2026-05-01T00:00:00.000Z"));

  writeJsonl(newFile, [
    {
      id: "new-1",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "new-session",
      cwd: "/repo",
      content: "first new",
    },
    {
      id: "new-2",
      time: "2026-06-02T00:00:00.000Z",
      sessionId: "new-session",
      cwd: "/repo",
      content: "second new",
    },
  ], Date.parse("2026-06-02T00:00:00.000Z"));

  const result = queryRecentEvents({
    files: [oldFile, newFile],
    parsers: [parser],
    filters: { order: "desc" },
    limit: 2,
    offset: 0,
  });

  assert.equal(result.events.length, 2);
  assert.deepEqual(result.events.map((event) => event.id), ["new-2", "new-1"]);
  assert.equal(result.page.hasMore, true);
  assert.ok(result.scan.scannedFiles < 2, "newest file should satisfy the first page");
});

test("queryRecentEvents can search raw session content on demand", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "events.jsonl");

  writeJsonl(file, [
    {
      id: "a",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "one",
      cwd: "/repo",
      content: "compile backend",
    },
    {
      id: "b",
      time: "2026-06-01T01:00:00.000Z",
      sessionId: "one",
      cwd: "/repo",
      content: "needle from prompt",
    },
  ], Date.parse("2026-06-01T01:00:00.000Z"));

  const result = queryRecentEvents({
    files: [file],
    parsers: [parser],
    filters: { q: "needle", order: "desc" },
    limit: 10,
    offset: 0,
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].id, "b");
  assert.equal(result.events[0].content, "needle from prompt");
});
