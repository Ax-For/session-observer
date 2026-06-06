#!/usr/bin/env node
/**
 * On-demand event reading for the stream API.
 *
 * This module deliberately does not build or retain a global event index. It
 * scans JSONL files in newest-file-first order, keeps only the current page
 * candidates, and caches only small event locators for visible/detail lookups.
 */
const fs = require("fs");
const ObserverCore = require("../shared/observer-core");
const fsScanner = require("./fs-scanner");
const { attachEventLocator, makeIndexedEvent } = require("./index-manager");

const LOCATOR_CACHE_LIMIT = 10000;
const locatorCache = new Map();

function rememberLocator(event) {
  if (!event?.eventId || !event.sourceFile || !event.sourceLine) return;
  locatorCache.set(event.eventId, {
    eventId: event.eventId,
    sourceFile: event.sourceFile,
    sourceLine: Number(event.sourceLine),
    lineEventIndex: Number(event.lineEventIndex) || 0,
  });
  while (locatorCache.size > LOCATOR_CACHE_LIMIT) {
    const first = locatorCache.keys().next().value;
    locatorCache.delete(first);
  }
}

function lookupEventLocator(eventId) {
  return locatorCache.get(eventId) || null;
}

function normalizeFiles(files) {
  return (files || [])
    .map((entry) => {
      if (typeof entry === "string") {
        try {
          const stat = fs.statSync(entry);
          return { file: entry, size: stat.size, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      }
      return entry?.file ? entry : null;
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (Number(right.mtimeMs) !== Number(left.mtimeMs)) return Number(right.mtimeMs) - Number(left.mtimeMs);
      return String(right.file).localeCompare(String(left.file));
    });
}

function resolveParser(file, parsers) {
  if (Array.isArray(parsers)) {
    return {
      parser: parsers[0]?.parseLine || parsers[0],
      sourceType: parsers[0]?.sourceType || "codex",
    };
  }
  const resolved = fsScanner.resolveParserForFile(file, parsers || {});
  return {
    parser: resolved.parser,
    sourceType: resolved.adapter?.key || "codex",
  };
}

function callParser(parser, obj, context) {
  if (!parser) return [];
  const parsed = parser.parseLine ? parser.parseLine(obj, context) : parser(obj, context);
  return Array.isArray(parsed) ? parsed.filter(Boolean) : [parsed].filter(Boolean);
}

function applyThreadMeta(event, meta, sourceType, applyEventSessionMetaCore) {
  if (!meta || !event) return event;
  const titleStrategy = sourceType === "codex" || meta.explicitTitle ? "always" : "missing-only";
  return applyEventSessionMetaCore(event, meta, { titleStrategy });
}

function rawLineMayMatch(line, filters) {
  const query = String(filters?.query || filters?.q || "").trim().toLowerCase();
  if (!query) return true;
  return String(line || "").toLowerCase().includes(query);
}

function defaultMatchesFilters(event, filters) {
  const query = String(filters?.query || filters?.q || "").trim().toLowerCase();
  if (filters?.platform && event.sourceType !== filters.platform) return false;
  if (filters?.model && event.model !== filters.model) return false;
  if (filters?.type && event.callType !== filters.type) return false;
  if (filters?.sessionId && event.sessionId !== filters.sessionId) return false;
  if (filters?.startMs != null) {
    const eventMs = ObserverCore.toTimeMs(event.time);
    if (eventMs == null || eventMs < filters.startMs) return false;
  }
  if (filters?.endMs != null) {
    const eventMs = ObserverCore.toTimeMs(event.time);
    if (eventMs == null || eventMs > filters.endMs) return false;
  }
  if (!query) return true;
  return [
    event.content,
    event.searchText,
    event.summary,
    event.model,
    event.toolName,
    event.cwd,
    event.sessionId,
    event.sessionTitle,
    event.tokenUsage ? JSON.stringify(event.tokenUsage) : "",
  ].some((value) => String(value || "").toLowerCase().includes(query));
}

function eventTimeMs(event) {
  const parsed = ObserverCore.toTimeMs(event?.time);
  return parsed == null ? Number.NEGATIVE_INFINITY : parsed;
}

function sortEvents(events, order) {
  events.sort((left, right) => {
    const timeDiff = eventTimeMs(right) - eventTimeMs(left);
    if (timeDiff !== 0) return order === "asc" ? -timeDiff : timeDiff;
    const lineDiff = (Number(right.sourceLine) || 0) - (Number(left.sourceLine) || 0);
    if (lineDiff !== 0) return order === "asc" ? -lineDiff : lineDiff;
    return (Number(right.lineEventIndex) || 0) - (Number(left.lineEventIndex) || 0);
  });
  return events;
}

function shouldAllowEarlyStop(filters) {
  const query = String(filters?.query || filters?.q || "").trim();
  return !query && !filters?.sessionId && !filters?.startMs && !filters?.endMs && filters?.order !== "asc";
}

function queryRecentEvents(options = {}) {
  const files = normalizeFiles(options.files);
  const filters = options.filters || {};
  const order = filters.order === "asc" ? "asc" : "desc";
  const offset = Math.max(0, Number(options.offset ?? filters.offset) || 0);
  const limit = Math.max(0, Number(options.limit ?? filters.limit) || 250);
  const pageEnd = offset + limit;
  const applyEventSessionMetaCore = options.applyEventSessionMetaCore || ObserverCore.applyEventSessionMeta;
  const eventMatchesModeCore = options.eventMatchesModeCore || ObserverCore.eventMatchesMode;
  const eventMatchesFiltersCore = options.eventMatchesFiltersCore || defaultMatchesFilters;
  const threadMeta = options.threadMeta || new Map();
  const candidates = [];
  let scannedFiles = 0;
  let stoppedEarly = false;

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const record = files[fileIndex];
    const { parser, sourceType } = resolveParser(record.file, options.parsers);
    if (!parser) continue;
    scannedFiles += 1;
    const context = { model: "unknown", sessionId: "unknown", sourceFile: record.file, cwd: "", sessionTitle: "" };
    const fileEvents = [];

    fsScanner.forEachCompleteJsonlLine(record.file, (line, lineNumber) => {
      if (!line || !rawLineMayMatch(line, filters)) return;
      try {
        const obj = JSON.parse(line);
        const parsedEvents = callParser(parser, obj, context);
        parsedEvents.forEach((event, eventIndex) => {
          const meta = threadMeta.get(event.sessionId);
          applyThreadMeta(event, meta, sourceType, applyEventSessionMetaCore);
          const indexed = makeIndexedEvent(attachEventLocator(event, record.file, lineNumber, eventIndex));
          if (event.id != null) indexed.id = event.id;
          if (!eventMatchesModeCore(indexed, filters.mode)) return;
          if (!eventMatchesFiltersCore(indexed, filters)) return;
          rememberLocator(indexed);
          fileEvents.push(indexed);
        });
      } catch {
        // Skip invalid or partially written JSON lines.
      }
    });

    candidates.push(...fileEvents);
    sortEvents(candidates, order);
    if (shouldAllowEarlyStop(filters) && candidates.length >= pageEnd && fileIndex < files.length - 1) {
      stoppedEarly = true;
      break;
    }
    if (candidates.length > Math.max(pageEnd * 2, pageEnd + 1000)) {
      candidates.length = Math.max(pageEnd + 1, 1000);
    }
  }

  sortEvents(candidates, order);
  const events = candidates.slice(offset, pageEnd);
  const hasMore = candidates.length > pageEnd || stoppedEarly;
  return {
    events,
    totalVisible: stoppedEarly ? Math.max(pageEnd + 1, candidates.length) : candidates.length,
    totalMatching: stoppedEarly ? Math.max(pageEnd + 1, candidates.length) : candidates.length,
    page: {
      offset,
      limit,
      hasMore,
    },
    scan: {
      scannedFiles,
      totalFiles: files.length,
      stoppedEarly,
    },
  };
}

function clearLocatorCache() {
  locatorCache.clear();
}

module.exports = {
  clearLocatorCache,
  lookupEventLocator,
  queryRecentEvents,
};
