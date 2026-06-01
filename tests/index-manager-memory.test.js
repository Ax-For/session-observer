const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  fileEventCache,
  makeIndexedEvent,
  parseFileEvents,
  sortEventsChronologically,
} = require("../server/index-manager");

test("makeIndexedEvent stores a compact event without duplicate or empty fields", () => {
  const indexed = makeIndexedEvent({
    time: "2026-06-01T10:00:00.000Z",
    sessionId: "sess-1",
    model: "gpt-5.5",
    turnId: "",
    callId: "",
    toolName: "",
    cwd: "",
    sessionTitle: "",
    extra: "",
    sourceFile: "/tmp/session.jsonl",
    sourceType: "codex",
    callType: "Token_Usage",
    rawType: "",
    rawSubType: "",
    sourceLine: 12,
    lineEventIndex: 0,
    eventId: "event-1",
    content: "Token usage",
    contentPreview: "Token usage",
    summary: "Token usage",
    raw: { large: "payload" },
    tokenUsage: {
      input: 100,
      output: 0,
      total: 100,
      cachedInput: null,
      cacheReadInput: 0,
      cacheCreationInput: 0,
      reasoningOutput: null,
    },
  });

  assert.equal(indexed.raw, undefined);
  assert.equal(Object.hasOwn(indexed, "contentPreview"), false);
  assert.equal(Object.hasOwn(indexed, "contentTruncated"), false);
  assert.equal(Object.hasOwn(indexed, "summary"), false);
  assert.equal(Object.hasOwn(indexed, "turnId"), false);
  assert.equal(Object.hasOwn(indexed, "callId"), false);
  assert.equal(Object.hasOwn(indexed, "toolName"), false);
  assert.equal(Object.hasOwn(indexed, "lineEventIndex"), false);
  assert.deepEqual(indexed.tokenUsage, { input: 100, total: 100 });
});

test("parseFileEvents keeps file cache metadata without retaining per-file event arrays by default", () => {
  fileEventCache.clear();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-index-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ timestamp: "2026-06-01T10:00:00.000Z", content: "hello" }),
    JSON.stringify({ timestamp: "2026-06-01T10:01:00.000Z", content: "world" }),
    "",
  ].join("\n"));

  const parsers = {
    parseCodexLineToEvent: (obj, context) => ({
      time: obj.timestamp,
      sessionId: "sess-1",
      model: "gpt-5.5",
      cwd: "/tmp/project",
      sourceFile: context.sourceFile,
      sourceType: "codex",
      callType: "Agent",
      content: obj.content,
      summary: obj.content,
    }),
  };

  const events = parseFileEvents(file, "state-a", new Map(), parsers, (event) => event);
  const cached = fileEventCache.get(file);

  assert.equal(events.length, 2);
  assert.equal(cached.lineCount, 2);
  assert.equal(cached.events, undefined);
});

test("parseFileEvents includes the latest complete JSON event without a trailing newline", () => {
  fileEventCache.clear();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-latest-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, JSON.stringify({ timestamp: "2026-06-01T10:02:00.000Z", content: "latest" }));

  const parsers = {
    parseCodexLineToEvent: (obj, context) => ({
      time: obj.timestamp,
      sessionId: "sess-latest",
      model: "gpt-5.5",
      cwd: "/tmp/project",
      sourceFile: context.sourceFile,
      sourceType: "codex",
      callType: "Agent",
      content: obj.content,
      summary: obj.content,
    }),
  };

  const events = parseFileEvents(file, "state-a", new Map(), parsers, (event) => event);
  const cached = fileEventCache.get(file);

  assert.equal(events.length, 1);
  assert.equal(events[0].content, "latest");
  assert.equal(events[0].sourceLine, 1);
  assert.equal(cached.lineCount, 1);
  assert.equal(cached.tailBuffer, "");
  assert.equal(cached.endedWithNewline, false);
});

test("sortEventsChronologically keeps missing timestamps before dated events and latest events last", () => {
  const events = [
    { eventId: "latest", time: "2026-06-01T10:00:00.000Z", sourceFile: "b.jsonl", sourceLine: 1 },
    { eventId: "missing", sourceFile: "z.jsonl", sourceLine: 1 },
    { eventId: "old", time: "2026-05-25T10:00:00.000Z", sourceFile: "a.jsonl", sourceLine: 1 },
    { eventId: "same-time-next-line", time: "2026-06-01T10:00:00.000Z", sourceFile: "b.jsonl", sourceLine: 2 },
  ];

  sortEventsChronologically(events);

  assert.deepEqual(events.map((event) => event.eventId), [
    "missing",
    "old",
    "latest",
    "same-time-next-line",
  ]);
});
