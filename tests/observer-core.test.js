const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyEventSessionMeta,
  applySessionTitleOverrides,
  buildTokenUsageWindows,
  buildSessionGroups,
  dedupeEvents,
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
  assert.deepEqual(groups[0].aggregateToken, {
    input: 100,
    output: 25,
    total: 125,
    cachedInput: 10,
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
      tokenUsage: { total: 1200, cachedInput: 300 },
    },
    {
      time: "2026-04-22T11:20:00.000Z",
      sourceType: "claude",
      callType: "Token_Usage",
      tokenUsage: { total: 800, cachedInput: 200 },
    },
    {
      time: "2026-04-19T09:20:00.000Z",
      sourceType: "codex",
      callType: "Token_Usage",
      tokenUsage: { total: 400 },
    },
  ], {
    nowMs: Date.parse("2026-04-23T12:00:00.000Z"),
    timezoneOffsetMinutes: 0,
  });

  assert.deepEqual(windows, {
    day: {
      total: 1500,
      platforms: [
        { key: "codex", total: 1500 },
      ],
    },
    week: {
      total: 2500,
      platforms: [
        { key: "codex", total: 1500 },
        { key: "claude", total: 1000 },
      ],
    },
  });
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
