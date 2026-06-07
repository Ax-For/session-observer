#!/usr/bin/env node
/**
 * Lightweight dashboard/session summary cache.
 *
 * The store caches per-file aggregate summaries by stat signature. It keeps
 * sessions, buckets, and counters, but never retains raw event arrays.
 */
const fs = require("fs");
const path = require("path");
const ObserverCore = require("../shared/observer-core");
const tokenPricing = require("../shared/token-pricing");
const config = require("./config");
const fsScanner = require("./fs-scanner");
const { compactLargeJsonlLine } = require("./jsonl-compact");
const { makeTruncatedLineEvent } = require("./recent-events-reader");

const SUMMARY_CACHE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function emptyUsage() {
  return {
    input: 0,
    inputTotal: 0,
    output: 0,
    total: 0,
    cachedInput: 0,
    cacheReadInput: 0,
    cacheCreationInput: 0,
    reasoningOutput: 0,
    effectiveTotal: 0,
  };
}

function addMapValue(map, key, amount) {
  const normalizedKey = key || "unknown";
  map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
}

function sortedValueEntries(map, valueKey = "total") {
  return [...(map || new Map()).entries()]
    .map(([key, value]) => ({ key, [valueKey]: value }))
    .sort((left, right) => {
      if (right[valueKey] !== left[valueKey]) return right[valueKey] - left[valueKey];
      return String(left.key).localeCompare(String(right.key), "zh-CN");
    });
}

function formatDayLabel(ms) {
  const date = new Date(ms);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}

function formatHourLabel(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:00`;
}

function startOfLocalDayMs(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function startOfLocalWeekMs(ms) {
  const dayMs = startOfLocalDayMs(ms);
  const weekday = new Date(dayMs).getDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  return dayMs - offset * DAY_MS;
}

function startOfHourMs(ms) {
  const date = new Date(ms);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function dayKeyFromMs(ms) {
  return String(startOfLocalDayMs(ms));
}

function hourKeyFromMs(ms) {
  return String(startOfHourMs(ms));
}

function createSessionSummary(sessionId, sourceType) {
  return {
    sessionId,
    sessionTitle: "",
    fallbackTitle: "",
    cwd: "",
    latestToken: null,
    latestTokenTime: "",
    aggregateToken: null,
    models: new Set(),
    count: 0,
    startedAt: "",
    latest: "",
    prompt: 0,
    agent: 0,
    tool: 0,
    sourceType: sourceType || "unknown",
    sourceFiles: new Set(),
  };
}

function deriveFallbackTitle(event) {
  if (!event || (event.callType !== "Prompt" && event.callType !== "User")) return "";
  let text = String(event.content || "").trim().replace(/\s+/g, " ");
  text = text.replace(/<[^>]+>/g, "").trim();
  if (!text || text.startsWith("# AGENTS.md") || text.startsWith("<environment_context>")) return "";
  return ObserverCore.clip(text, 36);
}

function sessionDisplayTitle(session) {
  return session?.sessionTitle?.trim() || session?.fallbackTitle?.trim() || "未命名会话";
}

function addUsageTotals(target, tokenUsage, sourceType) {
  if (!ObserverCore.hasTokenUsageData(tokenUsage)) return 0;
  const countedTotal = ObserverCore.tokenCountedTotal(tokenUsage, sourceType);
  target.input += Number.isFinite(Number(tokenUsage?.input)) ? Number(tokenUsage.input) : 0;
  target.inputTotal += ObserverCore.tokenInputTotal(tokenUsage, sourceType);
  target.output += Number.isFinite(Number(tokenUsage?.output)) ? Number(tokenUsage.output) : 0;
  target.total += Number.isFinite(Number(tokenUsage?.total)) ? Number(tokenUsage.total) : 0;
  target.cachedInput += Number.isFinite(Number(tokenUsage?.cachedInput)) ? Number(tokenUsage.cachedInput) : 0;
  target.cacheReadInput += ObserverCore.tokenCacheReadInput(tokenUsage);
  target.cacheCreationInput += ObserverCore.tokenCacheCreationInput(tokenUsage);
  target.reasoningOutput += Number.isFinite(Number(tokenUsage?.reasoningOutput)) ? Number(tokenUsage.reasoningOutput) : 0;
  target.effectiveTotal += countedTotal;
  return countedTotal;
}

function createDailyBucket() {
  return {
    events: 0,
    alerts: 0,
    tokens: 0,
    usage: emptyUsage(),
    sessions: new Set(),
    platforms: new Map(),
    workspaces: new Map(),
  };
}

function createWorkspaceBucket(cwd) {
  return {
    cwd,
    events: 0,
    tokens: 0,
    alerts: 0,
    sessions: new Set(),
  };
}

function createFileSummary(file, signature) {
  return {
    file,
    signature,
    eventsTotal: 0,
    firstEventAt: "",
    lastEventAt: "",
    sessions: new Map(),
    models: new Set(),
    types: new Set(),
    platforms: new Set(),
    usage: emptyUsage(),
    usageByModel: new Map(),
    tokensByPlatform: new Map(),
    tokensByModel: new Map(),
    tokensByWorkspace: new Map(),
    workspaces: new Map(),
    tools: new Map(),
    alerts: {
      total: 0,
      byType: new Map(),
      byPlatform: new Map(),
      bySession: new Map(),
      recent: [],
    },
    hourly: new Map(),
    daily: new Map(),
    traces: {
      llmSpans: 0,
      toolSpans: 0,
      tokenSpans: 0,
      thinkingSpans: 0,
      maxDepth: 0,
    },
  };
}

function pushRecentByTime(items, item, limit) {
  const itemTime = String(item?.time || "");
  let insertAt = items.findIndex((existing) => String(existing?.time || "").localeCompare(itemTime) < 0);
  if (insertAt === -1) {
    if (items.length >= limit) return;
    insertAt = items.length;
  }
  items.splice(insertAt, 0, item);
  if (items.length > limit) items.length = limit;
}

function touchSession(summary, event) {
  const sessionId = event?.sessionId || "unknown";
  if (!sessionId || sessionId === "unknown") return null;
  const session = summary.sessions.get(sessionId) || createSessionSummary(sessionId, event?.sourceType);
  session.count += 1;
  if (event?.time && (!session.startedAt || event.time < session.startedAt)) session.startedAt = event.time;
  if (event?.time && (!session.latest || event.time > session.latest)) session.latest = event.time;
  if (event?.sessionTitle) session.sessionTitle = event.sessionTitle;
  if (!session.fallbackTitle) session.fallbackTitle = deriveFallbackTitle(event);
  if (event?.cwd) session.cwd = event.cwd;
  if (event?.model && event.model !== "unknown") session.models.add(event.model);
  if (event?.sourceFile) session.sourceFiles.add(event.sourceFile);
  if (event?.sourceType) session.sourceType = event.sourceType;
  if (event?.callType === "Token_Usage" && ObserverCore.hasTokenUsageData(event?.tokenUsage)) {
    if (!session.latestTokenTime || String(event.time || "").localeCompare(session.latestTokenTime) >= 0) {
      session.latestToken = event.tokenUsage;
      session.latestTokenTime = event.time || "";
    }
    session.aggregateToken = ObserverCore.addTokenUsage(session.aggregateToken, event.tokenUsage);
  }
  if (event?.callType === "Prompt" || event?.callType === "User") session.prompt += 1;
  else if (event?.callType === "Agent") session.agent += 1;
  else session.tool += 1;
  summary.sessions.set(sessionId, session);
  return session;
}

function touchWorkspace(summary, event, tokenTotal, isAlert) {
  const cwd = event?.cwd || "unknown";
  const workspace = summary.workspaces.get(cwd) || createWorkspaceBucket(cwd);
  workspace.events += 1;
  workspace.tokens += tokenTotal;
  if (isAlert) workspace.alerts += 1;
  if (event?.sessionId && event.sessionId !== "unknown") workspace.sessions.add(event.sessionId);
  summary.workspaces.set(cwd, workspace);
  return workspace;
}

function touchDaily(summary, event, eventMs, tokenTotal, isAlert) {
  const key = dayKeyFromMs(eventMs);
  const bucket = summary.daily.get(key) || createDailyBucket();
  const cwd = event?.cwd || "unknown";
  const workspace = bucket.workspaces.get(cwd) || createWorkspaceBucket(cwd);

  bucket.events += 1;
  if (isAlert) bucket.alerts += 1;
  bucket.tokens += tokenTotal;
  workspace.events += 1;
  workspace.tokens += tokenTotal;
  if (isAlert) workspace.alerts += 1;
  if (event?.sessionId && event.sessionId !== "unknown") {
    bucket.sessions.add(event.sessionId);
    workspace.sessions.add(event.sessionId);
  }
  if (tokenTotal > 0) {
    addUsageTotals(bucket.usage, event.tokenUsage, event.sourceType);
    addMapValue(bucket.platforms, event?.sourceType, tokenTotal);
  }
  bucket.workspaces.set(cwd, workspace);
  summary.daily.set(key, bucket);
}

function touchHourly(summary, event, eventMs, tokenTotal, isAlert) {
  const key = hourKeyFromMs(eventMs);
  const bucket = summary.hourly.get(key) || {
    events: 0,
    alerts: 0,
    tokens: 0,
    platforms: new Map(),
  };
  bucket.events += 1;
  if (isAlert) bucket.alerts += 1;
  bucket.tokens += tokenTotal;
  if (tokenTotal > 0) addMapValue(bucket.platforms, event?.sourceType, tokenTotal);
  summary.hourly.set(key, bucket);
}

function ingestEvent(summary, event) {
  if (!event) return;
  summary.eventsTotal += 1;
  const time = event.time || "";
  if (time && (!summary.firstEventAt || time < summary.firstEventAt)) summary.firstEventAt = time;
  if (time && (!summary.lastEventAt || time > summary.lastEventAt)) summary.lastEventAt = time;
  if (event.model) summary.models.add(event.model);
  if (event.callType) summary.types.add(event.callType);
  if (event.sourceType) summary.platforms.add(event.sourceType);
  touchSession(summary, event);

  const isAlert = ObserverCore.isAlertEvent(event);
  const tokenTotal = ObserverCore.tokenCountedTotal(event.tokenUsage, event.sourceType);
  if (tokenTotal > 0) {
    addUsageTotals(summary.usage, event.tokenUsage, event.sourceType);
    const modelKey = event?.model || "unknown";
    summary.usageByModel.set(modelKey, ObserverCore.addTokenUsage(summary.usageByModel.get(modelKey), event.tokenUsage));
    addMapValue(summary.tokensByPlatform, event?.sourceType, tokenTotal);
    addMapValue(summary.tokensByModel, event?.model, tokenTotal);
    addMapValue(summary.tokensByWorkspace, event?.cwd, tokenTotal);
  }

  if (isAlert) {
    summary.alerts.total += 1;
    addMapValue(summary.alerts.byType, event?.callType, 1);
    addMapValue(summary.alerts.byPlatform, event?.sourceType, 1);
    addMapValue(summary.alerts.bySession, event?.sessionId, 1);
    pushRecentByTime(summary.alerts.recent, {
      time,
      sessionId: event?.sessionId || "",
      sessionTitle: "",
      sourceType: event?.sourceType || "unknown",
      callType: event?.callType || "Unknown",
      toolName: event?.toolName || "",
      model: event?.model || "unknown",
      cwd: event?.cwd || "unknown",
      summary: ObserverCore.clip(event?.summary || event?.content || "", 180),
      extra: event?.extra || "",
    }, 30);
  }

  if (event?.callType === "Tool_Call" || event?.callType === "Tool_Result") {
    const toolKey = event?.toolName || (event?.callType === "Tool_Result" ? "(tool result)" : "unknown");
    const tool = summary.tools.get(toolKey) || { key: toolKey, calls: 0, results: 0, alerts: 0 };
    if (event.callType === "Tool_Call") tool.calls += 1;
    if (event.callType === "Tool_Result") tool.results += 1;
    if (isAlert) tool.alerts += 1;
    summary.tools.set(toolKey, tool);
  }

  if (event?.callType === "Agent") summary.traces.llmSpans += 1;
  if (event?.callType === "Tool_Call" || event?.callType === "Tool_Result") summary.traces.toolSpans += 1;
  if (event?.callType === "Token_Usage") summary.traces.tokenSpans += 1;
  if (String(event?.extra || "").toLowerCase().includes("thinking")) summary.traces.thinkingSpans += 1;
  summary.traces.maxDepth = Math.max(summary.traces.maxDepth, event?.callType === "Tool_Result" ? 3 : 2);

  const eventMs = ObserverCore.toTimeMs(time);
  if (eventMs == null) return;
  touchWorkspace(summary, event, tokenTotal, isAlert);
  touchDaily(summary, event, eventMs, tokenTotal, isAlert);
  touchHourly(summary, event, eventMs, tokenTotal, isAlert);
}

function mergeMapTotals(target, source) {
  for (const [key, value] of source || []) addMapValue(target, key, value);
}

function mergeUsage(target, source) {
  for (const key of Object.keys(emptyUsage())) {
    target[key] += Number(source?.[key]) || 0;
  }
}

function mergeUsageByModel(target, source) {
  for (const [model, usage] of source || []) {
    target.set(model, ObserverCore.addTokenUsage(target.get(model), usage));
  }
}

function mergeWorkspace(target, source) {
  target.events += source.events || 0;
  target.tokens += source.tokens || 0;
  target.alerts += source.alerts || 0;
  for (const sessionId of source.sessions || []) target.sessions.add(sessionId);
}

function mergeDailyBucket(target, source) {
  target.events += source.events || 0;
  target.alerts += source.alerts || 0;
  target.tokens += source.tokens || 0;
  mergeUsage(target.usage, source.usage);
  for (const sessionId of source.sessions || []) target.sessions.add(sessionId);
  mergeMapTotals(target.platforms, source.platforms);
  for (const [cwd, sourceWorkspace] of source.workspaces || []) {
    const workspace = target.workspaces.get(cwd) || createWorkspaceBucket(cwd);
    mergeWorkspace(workspace, sourceWorkspace);
    target.workspaces.set(cwd, workspace);
  }
}

function mergeSession(target, source) {
  target.count += source.count || 0;
  if (source.startedAt && (!target.startedAt || source.startedAt < target.startedAt)) target.startedAt = source.startedAt;
  if (source.latest && (!target.latest || source.latest > target.latest)) target.latest = source.latest;
  if (source.sessionTitle) target.sessionTitle = source.sessionTitle;
  if (!target.fallbackTitle && source.fallbackTitle) target.fallbackTitle = source.fallbackTitle;
  if (source.cwd) target.cwd = source.cwd;
  if (source.sourceType) target.sourceType = source.sourceType;
  for (const model of source.models || []) target.models.add(model);
  for (const file of source.sourceFiles || []) target.sourceFiles.add(file);
  if (source.latestToken && (!target.latestTokenTime || String(source.latestTokenTime || "").localeCompare(target.latestTokenTime) >= 0)) {
    target.latestToken = source.latestToken;
    target.latestTokenTime = source.latestTokenTime || "";
  }
  if (source.aggregateToken) target.aggregateToken = ObserverCore.addTokenUsage(target.aggregateToken, source.aggregateToken);
  target.prompt += source.prompt || 0;
  target.agent += source.agent || 0;
  target.tool += source.tool || 0;
}

function mergeSummary(target, source) {
  target.eventsTotal += source.eventsTotal || 0;
  if (source.firstEventAt && (!target.firstEventAt || source.firstEventAt < target.firstEventAt)) target.firstEventAt = source.firstEventAt;
  if (source.lastEventAt && (!target.lastEventAt || source.lastEventAt > target.lastEventAt)) target.lastEventAt = source.lastEventAt;
  for (const model of source.models || []) target.models.add(model);
  for (const type of source.types || []) target.types.add(type);
  for (const platform of source.platforms || []) target.platforms.add(platform);
  mergeUsage(target.usage, source.usage);
  mergeUsageByModel(target.usageByModel, source.usageByModel);
  mergeMapTotals(target.tokensByPlatform, source.tokensByPlatform);
  mergeMapTotals(target.tokensByModel, source.tokensByModel);
  mergeMapTotals(target.tokensByWorkspace, source.tokensByWorkspace);

  for (const [sessionId, sourceSession] of source.sessions || []) {
    const session = target.sessions.get(sessionId) || createSessionSummary(sessionId, sourceSession.sourceType);
    mergeSession(session, sourceSession);
    target.sessions.set(sessionId, session);
  }
  for (const [cwd, sourceWorkspace] of source.workspaces || []) {
    const workspace = target.workspaces.get(cwd) || createWorkspaceBucket(cwd);
    mergeWorkspace(workspace, sourceWorkspace);
    target.workspaces.set(cwd, workspace);
  }
  for (const [key, sourceTool] of source.tools || []) {
    const tool = target.tools.get(key) || { key, calls: 0, results: 0, alerts: 0 };
    tool.calls += sourceTool.calls || 0;
    tool.results += sourceTool.results || 0;
    tool.alerts += sourceTool.alerts || 0;
    target.tools.set(key, tool);
  }
  target.alerts.total += source.alerts?.total || 0;
  mergeMapTotals(target.alerts.byType, source.alerts?.byType);
  mergeMapTotals(target.alerts.byPlatform, source.alerts?.byPlatform);
  mergeMapTotals(target.alerts.bySession, source.alerts?.bySession);
  for (const item of source.alerts?.recent || []) pushRecentByTime(target.alerts.recent, item, 30);
  for (const [key, sourceBucket] of source.daily || []) {
    const bucket = target.daily.get(key) || createDailyBucket();
    mergeDailyBucket(bucket, sourceBucket);
    target.daily.set(key, bucket);
  }
  for (const [key, sourceBucket] of source.hourly || []) {
    const bucket = target.hourly.get(key) || { events: 0, alerts: 0, tokens: 0, platforms: new Map() };
    bucket.events += sourceBucket.events || 0;
    bucket.alerts += sourceBucket.alerts || 0;
    bucket.tokens += sourceBucket.tokens || 0;
    mergeMapTotals(bucket.platforms, sourceBucket.platforms);
    target.hourly.set(key, bucket);
  }
  target.traces.llmSpans += source.traces?.llmSpans || 0;
  target.traces.toolSpans += source.traces?.toolSpans || 0;
  target.traces.tokenSpans += source.traces?.tokenSpans || 0;
  target.traces.thinkingSpans += source.traces?.thinkingSpans || 0;
  target.traces.maxDepth = Math.max(target.traces.maxDepth, source.traces?.maxDepth || 0);
}

function normalizeFiles(files) {
  return (files || [])
    .map((entry) => {
      if (typeof entry === "string") {
        try {
          const stat = fs.statSync(entry);
          return { file: entry, signature: `${entry}:${stat.size}:${stat.mtimeMs}`, size: stat.size, mtimeMs: stat.mtimeMs };
        } catch {
          return null;
        }
      }
      return entry?.file ? entry : null;
    })
    .filter(Boolean);
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

function encodeCacheValue(value) {
  if (value instanceof Map) {
    return {
      __kind: "Map",
      entries: [...value.entries()].map(([key, entry]) => [key, encodeCacheValue(entry)]),
    };
  }
  if (value instanceof Set) {
    return {
      __kind: "Set",
      values: [...value.values()].map((entry) => encodeCacheValue(entry)),
    };
  }
  if (Array.isArray(value)) return value.map((entry) => encodeCacheValue(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, encodeCacheValue(entry)]),
  );
}

function decodeCacheValue(value) {
  if (!value || typeof value !== "object") return value;
  if (value.__kind === "Map" && Array.isArray(value.entries)) {
    return new Map(value.entries.map(([key, entry]) => [key, decodeCacheValue(entry)]));
  }
  if (value.__kind === "Set" && Array.isArray(value.values)) {
    return new Set(value.values.map((entry) => decodeCacheValue(entry)));
  }
  if (Array.isArray(value)) return value.map((entry) => decodeCacheValue(entry));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, decodeCacheValue(entry)]),
  );
}

function serializeCacheEntry(entry) {
  return {
    signature: entry.signature,
    size: entry.size,
    mtimeMs: entry.mtimeMs,
    lineCount: entry.lineCount,
    tailBuffer: entry.tailBuffer,
    endedWithNewline: entry.endedWithNewline,
    context: entry.context,
    summary: encodeCacheValue(entry.summary),
  };
}

function deserializeCacheEntry(file, entry) {
  if (!entry?.signature || !entry.summary) return null;
  return {
    signature: entry.signature,
    size: Number(entry.size) || 0,
    mtimeMs: Number(entry.mtimeMs) || 0,
    lineCount: Number(entry.lineCount) || 0,
    tailBuffer: entry.tailBuffer || "",
    endedWithNewline: entry.endedWithNewline !== false,
    context: {
      ...createParserContext(file),
      ...(entry.context || {}),
      sourceFile: file,
      compactContent: true,
    },
    summary: decodeCacheValue(entry.summary),
  };
}

function createParserContext(file) {
  return {
    model: "unknown",
    sessionId: "unknown",
    sourceFile: file,
    cwd: "",
    sessionTitle: "",
    compactContent: true,
    contentLimit: 800,
  };
}

function ingestJsonlLine(summary, line, context, deps, locator = {}) {
  if (!line) return;
  try {
    if (locator.truncated) {
      ingestEvent(summary, makeTruncatedLineEvent(line, {
        ...context,
        sourceType: deps.sourceType,
      }, locator));
      return;
    }

    const sourceLine = context?.compactContent
      ? compactLargeJsonlLine(line, { maxValueLength: context.contentLimit || 800 })
      : line;
    const obj = JSON.parse(sourceLine);
    const events = callParser(deps.parser, obj, context);
    for (const event of events) {
      if (!event.sourceFile) event.sourceFile = deps.file;
      if (!event.sourceType) event.sourceType = deps.sourceType;
      ingestEvent(summary, event);
    }
  } catch {
    // Skip invalid or incomplete JSON lines.
  }
}

function parseFileSummary(record, deps) {
  const { parser, sourceType } = resolveParser(record.file, deps.parsers);
  const summary = createFileSummary(record.file, record.signature);
  const context = createParserContext(record.file);
  if (!parser) {
    return {
      summary,
      context,
      lineCount: 0,
      tailBuffer: "",
      endedWithNewline: false,
      incremental: false,
    };
  }

  const parseDeps = { ...deps, parser, sourceType, file: record.file };
  const result = fsScanner.forEachCompleteJsonlLine(record.file, (line, _lineNumber, locator) => {
    ingestJsonlLine(summary, line, context, parseDeps, locator);
  }, { maxLineBytes: config.EVENT_STREAM_MAX_PARSE_LINE_BYTES });
  return {
    summary,
    context: { ...context },
    lineCount: result.lineCount,
    tailBuffer: result.tailBuffer,
    endedWithNewline: result.endedWithNewline,
    incremental: false,
  };
}

function canAppendFileSummary(cached, record) {
  return Boolean(
    cached &&
    cached.summary &&
    cached.context &&
    Number.isFinite(Number(cached.size)) &&
    Number(record.size) > Number(cached.size),
  );
}

function appendFileSummary(record, cached, deps) {
  const { parser, sourceType } = resolveParser(record.file, deps.parsers);
  if (!parser) return parseFileSummary(record, deps);

  const summary = cached.summary;
  const context = { ...cached.context, sourceFile: record.file };
  const parseDeps = { ...deps, parser, sourceType, file: record.file };
  let tailBuffer = cached.tailBuffer || "";
  let lineNumber = Number(cached.lineCount) || 0;
  let endedWithNewline = cached.endedWithNewline !== false;
  const length = Number(record.size) - Number(cached.size);
  const fd = fs.openSync(record.file, "r");

  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, Number(cached.size));
    const appendedText = buffer.toString("utf8");
    const chunk = `${tailBuffer}${appendedText}`;
    const lines = chunk.split(/\r?\n/);
    tailBuffer = lines.pop() || "";
    for (const line of lines) {
      lineNumber += 1;
      ingestJsonlLine(summary, line, context, parseDeps);
    }
    endedWithNewline = appendedText.endsWith("\n");
  } finally {
    fs.closeSync(fd);
  }

  return {
    summary,
    context: { ...context },
    lineCount: lineNumber,
    tailBuffer,
    endedWithNewline,
    incremental: true,
  };
}

function getThreadMeta(threadMeta, sessionId) {
  if (!threadMeta) return null;
  if (threadMeta instanceof Map) return threadMeta.get(sessionId) || null;
  return threadMeta[sessionId] || null;
}

function serializeSession(session, threadMeta) {
  const meta = getThreadMeta(threadMeta, session.sessionId);
  const metaTitle = typeof meta?.title === "string" ? meta.title.trim() : "";
  const metaCwd = typeof meta?.cwd === "string" ? meta.cwd.trim() : "";
  const shouldUseMetaTitle = Boolean(
    metaTitle &&
    (session.sourceType === "codex" || meta?.explicitTitle || !String(session.sessionTitle || "").trim()),
  );
  return {
    sessionId: session.sessionId,
    sessionTitle: shouldUseMetaTitle ? metaTitle : session.sessionTitle,
    fallbackTitle: session.fallbackTitle,
    cwd: session.cwd || metaCwd,
    latestToken: session.latestToken,
    aggregateToken: session.aggregateToken,
    models: [...session.models].sort(),
    count: session.count,
    startedAt: session.startedAt,
    latest: session.latest,
    prompt: session.prompt,
    agent: session.agent,
    tool: session.tool,
    sourceType: session.sourceType,
    sourceFiles: [...session.sourceFiles].sort(),
  };
}

function buildSessionsPayload(summary, threadMeta) {
  const groups = [...summary.sessions.values()]
    .filter((session) => session.sessionId !== "unknown")
    .map((session) => serializeSession(session, threadMeta))
    .sort((left, right) => (left.latest < right.latest ? 1 : -1));
  const byCwd = {};
  for (const group of groups) {
    const cwd = group.cwd || "unknown";
    if (!byCwd[cwd]) byCwd[cwd] = [];
    byCwd[cwd].push(group);
  }
  return { groups, byCwd };
}

function buildHourlyChart(summary, nowMs, bucketCount = 24) {
  const currentHourMs = startOfHourMs(nowMs);
  const firstMs = currentHourMs - (bucketCount - 1) * HOUR_MS;
  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketMs = firstMs + index * HOUR_MS;
    const bucket = summary.hourly.get(String(bucketMs));
    return {
      time: new Date(bucketMs).toISOString(),
      label: formatHourLabel(bucketMs),
      events: bucket?.events || 0,
      alerts: bucket?.alerts || 0,
      tokens: bucket?.tokens || 0,
      platforms: sortedValueEntries(bucket?.platforms || new Map()),
    };
  });
}

function topWorkspaceFromBucket(bucket) {
  return [...(bucket?.workspaces || new Map()).values()]
    .map((workspace) => ({
      cwd: workspace.cwd,
      events: workspace.events,
      sessions: workspace.sessions.size,
      tokens: workspace.tokens,
    }))
    .sort((left, right) => {
      if (right.sessions !== left.sessions) return right.sessions - left.sessions;
      if (right.events !== left.events) return right.events - left.events;
      if (right.tokens !== left.tokens) return right.tokens - left.tokens;
      return String(left.cwd).localeCompare(String(right.cwd), "zh-CN");
    })[0] || null;
}

function buildDailyChart(summary, nowMs, bucketCount = 30) {
  const currentDayMs = startOfLocalDayMs(nowMs);
  const firstMs = currentDayMs - (bucketCount - 1) * DAY_MS;
  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketMs = firstMs + index * DAY_MS;
    const bucket = summary.daily.get(String(bucketMs));
    return {
      time: new Date(bucketMs).toISOString(),
      label: formatDayLabel(bucketMs),
      events: bucket?.events || 0,
      alerts: bucket?.alerts || 0,
      tokens: bucket?.tokens || 0,
      platforms: sortedValueEntries(bucket?.platforms || new Map()),
    };
  });
}

function buildDailySessionHeatmap(summary, nowMs, bucketCount = 365) {
  const currentDayMs = startOfLocalDayMs(nowMs);
  const firstMs = currentDayMs - (bucketCount - 1) * DAY_MS;
  return Array.from({ length: bucketCount }, (_, index) => {
    const bucketMs = firstMs + index * DAY_MS;
    const bucket = summary.daily.get(String(bucketMs));
    return {
      time: new Date(bucketMs).toISOString(),
      label: formatDayLabel(bucketMs),
      sessions: bucket?.sessions?.size || 0,
      events: bucket?.events || 0,
      tokens: bucket?.tokens || 0,
      topWorkspace: topWorkspaceFromBucket(bucket),
    };
  });
}

function buildTokenWindows(summary, nowMs) {
  const dayStartMs = startOfLocalDayMs(nowMs);
  const weekStartMs = startOfLocalWeekMs(nowMs);
  const day = { ...emptyUsage(), platforms: new Map(), rawTotal: 0 };
  const week = { ...emptyUsage(), platforms: new Map(), rawTotal: 0 };

  for (const [key, bucket] of summary.daily) {
    const bucketMs = Number(key);
    if (!Number.isFinite(bucketMs) || bucketMs > nowMs) continue;
    const targets = [];
    if (bucketMs >= weekStartMs) targets.push(week);
    if (bucketMs >= dayStartMs) targets.push(day);
    for (const target of targets) {
      mergeUsage(target, bucket.usage);
      target.rawTotal += bucket.usage.total || 0;
      mergeMapTotals(target.platforms, bucket.platforms);
    }
  }

  return {
    day: {
      ...day,
      total: day.effectiveTotal,
      platforms: sortedValueEntries(day.platforms),
    },
    week: {
      ...week,
      total: week.effectiveTotal,
      platforms: sortedValueEntries(week.platforms),
    },
  };
}

function buildCostSummary(summary) {
  let estimatedUsd = 0;
  let knownTokenTotal = 0;
  const unknownModels = new Set();
  const byModel = [];

  for (const [model, usage] of summary.usageByModel) {
    const estimate = tokenPricing.estimateTokenCost(usage, model);
    if (!estimate.known) {
      unknownModels.add(model);
      continue;
    }
    estimatedUsd += estimate.estimatedUsd;
    knownTokenTotal += estimate.knownTokenTotal;
    byModel.push({
      model,
      estimatedUsd: estimate.estimatedUsd,
      knownTokenTotal: estimate.knownTokenTotal,
    });
  }

  return {
    estimatedUsd,
    knownTokenTotal,
    currency: "USD",
    source: "built-in-estimate",
    unknownModels: [...unknownModels].sort(),
    byModel: byModel.sort((left, right) => right.estimatedUsd - left.estimatedUsd),
  };
}

function buildPublicSummary(summary, cacheStats, options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const sessions = buildSessionsPayload(summary, options.threadMeta);
  const topSessions = sessions.groups
    .map((session) => ({
      sessionId: session.sessionId,
      title: sessionDisplayTitle(session),
      sourceType: session.sourceType || "unknown",
      cwd: session.cwd || "unknown",
      latest: session.latest || "",
      events: session.count || 0,
      tokens: ObserverCore.tokenCountedTotal(session.aggregateToken, session.sourceType),
      alerts: summary.alerts.bySession.get(session.sessionId) || 0,
    }))
    .sort((left, right) => {
      if (right.tokens !== left.tokens) return right.tokens - left.tokens;
      return String(right.latest).localeCompare(String(left.latest));
    })
    .slice(0, 12);
  const workspaceChart = [...summary.workspaces.values()]
    .map((workspace) => ({
      cwd: workspace.cwd,
      events: workspace.events,
      sessions: workspace.sessions.size,
      tokens: workspace.tokens,
      alerts: workspace.alerts,
    }))
    .sort((left, right) => {
      if (right.tokens !== left.tokens) return right.tokens - left.tokens;
      if (right.events !== left.events) return right.events - left.events;
      return String(left.cwd).localeCompare(String(right.cwd), "zh-CN");
    });
  const topTools = [...summary.tools.values()].sort((left, right) => {
    const rightTotal = right.calls + right.results;
    const leftTotal = left.calls + left.results;
    if (rightTotal !== leftTotal) return rightTotal - leftTotal;
    if (right.alerts !== left.alerts) return right.alerts - left.alerts;
    return String(left.key).localeCompare(String(right.key), "zh-CN");
  });
  let totalToolCalls = 0;
  let totalToolResults = 0;
  for (const tool of topTools) {
    totalToolCalls += tool.calls || 0;
    totalToolResults += tool.results || 0;
  }
  const platformShare = sortedValueEntries(summary.tokensByPlatform);
  const modelTokens = sortedValueEntries(summary.tokensByModel).slice(0, 10);
  const workspaceTokens = sortedValueEntries(summary.tokensByWorkspace)
    .map((item) => ({ cwd: item.key, total: item.total }));

  const costSummary = buildCostSummary(summary);

  return {
    health: {
      eventsTotal: summary.eventsTotal,
      sessionsTotal: sessions.groups.length,
      platformCount: summary.platforms.size,
      modelCount: summary.models.size,
      firstEventAt: summary.firstEventAt,
      lastEventAt: summary.lastEventAt,
      alertEvents: summary.alerts.total,
      highTokenEvents: 0,
    },
    tokens: {
      input: summary.usage.input,
      inputTotal: summary.usage.inputTotal,
      output: summary.usage.output,
      total: summary.usage.total,
      cachedInput: summary.usage.cachedInput,
      cacheReadInput: summary.usage.cacheReadInput,
      cacheCreationInput: summary.usage.cacheCreationInput,
      reasoningOutput: summary.usage.reasoningOutput,
      effectiveTotal: summary.usage.effectiveTotal,
      cost: costSummary,
      windows: buildTokenWindows(summary, nowMs),
      byPlatform: platformShare,
      byModel: modelTokens,
      byWorkspace: workspaceTokens,
      topSessions,
    },
    alerts: {
      total: summary.alerts.total,
      byType: sortedValueEntries(summary.alerts.byType, "count"),
      byPlatform: sortedValueEntries(summary.alerts.byPlatform, "count"),
      recent: summary.alerts.recent,
    },
    tools: {
      totalCalls: totalToolCalls,
      totalResults: totalToolResults,
      topTools: topTools.slice(0, 20),
    },
    workspaces: {
      total: summary.workspaces.size,
      topWorkspaces: workspaceChart.slice(0, 20),
    },
    charts: {
      hourly: buildHourlyChart(summary, nowMs, 24),
      daily: buildDailyChart(summary, nowMs, 30),
      dailySessions: buildDailySessionHeatmap(summary, nowMs, 365),
      platformShare,
      modelTokens,
      workspaceTokens: workspaceChart.slice(0, 10),
      alertTypes: sortedValueEntries(summary.alerts.byType, "count"),
    },
    traces: {
      traces: sessions.groups.length,
      spans: summary.eventsTotal,
      llmSpans: summary.traces.llmSpans,
      toolSpans: summary.traces.toolSpans,
      tokenSpans: summary.traces.tokenSpans,
      thinkingSpans: summary.traces.thinkingSpans,
      maxDepth: summary.traces.maxDepth,
    },
    sessions,
    meta: {
      models: [...summary.models].sort(),
      types: [...summary.types].sort(),
      platforms: [...summary.platforms].sort(),
    },
    cache: cacheStats,
    memory: {
      retainedRawEvents: 0,
      cachedFileSummaries: cacheStats.cachedFiles,
    },
  };
}

function createSummaryStore(options = {}) {
  const fileCache = new Map();
  let lastSummary = null;
  let persistentCacheLoaded = false;
  let persistentCacheDirty = false;
  const cacheFile = options.cacheFile || "";
  const deps = {
    parsers: options.parsers || {},
    threadMeta: options.threadMeta || new Map(),
  };
  const now = typeof options.now === "function" ? options.now : () => Date.now();

  function loadPersistentCache() {
    if (persistentCacheLoaded || !cacheFile) return;
    persistentCacheLoaded = true;
    if (!fs.existsSync(cacheFile)) return;
    try {
      const payload = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      if (payload?.version !== SUMMARY_CACHE_VERSION || !payload.files || typeof payload.files !== "object") return;
      for (const [file, entry] of Object.entries(payload.files)) {
        const restored = deserializeCacheEntry(file, entry);
        if (restored) fileCache.set(file, restored);
      }
    } catch {
      // Ignore corrupt runtime cache; it will be rebuilt from source logs.
    }
  }

  function savePersistentCache() {
    if (!cacheFile || !persistentCacheDirty) return;
    persistentCacheDirty = false;
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const files = {};
      for (const [file, entry] of fileCache) files[file] = serializeCacheEntry(entry);
      const tmpFile = `${cacheFile}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify({
        version: SUMMARY_CACHE_VERSION,
        savedAt: new Date(Number(now())).toISOString(),
        files,
      }));
      fs.renameSync(tmpFile, cacheFile);
    } catch {
      persistentCacheDirty = true;
    }
  }

  function invalidate() {
    lastSummary = null;
  }

  function clear() {
    fileCache.clear();
    lastSummary = null;
    persistentCacheLoaded = true;
    persistentCacheDirty = false;
    if (cacheFile) {
      try {
        fs.unlinkSync(cacheFile);
      } catch {
        // Runtime cache may not exist.
      }
    }
  }

  function getSummary(input = {}) {
    loadPersistentCache();
    const records = normalizeFiles(input.files);
    const runDeps = {
      ...deps,
      threadMeta: input.threadMeta || deps.threadMeta || new Map(),
    };
    const liveFiles = new Set(records.map((record) => record.file));
    for (const cachedFile of fileCache.keys()) {
      if (!liveFiles.has(cachedFile)) {
        fileCache.delete(cachedFile);
        persistentCacheDirty = true;
      }
    }

    let scannedFiles = 0;
    let reusedFiles = 0;
    let incrementalFiles = 0;
    const aggregate = createFileSummary("aggregate", "aggregate");

    for (const record of records) {
      const cached = fileCache.get(record.file);
      if (cached?.signature === record.signature) {
        reusedFiles += 1;
        mergeSummary(aggregate, cached.summary);
        continue;
      }
      const parsed = canAppendFileSummary(cached, record)
        ? appendFileSummary(record, cached, runDeps)
        : parseFileSummary(record, runDeps);
      scannedFiles += 1;
      if (parsed.incremental) incrementalFiles += 1;
      fileCache.set(record.file, {
        signature: record.signature,
        size: record.size,
        mtimeMs: record.mtimeMs,
        summary: parsed.summary,
        context: parsed.context,
        lineCount: parsed.lineCount,
        tailBuffer: parsed.tailBuffer,
        endedWithNewline: parsed.endedWithNewline,
      });
      persistentCacheDirty = true;
      mergeSummary(aggregate, parsed.summary);
    }

    const cacheStats = {
      totalFiles: records.length,
      scannedFiles,
      reusedFiles,
      cachedFiles: fileCache.size,
      incrementalFiles,
    };
    lastSummary = buildPublicSummary(aggregate, cacheStats, {
      nowMs: Number(now()),
      threadMeta: runDeps.threadMeta,
    });
    savePersistentCache();
    return lastSummary;
  }

  function getLastSummary() {
    return lastSummary;
  }

  function getSourceFilesForSession(sessionId, input = {}) {
    const current = lastSummary || getSummary(input);
    const session = (current.sessions?.groups || []).find((item) => item.sessionId === sessionId);
    return session?.sourceFiles || [];
  }

  function resolveSessionIdentifier(sessionId, input = {}) {
    const needle = String(sessionId || "").trim();
    if (!needle) return "";
    const current = lastSummary || getSummary(input);
    const sessionIds = (current.sessions?.groups || []).map((item) => item.sessionId).filter(Boolean);
    if (sessionIds.includes(needle)) return needle;
    const matches = sessionIds.filter((id) => id.startsWith(needle));
    return matches.length === 1 ? matches[0] : needle;
  }

  return {
    clear,
    getLastSummary,
    getSourceFilesForSession,
    getSummary,
    invalidate,
    resolveSessionIdentifier,
  };
}

module.exports = {
  createSummaryStore,
};
