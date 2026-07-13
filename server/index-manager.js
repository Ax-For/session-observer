#!/usr/bin/env node
/**
 * Index management: building, caching, scheduling refreshes, and file event caching.
 */
const fs = require("fs");
const crypto = require("crypto");
const config = require("./config");
const fsScanner = require("./fs-scanner");
const sessionMeta = require("./session-meta");

const fileEventCache = new Map();
const stringPool = new Map();
let aggregateCache = { key: "", events: [] };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function windowAnchorMs(nowMs = Date.now()) {
  return Math.floor(nowMs / HOUR_MS) * HOUR_MS;
}

function normalizeIndexWindowDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return config.INDEX_DEFAULT_WINDOW_DAYS;
  return Math.min(config.INDEX_MAX_WINDOW_DAYS, Math.max(1, Math.floor(parsed)));
}

function createIndexWindow(days = config.INDEX_DEFAULT_WINDOW_DAYS, nowMs = Date.now()) {
  const normalizedDays = normalizeIndexWindowDays(days);
  const anchorMs = windowAnchorMs(nowMs);
  const startMs = anchorMs - (normalizedDays * DAY_MS);
  return {
    days: normalizedDays,
    defaultDays: config.INDEX_DEFAULT_WINDOW_DAYS,
    maxDays: config.INDEX_MAX_WINDOW_DAYS,
    anchorMs,
    startMs,
    startTime: new Date(startMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
  };
}

let indexWindow = createIndexWindow();

const indexState = {
  events: [],
  totalEvents: 0,
  retainedEvents: 0,
  omittedEventCount: 0,
  scannedFiles: 0,
  skippedFiles: 0,
  aggregateKey: "",
  dirty: true,
  refreshTimer: null,
  lastBuiltAt: "",
  lastError: "",
};

function resetIndexState() {
  aggregateCache = { key: "", events: [] };
  indexState.events = [];
  indexState.totalEvents = 0;
  indexState.retainedEvents = 0;
  indexState.omittedEventCount = 0;
  indexState.scannedFiles = 0;
  indexState.skippedFiles = 0;
  indexState.aggregateKey = "";
  indexState.dirty = true;
  fileEventCache.clear();
  stringPool.clear();
  trimHeapNow({ aggressive: true });
}

function getIndexWindowState() {
  return { ...indexWindow };
}

function setIndexWindowDays(days, nowMs = Date.now()) {
  const next = createIndexWindow(days, nowMs);
  const changed = next.days !== indexWindow.days || next.anchorMs !== indexWindow.anchorMs;
  indexWindow = next;
  resetIndexState();
  return {
    changed,
    indexWindow: getIndexWindowState(),
  };
}

function refreshIndexWindowClock(nowMs = Date.now()) {
  const anchorMs = windowAnchorMs(nowMs);
  if (anchorMs === indexWindow.anchorMs) return false;
  indexWindow = createIndexWindow(indexWindow.days, nowMs);
  resetIndexState();
  return true;
}

/**
 * Compute a short SHA-1 hash of a value for comparison.
 */
function signatureHash(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 12);
}

/**
 * Intern a string to reduce memory usage of repeated values.
 */
function internString(value) {
  if (typeof value !== "string" || !value) return value;
  const cached = stringPool.get(value);
  if (cached) return cached;
  stringPool.set(value, value);
  return value;
}

/**
 * Intern common string fields on an event to reduce memory.
 */
function internEventStrings(event) {
  for (const key of [
    "sessionId", "model", "toolName", "cwd", "sessionTitle",
    "sourceFile", "sourceType", "callType", "rawType", "rawSubType",
  ]) {
    if (typeof event[key] === "string") event[key] = internString(event[key]);
  }
  return event;
}

/**
 * Generate a unique event locator ID from file, line, and index.
 */
function eventLocatorId(file, locator, eventIndex) {
  return crypto
    .createHash("sha1")
    .update(`${file}:${locator}:${eventIndex}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Attach source location info to an event.
 */
function attachEventLocator(event, file, lineNumber, eventIndex, options = {}) {
  event.sourceFile = event.sourceFile || file;
  const sourceLine = Number(lineNumber);
  if (Number.isFinite(sourceLine) && sourceLine > 0) event.sourceLine = sourceLine;
  const sourceOffset = Number(options.sourceOffset);
  if (Number.isFinite(sourceOffset) && sourceOffset >= 0) event.sourceOffset = sourceOffset;
  const sourceLength = Number(options.sourceLength);
  if (Number.isFinite(sourceLength) && sourceLength >= 0) event.sourceLength = sourceLength;
  event.lineEventIndex = eventIndex;
  const locator = event.sourceLine ? `line:${event.sourceLine}` : `offset:${event.sourceOffset || 0}`;
  event.eventId = eventLocatorId(file, locator, eventIndex);
  return event;
}

/**
 * Build an indexed event with preview, search text, and truncation flags.
 */
function compactTokenUsage(tokenUsage) {
  if (!tokenUsage || typeof tokenUsage !== "object") return undefined;
  const compact = {};
  for (const key of ["input", "output", "total", "cachedInput", "cacheReadInput", "cacheCreationInput", "reasoningOutput"]) {
    const value = Number(tokenUsage[key]);
    if (Number.isFinite(value) && value !== 0) compact[key] = value;
  }
  return Object.keys(compact).length ? compact : undefined;
}

function setStringField(target, key, value) {
  if (typeof value !== "string" || value === "") return;
  target[key] = value;
}

function makeIndexedEvent(event) {
  const content = String(event.content || "");
  const contentPreview = content.length > config.EVENT_CONTENT_PREVIEW_LENGTH
    ? `${content.slice(0, config.EVENT_CONTENT_PREVIEW_LENGTH)}…`
    : content;
  const searchText = content.length > config.EVENT_SEARCH_TEXT_LENGTH
    ? content.slice(0, config.EVENT_SEARCH_TEXT_LENGTH)
    : content;
  const indexed = {};
  setStringField(indexed, "time", event.time);
  setStringField(indexed, "sessionId", event.sessionId);
  setStringField(indexed, "model", event.model);
  setStringField(indexed, "turnId", event.turnId);
  setStringField(indexed, "callId", event.callId);
  setStringField(indexed, "toolName", event.toolName);
  setStringField(indexed, "cwd", event.cwd);
  setStringField(indexed, "sessionTitle", event.sessionTitle);
  setStringField(indexed, "extra", event.extra);
  setStringField(indexed, "sourceFile", event.sourceFile);
  setStringField(indexed, "sourceType", event.sourceType);
  setStringField(indexed, "callType", event.callType);
  setStringField(indexed, "rawType", event.rawType);
  setStringField(indexed, "rawSubType", event.rawSubType);
  setStringField(indexed, "eventId", event.eventId);
  setStringField(indexed, "content", contentPreview);

  const sourceLine = Number(event.sourceLine);
  if (Number.isFinite(sourceLine) && sourceLine > 0) indexed.sourceLine = sourceLine;
  const sourceOffset = Number(event.sourceOffset);
  if (Number.isFinite(sourceOffset) && sourceOffset >= 0) indexed.sourceOffset = sourceOffset;
  const sourceLength = Number(event.sourceLength);
  if (Number.isFinite(sourceLength) && sourceLength >= 0) indexed.sourceLength = sourceLength;
  const lineEventIndex = Number(event.lineEventIndex);
  if (Number.isFinite(lineEventIndex) && lineEventIndex > 0) indexed.lineEventIndex = lineEventIndex;

  const summary = String(event.summary || "");
  if (summary && summary !== contentPreview) indexed.summary = summary;
  if (event.contentTruncated || content.length > config.EVENT_CONTENT_PREVIEW_LENGTH) {
    indexed.contentTruncated = true;
    indexed.contentLength = Number(event.contentLength) > 0
      ? Number(event.contentLength)
      : content.length;
  }
  const compactUsage = compactTokenUsage(event.tokenUsage);
  if (compactUsage) indexed.tokenUsage = compactUsage;
  const compactReportedUsage = compactTokenUsage(event.reportedTokenUsage);
  if (compactReportedUsage) indexed.reportedTokenUsage = compactReportedUsage;
  if (config.EVENT_SEARCH_TEXT_LENGTH > config.EVENT_CONTENT_PREVIEW_LENGTH && searchText !== contentPreview) {
    indexed.searchText = searchText;
  }
  return internEventStrings(indexed);
}

function shouldRetainFileEventCache(events) {
  const maxEvents = config.INDEX_FILE_EVENT_CACHE_MAX_EVENTS;
  return maxEvents > 0 && Array.isArray(events) && events.length <= maxEvents;
}

function eventTimestampMs(event) {
  const parsed = Date.parse(event?.time || "");
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function eventWithinIndexWindow(event, cutoffMs) {
  if (!Number.isFinite(cutoffMs)) return true;
  return eventTimestampMs(event) >= cutoffMs;
}

function filterFileRecordsForIndexWindow(records, cutoffMs = indexWindow.startMs) {
  const sourceRecords = Array.isArray(records) ? records : [];
  if (!Number.isFinite(cutoffMs)) {
    return {
      records: sourceRecords,
      files: sourceRecords.map((record) => record.file),
      scannedFiles: sourceRecords.length,
      skippedFiles: 0,
    };
  }

  const filtered = sourceRecords.filter((record) => Number(record.mtimeMs) >= cutoffMs);
  return {
    records: filtered,
    files: filtered.map((record) => record.file),
    scannedFiles: filtered.length,
    skippedFiles: sourceRecords.length - filtered.length,
  };
}

function sortEventsChronologically(events) {
  return (events || []).sort((left, right) => {
    const timeDiff = eventTimestampMs(left) - eventTimestampMs(right);
    if (timeDiff !== 0) return timeDiff;

    const fileDiff = String(left?.sourceFile || "").localeCompare(String(right?.sourceFile || ""));
    if (fileDiff !== 0) return fileDiff;

    const lineDiff = (Number(left?.sourceLine) || 0) - (Number(right?.sourceLine) || 0);
    if (lineDiff !== 0) return lineDiff;

    return (Number(left?.lineEventIndex) || 0) - (Number(right?.lineEventIndex) || 0);
  });
}

function limitIndexedEvents(events, maxEvents = config.INDEX_MAX_EVENTS) {
  const totalEvents = Array.isArray(events) ? events.length : 0;
  const limit = Number(maxEvents) || 0;
  if (!Array.isArray(events) || limit <= 0 || totalEvents <= limit) {
    return {
      events: events || [],
      totalEvents,
      retainedEvents: totalEvents,
      omittedEventCount: 0,
    };
  }

  const omittedEventCount = totalEvents - limit;
  events.splice(0, omittedEventCount);
  return {
    events,
    totalEvents,
    retainedEvents: events.length,
    omittedEventCount,
  };
}

/**
 * Return public index state for API responses.
 */
function publicIndexState(currentAggregateKey) {
  return {
    dirty: indexState.dirty,
    lastBuiltAt: indexState.lastBuiltAt,
    lastError: indexState.lastError,
    aggregateHash: signatureHash(indexState.aggregateKey),
    currentAggregateHash: signatureHash(currentAggregateKey),
    totalEvents: indexState.totalEvents,
    retainedEvents: indexState.retainedEvents,
    omittedEventCount: indexState.omittedEventCount,
    maxEvents: config.INDEX_MAX_EVENTS,
    scannedFiles: indexState.scannedFiles,
    skippedFiles: indexState.skippedFiles,
    windowDays: indexWindow.days,
    windowStartTime: indexWindow.startTime,
    defaultWindowDays: indexWindow.defaultDays,
    maxWindowDays: indexWindow.maxDays,
  };
}

/**
 * Trigger GC immediately if available.
 */
function runGcCycle() {
  try {
    global.gc({ type: "major", execution: "sync" });
  } catch {
    global.gc();
  }
}

function trimHeapNow(options = {}) {
  if (typeof global.gc !== "function") return;
  const cycles = options.aggressive ? 3 : 1;
  for (let index = 0; index < cycles; index += 1) {
    try { runGcCycle(); } catch { /* optional */ }
  }
}

/**
 * Trigger GC if available.
 */
function trimHeapSoon() {
  if (typeof global.gc !== "function") return;
  setTimeout(() => {
    trimHeapNow();
  }, 0).unref();
}

/**
 * Parse events from a single file, supporting incremental updates.
 */
function parseFileEvents(file, stateSignature, threadMeta, parsers, applyEventSessionMetaCore, options = {}) {
  const stat = fs.statSync(file);
  const { parser } = fsScanner.resolveParserForFile(file, parsers);
  const cutoffMs = Number(options.cutoffMs);
  const cutoffKey = Number.isFinite(cutoffMs) ? cutoffMs : 0;
  const cached = fileEventCache.get(file);
  const hasCachedEvents = Array.isArray(cached?.events);
  const cacheFileStateMatches =
    cached &&
    cached.stateSignature === stateSignature &&
    cached.cutoffKey === cutoffKey &&
    cached.size === stat.size &&
    cached.mtimeMs === stat.mtimeMs;
  const canAppendIncrementally =
    cached &&
    hasCachedEvents &&
    cached.stateSignature === stateSignature &&
    cached.cutoffKey === cutoffKey &&
    stat.size > cached.size &&
    cached.endedWithNewline !== false &&
    cached.context;

  if (cacheFileStateMatches && hasCachedEvents) {
    return cached.events;
  }

  const context = canAppendIncrementally
    ? { ...cached.context, sourceFile: file }
    : { model: "unknown", sessionId: "unknown", sourceFile: file, cwd: "", sessionTitle: "" };
  const parsed = canAppendIncrementally ? cached.events.slice() : [];
  let tailBuffer = canAppendIncrementally ? cached.tailBuffer || "" : "";
  let lineNumber = canAppendIncrementally ? Number(cached.lineCount) || 0 : 0;
  let endedWithNewline = canAppendIncrementally ? cached.endedWithNewline !== false : false;

  const pushLine = (line, currentLineNumber) => {
    if (!line) return true;
    try {
      const obj = JSON.parse(line);
      const evtOrArray = parser(obj, context);
      const events = Array.isArray(evtOrArray) ? evtOrArray : [evtOrArray].filter(Boolean);
      events.forEach((evt, eventIndex) => {
        const meta = threadMeta.get(evt.sessionId);
        if (meta) {
          const titleStrategy =
            parser === parsers.parseCodexLineToEvent || meta.explicitTitle
              ? "always"
              : "missing-only";
          applyEventSessionMetaCore(evt, meta, { titleStrategy });
        }
        if (eventWithinIndexWindow(evt, cutoffMs)) {
          parsed.push(makeIndexedEvent(attachEventLocator(evt, file, currentLineNumber, eventIndex)));
        }
      });
      return true;
    } catch {
      // skip invalid lines
      return false;
    }
  };

  const consumeTailIfComplete = () => {
    if (!tailBuffer) return;
    const finalLineNumber = lineNumber + 1;
    if (pushLine(tailBuffer, finalLineNumber)) {
      lineNumber = finalLineNumber;
      tailBuffer = "";
    }
  };

  if (canAppendIncrementally) {
    const fd = fs.openSync(file, "r");
    try {
      const length = stat.size - cached.size;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, cached.size);
      const appendedText = buf.toString("utf8");
      const chunk = `${tailBuffer}${appendedText}`;
      const lines = chunk.split(/\r?\n/);
      tailBuffer = lines.pop() || "";
      for (const line of lines) {
        lineNumber += 1;
        pushLine(line, lineNumber);
      }
      endedWithNewline = appendedText.endsWith("\n");
      consumeTailIfComplete();
    } finally {
      fs.closeSync(fd);
    }
  } else if (!canAppendIncrementally) {
    const result = fsScanner.forEachCompleteJsonlLine(file, (line, currentLineNumber) => {
      lineNumber = currentLineNumber;
      pushLine(line, currentLineNumber);
    });
    lineNumber = result.lineCount;
    tailBuffer = result.tailBuffer;
    endedWithNewline = result.endedWithNewline;
    consumeTailIfComplete();
  }

  const nextCache = {
    stateSignature,
    cutoffKey,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    tailBuffer,
    lineCount: lineNumber,
    endedWithNewline,
    context: { ...context },
  };
  if (shouldRetainFileEventCache(parsed)) nextCache.events = parsed;
  fileEventCache.set(file, nextCache);
  return parsed;
}

/**
 * Parse all events from a file (full re-read, used for targeted queries).
 */
function parseFullFileEvents(file, threadMeta, parsers, applyEventSessionMetaCore, options = {}) {
  if (!fs.existsSync(file)) return [];
  const { parser } = fsScanner.resolveParserForFile(file, parsers);
  const context = { model: "unknown", sessionId: "unknown", sourceFile: file, cwd: "", sessionTitle: "" };
  const events = [];
  const targetLine = Number(options.targetLine) || 0;

  fsScanner.forEachJsonlLine(file, (line, lineNumber) => {
    if (!line) return undefined;
    try {
      const obj = JSON.parse(line);
      const evtOrArray = parser(obj, context);
      const parsedEvents = Array.isArray(evtOrArray) ? evtOrArray : [evtOrArray].filter(Boolean);
      if (targetLine && lineNumber !== targetLine) {
        if (lineNumber >= targetLine) return false;
        return undefined;
      }
      parsedEvents.forEach((evt, eventIndex) => {
        const meta = threadMeta.get(evt.sessionId);
        if (meta) {
          const titleStrategy =
            parser === parsers.parseCodexLineToEvent || meta.explicitTitle
              ? "always"
              : "missing-only";
          applyEventSessionMetaCore(evt, meta, { titleStrategy });
        }
        events.push(attachEventLocator(evt, file, lineNumber, eventIndex));
      });
    } catch {
      // skip invalid lines
    }
    if (targetLine && lineNumber >= targetLine) return false;
    return undefined;
  });

  return events;
}

/**
 * Parse a single event line from the index (for detail lookup).
 */
function parseEventLineFromIndex(indexedEvent, threadMeta, parsers, applyEventSessionMetaCore) {
  const sourceLine = Number(indexedEvent.sourceLine);
  const sourceOffset = Number(indexedEvent.sourceOffset);
  const sourceLength = Number(indexedEvent.sourceLength);
  if (Number.isFinite(sourceLength) && sourceLength > config.EVENT_DETAIL_MAX_LINE_BYTES) return [];
  const maxBytes = Number.isFinite(sourceLength) && sourceLength > 0
    ? Math.min(config.EVENT_DETAIL_MAX_LINE_BYTES, sourceLength + 1)
    : config.EVENT_DETAIL_MAX_LINE_BYTES;
  const line = Number.isFinite(sourceOffset) && sourceOffset >= 0
    ? fsScanner.readJsonlLineAtOffset(indexedEvent.sourceFile, sourceOffset, maxBytes)
    : Number.isFinite(sourceLine) && sourceLine > 0 && Number.isFinite(sourceLength)
      ? fsScanner.readJsonlLine(indexedEvent.sourceFile, sourceLine)
      : "";
  if (!line) return [];
  const { parser } = fsScanner.resolveParserForFile(indexedEvent.sourceFile, parsers);
  const context = {
    model: indexedEvent.model || "unknown",
    sessionId: indexedEvent.sessionId || "unknown",
    sourceFile: indexedEvent.sourceFile,
    cwd: indexedEvent.cwd || "",
    sessionTitle: indexedEvent.sessionTitle || "",
  };

  try {
    const obj = JSON.parse(line);
    const evtOrArray = parser(obj, context);
    const events = Array.isArray(evtOrArray) ? evtOrArray : [evtOrArray].filter(Boolean);
    return events.map((evt, eventIndex) => {
      const meta = threadMeta.get(evt.sessionId);
      if (meta) {
        const titleStrategy =
          parser === parsers.parseCodexLineToEvent || meta.explicitTitle
            ? "always"
            : "missing-only";
        applyEventSessionMetaCore(evt, meta, { titleStrategy });
      }
      return attachEventLocator(evt, indexedEvent.sourceFile, sourceLine, eventIndex, {
        sourceOffset,
        sourceLength: indexedEvent.sourceLength,
      });
    });
  } catch {
    return [];
  }
}

/**
 * Compute the aggregate signature of all JSONL files and state DB.
 */
function computeAggregateSignature() {
  refreshIndexWindowClock();
  const { listJsonlFiles, getPathSignature } = fsScanner;
  const codexFiles = listJsonlFiles(config.SESSIONS_DIR);
  const claudeFiles = listJsonlFiles(config.CLAUDE_PROJECTS_DIR);
  const files = [...codexFiles, ...claudeFiles];
  const stateSignature = `${getPathSignature(config.STATE_DB)}|${getPathSignature(config.CODEX_SESSION_INDEX)}`;
  const records = files.map((file) => {
    const stat = fs.statSync(file);
    return {
      file,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      signature: `${file}:${stat.size}:${stat.mtimeMs}`,
    };
  });
  const filtered = filterFileRecordsForIndexWindow(records, indexWindow.startMs);
  const parts = filtered.records.map((record) => record.signature);
  return {
    files: filtered.files,
    stateSignature,
    scannedFiles: filtered.scannedFiles,
    skippedFiles: filtered.skippedFiles,
    aggregateKey: `window:${indexWindow.days}:${indexWindow.startMs}|${stateSignature}|${parts.join("|")}`,
  };
}

/**
 * Build the full aggregate of all events.
 */
function computeAggregate(parsers, applyEventSessionMetaCore, dedupeEventsCore, mergeSessionMetaRecordsCore) {
  const threadMeta = sessionMeta.loadMergedThreadMetadata(mergeSessionMetaRecordsCore);
  const { files, stateSignature, aggregateKey, scannedFiles, skippedFiles } = computeAggregateSignature();
  const liveFiles = new Set(files);
  for (const cachedFile of fileEventCache.keys()) {
    if (!liveFiles.has(cachedFile)) fileEventCache.delete(cachedFile);
  }
  if (aggregateCache.key === aggregateKey) {
    return aggregateCache;
  }

  stringPool.clear();
  const all = [];
  for (const file of files) {
    const events = parseFileEvents(file, stateSignature, threadMeta, parsers, applyEventSessionMetaCore, {
      cutoffMs: indexWindow.startMs,
    });
    for (const event of events) all.push(event);
  }
  sortEventsChronologically(all);
  const deduped = dedupeEventsCore(all, { inPlace: true });
  const limited = limitIndexedEvents(deduped);
  aggregateCache = {
    key: aggregateKey,
    aggregateKey,
    events: limited.events,
    totalEvents: limited.totalEvents,
    retainedEvents: limited.retainedEvents,
    omittedEventCount: limited.omittedEventCount,
    scannedFiles,
    skippedFiles,
    windowDays: indexWindow.days,
    windowStartTime: indexWindow.startTime,
  };
  return aggregateCache;
}

/**
 * Schedule a debounced index refresh.
 */
function scheduleIndexRefresh(reason = "unknown", refreshIndex) {
  indexState.dirty = true;
  if (indexState.refreshTimer) clearTimeout(indexState.refreshTimer);
  indexState.refreshTimer = setTimeout(() => {
    indexState.refreshTimer = null;
    try {
      refreshIndex(reason);
    } catch {
      // leave dirty state to retry
    }
  }, config.INDEX_REFRESH_DEBOUNCE_MS);
}

/**
 * Rebuild the index.
 */
function refreshIndex(reason, parsers, applyEventSessionMetaCore, dedupeEventsCore, mergeSessionMetaRecordsCore) {
  try {
    const built = computeAggregate(parsers, applyEventSessionMetaCore, dedupeEventsCore, mergeSessionMetaRecordsCore);
    indexState.events = built.events;
    indexState.totalEvents = built.totalEvents;
    indexState.retainedEvents = built.retainedEvents;
    indexState.omittedEventCount = built.omittedEventCount;
    indexState.scannedFiles = built.scannedFiles;
    indexState.skippedFiles = built.skippedFiles;
    indexState.aggregateKey = built.aggregateKey;
    indexState.lastBuiltAt = new Date().toISOString();
    indexState.lastError = "";
    indexState.dirty = false;
    trimHeapNow();
    return indexState.events;
  } catch (err) {
    indexState.lastError = String(err);
    throw err;
  }
}

/**
 * Ensure the index is up to date. Returns events and current aggregate key.
 */
function ensureIndexReady(parsers, applyEventSessionMetaCore, dedupeEventsCore, mergeSessionMetaRecordsCore) {
  const { aggregateKey } = computeAggregateSignature();
  if (!indexState.events.length || indexState.dirty || indexState.aggregateKey !== aggregateKey) {
    refreshIndex(
      indexState.events.length ? "dirty-read" : "cold-start",
      parsers, applyEventSessionMetaCore, dedupeEventsCore, mergeSessionMetaRecordsCore
    );
  }
  return { events: indexState.events, currentAggregateKey: aggregateKey };
}

/**
 * Start file watchers for automatic index refresh.
 */
function startIndexWatchers(scheduleIndexRefreshFn) {
  const watchPath = (target) => {
    if (!fs.existsSync(target)) return null;
    try {
      return fs.watch(target, { recursive: true }, () => scheduleIndexRefreshFn("watch"));
    } catch {
      try {
        return fs.watch(target, () => scheduleIndexRefreshFn("watch"));
      } catch {
        return null;
      }
    }
  };

  const sessionWatcher = watchPath(config.SESSIONS_DIR);
  const stateWatcher = watchPath(config.STATE_DB);
  const claudeWatcher = watchPath(config.CLAUDE_PROJECTS_DIR);
  if (!sessionWatcher) {
    console.warn(`Session watcher unavailable for ${config.SESSIONS_DIR}, fallback warmup tick enabled.`);
  }
  if (!stateWatcher && fs.existsSync(config.STATE_DB)) {
    console.warn(`State DB watcher unavailable for ${config.STATE_DB}, fallback warmup tick enabled.`);
  }
  if (!claudeWatcher) {
    console.warn(`Claude Code watcher unavailable for ${config.CLAUDE_PROJECTS_DIR}, fallback warmup tick enabled.`);
  }
  setInterval(() => {
    if (indexState.dirty) {
      try {
        // Called from server via bound refreshIndex
      } catch {
        // keep retrying
      }
    }
  }, config.INDEX_WARMUP_INTERVAL_MS).unref();
}

/**
 * Get source files for a specific session.
 */
function sourceFilesForSession(events, sessionId) {
  return [...new Set(
    (events || [])
      .filter((event) => event.sessionId === sessionId && event.sourceFile)
      .map((event) => event.sourceFile),
  )];
}

module.exports = {
  attachEventLocator,
  eventLocatorId,
  signatureHash,
  getIndexWindowState,
  setIndexWindowDays,
  makeIndexedEvent,
  limitIndexedEvents,
  filterFileRecordsForIndexWindow,
  sortEventsChronologically,
  publicIndexState,
  trimHeapNow,
  trimHeapSoon,
  parseFileEvents,
  parseFullFileEvents,
  parseEventLineFromIndex,
  ensureIndexReady,
  refreshIndex,
  scheduleIndexRefresh,
  startIndexWatchers,
  sourceFilesForSession,
  fileEventCache,
};
