const test = require("node:test");
const assert = require("node:assert/strict");

function freshRoutes() {
  const modulePath = require.resolve("../server/routes");
  delete require.cache[modulePath];
  return require("../server/routes");
}

test("queryObservability reuses the summary for an unchanged aggregate key", () => {
  const routes = freshRoutes();
  let aggregateKey = "aggregate-a";
  let buildCalls = 0;
  const events = [
    { sessionId: "sess-1", callType: "Prompt", sourceType: "codex" },
    { sessionId: "sess-1", callType: "Agent", sourceType: "codex" },
  ];

  routes.init({
    parsers: {},
    applyEventSessionMetaCore: () => {},
    dedupeEventsCore: () => {},
    mergeSessionMetaRecordsCore: () => {},
    eventMatchesModeCore: () => true,
    buildObservabilitySummaryCore: (inputEvents) => {
      buildCalls += 1;
      return {
        marker: buildCalls,
        health: { eventsTotal: inputEvents.length },
      };
    },
    indexManager: {
      ensureIndexReady: () => ({ events, currentAggregateKey: aggregateKey }),
      publicIndexState: () => ({ dirty: false }),
    },
  });

  const first = routes.queryObservability();
  const second = routes.queryObservability();

  assert.equal(buildCalls, 1);
  assert.equal(first.summary, second.summary);
  assert.equal(second.summary.marker, 1);

  aggregateKey = "aggregate-b";
  const third = routes.queryObservability();

  assert.equal(buildCalls, 2);
  assert.equal(third.summary.marker, 2);
});

test("queryEvents builds session groups only once when aggregate filters match visible filters", () => {
  const routes = freshRoutes();
  const events = [
    { eventId: "1", sessionId: "sess-1", sourceType: "codex", callType: "Prompt", time: "2026-06-01T10:00:00.000Z" },
    { eventId: "2", sessionId: "sess-1", sourceType: "codex", callType: "Agent", time: "2026-06-01T10:01:00.000Z" },
  ];
  const grouped = [{ sessionId: "sess-1", count: 2, latest: "2026-06-01T10:01:00.000Z" }];
  let buildSessionGroupCalls = 0;
  let mergeCalls = 0;

  routes.init({
    parsers: {},
    applyEventSessionMetaCore: () => {},
    dedupeEventsCore: () => {},
    mergeSessionMetaRecordsCore: () => {},
    eventMatchesModeCore: () => true,
    eventMatchesFiltersCore: () => true,
    buildSessionGroupsCore: (inputEvents) => {
      buildSessionGroupCalls += 1;
      assert.equal(inputEvents.length, events.length);
      return grouped;
    },
    mergeSessionTokenAggregates: (sessions, aggregateSessions) => {
      mergeCalls += 1;
      return sessions.map((session) => ({ ...session, aggregateSessionCount: aggregateSessions.length }));
    },
    buildTokenUsageWindowsCore: () => ({ day: { total: 0, platforms: [] }, week: { total: 0, platforms: [] } }),
    collectMetaCore: () => ({ models: [], types: [], platforms: ["codex"] }),
    toPositiveIntCore: (value, fallback) => Number(value) || fallback,
    toTimeMsCore: (value) => Date.parse(value),
    indexManager: {
      ensureIndexReady: () => ({ events, currentAggregateKey: "aggregate-a" }),
      publicIndexState: () => ({ dirty: false }),
    },
  });

  const filters = routes.parseRequestFilters(new URLSearchParams());
  const payload = routes.queryEvents(filters);

  assert.equal(buildSessionGroupCalls, 1);
  assert.equal(mergeCalls, 0);
  assert.equal(payload.sessions, grouped);
});
