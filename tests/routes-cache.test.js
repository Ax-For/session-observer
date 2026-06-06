const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ObserverCore = require("../shared/observer-core");
const { statFile } = require("../server/source-files");

function freshRoutes() {
  const modulePath = require.resolve("../server/routes");
  delete require.cache[modulePath];
  return require("../server/routes");
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "session-observer-routes-"));
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function minimalSummary(overrides = {}) {
  return {
    health: { eventsTotal: 0, sessionsTotal: 0, platformCount: 0, modelCount: 0, ...overrides.health },
    tokens: {
      windows: { day: { total: 0, platforms: [] }, week: { total: 0, platforms: [] } },
      ...overrides.tokens,
    },
    sessions: { groups: overrides.sessions || [], byCwd: {} },
    meta: { models: [], types: [], platforms: [], ...overrides.meta },
    cache: { scannedFiles: 0, reusedFiles: 0, cachedFiles: 0, ...overrides.cache },
    charts: {},
    tools: {},
    workspaces: {},
    traces: {},
  };
}

test("queryObservability uses summary store without building the full index", () => {
  const routes = freshRoutes();
  let summaryCalls = 0;
  let indexCalls = 0;
  const records = [];
  const summary = minimalSummary({ health: { eventsTotal: 12, sessionsTotal: 3 } });

  routes.init({
    parsers: {},
    applyEventSessionMetaCore: () => {},
    mergeSessionMetaRecordsCore: (base, incoming) => ({ ...base, ...incoming }),
    indexManager: {
      ensureIndexReady: () => {
        indexCalls += 1;
        return { events: [], currentAggregateKey: "legacy" };
      },
      signatureHash: (value) => String(value).slice(0, 12),
      trimHeapNow: () => {},
    },
    summaryStore: {
      getSummary: () => {
        summaryCalls += 1;
        return summary;
      },
      invalidate: () => {},
    },
    sourceFileRecordsProvider: () => records,
  });

  const payload = routes.queryObservability();

  assert.equal(indexCalls, 0);
  assert.equal(summaryCalls, 1);
  assert.equal(payload.summary, summary);
  assert.equal(payload.index.mode, "on-demand");
});

test("queryEvents reads a recent page on demand and uses summary store metadata", () => {
  const routes = freshRoutes();
  const dir = makeTempDir();
  const file = path.join(dir, "events.jsonl");
  writeJsonl(file, [
    {
      timestamp: "2026-06-01T10:00:00.000Z",
      type: "message",
      sessionId: "sess-1",
      content: "first",
    },
    {
      timestamp: "2026-06-01T10:01:00.000Z",
      type: "message",
      sessionId: "sess-1",
      content: "second",
    },
  ]);
  const records = [statFile(file)];
  let indexCalls = 0;
  const grouped = [{ sessionId: "sess-1", count: 2, latest: "2026-06-01T10:01:00.000Z", sourceType: "codex" }];
  const summary = minimalSummary({
    health: { eventsTotal: 2, sessionsTotal: 1 },
    sessions: grouped,
    meta: { platforms: ["codex"], types: ["Agent"], models: [] },
  });

  routes.init({
    parsers: {
      parseCodexLineToEvent: (obj, context) => ({
        time: obj.timestamp,
        sessionId: obj.sessionId,
        model: context.model || "unknown",
        sourceFile: context.sourceFile,
        sourceType: "codex",
        callType: "Agent",
        content: obj.content,
        summary: obj.content,
      }),
    },
    applyEventSessionMetaCore: ObserverCore.applyEventSessionMeta,
    mergeSessionMetaRecordsCore: ObserverCore.mergeSessionMetaRecords,
    eventMatchesModeCore: ObserverCore.eventMatchesMode,
    eventMatchesFiltersCore: ObserverCore.eventMatchesFilters,
    toPositiveIntCore: ObserverCore.toPositiveInt,
    toTimeMsCore: ObserverCore.toTimeMs,
    applySessionTitleOverridesCore: (groups) => groups,
    indexManager: {
      ensureIndexReady: () => {
        indexCalls += 1;
        return { events: [], currentAggregateKey: "legacy" };
      },
      signatureHash: (value) => String(value).slice(0, 12),
    },
    summaryStore: {
      getSummary: () => summary,
      getLastSummary: () => summary,
      invalidate: () => {},
    },
    sourceFileRecordsProvider: () => records,
  });

  const filters = routes.parseRequestFilters(new URLSearchParams("limit=1"));
  const payload = routes.queryEvents(filters);

  assert.equal(indexCalls, 0);
  assert.deepEqual(payload.sessions, grouped);
  assert.equal(payload.events.length, 1);
  assert.equal(payload.events[0].content, "second");
  assert.equal(payload.page.hasMore, true);
});
