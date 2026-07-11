const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyEventSessionMeta,
  applySessionTitleOverrides,
  buildObservabilitySummary,
  buildTokenUsageWindows,
  buildSessionGroups,
  dedupeEvents,
  eventMatchesFilters,
  eventMatchesMode,
  mergeSessionMetaRecords,
  parseClaudeCodeLineToEvent,
  parseCodexLineToEvent,
} = require("../shared/observer-core");

test("parseCodexLineToEvent normalizes user messages into Prompt events", () => {
  const context = {
    model: "gpt-5.4",
    sessionId: "sess-codex",
    cwd: "/tmp/workspace",
    sessionTitle: "Codex Session",
    sourceFile: "codex.jsonl",
  };
  const event = parseCodexLineToEvent({
    timestamp: "2026-04-19T10:00:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ text: "Summarize the latest errors" }],
    },
  }, context);

  assert.equal(event.callType, "Prompt");
  assert.equal(event.model, "gpt-5.4");
  assert.equal(event.sessionId, "sess-codex");
  assert.equal(event.content, "Summarize the latest errors");
});

test("parseCodexLineToEvent keeps full content by default but compacts large output for summary contexts", () => {
  const obj = {
    timestamp: "2026-04-19T10:01:00.000Z",
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "call-1",
      output: "x".repeat(5000),
    },
  };
  const baseContext = {
    model: "gpt-5.4",
    sessionId: "sess-codex",
    cwd: "/tmp/workspace",
    sessionTitle: "Codex Session",
    sourceFile: "codex.jsonl",
  };

  const fullEvent = parseCodexLineToEvent(obj, { ...baseContext });
  const compactEvent = parseCodexLineToEvent(obj, {
    ...baseContext,
    compactContent: true,
    contentLimit: 120,
  });

  assert.equal(fullEvent.content.length, 5000);
  assert.equal(compactEvent.content.length, 123);
  assert.equal(compactEvent.content.endsWith("..."), true);
});

test("parseCodexLineToEvent splits cached input from uncached input tokens", () => {
  const event = parseCodexLineToEvent({
    timestamp: "2026-04-19T10:02:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 3970,
          cached_input_tokens: 3200,
          output_tokens: 48,
          reasoning_output_tokens: 12,
          total_tokens: 4018,
        },
      },
    },
  }, {
    model: "gpt-5.5",
    sessionId: "sess-codex",
    cwd: "/tmp/workspace",
    sessionTitle: "Codex Session",
    sourceFile: "codex.jsonl",
  });

  assert.equal(event.callType, "Token_Usage");
  assert.deepEqual(event.tokenUsage, {
    input: 770,
    output: 48,
    total: 4018,
    cachedInput: 3200,
    cacheReadInput: 3200,
    cacheCreationInput: 0,
    reasoningOutput: 12,
  });
});

test("parseCodexLineToEvent clamps inconsistent cached input to zero uncached input", () => {
  const event = parseCodexLineToEvent({
    timestamp: "2026-04-19T10:03:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 128,
          output_tokens: 8,
          total_tokens: 108,
        },
      },
    },
  }, {
    model: "gpt-5.5",
    sessionId: "sess-codex",
    cwd: "/tmp/workspace",
    sessionTitle: "Codex Session",
    sourceFile: "codex.jsonl",
  });

  assert.equal(event.tokenUsage.input, 0);
  assert.equal(event.tokenUsage.cacheReadInput, 128);
});

test("parseClaudeCodeLineToEvent emits tool, agent, and token usage events from assistant output", () => {
  const context = {
    model: "unknown",
    sessionId: "sess-claude",
    cwd: "/tmp/workspace",
    sessionTitle: "Claude Session",
    sourceFile: "claude.jsonl",
  };
  const events = parseClaudeCodeLineToEvent({
    timestamp: "2026-04-19T10:05:00.000Z",
    sessionId: "sess-claude",
    cwd: "/tmp/workspace",
    uuid: "turn-1",
    type: "assistant",
    message: {
      model: "claude-sonnet-4-6",
      usage: {
        input_tokens: 12,
        output_tokens: 5,
        cache_read_input_tokens: 2,
        cache_creation_input_tokens: 3,
      },
      content: [
        { type: "tool_use", id: "call-1", name: "Read", input: { file_path: "/tmp/workspace/app.js" } },
        { type: "text", text: "Found the issue in the filter path." },
      ],
    },
  }, context);

  assert.equal(events.length, 3);
  assert.equal(events[0].callType, "Tool_Call");
  assert.equal(events[0].toolName, "Read");
  assert.equal(events[1].callType, "Agent");
  assert.match(events[1].content, /Found the issue/);
  assert.equal(events[2].callType, "Token_Usage");
  assert.deepEqual(events[2].tokenUsage, {
    input: 12,
    output: 5,
    total: 17,
    cachedInput: 5,
    cacheReadInput: 2,
    cacheCreationInput: 3,
    reasoningOutput: null,
  });
});

test("parseClaudeCodeLineToEvent captures Claude custom title records", () => {
  const context = {
    model: "unknown",
    sessionId: "sess-claude",
    cwd: "/tmp/workspace",
    sessionTitle: "",
    sourceFile: "claude.jsonl",
  };

  const customTitleEvent = parseClaudeCodeLineToEvent({
    timestamp: "2026-04-19T10:02:00.000Z",
    sessionId: "sess-claude",
    cwd: "/tmp/workspace",
    uuid: "meta-1",
    type: "custom-title",
    customTitle: "Refactor Session",
  }, context);

  const agentNameEvent = parseClaudeCodeLineToEvent({
    timestamp: "2026-04-19T10:02:01.000Z",
    sessionId: "sess-claude",
    cwd: "/tmp/workspace",
    uuid: "meta-2",
    type: "agent-name",
    agentName: "Readable Alias",
  }, {
    ...context,
    sessionTitle: "",
  });

  assert.equal(customTitleEvent.callType, "Raw");
  assert.equal(customTitleEvent.rawType, "custom-title");
  assert.equal(customTitleEvent.sessionTitle, "Refactor Session");
  assert.equal(context.sessionTitle, "Refactor Session");

  assert.equal(agentNameEvent.callType, "Raw");
  assert.equal(agentNameEvent.rawType, "agent-name");
  assert.equal(agentNameEvent.sessionTitle, "Readable Alias");
});

test("eventMatchesFilters searches only user and agent message content", () => {
  const filters = { query: "needle" };

  assert.equal(eventMatchesFilters({ callType: "Prompt", content: "needle from user" }, filters), true);
  assert.equal(eventMatchesFilters({ callType: "User", searchText: "needle from user text" }, filters), true);
  assert.equal(eventMatchesFilters({ callType: "Agent", content: "needle from agent" }, filters), true);
  assert.equal(eventMatchesFilters({ callType: "Tool_Result", content: "needle from tool output" }, filters), false);
  assert.equal(eventMatchesFilters({ callType: "Agent", cwd: "/repo/needle", content: "ordinary answer" }, filters), false);
  assert.equal(eventMatchesFilters({ callType: "Agent", model: "needle-model", content: "ordinary answer" }, filters), false);
  assert.equal(eventMatchesFilters({ callType: "Agent", sessionId: "needle-session", content: "ordinary answer" }, filters), false);
});

test("dedupeEvents prefers non-sidechain events when duplicated", () => {
  const deduped = dedupeEvents([
    {
      time: "2026-04-19T10:10:00.000Z",
      sessionId: "sess-1",
      turnId: "turn-1",
      callType: "Tool_Result",
      content: "command completed",
      extra: "sidechain/tool_result",
    },
    {
      time: "2026-04-19T10:10:01.000Z",
      sessionId: "sess-1",
      turnId: "turn-1",
      callType: "Tool_Result",
      content: "command completed",
      extra: "tool_result",
    },
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].extra, "tool_result");
});

test("dedupeEvents can compact the input array in place to avoid a duplicate event buffer", () => {
  const events = [
    {
      time: "2026-04-19T10:10:00.000Z",
      sessionId: "sess-1",
      turnId: "turn-1",
      callType: "Tool_Result",
      content: "command completed",
      extra: "sidechain/tool_result",
    },
    {
      time: "2026-04-19T10:10:01.000Z",
      sessionId: "sess-1",
      turnId: "turn-1",
      callType: "Tool_Result",
      content: "command completed",
      extra: "tool_result",
    },
    {
      time: "2026-04-19T10:11:00.000Z",
      sessionId: "sess-1",
      turnId: "turn-2",
      callType: "Agent",
      content: "next",
    },
  ];

  const deduped = dedupeEvents(events, { inPlace: true });

  assert.equal(deduped, events);
  assert.equal(events.length, 2);
  assert.equal(events[0].extra, "tool_result");
  assert.equal(events[1].content, "next");
});

test("buildSessionGroups aggregates token usage and derives a cleaned fallback title", () => {
  const groups = buildSessionGroups([
    {
      time: "2026-04-19T10:12:00.000Z",
      sessionId: "sess-2",
      model: "claude-sonnet-4-6",
      turnId: "turn-1",
      callId: "",
      toolName: "",
      cwd: "/tmp/workspace",
      sessionTitle: "",
      extra: "user",
      sourceFile: "claude.jsonl",
      sourceType: "claude",
      callType: "User",
      content: "<command-name>/help</command-name> Inspect this session carefully",
      summary: "Inspect this session carefully",
    },
    {
      time: "2026-04-19T10:12:03.000Z",
      sessionId: "sess-2",
      model: "claude-sonnet-4-6",
      turnId: "turn-1",
      callId: "",
      toolName: "",
      cwd: "/tmp/workspace",
      sessionTitle: "",
      extra: "token_usage",
      sourceFile: "claude.jsonl",
      sourceType: "claude",
      callType: "Token_Usage",
      content: "Token usage",
      summary: "Token usage",
      tokenUsage: {
        input: 100,
        output: 25,
        total: 125,
        cachedInput: 10,
        reasoningOutput: null,
      },
    },
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].fallbackTitle, "/help Inspect this session carefully");
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].startedAt, "2026-04-19T10:12:00.000Z");
  assert.equal(groups[0].latest, "2026-04-19T10:12:03.000Z");
  assert.deepEqual(groups[0].sourceFiles, ["claude.jsonl"]);
  assert.deepEqual(groups[0].aggregateToken, {
    input: 100,
    output: 25,
    total: 125,
    cachedInput: 10,
    cacheReadInput: 10,
    cacheCreationInput: 0,
    reasoningOutput: 0,
  });
});

test("buildSessionGroups keeps Claude custom titles even when they arrive as raw events", () => {
  const context = {
    model: "unknown",
    sessionId: "sess-rename",
    cwd: "/tmp/workspace",
    sessionTitle: "",
    sourceFile: "claude.jsonl",
  };

  const titleEvent = parseClaudeCodeLineToEvent({
    timestamp: "2026-04-19T10:13:00.000Z",
    sessionId: "sess-rename",
    cwd: "/tmp/workspace",
    uuid: "meta-1",
    type: "custom-title",
    customTitle: "Renamed in Claude",
  }, context);

  const groups = buildSessionGroups([
    {
      time: "2026-04-19T10:12:00.000Z",
      sessionId: "sess-rename",
      model: "claude-sonnet-4-6",
      turnId: "turn-1",
      callId: "",
      toolName: "",
      cwd: "/tmp/workspace",
      sessionTitle: "",
      extra: "user",
      sourceFile: "claude.jsonl",
      sourceType: "claude",
      callType: "User",
      content: "Initial prompt",
      summary: "Initial prompt",
    },
    titleEvent,
  ]);

  assert.equal(groups[0].sessionTitle, "Renamed in Claude");
});

test("buildTokenUsageWindows aggregates today and current week token totals by platform", () => {
  const windows = buildTokenUsageWindows([
    {
      time: "2026-04-23T01:10:00.000Z",
      sourceType: "codex",
      callType: "Token_Usage",
      tokenUsage: { input: 600, output: 300, total: 1200, cachedInput: 300, reasoningOutput: 50 },
    },
    {
      time: "2026-04-22T11:20:00.000Z",
      sourceType: "claude",
      callType: "Token_Usage",
      tokenUsage: { input: 600, output: 200, total: 800, cachedInput: 200 },
    },
    {
      time: "2026-04-19T09:20:00.000Z",
      sourceType: "codex",
      callType: "Token_Usage",
      tokenUsage: { input: 300, output: 100, total: 400 },
    },
  ], {
    nowMs: Date.parse("2026-04-23T12:00:00.000Z"),
    timezoneOffsetMinutes: 0,
  });

  assert.deepEqual(windows, {
    day: {
      total: 1200,
      rawTotal: 1200,
      input: 600,
      inputTotal: 900,
      output: 300,
      cachedInput: 300,
      cacheReadInput: 300,
      cacheCreationInput: 0,
      reasoningOutput: 50,
      platforms: [
        { key: "codex", total: 1200 },
      ],
    },
    week: {
      total: 2200,
      rawTotal: 2000,
      input: 1200,
      inputTotal: 1700,
      output: 500,
      cachedInput: 500,
      cacheReadInput: 500,
      cacheCreationInput: 0,
      reasoningOutput: 50,
      platforms: [
        { key: "codex", total: 1200 },
        { key: "claude", total: 1000 },
      ],
    },
  });
});

test("buildObservabilitySummary aggregates health, token, alert, tool, and workspace signals", () => {
  const summary = buildObservabilitySummary([
    {
      time: "2026-04-23T01:10:00.000Z",
      sessionId: "sess-codex",
      sessionTitle: "Fix deploy",
      fallbackTitle: "",
      sourceType: "codex",
      model: "gpt-5.4",
      cwd: "/repo/a",
      callType: "Prompt",
      content: "Fix deploy",
    },
    {
      time: "2026-04-23T01:11:00.000Z",
      sessionId: "sess-codex",
      sessionTitle: "Fix deploy",
      sourceType: "codex",
      model: "gpt-5.4",
      cwd: "/repo/a",
      callType: "Tool_Call",
      toolName: "Shell",
      callId: "call-1",
      content: "npm test",
    },
    {
      time: "2026-04-23T01:12:00.000Z",
      sessionId: "sess-codex",
      sessionTitle: "Fix deploy",
      sourceType: "codex",
      model: "gpt-5.4",
      cwd: "/repo/a",
      callType: "Tool_Result",
      toolName: "Shell",
      callId: "call-1",
      content: "failed with timeout",
      extra: "exit=1",
    },
    {
      time: "2026-04-23T01:13:00.000Z",
      sessionId: "sess-codex",
      sessionTitle: "Fix deploy",
      sourceType: "codex",
      model: "gpt-5.4",
      cwd: "/repo/a",
      callType: "Token_Usage",
      tokenUsage: {
        input: 700,
        output: 200,
        total: 1200,
        cachedInput: 300,
        reasoningOutput: 50,
      },
    },
    {
      time: "2026-04-22T03:00:00.000Z",
      sessionId: "sess-claude",
      sessionTitle: "Review session",
      sourceType: "claude",
      model: "claude-sonnet-4-6",
      cwd: "/repo/b",
      callType: "Tool_Call",
      toolName: "Read",
      callId: "call-2",
      content: "read file",
    },
    {
      time: "2026-04-22T03:01:00.000Z",
      sessionId: "sess-claude",
      sessionTitle: "Review session",
      sourceType: "claude",
      model: "claude-sonnet-4-6",
      cwd: "/repo/b",
      callType: "Token_Usage",
      tokenUsage: {
        input: 400,
        output: 100,
        total: 500,
        cachedInput: 0,
        reasoningOutput: null,
      },
    },
  ], {
    nowMs: Date.parse("2026-04-23T12:00:00.000Z"),
    timezoneOffsetMinutes: 0,
  });

  assert.equal(summary.health.eventsTotal, 6);
  assert.equal(summary.health.sessionsTotal, 2);
  assert.equal(summary.health.alertEvents, 1);
  assert.equal(summary.tokens.effectiveTotal, 1700);
  assert.equal(summary.tokens.inputTotal, 1400);
  assert.equal(summary.tokens.cacheReadInput, 300);
  assert.equal(summary.tokens.cacheCreationInput, 0);
  assert.equal(summary.tokens.cost.estimatedUsd > 0, true);
  assert.equal(summary.tokens.cost.knownTokenTotal > 0, true);
  assert.equal(Array.isArray(summary.tokens.cost.unknownModels), true);
  assert.equal(summary.traces.traces, 2);
  assert.equal(summary.traces.tokenSpans, 2);
  assert.deepEqual(summary.tokens.byPlatform, [
    { key: "codex", total: 1200 },
    { key: "claude", total: 500 },
  ]);
  assert.equal(summary.alerts.total, 1);
  assert.equal(summary.alerts.recent[0].toolName, "Shell");
  assert.equal(summary.tools.totalCalls, 2);
  assert.equal(summary.tools.totalResults, 1);
  assert.equal(summary.tools.categories.find((row) => row.key === "terminal").calls, 1);
  assert.equal(summary.tools.categories.find((row) => row.key === "files").calls, 1);
  assert.deepEqual(summary.tools.topTools, [
    { key: "Shell", calls: 1, results: 1, alerts: 1 },
    { key: "Read", calls: 1, results: 0, alerts: 0 },
  ]);
  assert.deepEqual(summary.workspaces.topWorkspaces, [
    { cwd: "/repo/a", events: 4, sessions: 1, tokens: 1200, alerts: 1 },
    { cwd: "/repo/b", events: 2, sessions: 1, tokens: 500, alerts: 0 },
  ]);
  assert.equal(summary.charts.hourly.length, 24);
  assert.deepEqual(summary.charts.hourly.slice(-2), [
    {
      time: "2026-04-23T11:00:00.000Z",
      label: "11:00",
      events: 0,
      alerts: 0,
      prompts: 0,
      agentMessages: 0,
      interactions: 0,
      toolCalls: 0,
      sessions: 0,
      tokens: 0,
      estimatedUsd: 0,
      knownTokenTotal: 0,
      platforms: [],
    },
    {
      time: "2026-04-23T12:00:00.000Z",
      label: "12:00",
      events: 0,
      alerts: 0,
      prompts: 0,
      agentMessages: 0,
      interactions: 0,
      toolCalls: 0,
      sessions: 0,
      tokens: 0,
      estimatedUsd: 0,
      knownTokenTotal: 0,
      platforms: [],
    },
  ]);
  assert.equal(summary.charts.hourly.find((bucket) => bucket.label === "01:00").tokens, 1200);
  assert.equal(summary.charts.hourly.find((bucket) => bucket.label === "01:00").alerts, 1);
  assert.equal(summary.charts.daily.length, 14);
  assert.equal(summary.charts.daily.at(-1).label, "04/23");
  assert.equal(summary.charts.daily.at(-1).tokens, 1200);
  assert.equal(summary.charts.daily.find((bucket) => bucket.label === "04/22").tokens, 500);
  assert.equal(summary.charts.dailySessions.length, 14);
  const april23 = summary.charts.dailySessions.find((bucket) => bucket.label === "04/23");
  assert.equal(april23.sessions, 1);
  assert.equal(april23.events, 4);
  assert.equal(april23.prompts, 1);
  assert.equal(april23.agentMessages, 0);
  assert.equal(april23.interactions, 1);
  assert.equal(april23.toolCalls, 1);
  assert.equal(april23.tokens, 1200);
  assert.equal(april23.estimatedUsd > 0, true);
  assert.deepEqual(april23.topWorkspace, {
    cwd: "/repo/a",
    events: 4,
    sessions: 1,
    tokens: 1200,
  });
  const april22 = summary.charts.dailySessions.find((bucket) => bucket.label === "04/22");
  assert.equal(april22.sessions, 1);
  assert.equal(april22.events, 2);
  assert.equal(april22.prompts, 0);
  assert.equal(april22.agentMessages, 0);
  assert.equal(april22.interactions, 0);
  assert.equal(april22.toolCalls, 1);
  assert.equal(april22.tokens, 500);
  assert.equal(april22.estimatedUsd > 0, true);
  assert.deepEqual(april22.topWorkspace, {
    cwd: "/repo/b",
    events: 2,
    sessions: 1,
    tokens: 500,
  });
  assert.equal(summary.charts.dailySessions.find((bucket) => bucket.label === "04/21").topWorkspace, null);
  assert.deepEqual(summary.charts.platformShare, [
    { key: "codex", total: 1200 },
    { key: "claude", total: 500 },
  ]);
  assert.deepEqual(summary.charts.alertTypes, [
    { key: "Tool_Result", count: 1 },
  ]);
  assert.equal(summary.usageStats.interactions.prompts, 1);
  assert.equal(summary.usageStats.interactions.toolCalls, 2);
  assert.equal(summary.usageStats.interactions.tokensPerPrompt, 1700);
  assert.equal(summary.usageStats.sessions.averageDurationMs, 120000);
  assert.equal(summary.usageStats.today.interactions, 1);
  assert.equal(summary.usageStats.cadence.activeDays7, 2);
  assert.equal(summary.usageStats.forecast.monthCost > 0, true);
});

test("buildObservabilitySummary can apply Codex fast pricing", () => {
  const summary = buildObservabilitySummary([
    {
      time: "2026-06-01T11:00:00.000Z",
      sessionId: "sess-fast",
      sourceType: "codex",
      model: "gpt-5.5",
      cwd: "/repo/fast",
      callType: "Token_Usage",
      tokenUsage: {
        input: 100,
        cacheReadInput: 100,
        output: 10,
        total: 210,
      },
    },
  ], {
    nowMs: Date.parse("2026-06-01T12:00:00.000Z"),
    costSpeedTier: "fast",
  });

  assert.equal(summary.tokens.cost.estimatedUsd, 0.002125);
});

test("applySessionTitleOverrides updates only matching source groups", () => {
  const groups = [
    { sessionId: "sess-claude", sessionTitle: "", sourceType: "claude" },
    { sessionId: "sess-codex", sessionTitle: "", sourceType: "codex" },
  ];

  applySessionTitleOverrides(groups, new Map([
    ["sess-claude", "Claude Active Title"],
    ["sess-codex", "Codex Indexed Title"],
  ]), "claude");

  assert.equal(groups[0].sessionTitle, "Claude Active Title");
  assert.equal(groups[1].sessionTitle, "");
});

test("applyEventSessionMeta lets Codex metadata overwrite stale transcript titles", () => {
  const event = {
    sessionId: "sess-codex",
    sessionTitle: "Original title",
    cwd: "",
    sourceType: "codex",
  };

  const updated = applyEventSessionMeta({ ...event }, {
    title: "Renamed in Codex",
    cwd: "/tmp/workspace",
    updatedAtMs: 2000,
  }, { titleStrategy: "always" });

  assert.equal(updated.sessionTitle, "Renamed in Codex");
  assert.equal(updated.cwd, "/tmp/workspace");
});

test("mergeSessionMetaRecords keeps explicit title overrides while preserving existing cwd", () => {
  const merged = mergeSessionMetaRecords(
    { title: "Original title", cwd: "/tmp/workspace", updatedAtMs: 1000 },
    { title: "Renamed in Observer", updatedAtMs: 2000 },
  );

  assert.deepEqual(merged, {
    title: "Renamed in Observer",
    cwd: "/tmp/workspace",
    updatedAtMs: 2000,
  });
});

test("eventMatchesMode hides raw and sidechain events in observe mode", () => {
  assert.equal(eventMatchesMode({ callType: "Raw", extra: "" }, "observe"), false);
  assert.equal(eventMatchesMode({ callType: "Agent", extra: "sidechain/assistant" }, "observe"), false);
  assert.equal(eventMatchesMode({ callType: "Agent", extra: "assistant" }, "observe"), true);
  assert.equal(eventMatchesMode({ callType: "Raw", extra: "" }, "raw"), true);
});
