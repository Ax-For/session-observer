const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createSummaryStore } = require("../server/summary-store");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-summary-"));
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
    tokenUsage: json.tokenUsage,
  }),
};

test("summary store builds global dashboard data without retaining raw events", () => {
  const dir = makeTempDir();
  const mayFile = path.join(dir, "2026-05-31.jsonl");
  const juneFile = path.join(dir, "2026-06-01.jsonl");

  writeJsonl(mayFile, [
    {
      id: "may",
      time: "2026-05-31T10:00:00.000Z",
      sessionId: "may-session",
      title: "May work",
      cwd: "/repo-a",
      model: "gpt-5",
      content: "archived work",
      tokenUsage: { input: 100, output: 20, total: 120 },
    },
  ], Date.parse("2026-05-31T10:00:00.000Z"));

  writeJsonl(juneFile, [
    {
      id: "june",
      time: "2026-06-01T11:00:00.000Z",
      sessionId: "june-session",
      title: "June work",
      cwd: "/repo-b",
      model: "gpt-5",
      content: "latest work",
      tokenUsage: { input: 200, output: 50, total: 250 },
    },
  ], Date.parse("2026-06-01T11:00:00.000Z"));

  const store = createSummaryStore({ parsers: [parser], now: () => Date.parse("2026-06-06T00:00:00.000Z") });
  const summary = store.getSummary({ files: [mayFile, juneFile] });

  assert.equal(summary.health.eventsTotal, 2);
  assert.equal(summary.health.sessionsTotal, 2);
  assert.equal(summary.tokens.input, 300);
  assert.equal(summary.tokens.output, 70);
  assert.ok(summary.tokens.cost.estimatedUsd > 0);
  assert.equal(summary.tokens.cost.byModel[0].model, "gpt-5");
  assert.equal(summary.sessions.groups.find((group) => group.sessionId === "may-session").startedAt, "2026-05-31T10:00:00.000Z");
  assert.deepEqual(summary.sessions.groups.map((group) => group.sessionId).sort(), ["june-session", "may-session"]);
  assert.ok(summary.charts.dailySessions.length >= 365);
  assert.equal(summary.memory.retainedRawEvents, 0);
});

test("summary store reuses unchanged daily archive summaries", () => {
  const dir = makeTempDir();
  const stableFile = path.join(dir, "stable.jsonl");
  const changingFile = path.join(dir, "changing.jsonl");

  writeJsonl(stableFile, [
    {
      id: "stable",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "stable-session",
      cwd: "/repo",
      content: "stable",
    },
  ], Date.parse("2026-06-01T00:00:00.000Z"));

  writeJsonl(changingFile, [
    {
      id: "first",
      time: "2026-06-02T00:00:00.000Z",
      sessionId: "changing-session",
      cwd: "/repo",
      content: "first",
    },
  ], Date.parse("2026-06-02T00:00:00.000Z"));

  const store = createSummaryStore({ parsers: [parser], now: () => Date.parse("2026-06-06T00:00:00.000Z") });
  store.getSummary({ files: [stableFile, changingFile] });

  writeJsonl(changingFile, [
    {
      id: "first",
      time: "2026-06-02T00:00:00.000Z",
      sessionId: "changing-session",
      cwd: "/repo",
      content: "first",
    },
    {
      id: "second",
      time: "2026-06-03T00:00:00.000Z",
      sessionId: "changing-session",
      cwd: "/repo",
      content: "second",
    },
  ], Date.parse("2026-06-03T00:00:00.000Z"));

  const summary = store.getSummary({ files: [stableFile, changingFile] });

  assert.equal(summary.health.eventsTotal, 3);
  assert.equal(summary.cache.reusedFiles, 1);
  assert.equal(summary.cache.scannedFiles, 1);
});

test("summary store reuses file summaries when metadata signature changes and overlays latest title", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "stable.jsonl");
  let parsedLines = 0;
  const countingParser = {
    ...parser,
    parseLine: (json, context) => {
      parsedLines += 1;
      return parser.parseLine(json, context);
    },
  };

  writeJsonl(file, [
    {
      id: "stable",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "stable-session",
      cwd: "/repo",
      content: "stable",
    },
  ], Date.parse("2026-06-01T00:00:00.000Z"));

  const store = createSummaryStore({ parsers: [countingParser], now: () => Date.parse("2026-06-06T00:00:00.000Z") });
  store.getSummary({
    files: [file],
    stateSignature: "meta-v1",
    threadMeta: new Map([["stable-session", { title: "Old title", cwd: "/repo" }]]),
  });

  const summary = store.getSummary({
    files: [file],
    stateSignature: "meta-v2",
    threadMeta: new Map([["stable-session", { title: "New title", cwd: "/repo" }]]),
  });

  assert.equal(parsedLines, 1);
  assert.equal(summary.cache.reusedFiles, 1);
  assert.equal(summary.cache.scannedFiles, 0);
  assert.equal(summary.sessions.groups[0].sessionTitle, "New title");
});

test("summary store parses only appended lines for a growing current file", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "current.jsonl");
  let parsedLines = 0;
  const countingParser = {
    ...parser,
    parseLine: (json, context) => {
      parsedLines += 1;
      return parser.parseLine(json, context);
    },
  };

  writeJsonl(file, [
    {
      id: "first",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "current-session",
      cwd: "/repo",
      content: "first",
    },
    {
      id: "second",
      time: "2026-06-01T00:01:00.000Z",
      sessionId: "current-session",
      cwd: "/repo",
      content: "second",
    },
  ], Date.parse("2026-06-01T00:01:00.000Z"));

  const store = createSummaryStore({ parsers: [countingParser], now: () => Date.parse("2026-06-06T00:00:00.000Z") });
  store.getSummary({ files: [file] });
  assert.equal(parsedLines, 2);

  fs.appendFileSync(file, `${JSON.stringify({
    id: "third",
    time: "2026-06-01T00:02:00.000Z",
    sessionId: "current-session",
    cwd: "/repo",
    content: "third",
  })}\n`);
  const date = new Date(Date.parse("2026-06-01T00:02:00.000Z"));
  fs.utimesSync(file, date, date);

  const summary = store.getSummary({ files: [file] });

  assert.equal(parsedLines, 3);
  assert.equal(summary.health.eventsTotal, 3);
  assert.equal(summary.cache.scannedFiles, 1);
  assert.equal(summary.cache.incrementalFiles, 1);
});

test("summary store asks parsers for compact content previews", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "large-output.jsonl");
  const contexts = [];
  const compactAwareParser = {
    sourceType: "codex",
    parseLine: (json, context) => {
      contexts.push({ compactContent: context.compactContent, contentLimit: context.contentLimit });
      const rawContent = String(json.content || "");
      const content = context.compactContent && rawContent.length > context.contentLimit
        ? `${rawContent.slice(0, context.contentLimit)}...`
        : rawContent;
      return {
        time: json.time,
        sessionId: json.sessionId,
        cwd: json.cwd,
        model: json.model,
        callType: "Tool_Result",
        summary: content,
        content,
        sourceFile: context.sourceFile,
        sourceType: "codex",
      };
    },
  };

  writeJsonl(file, [
    {
      id: "large",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "large-session",
      cwd: "/repo",
      model: "gpt-5",
      content: "x".repeat(5000),
    },
  ], Date.parse("2026-06-01T00:00:00.000Z"));

  const store = createSummaryStore({ parsers: [compactAwareParser], now: () => Date.parse("2026-06-06T00:00:00.000Z") });
  const summary = store.getSummary({ files: [file] });

  assert.deepEqual(contexts, [{ compactContent: true, contentLimit: 800 }]);
  assert.equal(summary.sessions.groups[0].fallbackTitle.length <= 36, true);
  assert.equal(summary.memory.retainedRawEvents, 0);
});

test("summary store restores unchanged file summaries from persistent cache", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "cached.jsonl");
  const cacheFile = path.join(dir, ".runtime", "summary-cache.json");
  let parsedLines = 0;
  const countingParser = {
    ...parser,
    parseLine: (json, context) => {
      parsedLines += 1;
      return parser.parseLine(json, context);
    },
  };

  writeJsonl(file, [
    {
      id: "cached",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "cached-session",
      cwd: "/repo",
      content: "cached",
    },
  ], Date.parse("2026-06-01T00:00:00.000Z"));

  const firstStore = createSummaryStore({
    parsers: [countingParser],
    now: () => Date.parse("2026-06-06T00:00:00.000Z"),
    cacheFile,
  });
  firstStore.getSummary({ files: [file] });
  assert.equal(parsedLines, 1);
  assert.equal(fs.existsSync(cacheFile), true);

  const secondStore = createSummaryStore({
    parsers: [countingParser],
    now: () => Date.parse("2026-06-06T00:00:00.000Z"),
    cacheFile,
  });
  const summary = secondStore.getSummary({ files: [file] });

  assert.equal(parsedLines, 1);
  assert.equal(summary.cache.reusedFiles, 1);
  assert.equal(summary.cache.scannedFiles, 0);
  assert.equal(summary.health.eventsTotal, 1);
});

test("summary store appends from persistent cache for a growing current file", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "growing.jsonl");
  const cacheFile = path.join(dir, ".runtime", "summary-cache.json");
  let parsedLines = 0;
  const countingParser = {
    ...parser,
    parseLine: (json, context) => {
      parsedLines += 1;
      return parser.parseLine(json, context);
    },
  };

  writeJsonl(file, [
    {
      id: "first",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "growing-session",
      cwd: "/repo",
      content: "first",
    },
  ], Date.parse("2026-06-01T00:00:00.000Z"));

  createSummaryStore({
    parsers: [countingParser],
    now: () => Date.parse("2026-06-06T00:00:00.000Z"),
    cacheFile,
  }).getSummary({ files: [file] });
  assert.equal(parsedLines, 1);

  fs.appendFileSync(file, `${JSON.stringify({
    id: "second",
    time: "2026-06-01T00:01:00.000Z",
    sessionId: "growing-session",
    cwd: "/repo",
    content: "second",
  })}\n`);
  const date = new Date(Date.parse("2026-06-01T00:01:00.000Z"));
  fs.utimesSync(file, date, date);

  const nextStore = createSummaryStore({
    parsers: [countingParser],
    now: () => Date.parse("2026-06-06T00:00:00.000Z"),
    cacheFile,
  });
  const summary = nextStore.getSummary({ files: [file] });

  assert.equal(parsedLines, 2);
  assert.equal(summary.cache.scannedFiles, 1);
  assert.equal(summary.cache.incrementalFiles, 1);
  assert.equal(summary.health.eventsTotal, 2);
});
