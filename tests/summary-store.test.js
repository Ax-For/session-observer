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
    toolName: json.toolName,
    summary: json.summary || json.content,
    content: json.content,
    sourceFile: context.sourceFile,
    sourceType: "codex",
    tokenUsage: json.tokenUsage,
    extra: json.extra,
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
      model: "gpt-5.5",
      callType: "Token_Usage",
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
      model: "gpt-5.5",
      callType: "Token_Usage",
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
  assert.equal(summary.tokens.cost.byModel[0].model, "gpt-5.5");
  assert.equal(summary.charts.daily.find((row) => row.label === "06/01").estimatedUsd, 0.0025);
  assert.equal(summary.tokens.windows.week.estimatedUsd, 0.0025);
  assert.equal(summary.tokens.windows.week.knownTokenTotal, 250);
  assert.equal(summary.tokens.topSessions.find((row) => row.sessionId === "june-session").estimatedUsd, 0.0025);
  assert.equal(summary.tokens.byWorkspace.find((row) => row.cwd === "/repo-b").estimatedUsd, 0.0025);
  assert.equal(summary.charts.workspaceTokens.find((row) => row.cwd === "/repo-b").estimatedUsd, 0.0025);
  assert.equal(summary.sessions.groups.find((group) => group.sessionId === "may-session").startedAt, "2026-05-31T10:00:00.000Z");
  assert.deepEqual(summary.sessions.groups.map((group) => group.sessionId).sort(), ["june-session", "may-session"]);
  assert.ok(summary.charts.dailySessions.length >= 365);
  assert.equal(summary.memory.retainedRawEvents, 0);
});

test("summary store builds cached token snapshots for today, seven days, and thirty days", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "range-usage.jsonl");

  writeJsonl(file, [
    {
      id: "outside",
      time: "2026-05-01T04:00:00.000Z",
      sessionId: "outside-session",
      title: "Outside range",
      cwd: "/repo-old",
      model: "gpt-5.4",
      callType: "Token_Usage",
      tokenUsage: { input: 400, output: 40, total: 440 },
    },
    {
      id: "month",
      time: "2026-05-20T04:00:00.000Z",
      sessionId: "month-session",
      title: "Month work",
      cwd: "/repo-month",
      model: "gpt-5.4",
      callType: "Token_Usage",
      tokenUsage: { input: 300, output: 30, total: 330 },
    },
    {
      id: "week",
      time: "2026-06-03T04:00:00.000Z",
      sessionId: "week-session",
      title: "Week work",
      cwd: "/repo-week",
      model: "gpt-5.5",
      callType: "Token_Usage",
      tokenUsage: { input: 200, cacheReadInput: 80, output: 20, total: 300 },
    },
    {
      id: "today",
      time: "2026-06-06T04:00:00.000Z",
      sessionId: "today-session",
      title: "Today work",
      cwd: "/repo-today",
      model: "gpt-5.5",
      callType: "Token_Usage",
      tokenUsage: { input: 100, cacheReadInput: 50, output: 10, total: 160 },
    },
  ], Date.parse("2026-06-06T04:00:00.000Z"));

  const store = createSummaryStore({
    parsers: [parser],
    now: () => Date.parse("2026-06-06T06:00:00.000Z"),
  });
  const summary = store.getSummary({ files: [file] });

  assert.deepEqual(Object.keys(summary.tokenRanges), ["today", "week", "month"]);
  assert.equal(summary.tokenRanges.today.days, 1);
  assert.equal(summary.tokenRanges.today.tokens.effectiveTotal, 160);
  assert.equal(summary.tokenRanges.today.health.sessionsTotal, 1);
  assert.equal(summary.tokenRanges.today.tokens.byModel[0].key, "gpt-5.5");
  assert.equal(summary.tokenRanges.today.tokens.byWorkspace[0].cwd, "/repo-today");
  assert.equal(summary.tokenRanges.today.tokens.topSessions[0].sessionId, "today-session");
  assert.equal(summary.tokenRanges.today.timelineGranularity, "hour");

  assert.equal(summary.tokenRanges.week.tokens.effectiveTotal, 460);
  assert.equal(summary.tokenRanges.week.health.sessionsTotal, 2);
  assert.equal(summary.tokenRanges.week.timelineGranularity, "day");
  assert.equal(summary.tokenRanges.week.history.cachedHistoricalDays, 6);

  assert.equal(summary.tokenRanges.month.tokens.effectiveTotal, 790);
  assert.equal(summary.tokenRanges.month.health.sessionsTotal, 3);
  assert.equal(summary.tokenRanges.month.tokens.cost.byModel.length, 2);
  assert.equal(summary.tokenRanges.month.tokens.byWorkspace.some((row) => row.cwd === "/repo-old"), false);
  assert.equal(summary.tokenRanges.month.history.strategy, "persisted-daily-summaries");
});

test("summary store derives interaction, cadence, duration, forecast, and tool category statistics", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "2026-06-05.jsonl");

  writeJsonl(file, [
    {
      id: "prompt",
      time: "2026-06-05T10:00:00.000Z",
      sessionId: "stats-session",
      title: "Statistics work",
      cwd: "/repo-stats",
      model: "gpt-5.5",
      callType: "Prompt",
      content: "Add usage statistics",
    },
    {
      id: "agent",
      time: "2026-06-05T10:01:00.000Z",
      sessionId: "stats-session",
      title: "Statistics work",
      cwd: "/repo-stats",
      model: "gpt-5.5",
      callType: "Agent",
      content: "I will implement it",
    },
    {
      id: "tool",
      time: "2026-06-05T10:02:00.000Z",
      sessionId: "stats-session",
      title: "Statistics work",
      cwd: "/repo-stats",
      model: "gpt-5.5",
      callType: "Tool_Call",
      toolName: "apply_patch",
      content: "patch files",
    },
    {
      id: "tokens",
      time: "2026-06-05T10:03:00.000Z",
      sessionId: "stats-session",
      title: "Statistics work",
      cwd: "/repo-stats",
      model: "gpt-5.5",
      callType: "Token_Usage",
      content: "usage",
      tokenUsage: { input: 1000, output: 200, total: 1200 },
    },
  ], Date.parse("2026-06-05T10:03:00.000Z"));

  const store = createSummaryStore({ parsers: [parser], now: () => Date.parse("2026-06-06T12:00:00.000Z") });
  const summary = store.getSummary({ files: [file] });

  assert.equal(summary.usageStats.interactions.prompts, 1);
  assert.equal(summary.usageStats.interactions.agentMessages, 1);
  assert.equal(summary.usageStats.interactions.toolCalls, 1);
  assert.equal(summary.usageStats.sessions.averageDurationMs, 180000);
  assert.equal(summary.usageStats.cadence.activeDays7, 1);
  assert.equal(summary.usageStats.cadence.recent7.interactions, 2);
  assert.equal(summary.usageStats.forecast.monthCost > 0, true);
  assert.equal(summary.sessions.groups[0].toolCalls, 1);
  assert.equal(summary.charts.daily.find((row) => row.label === "06/05").interactions, 2);
  assert.equal(summary.tools.categories.find((row) => row.key === "code").calls, 1);
});

test("summary store keeps bounded session goal, outcome, tool, file, model, and compaction summaries", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "session-details.jsonl");

  writeJsonl(file, [
    {
      id: "prompt",
      time: "2026-06-05T10:00:00.000Z",
      sessionId: "detail-session",
      cwd: "/repo-details",
      model: "gpt-5.5",
      callType: "Prompt",
      content: "Build a compact event workbench",
    },
    {
      id: "edit",
      time: "2026-06-05T10:01:00.000Z",
      sessionId: "detail-session",
      cwd: "/repo-details",
      model: "gpt-5.5",
      callType: "Tool_Call",
      toolName: "apply_patch",
      content: "tool=apply_patch args={\"file_path\":\"/repo-details/src/app.jsx\"}",
    },
    {
      id: "error",
      time: "2026-06-05T10:02:00.000Z",
      sessionId: "detail-session",
      cwd: "/repo-details",
      model: "gpt-5.5",
      callType: "Tool_Result",
      toolName: "apply_patch",
      content: "Error: patch failed",
    },
    {
      id: "compact",
      time: "2026-06-05T10:03:00.000Z",
      sessionId: "detail-session",
      cwd: "/repo-details",
      model: "gpt-5.6-sol",
      callType: "Raw",
      content: "context_compacted",
    },
    {
      id: "agent",
      time: "2026-06-05T10:04:00.000Z",
      sessionId: "detail-session",
      cwd: "/repo-details",
      model: "gpt-5.6-sol",
      callType: "Agent",
      content: "The event workbench is complete",
    },
  ], Date.parse("2026-06-05T10:04:00.000Z"));

  const store = createSummaryStore({ parsers: [parser], now: () => Date.parse("2026-06-06T12:00:00.000Z") });
  const session = store.getSummary({ files: [file] }).sessions.groups[0];

  assert.equal(session.firstUserMessage, "Build a compact event workbench");
  assert.equal(session.latestAgentMessage, "The event workbench is complete");
  assert.deepEqual(session.topTools, [{ key: "apply_patch", calls: 1 }]);
  assert.deepEqual(session.editedFiles, ["/repo-details/src/app.jsx"]);
  assert.equal(session.toolErrors, 1);
  assert.equal(session.compactions, 1);
  assert.deepEqual(session.modelTimeline.map((item) => item.model), ["gpt-5.5", "gpt-5.6-sol"]);
  assert.equal(session.firstUserMessage.length <= 240, true);
  assert.equal(session.latestAgentMessage.length <= 320, true);
});

test("summary store applies Codex fast pricing to event and model cost summaries", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "2026-06-01.jsonl");

  writeJsonl(file, [
    {
      id: "fast",
      time: "2026-06-01T11:00:00.000Z",
      sessionId: "fast-session",
      title: "Fast work",
      cwd: "/repo-fast",
      model: "gpt-5.5",
      callType: "Token_Usage",
      content: "fast work",
      tokenUsage: { input: 100, cacheReadInput: 100, output: 10, total: 210 },
    },
  ], Date.parse("2026-06-01T11:00:00.000Z"));

  const store = createSummaryStore({
    parsers: [parser],
    costSpeedTier: "fast",
    now: () => Date.parse("2026-06-06T00:00:00.000Z"),
  });
  const summary = store.getSummary({ files: [file] });

  assert.equal(summary.tokens.cost.estimatedUsd, 0.002125);
  assert.equal(summary.tokens.cost.speedTier, "fast");
  assert.equal(summary.tokens.cost.byModel[0].estimatedUsd, 0.002125);
  assert.equal(summary.tokens.topSessions.find((row) => row.sessionId === "fast-session").estimatedUsd, 0.002125);
  assert.equal(summary.tokens.byWorkspace.find((row) => row.cwd === "/repo-fast").estimatedUsd, 0.002125);
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

test("summary store derives an accurate current topic and ignores internal title placeholders", () => {
  const dir = makeTempDir();
  const file = path.join(dir, "title-quality.jsonl");

  writeJsonl(file, [
    {
      id: "internal",
      time: "2026-06-01T00:00:00.000Z",
      sessionId: "title-session",
      cwd: "/repo/session-observer",
      callType: "Prompt",
      content: "[text omitted for summary: 9692 chars]",
    },
    {
      id: "first-user",
      time: "2026-06-01T00:01:00.000Z",
      sessionId: "title-session",
      cwd: "/repo/session-observer",
      callType: "Prompt",
      content: "为当前项目建立活跃会话面板",
    },
    {
      id: "current-topic",
      time: "2026-06-01T00:02:00.000Z",
      sessionId: "title-session",
      cwd: "/repo/session-observer",
      callType: "Prompt",
      content: "我希望会话详情可以用聊天窗口查看完整对话过程",
    },
    {
      id: "low-signal",
      time: "2026-06-01T00:03:00.000Z",
      sessionId: "title-session",
      cwd: "/repo/session-observer",
      callType: "Prompt",
      content: "继续吧",
    },
  ], Date.parse("2026-06-01T00:03:00.000Z"));

  const store = createSummaryStore({ parsers: [parser], now: () => Date.parse("2026-06-06T00:00:00.000Z") });
  const summary = store.getSummary({
    files: [file],
    threadMeta: new Map([["title-session", { title: "session-observer 管理", cwd: "/repo/session-observer" }]]),
  });
  const session = summary.sessions.groups[0];

  assert.equal(session.fallbackTitle, "为当前项目建立活跃会话面板");
  assert.equal(session.firstUserMessage, "为当前项目建立活跃会话面板");
  assert.equal(session.latestUserMessage, "继续吧");
  assert.equal(session.currentTopic, "我希望会话详情可以用聊天窗口查看完整对话过程");
  assert.equal(session.displayTitle, "会话详情可以用聊天窗口查看完整对话过程");
  assert.equal(session.titleSource, "current-topic");

  const renamed = store.getSummary({
    files: [file],
    threadMeta: new Map([["title-session", {
      title: "手动命名的会话",
      cwd: "/repo/session-observer",
      explicitTitle: true,
    }]]),
  }).sessions.groups[0];
  assert.equal(renamed.displayTitle, "手动命名的会话");
  assert.equal(renamed.titleSource, "custom");
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
      model: "gpt-5.5",
      callType: "Token_Usage",
      content: "cached",
      tokenUsage: { input: 100, output: 20, total: 120 },
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
  assert.equal(summary.tokenRanges.week.tokens.effectiveTotal, 120);
  assert.equal(summary.tokenRanges.week.tokens.topSessions[0].sessionId, "cached-session");
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
