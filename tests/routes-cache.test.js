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
