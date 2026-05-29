#!/usr/bin/env node
/**
 * HTTP route handlers for the Session Observer API.
 * Dependencies are injected at initialization time to avoid circular imports.
 */
const config = require("./config");
const sessionOps = require("./session-ops");
const sessionMeta = require("./session-meta");

let _deps = null;

/**
 * Initialize route handlers with dependencies.
 */
function init(deps) {
  _deps = deps;
}

/**
 * Parse query params into filter options.
 */
function parseRequestFilters(searchParams) {
  return {
    mode: searchParams.get("mode") === "raw" ? "raw" : "observe",
    platform: searchParams.get("platform") || "",
    model: searchParams.get("model") || "",
    type: searchParams.get("type") || "",
    sessionId: searchParams.get("sessionId") || "",
    quickFilter: searchParams.get("quickFilter") || "all",
    tokenThreshold: _deps.toPositiveIntCore(searchParams.get("tokenThreshold"), 20000),
    query: (searchParams.get("q") || "").trim().toLowerCase(),
    startMs: _deps.toTimeMsCore(searchParams.get("start") || ""),
    endMs: _deps.toTimeMsCore(searchParams.get("end") || ""),
    order: searchParams.get("order") === "asc" ? "asc" : "desc",
    offset: _deps.toPositiveIntCore(searchParams.get("offset"), 0),
    limit: _deps.toPositiveIntCore(searchParams.get("limit"), config.DEFAULT_PAGE_SIZE, config.MAX_PAGE_SIZE),
    includeSummary: searchParams.get("summary") !== "0",
  };
}

/**
 * Query session events directly (for focused session view).
 */
function querySessionEventsDirect(filters, ready) {
  const { indexManager } = _deps;
  const threadMeta = sessionMeta.loadMergedThreadMetadata(_deps.mergeSessionMetaRecordsCore);

  const files = indexManager.sourceFilesForSession(ready.events, filters.sessionId);
  const allEvents = [];
  for (const file of files) {
    allEvents.push(...indexManager.parseFullFileEvents(file, threadMeta, _deps.parsers, _deps.applyEventSessionMetaCore)
      .filter((event) => event.sessionId === filters.sessionId));
  }

  const visibleEvents = allEvents.filter((event) => _deps.eventMatchesModeCore(event, filters.mode));
  const matched = visibleEvents.filter((event) => _deps.eventMatchesFiltersCore(event, filters));
  matched.sort((a, b) => {
    const am = _deps.toTimeMsCore(a.time) ?? 0;
    const bm = _deps.toTimeMsCore(b.time) ?? 0;
    return filters.order === "asc" ? am - bm : bm - am;
  });
  const paged = matched.slice(filters.offset, filters.offset + filters.limit);

  return {
    generatedAt: new Date().toISOString(),
    sessionsDir: config.SESSIONS_DIR,
    mode: filters.mode,
    claudeVersion: require("./versions").claudeVersion,
    codexVersion: require("./versions").codexVersion,
    index: indexManager.publicIndexState(ready.currentAggregateKey),
    totalVisible: visibleEvents.length,
    totalMatching: matched.length,
    sessions: [],
    tokenWindows: null,
    meta: { models: [], types: [], platforms: [] },
    page: {
      offset: filters.offset,
      limit: filters.limit,
      hasMore: filters.offset + paged.length < matched.length,
    },
    events: paged,
  };
}

/**
 * Query events with pagination.
 */
function queryEvents(filters) {
  const { indexManager } = _deps;
  const ensureIndexReady = () => indexManager.ensureIndexReady(
    _deps.parsers, _deps.applyEventSessionMetaCore, _deps.dedupeEventsCore, _deps.mergeSessionMetaRecordsCore
  );
  const ready = ensureIndexReady();

  if (!filters.includeSummary && filters.sessionId) {
    return querySessionEventsDirect(filters, ready);
  }

  const allEvents = ready.events;
  const visibleEvents = allEvents.filter((event) => _deps.eventMatchesModeCore(event, filters.mode));
  const matched = visibleEvents.filter((event) => _deps.eventMatchesFiltersCore(event, filters));
  const aggregateMatchedSessions = filters.includeSummary
    ? visibleEvents.filter((event) => _deps.eventMatchesFiltersCore(event, {
      ...filters, query: "", type: "", quickFilter: "all", sessionId: "",
    }))
    : [];
  matched.sort((a, b) => {
    const am = _deps.toTimeMsCore(a.time) ?? 0;
    const bm = _deps.toTimeMsCore(b.time) ?? 0;
    return filters.order === "asc" ? am - bm : bm - am;
  });
  const paged = matched.slice(filters.offset, filters.offset + filters.limit);

  return {
    generatedAt: new Date().toISOString(),
    sessionsDir: config.SESSIONS_DIR,
    mode: filters.mode,
    claudeVersion: require("./versions").claudeVersion,
    codexVersion: require("./versions").codexVersion,
    index: indexManager.publicIndexState(ready.currentAggregateKey),
    totalVisible: visibleEvents.length,
    totalMatching: matched.length,
    sessions: filters.includeSummary
      ? _deps.mergeSessionTokenAggregates(
        _deps.buildSessionGroupsCore(matched),
        _deps.buildSessionGroupsCore(aggregateMatchedSessions),
      )
      : [],
    tokenWindows: filters.includeSummary ? _deps.buildTokenUsageWindowsCore(matched) : null,
    meta: filters.includeSummary ? _deps.collectMetaCore(visibleEvents) : { models: [], types: [], platforms: [] },
    page: {
      offset: filters.offset,
      limit: filters.limit,
      hasMore: filters.offset + paged.length < matched.length,
    },
    events: paged,
  };
}

/**
 * Get event detail by eventId.
 */
function getEventDetail(eventId) {
  const { indexManager } = _deps;
  const ready = indexManager.ensureIndexReady(
    _deps.parsers, _deps.applyEventSessionMetaCore, _deps.dedupeEventsCore, _deps.mergeSessionMetaRecordsCore
  );
  const indexedEvent = ready.events.find((event) => event.eventId === eventId);
  if (!indexedEvent?.sourceFile || !indexedEvent?.sourceLine) return null;

  const threadMeta = sessionMeta.loadMergedThreadMetadata(_deps.mergeSessionMetaRecordsCore);
  const events = indexManager.parseEventLineFromIndex(indexedEvent, threadMeta, _deps.parsers, _deps.applyEventSessionMetaCore);
  return events.find((event) => event.eventId === eventId) || null;
}

/**
 * List sessions grouped by cwd.
 */
function querySessions() {
  const { indexManager } = _deps;
  const ready = indexManager.ensureIndexReady(
    _deps.parsers, _deps.applyEventSessionMetaCore, _deps.dedupeEventsCore, _deps.mergeSessionMetaRecordsCore
  );
  const groups = _deps.buildSessionGroupsCore(ready.events);

  _deps.applySessionTitleOverridesCore(groups, sessionMeta.loadClaudeSessionIndex(), "claude");

  const cwdGroups = new Map();
  for (const g of groups) {
    const cwd = g.cwd || "unknown";
    if (!cwdGroups.has(cwd)) cwdGroups.set(cwd, []);
    cwdGroups.get(cwd).push(g);
  }

  return {
    generatedAt: new Date().toISOString(),
    total: groups.length,
    groups: Object.fromEntries(cwdGroups),
  };
}

/**
 * Fetch observability summary.
 */
function queryObservability() {
  const { indexManager } = _deps;
  const ready = indexManager.ensureIndexReady(
    _deps.parsers, _deps.applyEventSessionMetaCore, _deps.dedupeEventsCore, _deps.mergeSessionMetaRecordsCore
  );
  const visibleEvents = ready.events.filter((event) => _deps.eventMatchesModeCore(event, "observe"));
  const summary = _deps.buildObservabilitySummaryCore(visibleEvents);

  return {
    generatedAt: new Date().toISOString(),
    mode: "observe",
    index: indexManager.publicIndexState(ready.currentAggregateKey),
    runtime: {
      versions: {
        codex: require("./versions").codexVersion,
        claude: require("./versions").claudeVersion,
      },
      memory: process.memoryUsage(),
      uptimeSeconds: Math.round(process.uptime()),
    },
    sources: {
      codex: sessionOps.directoryStatus(config.SESSIONS_DIR),
      claude: sessionOps.directoryStatus(config.CLAUDE_PROJECTS_DIR),
    },
    summary,
  };
}

/**
 * Serve static files with path traversal protection.
 */
function serveStatic(reqPath, res) {
  const fs = require("fs");
  const pathModule = require("path");
  let filePath = reqPath === "/" ? "/index.html" : reqPath;
  filePath = pathModule.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const abs = pathModule.join(config.STATIC_ROOT, filePath);
  if (!abs.startsWith(config.STATIC_ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404);
    return res.end("Not Found");
  }
  const ext = pathModule.extname(abs);
  res.writeHead(200, { "Content-Type": config.MIME[ext] || "application/octet-stream" });
  fs.createReadStream(abs).pipe(res);
}

module.exports = {
  init,
  parseRequestFilters,
  queryEvents,
  getEventDetail,
  querySessions,
  queryObservability,
  serveStatic,
};
