#!/usr/bin/env node
/**
 * Session Observer — thin entry point.
 * Wires together config, index manager, routes, and session ops.
 */
const http = require("http");
const ObserverCore = require("./shared/observer-core");
const config = require("./server/config");
const indexManager = require("./server/index-manager");
const routes = require("./server/routes");
const sessionOps = require("./server/session-ops");

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
  toPositiveInt: toPositiveIntCore,
  toTimeMs: toTimeMsCore,
} = ObserverCore;

const parsers = {
  parseCodexLineToEvent: parseCodexLineToEventCore,
  parseClaudeCodeLineToEvent: parseClaudeCodeLineToEventCore,
};

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
});

// Bound index functions for use in session ops and watchers
const boundRefreshIndex = (reason) => indexManager.refreshIndex(
  reason, parsers, applyEventSessionMetaCore, dedupeEventsCore, mergeSessionMetaRecordsCore
);
const boundScheduleIndexRefresh = (reason) => indexManager.scheduleIndexRefresh(reason, boundRefreshIndex);

// Create HTTP server
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (u.pathname === "/api/events/detail" && req.method === "GET") {
      const eventId = u.searchParams.get("eventId") || "";
      if (!eventId) return sendJson(req, res, 400, { error: "eventId required" });
      const event = routes.getEventDetail(eventId);
      if (!event) return sendJson(req, res, 404, { error: "Event not found" });
      sendJson(req, res, 200, { event });
      indexManager.trimHeapSoon();
      return;
    }

    if (u.pathname === "/api/events") {
      const filters = routes.parseRequestFilters(u.searchParams);
      sendJson(req, res, 200, routes.queryEvents(filters));
      indexManager.trimHeapSoon();
      return;
    }

    if (u.pathname === "/api/sessions" && req.method === "GET") {
      return sendJson(req, res, 200, routes.querySessions());
    }

    if (u.pathname.startsWith("/api/sessions/") && u.pathname.endsWith("/export") && req.method === "GET") {
      const parts = u.pathname.split("/").filter(Boolean);
      const sessionId = decodeURIComponent(parts[2] || "");
      if (!sessionId) return sendJson(req, res, 400, { error: "sessionId required" });
      const exported = routes.exportSession(sessionId, {
        format: u.searchParams.get("format") || "markdown",
        sanitize: u.searchParams.get("sanitize") !== "0",
      });
      if (!exported) return sendJson(req, res, 404, { error: "Session not found" });
      sendDownload(res, 200, exported);
      indexManager.trimHeapSoon();
      return;
    }

    if (u.pathname === "/api/observability" && req.method === "GET") {
      sendJson(req, res, 200, routes.queryObservability());
      indexManager.trimHeapSoon();
      return;
    }

    if (u.pathname === "/api/sessions/rename" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { sessionId, newName } = JSON.parse(body);
          if (!sessionId || !newName) return sendJson(req, res, 400, { error: "sessionId and newName required" });
          const result = sessionOps.renameSession(sessionId, newName, boundScheduleIndexRefresh);
          if (!result.success) return sendJson(req, res, 404, { error: result.error });
          sendJson(req, res, 200, result);
        } catch (err) {
          return sendJson(req, res, 500, { error: String(err) });
        }
      });
      return;
    }

    if (u.pathname === "/api/sessions/batch-delete" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const { sessionIds } = JSON.parse(body);
          if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            return sendJson(req, res, 400, { error: "sessionIds array required" });
          }
          const result = sessionOps.batchDeleteSessions(sessionIds, boundScheduleIndexRefresh);
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
      const result = sessionOps.deleteSession(sessionId, boundScheduleIndexRefresh);
      if (!result.success) return sendJson(req, res, 404, { error: result.error });
      return sendJson(req, res, 200, result);
    }
  } catch (err) {
    console.error(`[server] Unhandled error for ${req.method} ${u.pathname}:`, err);
    return sendJson(req, res, 500, { error: "Internal server error" });
  }

  return routes.serveStatic(u.pathname, res);
});

function sendJson(req, res, status, data) {
  const zlib = require("zlib");
  const body = JSON.stringify(data);
  const acceptsGzip = /\bgzip\b/i.test(req?.headers?.["accept-encoding"] || "");
  const shouldGzip = acceptsGzip && Buffer.byteLength(body) > 1024;

  const writePayload = (payload, gzipped = false) => {
    res.writeHead(status, {
      "Content-Type": config.MIME[".json"],
      ...(gzipped ? { "Content-Encoding": "gzip" } : {}),
      "Cache-Control": "no-store",
      "Content-Length": payload.length,
    });
    res.end(payload);
  };

  if (!shouldGzip) {
    writePayload(Buffer.from(body));
    return;
  }

  zlib.gzip(body, (error, payload) => {
    if (error) {
      writePayload(Buffer.from(body));
      return;
    }
    writePayload(payload, true);
  });
}

function sendDownload(res, status, exported) {
  const payload = Buffer.from(exported.body || "");
  const filename = String(exported.filename || "session-export.txt").replace(/["\\]/g, "");
  res.writeHead(status, {
    "Content-Type": exported.contentType || "application/octet-stream",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "Content-Length": payload.length,
  });
  res.end(payload);
}

// Handle uncaught errors gracefully
process.on("uncaughtException", (err) => {
  console.error("[server] Uncaught exception:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});

server.listen(config.PORT, config.HOST, () => {
  console.log(`Session Observer running at http://${config.HOST}:${config.PORT}`);
  console.log(`Codex sessions: ${config.SESSIONS_DIR}`);
  console.log(`Claude Code sessions: ${config.CLAUDE_PROJECTS_DIR}`);
  indexManager.startIndexWatchers(boundScheduleIndexRefresh);
  try {
    boundRefreshIndex("startup");
  } catch (err) {
    console.error(`Initial index build failed: ${err}`);
  }
});
