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

test("queryRecentEvents stops inside a large newest file once the first page is satisfied", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "large-current.jsonl");
  const rows = Array.from({ length: 100 }, (_, index) => ({
    id: `event-${index + 1}`,
    time: new Date(Date.parse("2026-06-01T00:00:00.000Z") + index * 1000).toISOString(),
    sessionId: "current",
    cwd: "/repo",
    content: `event ${index + 1}`,
  }));
  writeJsonl(file, rows, Date.parse("2026-06-01T00:02:00.000Z"));

  let parsed = 0;
  const countingParser = {
    ...parser,
    parseLine: (json, context) => {
      parsed += 1;
      return parser.parseLine(json, context);
    },
  };

  const result = queryRecentEvents({
    files: [file],
    parsers: [countingParser],
    filters: { order: "desc" },
    limit: 5,
    offset: 0,
  });

  assert.deepEqual(result.events.map((event) => event.id), ["event-100", "event-99", "event-98", "event-97", "event-96"]);
  assert.ok(parsed < 20, `expected early stop, parsed ${parsed} rows`);
  assert.equal(result.page.hasMore, true);
  assert.equal(result.scan.stoppedEarly, true);
  assert.equal(result.events[0].sourceLine, undefined);
  assert.ok(Number.isFinite(result.events[0].sourceOffset));
});

test("queryRecentEvents compacts large replacement history before parsing list rows", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "large-compacted.jsonl");
  writeJsonl(file, [
    {
      id: "small",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "current",
      cwd: "/repo",
      content: "small",
    },
    {
      id: "large",
      time: "2026-06-01T00:01:00.000Z",
      sessionId: "current",
      cwd: "/repo",
      payload: {
        replacement_history: [
          { role: "assistant", content: "x".repeat(8000) },
          { role: "tool", content: "y".repeat(8000) },
        ],
      },
    },
  ], Date.parse("2026-06-01T00:01:00.000Z"));

  let replacementHistoryType = "";
  const compactAwareParser = {
    ...parser,
    parseLine: (json, context) => {
      if (json.id === "large") replacementHistoryType = typeof json.payload?.replacement_history;
      return {
        ...parser.parseLine(json, context),
        content: json.payload?.replacement_history || json.content,
      };
    },
  };

  const result = queryRecentEvents({
    files: [file],
    parsers: [compactAwareParser],
    filters: { order: "desc" },
    limit: 1,
    offset: 0,
  });

  assert.equal(result.events[0].id, "large");
  assert.equal(replacementHistoryType, "string");
  assert.match(result.events[0].content, /^\[replacement_history omitted for summary:/);
});

test("queryRecentEvents synthesizes oversized reverse-scan rows without parsing the full JSON line", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "large-output.jsonl");
  const largeLine = {
    timestamp: "2026-06-01T00:01:00.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call-large",
      output: "x".repeat(200000),
    },
  };
  writeJsonl(file, [
    {
      id: "small",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "current",
      cwd: "/repo",
      content: "small",
    },
    largeLine,
  ], Date.parse("2026-06-01T00:01:00.000Z"));

  let parsed = 0;
  const countingParser = {
    ...parser,
    parseLine: (json, context) => {
      parsed += 1;
      return parser.parseLine(json, context);
    },
  };

  const result = queryRecentEvents({
    files: [file],
    parsers: [countingParser],
    filters: { order: "desc" },
    limit: 1,
    offset: 0,
    maxParseLineBytes: 512,
  });

  assert.equal(parsed, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].callType, "Tool_Result");
  assert.equal(result.events[0].callId, "call-large");
  assert.match(result.events[0].content, /^Large tool result omitted from event stream/);
  assert.ok(Number.isFinite(result.events[0].sourceOffset));
});

test("queryRecentEvents seeds reverse scans with session metadata hints", () => {
  const dir = makeTempDir();
  const sessionId = "019e5fc9-10b7-7cd3-98f0-6c1c2cbfecad";
  const file = path.join(dir, `rollout-2026-05-25T23-37-53-${sessionId}.jsonl`);
  writeJsonl(file, [
    {
      id: "old",
      time: "2026-06-01T00:00:00.000Z",
      content: "older",
    },
    {
      id: "latest",
      time: "2026-06-01T00:01:00.000Z",
      content: "latest",
    },
  ], Date.parse("2026-06-01T00:01:00.000Z"));

  const contextParser = {
    sourceType: "codex",
    parseLine: (json, context) => ({
      id: json.id,
      time: json.time,
      sessionId: context.sessionId,
      cwd: context.cwd,
      model: context.model,
      callType: "Agent",
      summary: json.content,
      content: json.content,
      sourceFile: context.sourceFile,
      sourceType: "codex",
    }),
  };

  const result = queryRecentEvents({
    files: [file],
    parsers: [contextParser],
    filters: { order: "desc" },
    limit: 1,
    offset: 0,
    sessionHints: [
      {
        sessionId,
        cwd: "/repo/session-observer",
        models: ["gpt-5.5"],
        sessionTitle: "UI review",
        sourceFiles: [file],
      },
    ],
  });

  assert.equal(result.events[0].id, "latest");
  assert.equal(result.events[0].sessionId, sessionId);
  assert.equal(result.events[0].cwd, "/repo/session-observer");
  assert.equal(result.events[0].model, "gpt-5.5");
  assert.equal(result.events[0].sessionTitle, "UI review");
});
