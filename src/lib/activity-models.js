import { readableDialogueContent, readableEventSummary } from "./event-display";

const USER_EVENT_TYPES = new Set(["Prompt", "User"]);
const AGENT_EVENT_TYPES = new Set(["Agent"]);
const EDIT_TOOL_PATTERN = /^(?:edit|write|apply_?patch|multiedit)$/i;
const COMMAND_TOOL_PATTERN = /^(?:bash|exec_command|exec)$/i;
const TOOL_ERROR_PATTERN = /(?:\berror\b|\bfailed\b|exception|traceback|permission denied|enoent|eacces|错误|异常|失败)/i;
const COMPACTION_PATTERN = /(?:context[_ -]?compact|compacted|conversation compact)/i;
const MAX_ARTIFACT_ITEMS = 16;

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function eventTimeValue(event) {
  const value = Date.parse(event?.time || "");
  return Number.isFinite(value) ? value : 0;
}

function compareEvents(left, right) {
  const timeDelta = eventTimeValue(left.event) - eventTimeValue(right.event);
  return timeDelta || left.index - right.index;
}

function clipText(value, limit) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function eventDialogueText(event, limit = 360) {
  return clipText(readableDialogueContent(event, limit), limit);
}

function normalizeTokenUsage(tokenUsage) {
  const input = toFiniteNumber(tokenUsage?.input);
  const cacheReadInput = toFiniteNumber(tokenUsage?.cacheReadInput ?? tokenUsage?.cachedInput);
  const cacheCreationInput = toFiniteNumber(tokenUsage?.cacheCreationInput);
  const output = toFiniteNumber(tokenUsage?.output);
  const reasoningOutput = toFiniteNumber(tokenUsage?.reasoningOutput);
  const explicitTotal = toFiniteNumber(tokenUsage?.total);
  return {
    input,
    cacheReadInput,
    cacheCreationInput,
    output,
    reasoningOutput,
    total: explicitTotal || input + cacheReadInput + cacheCreationInput + output,
  };
}

function hasTokenData(tokenUsage) {
  const normalized = normalizeTokenUsage(tokenUsage);
  return Object.values(normalized).some((value) => value > 0);
}

function countRows(items, keySelector, limit = 8) {
  const counts = new Map();
  for (const item of items || []) {
    const key = keySelector(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => right.value - left.value || String(left.key).localeCompare(String(right.key), "zh-CN"))
    .slice(0, limit);
}

function isToolErrorEvent(event) {
  if (event?.isError === true) return true;
  if (event?.callType !== "Tool_Result") return false;
  return TOOL_ERROR_PATTERN.test(`${event?.summary || ""}\n${event?.content || ""}\n${event?.extra || ""}`);
}

function createRun(event, session) {
  return {
    id: `${event?.sessionId || "unknown"}:${event?.eventId || event?.id || event?.time || "event"}`,
    sessionId: event?.sessionId || "unknown",
    sourceType: event?.sourceType || session?.sourceType || "unknown",
    title: session?.displayTitle || session?.title || session?.sessionTitle || session?.fallbackTitle || "未命名会话",
    cwd: event?.cwd || session?.cwd || "",
    startedAt: event?.time || "",
    endedAt: event?.time || "",
    events: [],
  };
}

function finalizeRun(run) {
  const userEvents = run.events.filter((event) => USER_EVENT_TYPES.has(event.callType));
  const agentEvents = run.events.filter((event) => AGENT_EVENT_TYPES.has(event.callType));
  const toolCallEvents = run.events.filter((event) => event.callType === "Tool_Call");
  const toolResultEvents = run.events.filter((event) => event.callType === "Tool_Result");
  const tokenEvents = run.events.filter((event) => event.callType === "Token_Usage" && hasTokenData(event.tokenUsage));
  const latestTokenEvent = tokenEvents[tokenEvents.length - 1];
  const latestEvent = run.events[run.events.length - 1] || null;
  const models = [...new Set(run.events.map((event) => event.model).filter((model) => model && model !== "unknown"))];
  const tools = countRows(toolCallEvents, (event) => event.toolName || "Tool", MAX_ARTIFACT_ITEMS);
  const startedMs = Date.parse(run.startedAt || "");
  const endedMs = Date.parse(run.endedAt || "");
  const durationMs = Number.isFinite(startedMs) && Number.isFinite(endedMs)
    ? Math.max(0, endedMs - startedMs)
    : 0;

  return {
    ...run,
    userPreview: eventDialogueText(userEvents[0]),
    assistantPreview: eventDialogueText(agentEvents[agentEvents.length - 1]),
    eventCount: run.events.length,
    userCount: userEvents.length,
    agentCount: agentEvents.length,
    toolCalls: toolCallEvents.length,
    toolResults: toolResultEvents.length,
    toolErrors: toolResultEvents.filter(isToolErrorEvent).length,
    tools,
    tokenUsage: normalizeTokenUsage(latestTokenEvent?.tokenUsage),
    tokenTotal: normalizeTokenUsage(latestTokenEvent?.tokenUsage).total,
    tokenEventCount: tokenEvents.length,
    rawCount: run.events.filter((event) => event.callType === "Raw").length,
    models,
    durationMs,
    latestEvent,
    hasDialogue: userEvents.length > 0 || agentEvents.length > 0,
    hasTools: toolCallEvents.length > 0 || toolResultEvents.length > 0,
  };
}

export function buildActivityRuns(events = [], sessions = []) {
  const sessionMap = new Map((sessions || []).map((session) => [session.sessionId, session]));
  const ordered = (events || [])
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event)
    .sort(compareEvents)
    .map(({ event }) => event);
  const currentBySession = new Map();
  const runs = [];

  for (const event of ordered) {
    const sessionId = event.sessionId || "unknown";
    const session = sessionMap.get(sessionId);
    let run = currentBySession.get(sessionId);
    if (!run || USER_EVENT_TYPES.has(event.callType)) {
      run = createRun(event, session);
      currentBySession.set(sessionId, run);
      runs.push(run);
    }
    run.events.push(event);
    if (!run.startedAt || String(event.time || "").localeCompare(run.startedAt) < 0) run.startedAt = event.time || run.startedAt;
    if (!run.endedAt || String(event.time || "").localeCompare(run.endedAt) > 0) run.endedAt = event.time || run.endedAt;
    if (!run.cwd && event.cwd) run.cwd = event.cwd;
  }

  return runs
    .map(finalizeRun)
    .sort((left, right) => String(right.endedAt || "").localeCompare(String(left.endedAt || "")));
}

export function filterActivityRuns(runs = [], viewMode = "activity") {
  if (viewMode === "dialogue") return runs.filter((run) => run.hasDialogue);
  if (viewMode === "tools") return runs.filter((run) => run.hasTools);
  if (viewMode === "usage") return runs.filter((run) => run.tokenTotal > 0);
  if (viewMode === "raw") return runs;
  return runs.filter((run) => run.hasDialogue || run.hasTools);
}

function dedupeDialoguePreview(events) {
  const seen = new Set();
  const rows = [];
  for (const event of events) {
    if (!USER_EVENT_TYPES.has(event.callType) && !AGENT_EVENT_TYPES.has(event.callType)) continue;
    const content = eventDialogueText(event, 600);
    const role = USER_EVENT_TYPES.has(event.callType) ? "user" : "agent";
    const signature = `${role}:${content}`;
    if (!content || seen.has(signature)) continue;
    seen.add(signature);
    rows.push(event);
  }
  return rows.slice(-8);
}

export function buildSessionPresentation(session = {}, events = [], page = {}) {
  session = session || {};
  page = page || {};
  const eventList = (events || [])
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event)
    .sort(compareEvents)
    .map(({ event }) => event);
  const eventTokenRows = eventList.filter((event) => event.callType === "Token_Usage" && hasTokenData(event.tokenUsage));
  const sessionTokens = normalizeTokenUsage(session.aggregateToken);
  const fallbackTokens = normalizeTokenUsage(eventTokenRows[eventTokenRows.length - 1]?.tokenUsage);
  const tokens = hasTokenData(session.aggregateToken) ? sessionTokens : fallbackTokens;
  const sessionEventCount = Number(session.count ?? session.events);
  const eventCount = Number.isFinite(sessionEventCount)
    ? sessionEventCount
    : Math.max(toFiniteNumber(page.total), eventList.length);
  const models = Array.isArray(session.models) && session.models.length
    ? session.models
    : [...new Set(eventList.map((event) => event.model).filter(Boolean))];
  const loadedModelCounts = new Map(countRows(eventList, (event) => event.model || "", 50).map((row) => [row.key, row.value]));
  const modelRows = models.map((model) => ({ key: model, value: loadedModelCounts.get(model) || 1 }));
  const first = session.startedAt || session.createdAt || eventList[0]?.time || "";
  const latest = session.latest || eventList[eventList.length - 1]?.time || "";
  const firstMs = Date.parse(first);
  const latestMs = Date.parse(latest);

  return {
    eventCount,
    loadedEventCount: eventList.length,
    rawWindowTotal: toFiniteNumber(page.total),
    rawSessionCount: Math.max(1, toFiniteNumber(session.groupedCount || session.sessionIds?.length || 1)),
    tokens,
    estimatedUsd: toFiniteNumber(session.estimatedUsd),
    typeRows: countRows(eventList, (event) => event.callType || "Unknown", 8),
    modelRows,
    toolRows: countRows(eventList.filter((event) => event.callType === "Tool_Call"), (event) => event.toolName || "Tool", 8),
    userEvents: session.prompt != null
      ? toFiniteNumber(session.prompt)
      : eventList.filter((event) => USER_EVENT_TYPES.has(event.callType)).length,
    agentEvents: session.agent != null
      ? toFiniteNumber(session.agent)
      : eventList.filter((event) => AGENT_EVENT_TYPES.has(event.callType)).length,
    dialoguePreview: dedupeDialoguePreview(eventList),
    first,
    latest,
    durationMs: Number.isFinite(firstMs) && Number.isFinite(latestMs) ? Math.max(0, latestMs - firstMs) : 0,
    recentEvents: eventList.slice(-10).reverse(),
  };
}

function safeJsonParse(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toolArgs(event) {
  const content = String(event?.content || event?.summary || "");
  const match = content.match(/args=([\s\S]+)$/m);
  const fromContent = match ? safeJsonParse(match[1]) : null;
  if (fromContent && typeof fromContent === "object") return fromContent;
  const fromExtra = safeJsonParse(String(event?.extra || ""));
  return fromExtra && typeof fromExtra === "object" ? fromExtra : {};
}

function uniqueLimited(values, limit = MAX_ARTIFACT_ITEMS) {
  return [...new Set((values || []).filter(Boolean))].slice(0, limit);
}

function deriveModelTimeline(events) {
  const timeline = [];
  for (const event of events) {
    const model = event?.model;
    if (!model || model === "unknown" || timeline[timeline.length - 1]?.model === model) continue;
    timeline.push({ model, time: event.time || "" });
  }
  return timeline.slice(-MAX_ARTIFACT_ITEMS);
}

export function buildSessionArtifacts(session = {}, events = []) {
  session = session || {};
  const eventList = (events || [])
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event)
    .sort(compareEvents)
    .map(({ event }) => event);
  const userEvents = eventList.filter((event) => USER_EVENT_TYPES.has(event.callType));
  const agentEvents = eventList.filter((event) => AGENT_EVENT_TYPES.has(event.callType));
  const toolCalls = eventList.filter((event) => event.callType === "Tool_Call");
  const derivedToolRows = countRows(toolCalls, (event) => event.toolName || "Tool", MAX_ARTIFACT_ITEMS)
    .map((row) => ({ key: row.key, calls: row.value }));
  const derivedFiles = [];
  const commands = [];

  for (const event of toolCalls) {
    const args = toolArgs(event);
    const toolName = event.toolName || "";
    if (EDIT_TOOL_PATTERN.test(toolName)) {
      derivedFiles.push(args.file_path || args.path || "");
    }
    if (COMMAND_TOOL_PATTERN.test(toolName)) {
      commands.push(clipText(args.command || "", 220));
    }
  }

  const sessionTools = Array.isArray(session.topTools) ? session.topTools : [];
  const sessionTimeline = Array.isArray(session.modelTimeline) ? session.modelTimeline : [];
  return {
    goal: clipText(session.firstUserMessage || eventDialogueText(userEvents[0], 320), 320),
    latestRequest: clipText(session.latestUserMessage || eventDialogueText(userEvents[userEvents.length - 1], 320), 320),
    outcome: clipText(session.latestAgentMessage || eventDialogueText(agentEvents[agentEvents.length - 1], 420), 420),
    tools: (sessionTools.length ? sessionTools : derivedToolRows).slice(0, MAX_ARTIFACT_ITEMS),
    editedFiles: uniqueLimited([...(session.editedFiles || []), ...derivedFiles]),
    commands: uniqueLimited(commands, 10),
    toolErrors: session.toolErrors != null
      ? toFiniteNumber(session.toolErrors)
      : eventList.filter(isToolErrorEvent).length,
    compactions: session.compactions != null
      ? toFiniteNumber(session.compactions)
      : eventList.filter((event) => COMPACTION_PATTERN.test(`${event.content || ""}\n${event.summary || ""}\n${event.extra || ""}`)).length,
    modelTimeline: (sessionTimeline.length ? sessionTimeline : deriveModelTimeline(eventList)).slice(-MAX_ARTIFACT_ITEMS),
  };
}

export function activityRunSummary(run) {
  if (run.userPreview) return run.userPreview;
  if (run.assistantPreview) return run.assistantPreview;
  const meaningful = run.events.find((event) => !["Raw", "Token_Usage"].includes(event.callType));
  return meaningful ? readableEventSummary(meaningful, 160) : "仅包含用量或原始事件";
}
