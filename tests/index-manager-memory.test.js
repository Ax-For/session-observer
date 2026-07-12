const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  fileEventCache,
  filterFileRecordsForIndexWindow,
  limitIndexedEvents,
  makeIndexedEvent,
  parseEventLineFromIndex,
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

test("makeIndexedEvent preserves source truncation metadata for detail hydration", () => {
  const indexed = makeIndexedEvent({
    time: "2026-07-12T15:38:09.415Z",
    sessionId: "sess-image",
    sourceFile: "/tmp/image-session.jsonl",
    sourceType: "codex",
    callType: "Prompt",
    content: "Large user content omitted from event stream (249KB).",
    contentTruncated: true,
    contentLength: 254948,
  });

  assert.equal(indexed.contentTruncated, true);
  assert.equal(indexed.contentLength, 254948);
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

test("parseEventLineFromIndex can read an event by byte offset", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-offset-"));
  const file = path.join(dir, "events.jsonl");
  const first = JSON.stringify({ timestamp: "2026-06-01T10:00:00.000Z", content: "first" });
  const second = JSON.stringify({ timestamp: "2026-06-01T10:01:00.000Z", content: "second" });
  fs.writeFileSync(file, `${first}\n${second}\n`);

  const parsers = {
    parseCodexLineToEvent: (obj, context) => ({
      time: obj.timestamp,
      sessionId: context.sessionId,
      model: context.model,
      cwd: context.cwd,
      sourceFile: context.sourceFile,
      sourceType: "codex",
      callType: "Agent",
      content: obj.content,
      summary: obj.content,
    }),
  };

  const events = parseEventLineFromIndex({
    sourceFile: file,
    sourceOffset: Buffer.byteLength(`${first}\n`),
    sourceLength: Buffer.byteLength(second),
    sessionId: "sess-offset",
    model: "gpt-5.5",
    cwd: "/tmp/project",
  }, new Map(), parsers, (event) => event);

  assert.equal(events.length, 1);
  assert.equal(events[0].content, "second");
  assert.equal(events[0].sourceLine, undefined);
  assert.equal(events[0].sourceOffset, Buffer.byteLength(`${first}\n`));
});

test("parseEventLineFromIndex reads a single detail larger than the stream preview limit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-large-detail-"));
  const file = path.join(dir, "events.jsonl");
  const content = "x".repeat((8 * 1024 * 1024) + 1024);
  const line = JSON.stringify({ timestamp: "2026-06-01T10:00:00.000Z", content });
  fs.writeFileSync(file, `${line}\n`);

  const parsers = {
    parseCodexLineToEvent: (obj, context) => ({
      time: obj.timestamp,
      sessionId: context.sessionId,
      sourceFile: context.sourceFile,
      sourceType: "codex",
      callType: "Agent",
      content: obj.content,
      summary: obj.content,
    }),
  };

  const events = parseEventLineFromIndex({
    sourceFile: file,
    sourceOffset: 0,
    sourceLength: Buffer.byteLength(line),
    sessionId: "sess-large-detail",
  }, new Map(), parsers, (event) => event);

  assert.equal(events.length, 1);
  assert.equal(events[0].content.length, content.length);
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

test("limitIndexedEvents keeps only the latest chronological event window", () => {
  const events = [
    { eventId: "old" },
    { eventId: "middle" },
    { eventId: "new" },
  ];

  const limited = limitIndexedEvents(events, 2);

  assert.equal(limited.events, events);
  assert.deepEqual(events.map((event) => event.eventId), ["middle", "new"]);
  assert.equal(limited.totalEvents, 3);
  assert.equal(limited.retainedEvents, 2);
  assert.equal(limited.omittedEventCount, 1);
});

test("limitIndexedEvents can keep the full index when the limit is disabled", () => {
  const events = [{ eventId: "old" }, { eventId: "new" }];
  const limited = limitIndexedEvents(events, 0);

  assert.equal(limited.events, events);
  assert.equal(limited.totalEvents, 2);
  assert.equal(limited.retainedEvents, 2);
  assert.equal(limited.omittedEventCount, 0);
});

test("filterFileRecordsForIndexWindow skips files outside the active time window", () => {
  const records = [
    { file: "old.jsonl", signature: "old", mtimeMs: Date.parse("2026-05-20T00:00:00.000Z") },
    { file: "recent.jsonl", signature: "recent", mtimeMs: Date.parse("2026-06-01T00:00:00.000Z") },
  ];

  const filtered = filterFileRecordsForIndexWindow(records, Date.parse("2026-05-27T00:00:00.000Z"));

  assert.deepEqual(filtered.files, ["recent.jsonl"]);
  assert.equal(filtered.skippedFiles, 1);
  assert.equal(filtered.scannedFiles, 1);
});

test("parseFileEvents skips old events inside a recent file when a cutoff is provided", () => {
  fileEventCache.clear();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-window-"));
  const file = path.join(dir, "events.jsonl");
  fs.writeFileSync(file, [
    JSON.stringify({ timestamp: "2026-05-20T10:00:00.000Z", content: "old" }),
    JSON.stringify({ timestamp: "2026-06-01T10:00:00.000Z", content: "recent" }),
    "",
  ].join("\n"));

  const parsers = {
    parseCodexLineToEvent: (obj, context) => ({
      time: obj.timestamp,
      sessionId: "sess-window",
      model: "gpt-5.5",
      cwd: "/tmp/project",
      sourceFile: context.sourceFile,
      sourceType: "codex",
      callType: "Agent",
      content: obj.content,
      summary: obj.content,
    }),
  };

  const events = parseFileEvents(file, "state-window", new Map(), parsers, (event) => event, {
    cutoffMs: Date.parse("2026-05-27T00:00:00.000Z"),
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].content, "recent");
  assert.equal(events[0].sourceLine, 2);
});
