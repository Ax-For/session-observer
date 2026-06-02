#!/usr/bin/env node
/**
 * HTTP route handlers for the Session Observer API.
 * Dependencies are injected at initialization time to avoid circular imports.
 */
const config = require("./config");
const sessionOps = require("./session-ops");
const sessionMeta = require("./session-meta");
const { createSessionExport } = require("./session-export");
const { listSourceAdapters } = require("../shared/source-adapters");

let _deps = null;
let visibleEventsCache = { key: "", asc: [] };
let observabilitySummaryCache = { key: "", summary: null };

/**
 * Initialize route handlers with dependencies.
 */
function init(deps) {
  _deps = deps;
  visibleEventsCache = { key: "", asc: [] };
  observabilitySummaryCache = { key: "", summary: null };
}

function invalidateCaches() {
  visibleEventsCache = { key: "", asc: [] };
  observabilitySummaryCache = { key: "", summary: null };
}

/**
 * Return events already filtered for the current mode, stored only once.
 */
function getVisibleEventSet(ready, mode) {
  const cacheKey = `${ready.currentAggregateKey || ""}|${mode || "observe"}`;
  if (visibleEventsCache.key === cacheKey) return visibleEventsCache;

  const asc = (ready.events || []).filter((event) => _deps.eventMatchesModeCore(event, mode));
  visibleEventsCache = {
    key: cacheKey,
    asc,
  };
  return visibleEventsCache;
}

function collectMatchedEvents(visibleEvents, filters) {
  const matched = [];
  if (filters.order === "asc") {
    for (const event of visibleEvents) {
      if (_deps.eventMatchesFiltersCore(event, filters)) matched.push(event);
    }
    return matched;
  }

  for (let index = visibleEvents.length - 1; index >= 0; index -= 1) {
    const event = visibleEvents[index];
    if (_deps.eventMatchesFiltersCore(event, filters)) matched.push(event);
  }
  return matched;
}

function filtersMatchAllVisible(filters) {
  return !filters.platform &&
    !filters.model &&
    !filters.type &&
    !filters.sessionId &&
    !filters.query &&
    (filters.quickFilter || "all") === "all" &&
    filters.startMs == null &&
    filters.endMs == null;
}

function aggregateSessionFiltersMatch(filters) {
  return !filters.query &&
    !filters.type &&
    !filters.sessionId &&
    (filters.quickFilter || "all") === "all";
}

function sliceVisibleEvents(visibleEvents, filters) {
  const offset = Math.max(0, Number(filters.offset) || 0);
  const limit = Math.max(0, Number(filters.limit) || config.DEFAULT_PAGE_SIZE);
  if (filters.order === "asc") {
    return visibleEvents.slice(offset, offset + limit);
  }

  const endExclusive = Math.max(0, visibleEvents.length - offset);
  const start = Math.max(0, endExclusive - limit);
  return visibleEvents.slice(start, endExclusive).reverse();
}

function collectAggregateSessionEvents(visibleEvents, filters) {
  return visibleEvents.filter((event) => _deps.eventMatchesFiltersCore(event, {
    ...filters, query: "", type: "", quickFilter: "all", sessionId: "",
  }));
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

  const visibleEventSet = getVisibleEventSet(ready, filters.mode);
  const visibleEvents = visibleEventSet.asc;
  const matchAllVisible = filtersMatchAllVisible(filters);
  const matched = matchAllVisible ? visibleEvents : collectMatchedEvents(visibleEvents, filters);
  const totalMatching = matchAllVisible ? visibleEvents.length : matched.length;
  const paged = matchAllVisible
    ? sliceVisibleEvents(visibleEvents, filters)
    : matched.slice(filters.offset, filters.offset + filters.limit);
  let sessions = [];
  if (filters.includeSummary) {
    sessions = _deps.buildSessionGroupsCore(matched);
    if (!aggregateSessionFiltersMatch(filters)) {
      sessions = _deps.mergeSessionTokenAggregates(
        sessions,
        _deps.buildSessionGroupsCore(collectAggregateSessionEvents(visibleEvents, filters)),
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sessionsDir: config.SESSIONS_DIR,
    mode: filters.mode,
    claudeVersion: require("./versions").claudeVersion,
    codexVersion: require("./versions").codexVersion,
    index: indexManager.publicIndexState(ready.currentAggregateKey),
    totalVisible: visibleEvents.length,
    totalMatching,
    sessions,
    tokenWindows: filters.includeSummary ? _deps.buildTokenUsageWindowsCore(matched) : null,
    meta: filters.includeSummary ? _deps.collectMetaCore(visibleEvents) : { models: [], types: [], platforms: [] },
    page: {
      offset: filters.offset,
      limit: filters.limit,
      hasMore: filters.offset + paged.length < totalMatching,
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
 * Export a full session as sanitized Markdown or JSONL.
 */
function resolveSessionIdentifier(events, sessionId) {
  const needle = String(sessionId || "").trim();
  if (!needle) return "";

  const sessionIds = [...new Set((events || []).map((event) => event.sessionId).filter(Boolean))];
  if (sessionIds.includes(needle)) return needle;

  const matches = sessionIds.filter((id) => id.startsWith(needle));
  return matches.length === 1 ? matches[0] : needle;
}

function exportSession(sessionId, options = {}) {
  const { indexManager } = _deps;
  const ready = indexManager.ensureIndexReady(
    _deps.parsers, _deps.applyEventSessionMetaCore, _deps.dedupeEventsCore, _deps.mergeSessionMetaRecordsCore
  );
  const resolvedSessionId = resolveSessionIdentifier(ready.events, sessionId);
  const threadMeta = sessionMeta.loadMergedThreadMetadata(_deps.mergeSessionMetaRecordsCore);
  const files = indexManager.sourceFilesForSession(ready.events, resolvedSessionId);
  const events = [];

  for (const file of files) {
    events.push(...indexManager.parseFullFileEvents(file, threadMeta, _deps.parsers, _deps.applyEventSessionMetaCore)
      .filter((event) => event.sessionId === resolvedSessionId));
  }

  events.sort((left, right) => {
    const leftMs = _deps.toTimeMsCore(left.time) ?? 0;
    const rightMs = _deps.toTimeMsCore(right.time) ?? 0;
    return leftMs - rightMs;
  });

  if (!events.length) return null;
  return createSessionExport(events, {
    format: options.format,
    sanitize: options.sanitize !== false,
    sessionId: resolvedSessionId,
  });
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
  const visibleEvents = getVisibleEventSet(ready, "observe").asc;
  const summaryKey = `${ready.currentAggregateKey || ""}|observe`;
  if (observabilitySummaryCache.key !== summaryKey) {
    observabilitySummaryCache = {
      key: summaryKey,
      summary: _deps.buildObservabilitySummaryCore(visibleEvents),
    };
  }
  const summary = observabilitySummaryCache.summary;
  indexManager.trimHeapNow?.();

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
      adapters: listSourceAdapters(),
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
  const cacheHeader = filePath.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(200, {
    "Content-Type": config.MIME[ext] || "application/octet-stream",
    "Cache-Control": cacheHeader,
  });
  fs.createReadStream(abs).pipe(res);
}

module.exports = {
  init,
  invalidateCaches,
  parseRequestFilters,
  queryEvents,
  getEventDetail,
  exportSession,
  resolveSessionIdentifier,
  querySessions,
  queryObservability,
  serveStatic,
};
