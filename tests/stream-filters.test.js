const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ALERT_PATTERN,
  toDateMs,
  isAlertEvent,
  matchStreamEvent,
} = require("../app/state/stream-filters");

function createEvent(overrides = {}) {
  return {
    time: "2026-04-19T10:00:00.000Z",
    callType: "Agent",
    content: "Patch applied",
    model: "gpt-5.4",
    sessionId: "sess-1",
    turnId: "turn-1",
    callId: "call-1",
    toolName: "",
    extra: "",
    rawType: "",
    rawSubType: "",
    cwd: "/Users/me/repo",
    sessionTitle: "Session title",
    tokenUsage: { total: 5000 },
    sourceType: "codex",
    ...overrides,
  };
}

test("stream filters parse timestamps and detect alert events", () => {
  assert.equal(toDateMs("2026-04-19T10:00:00.000Z"), 1776592800000);
  assert.equal(toDateMs("invalid"), null);
  assert.equal(ALERT_PATTERN.test("timeout"), true);
  assert.equal(isAlertEvent(createEvent({ content: "timeout while running" })), true);
  assert.equal(isAlertEvent(createEvent({ callType: "Tool_Result", extra: "exit: failed" })), true);
  assert.equal(isAlertEvent(createEvent({ content: "all good" })), false);
});

test("stream filters respect mode, quick filters, selected session, and text queries", () => {
  const baseFilters = {
    query: "",
    model: "",
    type: "",
    platform: "",
    start: "",
    end: "",
    selectedSessionId: "",
    quickFilter: "all",
    tokenThreshold: 20000,
  };
  const visible = matchStreamEvent(createEvent(), baseFilters, {
    eventMatchesMode: () => true,
  });
  assert.equal(visible, true);

  assert.equal(matchStreamEvent(createEvent(), { ...baseFilters, selectedSessionId: "sess-2" }, {
    eventMatchesMode: () => true,
  }), false);
  assert.equal(matchStreamEvent(createEvent({ content: "timeout while running" }), { ...baseFilters, quickFilter: "alert" }, {
    eventMatchesMode: () => true,
  }), true);
  assert.equal(matchStreamEvent(createEvent(), { ...baseFilters, quickFilter: "high_token", tokenThreshold: 9000 }, {
    eventMatchesMode: () => true,
  }), false);
  assert.equal(matchStreamEvent(createEvent(), { ...baseFilters, query: "repo" }, {
    eventMatchesMode: () => true,
  }), true);
  assert.equal(matchStreamEvent(createEvent(), { ...baseFilters, query: "missing" }, {
    eventMatchesMode: () => true,
  }), false);
});

test("stream filters apply platform, model, type, and date boundaries", () => {
  const event = createEvent({
    time: "2026-04-19T10:00:00.000Z",
    model: "claude-sonnet-4-6",
    callType: "Tool_Result",
    sourceType: "claude",
  });
  const baseFilters = {
    query: "",
    model: "claude-sonnet-4-6",
    type: "Tool_Result",
    platform: "claude",
    start: "2026-04-19T18:00",
    end: "2026-04-19T19:00",
    selectedSessionId: "",
    quickFilter: "all",
    tokenThreshold: 20000,
  };
  assert.equal(matchStreamEvent(event, baseFilters, {
    eventMatchesMode: () => true,
  }), true);
  assert.equal(matchStreamEvent(event, { ...baseFilters, platform: "codex" }, {
    eventMatchesMode: () => true,
  }), false);
  assert.equal(matchStreamEvent(event, { ...baseFilters, model: "gpt-5.4" }, {
    eventMatchesMode: () => true,
  }), false);
  assert.equal(matchStreamEvent(event, { ...baseFilters, start: "2026-04-19T19:00" }, {
    eventMatchesMode: () => true,
  }), false);
  assert.equal(matchStreamEvent(event, baseFilters, {
    eventMatchesMode: () => false,
  }), false);
});
