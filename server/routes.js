#!/usr/bin/env node
/**
 * HTTP route handlers for the Session Observer API.
 * Dependencies are injected at initialization time to avoid circular imports.
 */
const config = require("./config");
const fsScanner = require("./fs-scanner");
const sessionOps = require("./session-ops");
const sessionMeta = require("./session-meta");
const { createSessionExport } = require("./session-export");
const recentEventsReader = require("./recent-events-reader");
const sourceFiles = require("./source-files");
const { listSourceAdapters } = require("../shared/source-adapters");
const SessionInsights = require("../shared/session-insights");
const { analyzeTurns, agentRelations, gitEvidence } = require("./analysis-services");
const { readCompactJsonRecord } = require("./compact-json-record");
const { streamDialogueText } = require("./dialogue-text");

let _deps = null;

/**
 * Initialize route handlers with dependencies.
 */
function init(deps) {
  _deps = deps;
}

function invalidateCaches() {
  recentEventsReader.clearLocatorCache();
  _deps?.summaryStore?.invalidate?.();
}

function publicSourceState(records, summary = null, extra = {}) {
  const cache = summary?.cache || {};
  const health = summary?.health || {};
  return {
    dirty: false,
    lastBuiltAt: summary?.generatedAt || "",
    lastError: "",
    aggregateHash: _deps.indexManager.signatureHash(sourceFiles.aggregateRecordsKey(records)),
    currentAggregateHash: _deps.indexManager.signatureHash(sourceFiles.aggregateRecordsKey(records, "current")),
    totalEvents: health.eventsTotal || 0,
    retainedEvents: 0,
    omittedEventCount: 0,
    maxEvents: null,
    scannedFiles: cache.scannedFiles || 0,
    skippedFiles: 0,
    cachedFiles: cache.cachedFiles || 0,
    reusedFiles: cache.reusedFiles || 0,
    totalFiles: records.length,
    mode: "on-demand",
    ...extra,
  };
}

function loadThreadMeta() {
  return sessionMeta.loadMergedThreadMetadata(_deps.mergeSessionMetaRecordsCore);
}

function sourceStateSignature() {
  return `${fsScanner.getPathSignature(config.STATE_DB)}|${fsScanner.getPathSignature(config.CODEX_SESSION_INDEX)}`;
}

function getSummaryForRecords(records, threadMeta = loadThreadMeta()) {
  return _deps.summaryStore.getSummary({
    files: records,
    stateSignature: sourceStateSignature(),
    threadMeta,
  });
}

function listSourceFileRecords() {
  return _deps.sourceFileRecordsProvider
    ? _deps.sourceFileRecordsProvider()
    : sourceFiles.listSourceFileRecords();
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
    cursor: searchParams.get("cursor") || "",
    limit: _deps.toPositiveIntCore(searchParams.get("limit"), config.DEFAULT_PAGE_SIZE, config.MAX_PAGE_SIZE),
    includeSummary: searchParams.get("summary") !== "0",
  };
}

/**
 * Query session events directly (for focused session view).
 */
function querySessionEventsDirect(filters, records) {
  const threadMeta = loadThreadMeta();
  const summary = getSummaryForRecords(records, threadMeta);
  const resolvedSessionId = _deps.summaryStore.resolveSessionIdentifier(filters.sessionId, { files: records });
  const files = _deps.summaryStore.getSourceFilesForSession(resolvedSessionId, { files: records });
  const sessionFilters = {
    ...filters,
    sessionId: resolvedSessionId,
    includeSummary: false,
  };
  const recent = recentEventsReader.queryRecentEvents({
    files,
    parsers: _deps.parsers,
    threadMeta,
    filters: sessionFilters,
    limit: filters.limit,
    offset: filters.offset,
    allowSessionEarlyStop: true,
    applyEventSessionMetaCore: _deps.applyEventSessionMetaCore,
    eventMatchesModeCore: _deps.eventMatchesModeCore,
    eventMatchesFiltersCore: _deps.eventMatchesFiltersCore,
    sessionHints: summary.sessions.groups,
    compactContent: true,
  });

  return {
    generatedAt: new Date().toISOString(),
    sessionsDir: config.SESSIONS_DIR,
    mode: filters.mode,
    claudeVersion: require("./versions").claudeVersion,
    codexVersion: require("./versions").codexVersion,
    index: publicSourceState(records, summary, { ...recent.scan, focusedSession: true }),
    totalVisible: recent.totalVisible,
    totalMatching: recent.totalMatching,
    sessions: [],
    tokenWindows: null,
    meta: { models: [], types: [], platforms: [] },
    page: recent.page,
    events: recent.events,
  };
}

/**
 * Query events with pagination.
 */
function queryEvents(filters) {
  const records = listSourceFileRecords();

  if (!filters.query && !filters.includeSummary && filters.sessionId) {
    return querySessionEventsDirect(filters, records);
  }

  const summary = filters.includeSummary
    ? getSummaryForRecords(records)
    : _deps.summaryStore.getLastSummary();
  const threadMeta = loadThreadMeta();
  const useDiskSearch = Boolean(filters.query && _deps.dialogueSearchIndex?.state?.().enabled);
  const sessionsById = new Map((summary?.sessions?.groups || []).map((session) => [session.sessionId, session]));
  const agentMetadata = (item) => {
    const session = sessionsById.get(item.sessionId) || item;
    const parentId = session.parentSessionId || item.parentSessionId || "";
    const parent = parentId !== item.sessionId ? sessionsById.get(parentId) : null;
    if (!session.isSubagent && !item.isSubagent && (!parentId || parentId === item.sessionId)) return {};
    return { parentSessionId: parentId, isSubagent: true,
      parentTitle: parent?.displayTitle || parent?.sessionTitle || parent?.fallbackTitle || "" };
  };
  let recent;
  if (useDiskSearch) {
    _deps.dialogueSearchIndex.ensureFiles(records);
    recent = _deps.dialogueSearchIndex.query(filters.query, filters);
    recent.sessions = recent.sessions.map((match) => {
      const session = sessionsById.get(match.sessionId);
      return { sessionId: match.sessionId, sourceType: match.sourceType, sessionTitle: session?.displayTitle || session?.sessionTitle || session?.fallbackTitle || session?.title || "",
        cwd: session?.cwd || "", ...match };
    });
    for (const event of recent.events) {
      const meta = threadMeta.get(event.sessionId);
      if (meta) _deps.applyEventSessionMetaCore?.(event, meta, { titleStrategy: "always" });
    }
  } else recent = recentEventsReader.queryRecentEvents({
    files: records,
    parsers: _deps.parsers,
    threadMeta,
    filters,
    limit: filters.limit,
    offset: filters.offset,
    applyEventSessionMetaCore: _deps.applyEventSessionMetaCore,
    eventMatchesModeCore: _deps.eventMatchesModeCore,
    eventMatchesFiltersCore: _deps.eventMatchesFiltersCore,
    sessionHints: filters.includeSummary ? summary.sessions.groups : _deps.summaryStore.getLastSummary()?.sessions?.groups,
  });

  if (filters.includeSummary) {
    _deps.applySessionTitleOverridesCore(summary.sessions.groups, sessionMeta.loadClaudeSessionIndex(), "claude");
  }

  return {
    generatedAt: new Date().toISOString(),
    sessionsDir: config.SESSIONS_DIR,
    mode: filters.mode,
    claudeVersion: require("./versions").claudeVersion,
    codexVersion: require("./versions").codexVersion,
    index: publicSourceState(records, summary, recent.scan),
    totalVisible: recent.totalVisible,
    totalMatching: recent.totalMatching,
    sessions: (recent.sessions || (filters.includeSummary ? summary.sessions.groups : [])).map((session) => ({ ...session, ...agentMetadata(session) })),
    tokenWindows: filters.includeSummary ? summary.tokens.windows : null,
    meta: filters.includeSummary ? summary.meta : { models: [], types: [], platforms: [] },
    page: recent.page,
    events: recent.events.map((event) => ({ ...event, ...agentMetadata(event) })),
  };
}

/**
 * Get event detail by eventId.
 */
function getEventDetail(eventId) {
  const { indexManager } = _deps;
  const threadMeta = loadThreadMeta();
  const records = listSourceFileRecords();
  const locator = recentEventsReader.resolveEventLocator(eventId, records);
  if (locator && !locator.sessionId) {
    const sessions = _deps.summaryStore.getLastSummary?.()?.sessions?.groups || [];
    const session = sessions.find((item) => item.sourceFiles?.includes(locator.sourceFile));
    if (session) Object.assign(locator, { sessionId: session.sessionId, model: session.models?.[0], cwd: session.cwd, sessionTitle: session.sessionTitle });
  }
  if (locator?.sourceFile && (locator?.sourceLine || locator?.sourceOffset != null)) {
    const events = indexManager.parseEventLineFromIndex(locator, threadMeta, _deps.parsers, _deps.applyEventSessionMetaCore, { bounded: true });
    const found = events.find((event) => event.eventId === eventId)
      || events[Number(locator.lineEventIndex) || 0];
    if (found && locator.expectedTime && found.time !== locator.expectedTime) throw new Error("Source record changed; reload the session before opening this event");
    if (found) return found;
  }
  return null;
}

/**
 * Export a full session as sanitized Markdown or JSONL.
 */
function prepareDialogueRecord(eventId) {
  const records = listSourceFileRecords();
  const locator = recentEventsReader.resolveEventLocator(eventId, records);
  if (!locator) throw new Error("Event not found; reload search results");
  const record = records.find((item) => item.file === locator.sourceFile);
  if (!_deps.dialogueSearchIndex?.state().enabled) throw new Error("Dialogue cache requires Node.js with SQLite support");
  _deps.dialogueSearchIndex.indexRecord(record);
}

function getDialogueBody(eventId, options = {}) {
  const records = listSourceFileRecords();
  const locator = recentEventsReader.resolveEventLocator(eventId, records);
  if (!locator || !locator.sourceLength) throw new Error("Dialogue not found; reload the session");
  const obj = readCompactJsonRecord(locator.sourceFile, locator.sourceOffset, locator.sourceLength, { stringLimit: 2048 }).value;
  const { parser, adapter } = fsScanner.resolveParserForFile(locator.sourceFile, _deps.parsers);
  const parsed = parser(obj, { sessionId: locator.sessionId, sourceFile: locator.sourceFile, sourceType: adapter.key, compactContent: true });
  const event = (Array.isArray(parsed) ? parsed : [parsed])[locator.lineEventIndex || 0];
  if (!event || !["Agent", "User", "Prompt"].includes(event.callType) || (locator.expectedTime && event.time !== locator.expectedTime)) {
    throw new Error("Dialogue changed or is unavailable; reload the session");
  }
  const offset = Math.max(0, Number(options.offset) || 0);
  const limit = Math.max(1, Math.min(65536, Number(options.limit) || 65536));
  let totalLength = 0;
  let content = "";
  streamDialogueText(locator.sourceFile, { byteOffset: locator.sourceOffset, byteLength: locator.sourceLength, truncated: true }, obj, event.content, (text) => {
    const start = totalLength;
    totalLength += text.length;
    if (totalLength > offset && start < offset + limit) content += text.slice(Math.max(0, offset - start), Math.max(0, offset + limit - start));
  });
  return { content, offset, totalLength, nextOffset: offset + content.length, hasMore: offset + content.length < totalLength };
}

function getDialogueContext(eventId) {
  prepareDialogueRecord(eventId);
  const result = _deps.dialogueSearchIndex.context(eventId);
  if (!result) throw new Error("Dialogue changed or is unavailable; reload search results");
  const meta = loadThreadMeta();
  for (const event of result.events) {
    const session = meta.get(event.sessionId);
    if (session) _deps.applyEventSessionMetaCore?.(event, session, { titleStrategy: "always" });
  }
  return result;
}

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
  const records = listSourceFileRecords();
  const threadMeta = loadThreadMeta();
  getSummaryForRecords(records, threadMeta);
  const resolvedSessionId = _deps.summaryStore.resolveSessionIdentifier(sessionId, { files: records });
  const files = _deps.summaryStore.getSourceFilesForSession(resolvedSessionId, { files: records });
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
  const records = listSourceFileRecords();
  const summary = getSummaryForRecords(records);
  const annotationMap = new Map((_deps.annotationStore?.list?.() || []).map((item) => [item.sessionId, item]));
  const groups = summary.sessions.groups.map((session) => ({
    ...session,
    annotation: annotationMap.get(session.sessionId) || null,
    outcome: SessionInsights.deriveSessionOutcome(session, annotationMap.get(session.sessionId)),
  }));

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

function getSessionAnnotation(sessionId) {
  return _deps.annotationStore?.get?.(sessionId) || null;
}

function setSessionAnnotation(sessionId, annotation) {
  return _deps.annotationStore?.set?.(sessionId, annotation) || null;
}

function querySessionComparison(leftId, rightId) {
  const records = listSourceFileRecords();
  const summary = getSummaryForRecords(records);
  const resolve = (id) => {
    const resolved = _deps.summaryStore.resolveSessionIdentifier(id, { files: records });
    return summary.sessions.groups.find((session) => session.sessionId === resolved) || null;
  };
  const left = resolve(leftId);
  const right = resolve(rightId);
  if (!left || !right) return null;
  const leftAnnotation = getSessionAnnotation(left.sessionId);
  const rightAnnotation = getSessionAnnotation(right.sessionId);
  return {
    generatedAt: new Date().toISOString(),
    left: { ...left, annotation: leftAnnotation, outcome: SessionInsights.deriveSessionOutcome(left, leftAnnotation) },
    right: { ...right, annotation: rightAnnotation, outcome: SessionInsights.deriveSessionOutcome(right, rightAnnotation) },
    comparison: SessionInsights.compareSessions(left, right),
  };
}

function querySessionReplay(sessionId, limitValue) {
  const records = listSourceFileRecords();
  const summary = getSummaryForRecords(records);
  const resolvedSessionId = _deps.summaryStore.resolveSessionIdentifier(sessionId, { files: records });
  const session = summary.sessions.groups.find((item) => item.sessionId === resolvedSessionId);
  if (!session) return null;
  const limit = Math.min(config.MAX_PAGE_SIZE, Math.max(50, Number(limitValue) || 500));
  const payload = querySessionEventsDirect({
    mode: "raw",
    platform: "",
    model: "",
    type: "",
    sessionId: resolvedSessionId,
    quickFilter: "all",
    tokenThreshold: 0,
    query: "",
    startMs: null,
    endMs: null,
    order: "desc",
    offset: 0,
    limit,
    includeSummary: false,
    forceForward: true,
  }, records);
  return {
    generatedAt: new Date().toISOString(),
    session,
    replay: SessionInsights.buildExecutionReplay(payload.events, { limit }),
    page: payload.page,
  };
}

function querySessionAnalysis(sessionId) {
  const payload = querySessionReplay(sessionId, 1000);
  if (!payload) return null;
  const records = listSourceFileRecords();
  const summary = _deps.summaryStore.getLastSummary();
  const events = querySessionEventsDirect({ mode: "raw", sessionId: payload.session.sessionId, order: "desc", offset: 0,
    limit: 1000, query: "", quickFilter: "all", includeSummary: false, forceForward: true }, records);
  return { ...analyzeTurns(events.events), hasEarlierEvents: events.page.hasMore,
    relations: agentRelations(summary.sessions.groups, payload.session.sessionId), git: gitEvidence(payload.session) };
}

/**
 * Fetch observability summary.
 */
function queryObservability() {
  const records = listSourceFileRecords();
  const summary = getSummaryForRecords(records);
  return buildObservabilityPayload(records, summary);
}

function recalculateObservability() {
  const records = listSourceFileRecords();
  const startedAt = Date.now();
  const before = _deps.analysisServices?.audit().snapshot
    || (_deps.summaryStore.getLastSummary?.() && _deps.analysisServices?.capture(_deps.summaryStore.getLastSummary()));
  const summary = _deps.summaryStore.rebuild({
    files: records,
    stateSignature: sourceStateSignature(),
    threadMeta: loadThreadMeta(),
  });
  const audit = _deps.analysisServices?.recordAudit(before, _deps.analysisServices.capture(summary), {
    durationMs: Date.now() - startedAt, sourceCount: records.length, parserVersion: summary.provenance?.parserVersion,
    previousSnapshotAt: before?.at || null,
    sourceFingerprint: _deps.indexManager.signatureHash(sourceFiles.aggregateRecordsKey(records)),
  });
  return buildObservabilityPayload(records, summary, {
    audit,
    recalculation: {
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      scannedFiles: summary.cache?.scannedFiles || 0,
      totalFiles: records.length,
    },
  });
}

function buildObservabilityPayload(records, summary, extra = {}) {
  const index = publicSourceState(records, summary);
  _deps.indexManager.trimHeapNow?.();

  return {
    generatedAt: new Date().toISOString(),
    mode: "observe",
    index,
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
      dialogueSearch: _deps.dialogueSearchIndex?.state?.() || { enabled: false, mode: "scan" },
    },
    summary,
    ...extra,
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
  getDialogueBody,
  getDialogueContext,
  init,
  invalidateCaches,
  parseRequestFilters,
  queryEvents,
  getEventDetail,
  exportSession,
  resolveSessionIdentifier,
  querySessions,
  getSessionAnnotation,
  setSessionAnnotation,
  querySessionComparison,
  querySessionReplay,
  querySessionAnalysis,
  queryObservability,
  recalculateObservability,
  serveStatic,
};
