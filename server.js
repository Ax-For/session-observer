#!/usr/bin/env node
/**
 * Session Observer — thin entry point.
 * Wires together config, index manager, routes, and session ops.
 */
const http = require("http");
const ObserverCore = require("./shared/observer-core");
const config = require("./server/config");
const isQueryWorker = process.argv.includes("--query-worker");
if (!isQueryWorker) config.ensureFrontendBuild();
const { createQueryExecutor } = require("./server/query-executor");
const { policyError, readBody } = require("./server/http-policy");
const { createSourceWatchers } = require("./server/source-watchers");
const { createLiveSpeedMonitor } = require("./server/live-speed-monitor");
const { DEFAULT_HISTORY_MINUTES, LIVE_HISTORY_MINUTES } = require("./shared/response-performance");
const { getNativeLocations } = require("./server/source-locations");
const { parseHistoryFilters, historyCsv } = require("./server/history-query");
const liveSpeed = isQueryWorker ? null : createLiveSpeedMonitor({ roots: getNativeLocations() });
const executor = isQueryWorker ? null : createQueryExecutor();
const { createPerformanceBaselineService } = require("./server/performance-baseline-service");
const performanceBaseline = isQueryWorker ? null : createPerformanceBaselineService({ executor, onUpdate: liveSpeed.setBaseline });
let watchers = null;
const indexManager = require("./server/index-manager");
const routes = require("./server/routes");
const sessionOps = require("./server/session-ops");
const { createSourceChangeBus } = require("./server/source-change-bus");
const { createSummaryStore } = require("./server/summary-store");
const { createCodexUsageService } = require("./server/codex-usage");
const { createSessionAnnotationStore } = require("./server/session-annotations");
const { createDialogueSearchIndex } = require("./server/dialogue-search-index");
const { createAnalysisServices } = require("./server/analysis-services");
const analysisServices = createAnalysisServices(config.RUNTIME_DIR);
let activeJobId;
const { parseGenericLineToEvent } = require("./shared/generic-event-parser");
require("./server/custom-sources").loadCustomSources();

const {
  applyEventSessionMeta: applyEventSessionMetaCore,
  applySessionTitleOverrides: applySessionTitleOverridesCore,
  buildObservabilitySummary: buildObservabilitySummaryCore,
  buildTokenUsageWindows: buildTokenUsageWindowsCore,
  buildSessionGroups: buildSessionGroupsCore,
  collectMeta: collectMetaCore,
  dedupeEvents: dedupeEventsCore,
  eventMatchesFilters: eventMatchesFiltersCore,
  eventMatchesMode: eventMatchesModeCore,
  mergeSessionMetaRecords: mergeSessionMetaRecordsCore,
  parseClaudeCodeLineToEvent: parseClaudeCodeLineToEventCore,
  parseCodexLineToEvent: parseCodexLineToEventCore,
  parseQwenCodeLineToEvent,
  parseDshLineToEvent,
  toPositiveInt: toPositiveIntCore,
  toTimeMs: toTimeMsCore,
} = ObserverCore;

const parsers = {
  parseCodexLineToEvent: parseCodexLineToEventCore,
  parseClaudeCodeLineToEvent: parseClaudeCodeLineToEventCore,
  parseQwenCodeLineToEvent,
  parseDshLineToEvent,
  parseGenericLineToEvent,
};

const summaryStore = createSummaryStore({
  parsers,
  applyEventSessionMetaCore,
  cacheFile: config.SUMMARY_CACHE_FILE,
  costSpeedTier: process.env.OBSERVER_CODEX_SERVICE_TIER || "standard",
  loadPrices: () => analysisServices.loadPrices(),
  onProgress: (progress) => { if (isQueryWorker && activeJobId) process.send?.({ id: activeJobId, progress }); },
});
const sourceChangeBus = createSourceChangeBus({
  debounceMs: config.SOURCE_CHANGE_DEBOUNCE_MS,
});
const codexUsageService = createCodexUsageService({
  version: require("./server/versions").codexVersion,
  cacheFile: config.CODEX_USAGE_CACHE_FILE,
});
const annotationStore = createSessionAnnotationStore({
  file: config.SESSION_ANNOTATIONS_FILE,
});
const dialogueSearchIndex = createDialogueSearchIndex({
  enabled: config.DIALOGUE_SEARCH_MODE === "sqlite",
  file: config.DIALOGUE_SEARCH_DB,
  parsers,
  onProgress: (progress) => { if (isQueryWorker && activeJobId) process.send?.({ id: activeJobId, progress }); },
});

function mergeSessionTokenAggregates(sessions, aggregateSessions) {
  const aggregateBySessionId = new Map(
    (aggregateSessions || []).map((session) => [session.sessionId, session]),
  );
  return (sessions || []).map((session) => {
    const aggregate = aggregateBySessionId.get(session.sessionId);
    if (!aggregate) return session;
    return {
      ...session,
      sessionTitle: session.sessionTitle || aggregate.sessionTitle,
      fallbackTitle: session.fallbackTitle || aggregate.fallbackTitle,
      cwd: session.cwd || aggregate.cwd,
      sourceType: session.sourceType || aggregate.sourceType,
      models: mergeUniqueValues(session.models, aggregate.models),
      latestToken: aggregate.latestToken || session.latestToken,
      aggregateToken: aggregate.aggregateToken || session.aggregateToken,
    };
  });
}

function mergeUniqueValues(left, right) {
  return [...new Set([...(left || []), ...(right || [])])].filter(Boolean).sort();
}

// Initialize routes with injected dependencies
routes.init({
  indexManager,
  parsers,
  applyEventSessionMetaCore,
  dedupeEventsCore,
  mergeSessionMetaRecordsCore,
  eventMatchesModeCore,
  eventMatchesFiltersCore,
  buildSessionGroupsCore,
  mergeSessionTokenAggregates,
  buildTokenUsageWindowsCore,
  collectMetaCore,
  toPositiveIntCore,
  toTimeMsCore,
  buildObservabilitySummaryCore,
  applySessionTitleOverridesCore,
  summaryStore,
  annotationStore,
  analysisServices,
  dialogueSearchIndex,
});

// The default data path uses on-demand reads plus lightweight summary caching.
const boundScheduleSourceRefresh = (reason = "source-change") => {
  routes.invalidateCaches();
  executor?.invalidate();
  sourceChangeBus.notify(reason);
};

function readJsonBody(req, res, onPayload) {
  readBody(req, res, sendJson, onPayload);
}

function usageHistoryStatus() {
  const { status, generatedAt, timezone, coverage, progress, error } = performanceBaseline.state();
  return { status, generatedAt, timezone, coverage, progress, error };
}

function reloadLivePrices() {
  try { analysisServices.loadPrices(); }
  catch { console.warn("[live-speed] Unable to reload the local pricebook."); }
}

function runQuery(req, res, operation, args = []) {
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  executor.run(operation, args, { signal: controller.signal }).then((payload) => {
    if (operation === "savePrices") reloadLivePrices();
    if (res.destroyed) return;
    if (operation === "readUsageHistory" && typeof payload.csv === "string") {
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${payload.filename}"` });
      return res.end(payload.csv);
    }
    if (payload?.runtime) {
      payload.runtime.workerMemory = payload.runtime.memory;
      payload.runtime.memory = { ...process.memoryUsage(), rss: executor.state().combinedRss };
      payload.runtime.diagnostics = executor.state();
    }
    if (operation === "getEventDetail") {
      if (!payload) return sendJson(req, res, 404, { error: "Event not found or source was removed" });
      return sendJson(req, res, 200, { event: payload });
    }
    if (payload == null && operation.startsWith("querySession")) return sendJson(req, res, 404, { error: "Session not found" });
    sendJson(req, res, 200, payload);
  }).catch((error) => {
    if (!res.destroyed) sendJson(req, res, 503, { error: String(error.message || error) });
  });
}

// Create HTTP server
const server = http.createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  const denied = policyError(req, { host: config.HOST, port: config.PORT,
    token: process.env.OBSERVER_ACCESS_TOKEN,
    allowedHosts: (process.env.OBSERVER_ALLOWED_HOSTS || "").split(",").filter(Boolean),
    allowSourceMutations: process.env.OBSERVER_ALLOW_SOURCE_MUTATIONS === "1" });
  if (denied) {
    if (denied[0] === 401) res.setHeader("WWW-Authenticate", 'Basic realm="Session Observer", charset="UTF-8"');
    return sendJson(req, res, denied[0], { error: denied[1] });
  }

  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    if (u.pathname === "/api/library" && req.method === "GET") return runQuery(req, res, "library");
    if (u.pathname === "/api/library" && req.method === "POST") return readJsonBody(req, res, (value) => runQuery(req, res, "saveLibrary", [value.kind, value]));
    if (u.pathname === "/api/audit" && req.method === "GET") return runQuery(req, res, "audit");
    if (u.pathname === "/api/pricebook" && req.method === "GET") return runQuery(req, res, "pricebook");
    if (u.pathname === "/api/pricebook" && req.method === "PUT") return readJsonBody(req, res, (value) => runQuery(req, res, "savePrices", [value]));
    if (/^\/api\/sessions\/[^/]+\/analysis$/.test(u.pathname) && req.method === "GET") {
      return runQuery(req, res, "querySessionAnalysis", [decodeURIComponent(u.pathname.split("/")[3])]);
    }
    if (u.pathname === "/api/diagnostics" && req.method === "GET") {
      return sendJson(req, res, 200, { ...executor.state(), watchers: watchers?.state(), source: sourceChangeBus.state(),
        allowSourceMutations: process.env.OBSERVER_ALLOW_SOURCE_MUTATIONS === "1" });
    }
    if (u.pathname === "/api/diagnostics/recover" && req.method === "POST") {
      executor.reset();
      watchers?.reconcile();
      boundScheduleSourceRefresh("recovery");
      return sendJson(req, res, 200, { recoveredAt: new Date().toISOString() });
    }
    if (u.pathname === "/api/diagnostics/cancel" && req.method === "POST") {
      return readJsonBody(req, res, (value) => sendJson(req, res, 200, { cancelled: executor.cancel(Number(value.id)) }));
    }
    if (u.pathname === "/api/index-window" && req.method === "GET") {
      return sendJson(req, res, 200, {
        generatedAt: new Date().toISOString(),
        indexWindow: indexManager.getIndexWindowState(),
      });
    }

    if (u.pathname === "/api/performance-baseline" && req.method === "GET") return sendJson(req, res, 200, performanceBaseline.state());
    if (u.pathname === "/api/performance-baseline/refresh" && req.method === "POST") {
      performanceBaseline.refresh();
      return sendJson(req, res, 202, performanceBaseline.state());
    }
    if (u.pathname === "/api/usage-history/status" && req.method === "GET") return sendJson(req, res, 200, usageHistoryStatus());
    if (u.pathname === "/api/usage-history/refresh" && req.method === "POST") {
      performanceBaseline.refresh();
      return sendJson(req, res, 202, usageHistoryStatus());
    }
    if (u.pathname === "/api/usage-history" && req.method === "GET") {
      let filters;
      try { filters = parseHistoryFilters(u.searchParams); }
      catch (error) { return sendJson(req, res, 400, { error: error.message }); }
      return runQuery(req, res, "readUsageHistory", [filters, u.searchParams.get("format")]);
    }
    if (req.method === "GET" && ["/api/live-speed", "/api/live-speed/snapshot"].includes(u.pathname)) {
      const values = u.searchParams.getAll("minutes");
      const minutes = values.length ? LIVE_HISTORY_MINUTES.find((option) => String(option) === values[0]) : DEFAULT_HISTORY_MINUTES;
      if (values.length > 1 || minutes == null) return sendJson(req, res, 400, { error: "Invalid live speed history range" });
      if (u.pathname === "/api/live-speed") return liveSpeed.stream(req, res, minutes);
      return sendJson(req, res, 200, liveSpeed.snapshot(minutes));
    }
    if (u.pathname === "/api/source-events" && req.method === "GET") {
      streamSourceEvents(req, res);
      return;
    }

    if (u.pathname === "/api/index-window" && (req.method === "PUT" || req.method === "POST")) {
      readJsonBody(req, res, (payload) => {
        try {
          const result = indexManager.setIndexWindowDays(payload?.days);
          routes.invalidateCaches();
          indexManager.trimHeapNow();
          sendJson(req, res, 200, {
            generatedAt: new Date().toISOString(),
            ...result,
          });
        } catch (err) {
          console.error("[server] Failed to switch index window:", err);
          sendJson(req, res, 500, { error: "Index window switch failed" });
        }
      });
      return;
    }

    if (u.pathname === "/api/events/body" && req.method === "GET") {
      return runQuery(req, res, "getDialogueBody", [u.searchParams.get("eventId"), {
        offset: Number(u.searchParams.get("offset")) || 0, limit: Number(u.searchParams.get("limit")) || 65536,
      }]);
    }
    if (u.pathname === "/api/events/context" && req.method === "GET") {
      return runQuery(req, res, "getDialogueContext", [u.searchParams.get("eventId")]);
    }
    if (u.pathname === "/api/events/detail" && req.method === "GET") {
      const eventId = u.searchParams.get("eventId") || "";
      if (!eventId) return sendJson(req, res, 400, { error: "eventId required" });
      return runQuery(req, res, "getEventDetail", [eventId]);
    }

    if (u.pathname === "/api/events" && req.method === "GET") {
      const filters = routes.parseRequestFilters(u.searchParams);
      return runQuery(req, res, "queryEvents", [filters]);
    }

    if (u.pathname === "/api/sessions" && req.method === "GET") {
      return runQuery(req, res, "querySessions");
    }

    if (u.pathname === "/api/sessions/compare" && req.method === "GET") {
      const left = u.searchParams.get("left") || "";
      const right = u.searchParams.get("right") || "";
      if (!left || !right) return sendJson(req, res, 400, { error: "left and right session ids required" });
      return runQuery(req, res, "querySessionComparison", [left, right]);
    }

    if (u.pathname.startsWith("/api/sessions/") && u.pathname.endsWith("/replay") && req.method === "GET") {
      const sessionId = decodeURIComponent(u.pathname.split("/").filter(Boolean)[2] || "");
      if (!sessionId) return sendJson(req, res, 400, { error: "sessionId required" });
      const callId = u.searchParams.get("callId") || "";
      if (callId.length > 240 || Array.from(callId).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
        return sendJson(req, res, 400, { error: "Invalid tool call id" });
      }
      return runQuery(req, res, "querySessionReplay", [sessionId, u.searchParams.get("limit"), callId]);
    }

    if (u.pathname.startsWith("/api/sessions/") && u.pathname.endsWith("/annotation")) {
      const sessionId = decodeURIComponent(u.pathname.split("/").filter(Boolean)[2] || "");
      if (!sessionId) return sendJson(req, res, 400, { error: "sessionId required" });
      if (req.method === "GET") return runQuery(req, res, "readAnnotation", [sessionId]);
      if (req.method === "PUT" || req.method === "POST") {
        return readJsonBody(req, res, (payload) => {
          try {
            runQuery(req, res, "writeAnnotation", [sessionId, payload]);
          } catch (error) {
            sendJson(req, res, 400, { error: String(error.message || error) });
          }
        });
      }
    }

    if (u.pathname.startsWith("/api/sessions/") && u.pathname.endsWith("/export") && req.method === "GET") {
      return sendJson(req, res, 410, { error: "Transcript export is no longer provided" });
    }

    if (u.pathname === "/api/observability" && req.method === "GET") {
      return runQuery(req, res, "queryObservability");
    }

    if (u.pathname === "/api/observability/recalculate" && req.method === "POST") {
      return runQuery(req, res, "recalculateObservability");
    }

    if (u.pathname === "/api/codex-usage" && req.method === "GET") {
      codexUsageService.getSnapshot()
        .then((payload) => sendJson(req, res, 200, payload))
        .catch(() => sendJson(req, res, 200, { status: "idle" }));
      return;
    }

    if (u.pathname === "/api/codex-usage/refresh" && req.method === "POST") {
      codexUsageService.refresh()
        .then((payload) => sendJson(req, res, 200, payload))
        .catch((error) => {
          console.error("[server] Failed to read Codex usage:", error);
          sendJson(req, res, 500, { error: "Codex usage request failed" });
        });
      return;
    }

    if (u.pathname === "/api/sessions/rename" && req.method === "POST") {
      readJsonBody(req, res, (payload) => {
        try {
          const { sessionId, newName } = payload;
          if (!sessionId || !newName) return sendJson(req, res, 400, { error: "sessionId and newName required" });
          const result = sessionOps.renameSession(sessionId, newName, boundScheduleSourceRefresh);
          if (!result.success) return sendJson(req, res, 404, { error: result.error });
          sendJson(req, res, 200, result);
        } catch (err) {
          return sendJson(req, res, 500, { error: String(err) });
        }
      });
      return;
    }

    if (u.pathname === "/api/sessions/batch-delete" && req.method === "POST") {
      readJsonBody(req, res, (payload) => {
        try {
          const { sessionIds } = payload;
          if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            return sendJson(req, res, 400, { error: "sessionIds array required" });
          }
          const result = sessionOps.batchDeleteSessions(sessionIds, boundScheduleSourceRefresh);
          return sendJson(req, res, 200, result);
        } catch (err) {
          return sendJson(req, res, 500, { error: String(err) });
        }
      });
      return;
    }

    if (u.pathname.startsWith("/api/sessions/") && req.method === "DELETE") {
      const sessionId = u.pathname.split("/").pop();
      if (!sessionId) return sendJson(req, res, 400, { error: "sessionId required" });
      const result = sessionOps.deleteSession(sessionId, boundScheduleSourceRefresh);
      if (!result.success) return sendJson(req, res, 404, { error: result.error });
      return sendJson(req, res, 200, result);
    }
    return routes.serveStatic(u.pathname, res);
  } catch (err) {
    console.error(`[server] Unhandled error for ${req.method}:`, err);
    return sendJson(req, res, 500, { error: "Internal server error" });
  }
});

const JSON_HEAP_PRESSURE_BYTES = 128 * 1024 * 1024;

function isJsonHeapPressured() {
  const { heapTotal, heapUsed } = process.memoryUsage();
  return heapTotal >= JSON_HEAP_PRESSURE_BYTES || heapUsed >= JSON_HEAP_PRESSURE_BYTES * 0.75;
}

function trimHeapBeforeJson(options = {}) {
  if (typeof global.gc !== "function") return;
  if (!options.force && !isJsonHeapPressured()) return;
  try {
    global.gc();
  } catch {
    // Optional V8 GC hook; ignore when unavailable or interrupted.
  }
}

function sendJson(req, res, status, data) {
  const zlib = require("zlib");
  if (res.destroyed || res.writableEnded) return;
  trimHeapBeforeJson();
  const body = JSON.stringify(data);
  const acceptsGzip = /\bgzip\b/i.test(req?.headers?.["accept-encoding"] || "");
  const bodyLength = Buffer.byteLength(body);
  const shouldGzip = acceptsGzip && bodyLength > 1024 && !isJsonHeapPressured();

  const writePayload = (payload, gzipped = false) => {
    const length = typeof payload === "string" ? Buffer.byteLength(payload) : payload.length;
    res.writeHead(status, {
      "Content-Type": config.MIME[".json"],
      ...(gzipped ? { "Content-Encoding": "gzip" } : {}),
      "Cache-Control": "no-store",
      "Content-Length": length,
    });
    res.end(payload);
  };

  if (!shouldGzip) {
    writePayload(body);
    return;
  }

  zlib.gzip(body, (error, payload) => {
    if (error) {
      writePayload(body);
      return;
    }
    writePayload(payload, true);
  });
}

function writeSseEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function streamSourceEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  writeSseEvent(res, "ready", sourceChangeBus.state());

  const unsubscribe = sourceChangeBus.subscribe((payload) => {
    writeSseEvent(res, "source-changed", payload);
  });
  const heartbeat = setInterval(() => {
    writeSseEvent(res, "heartbeat", {
      ...sourceChangeBus.state(),
      type: "heartbeat",
      generatedAt: new Date().toISOString(),
    });
  }, config.SOURCE_CHANGE_HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

// Handle uncaught errors gracefully
process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});

if (isQueryWorker) {
  const performanceHistory = require("./server/performance-history").createPerformanceHistory({
    file: require("path").join(config.RUNTIME_DIR, "performance-history.sqlite"),
    listFiles: require("./server/source-files").listHistoryFileRecords,
    loadPrices: analysisServices.loadPrices,
    scanBudgetMs: 4000,
    onProgress: (progress) => { if (activeJobId) process.send?.({ id: activeJobId, progress }); },
  });
  const operations = {
    performanceBaseline: performanceHistory.refresh,
    readUsageHistory: (filters, format) => {
      const data = performanceHistory.read(filters, { exportAll: format === "csv" });
      if (!format) return data;
      const kind = format === "modes-csv" ? "execution-modes" : "daily-usage";
      return { csv: historyCsv(data, format === "modes-csv"), filename: `session-observer-${kind}-${data.range.from}-${data.range.to}.csv` };
    },
    queryEvents: routes.queryEvents, querySessions: routes.querySessions,
    queryObservability: routes.queryObservability, recalculateObservability: routes.recalculateObservability,
    querySessionReplay: routes.querySessionReplay, querySessionComparison: routes.querySessionComparison,
    getEventDetail: routes.getEventDetail,
    getDialogueBody: routes.getDialogueBody, getDialogueContext: routes.getDialogueContext,
    querySessionAnalysis: routes.querySessionAnalysis,
    library: analysisServices.library, saveLibrary: analysisServices.saveLibrary,
    audit: () => ({ runs: analysisServices.audit().runs }),
    pricebook: analysisServices.pricebook,
    savePrices: (value) => { const result = analysisServices.savePrices(value); routes.invalidateCaches(); return result; },
    readAnnotation: (id) => ({ annotation: routes.getSessionAnnotation(id) }),
    writeAnnotation: (id, value) => ({ annotation: routes.setSessionAnnotation(id, value) }),
  };
  process.on("message", async (message) => {
    if (message.operation === "invalidate") { routes.invalidateCaches(); return; }
    try {
      activeJobId = message.id;
      if (!Object.hasOwn(operations, message.operation)) throw new Error("Unsupported query operation");
      const result = await operations[message.operation](...message.args);
      activeJobId = null;
      process.send?.({ id: message.id, result, memory: process.memoryUsage() }, () => indexManager.trimHeapNow());
    } catch (error) { activeJobId = null; process.send?.({ id: message.id, error: String(error.message || error) }); }
  });
  process.on("disconnect", () => process.exit(0));
} else {
  if (!["localhost", "127.0.0.1", "::1"].includes(config.HOST) && !process.env.OBSERVER_ACCESS_TOKEN) {
    console.error("LAN binding requires OBSERVER_ACCESS_TOKEN and OBSERVER_ALLOWED_HOSTS");
    executor.close();
    process.exit(1);
  }
  const shutdown = () => { watchers?.close(); performanceBaseline.close(); liveSpeed.close(); executor.close(); server.close(); };
  process.on("SIGTERM", () => { shutdown(); process.exit(0); });
  process.on("SIGINT", () => { shutdown(); process.exit(0); });
  server.listen(config.PORT, config.HOST, () => {
  console.log(`Session Observer running at http://${config.HOST}:${config.PORT}`);
  console.log(`Codex sessions: ${config.SESSIONS_DIR}`);
  console.log(`Claude Code sessions: ${config.CLAUDE_PROJECTS_DIR}`);
    watchers = createSourceWatchers(boundScheduleSourceRefresh, {
      onFileChange: liveSpeed.notify,
      onRecords(records) { liveSpeed.discover(records); reloadLivePrices(); },
    });
    liveSpeed.start();
    performanceBaseline.start();
  });
}
