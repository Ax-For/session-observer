#!/usr/bin/env node
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { URL } = require("url");
const { spawnSync } = require("child_process");

const HOST = "127.0.0.1";
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const ROOT = __dirname;
const SESSIONS_DIR = process.env.CODEX_SESSIONS_DIR || path.join(os.homedir(), ".codex", "sessions");
const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), ".claude", "projects");
const STATE_DB = process.env.CODEX_STATE_DB || path.join(os.homedir(), ".codex", "state_5.sqlite");
const DEFAULT_PAGE_SIZE = 250;
const MAX_PAGE_SIZE = 1000;
const INDEX_REFRESH_DEBOUNCE_MS = 400;
const INDEX_WARMUP_INTERVAL_MS = 3000;
const ALERT_PATTERN = /(error|failed|exception|timeout|invalid|reject|denied|拒绝|失败|错误|异常)/i;
const fileEventCache = new Map();
let aggregateCache = { key: "", events: [] };
const indexState = {
  events: [],
  aggregateKey: "",
  dirty: true,
  refreshTimer: null,
  lastBuiltAt: "",
  lastError: "",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": MIME[".json"],
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function listJsonlFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && full.endsWith(".jsonl")) out.push(full);
    }
  }
  return out;
}

function parseContentFromMessage(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => item?.text || item?.input_text || item?.output_text || "")
    .filter(Boolean)
    .join("\n");
}

function clip(text, max = 140) {
  const s = (text || "").trim().replace(/\s+/g, " ");
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

function fmtNum(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString("zh-CN");
}

function fmtTokenHuman(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function hasTokenUsageData(tokenUsage) {
  if (!tokenUsage) return false;
  return ["input", "output", "total", "cachedInput", "reasoningOutput"].some((key) => {
    const value = tokenUsage[key];
    return value != null && Number.isFinite(Number(value));
  });
}

function addTokenUsage(base, next) {
  const out = base
    ? { ...base }
    : { input: 0, output: 0, total: 0, cachedInput: 0, reasoningOutput: 0 };
  if (!hasTokenUsageData(next)) return out;
  for (const key of ["input", "output", "total", "cachedInput", "reasoningOutput"]) {
    const value = next[key];
    if (value != null && Number.isFinite(Number(value))) out[key] += Number(value);
  }
  return out;
}

function summarizeRawObject(obj) {
  const payload = obj?.payload;
  if (typeof payload?.message === "string" && payload.message.trim()) return clip(payload.message, 220);
  if (typeof payload?.name === "string" && payload.name.trim()) return clip(payload.name, 220);
  if (typeof payload?.status === "string" && payload.status.trim()) return clip(payload.status, 220);
  if (typeof payload?.phase === "string" && payload.phase.trim()) return clip(payload.phase, 220);
  const raw = JSON.stringify(payload ?? obj);
  return clip(raw || "", 220);
}

function normalizeEventText(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function toTimeMs(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isDuplicateAgentEvent(prev, next) {
  if (!prev || !next) return false;
  if (prev.callType !== "Agent" || next.callType !== "Agent") return false;
  if (prev.sessionId !== next.sessionId) return false;
  if ((prev.turnId || "") !== (next.turnId || "")) return false;
  if (normalizeEventText(prev.content) !== normalizeEventText(next.content)) return false;

  const prevMs = toTimeMs(prev.time);
  const nextMs = toTimeMs(next.time);
  if (prevMs != null && nextMs != null && Math.abs(prevMs - nextMs) > 1500) return false;
  return true;
}

function preferAgentEvent(prev, next) {
  if (prev.extra === "agent_message" && next.extra === "role=assistant") return next;
  if (prev.extra === "role=assistant" && next.extra === "agent_message") return prev;
  return next;
}

function dedupeEvents(events) {
  const out = [];
  for (const event of events) {
    const prev = out[out.length - 1];
    if (isDuplicateAgentEvent(prev, event)) {
      out[out.length - 1] = preferAgentEvent(prev, event);
      continue;
    }
    out.push(event);
  }
  return out;
}

function isAlertEvent(event) {
  if (!event) return false;
  if (event.callType === "Tool_Result" || event.callType === "Tool_Call") {
    return ALERT_PATTERN.test(event.content || "") || ALERT_PATTERN.test(event.extra || "");
  }
  if (event.callType === "Agent") {
    return ALERT_PATTERN.test(event.content || "");
  }
  return false;
}

function eventMatchesMode(event, mode) {
  if (mode === "raw") return true;
  return event.callType !== "Raw";
}

function eventMatchesFilters(event, filters) {
  if (!eventMatchesMode(event, filters.mode)) return false;
  if (filters.platform && event.sourceType !== filters.platform) return false;
  if (filters.model && event.model !== filters.model) return false;
  if (filters.type && event.callType !== filters.type) return false;
  if (filters.sessionId && event.sessionId !== filters.sessionId) return false;
  if (filters.quickFilter === "alert" && !isAlertEvent(event)) return false;
  if (filters.quickFilter === "high_token") {
    const total = Number(event.tokenUsage?.total);
    if (!(Number.isFinite(total) && total >= filters.tokenThreshold)) return false;
  }
  const eventMs = toTimeMs(event.time);
  if (filters.startMs != null && eventMs != null && eventMs < filters.startMs) return false;
  if (filters.endMs != null && eventMs != null && eventMs > filters.endMs) return false;

  if (!filters.query) return true;
  return [
    event.content,
    event.callType,
    event.model,
    event.sessionId,
    event.turnId,
    event.callId,
    event.toolName,
    event.extra,
    event.rawType,
    event.rawSubType,
    event.cwd,
    event.sessionTitle,
    event.tokenUsage ? JSON.stringify(event.tokenUsage) : "",
  ].some((value) => String(value || "").toLowerCase().includes(filters.query));
}

function toPositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

function parseRequestFilters(searchParams) {
  return {
    mode: searchParams.get("mode") === "raw" ? "raw" : "observe",
    platform: searchParams.get("platform") || "",
    model: searchParams.get("model") || "",
    type: searchParams.get("type") || "",
    sessionId: searchParams.get("sessionId") || "",
    quickFilter: searchParams.get("quickFilter") || "all",
    tokenThreshold: toPositiveInt(searchParams.get("tokenThreshold"), 20000),
    query: (searchParams.get("q") || "").trim().toLowerCase(),
    startMs: toTimeMs(searchParams.get("start") || ""),
    endMs: toTimeMs(searchParams.get("end") || ""),
    order: searchParams.get("order") === "asc" ? "asc" : "desc",
    offset: toPositiveInt(searchParams.get("offset"), 0),
    limit: toPositiveInt(searchParams.get("limit"), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

function buildSessionGroups(events) {
  const groups = new Map();
  for (const e of events) {
    const g = groups.get(e.sessionId) || {
      sessionId: e.sessionId,
      sessionTitle: "",
      fallbackTitle: "",
      cwd: "",
      latestToken: null,
      aggregateToken: null,
      models: new Set(),
      count: 0,
      latest: "",
      prompt: 0,
      agent: 0,
      tool: 0,
      sourceType: e.sourceType || "unknown",
    };
    g.count += 1;
    g.latest = !g.latest || e.time > g.latest ? e.time : g.latest;
    if (e.sessionTitle) g.sessionTitle = e.sessionTitle;
    if (!g.fallbackTitle && (e.callType === "Prompt" || e.callType === "User")) {
      let title = clip(e.content, 36);
      // Strip XML-style command tags
      title = title.replace(/<[^>]+>/g, "").trim();
      g.fallbackTitle = title;
    }
    if (e.cwd) g.cwd = e.cwd;
    if (e.model && e.model !== "unknown") g.models.add(e.model);
    if (e.callType === "Token_Usage" && hasTokenUsageData(e.tokenUsage)) {
      g.latestToken = e.tokenUsage;
      g.aggregateToken = addTokenUsage(g.aggregateToken, e.tokenUsage);
    }
    if (e.callType === "Prompt" || e.callType === "User") g.prompt += 1;
    else if (e.callType === "Agent") g.agent += 1;
    else g.tool += 1;
    groups.set(e.sessionId, g);
  }
  // Convert models Set to array for JSON serialization
  return [...groups.values()].map((g) => {
    g.models = [...g.models].sort();
    return g;
  }).sort((a, b) => (a.latest < b.latest ? 1 : -1));
}

function collectMeta(events) {
  return {
    models: [...new Set(events.map((e) => e.model))].sort(),
    types: [...new Set(events.map((e) => e.callType))].sort(),
    platforms: [...new Set(events.map((e) => e.sourceType))].sort(),
  };
}

function parseCodexLineToEvent(obj, context) {
  const ts = obj.timestamp || "";
  const model = context.model || "unknown";
  const sessionId = context.sessionId || "unknown";
  const cwd = context.cwd || "";
  const sessionTitle = context.sessionTitle || "";
  const sourceFile = context.sourceFile || "unknown";
  const turnId =
    obj.payload?.turn_id ||
    obj.payload?.turnId ||
    obj.payload?.id ||
    obj.turn_id ||
    "";

  if (obj.type === "turn_context") {
    context.model = obj.payload?.model || context.model;
    context.sessionId = obj.payload?.thread_id || context.sessionId;
    context.cwd = obj.payload?.cwd || context.cwd;
    return {
      time: ts,
      sessionId: context.sessionId || sessionId,
      model: context.model || model,
      turnId,
      callId: "",
      toolName: "",
      cwd: context.cwd || cwd,
      sessionTitle,
      extra: "context_update",
      sourceFile,
      sourceType: "codex",
      callType: "Raw",
      rawType: obj.type || "",
      rawSubType: obj.payload?.type || "",
      content: summarizeRawObject(obj),
      summary: summarizeRawObject(obj),
      raw: obj,
    };
  }

  if (obj.type === "session_meta") {
    context.sessionId = obj.payload?.id || context.sessionId;
    context.cwd = obj.payload?.cwd || context.cwd;
    context.sessionTitle =
      obj.payload?.title ||
      obj.payload?.session_title ||
      obj.payload?.session_name ||
      obj.payload?.name ||
      obj.payload?.thread_title ||
      obj.payload?.display_name ||
      context.sessionTitle;
    return {
      time: ts,
      sessionId: context.sessionId || sessionId,
      model,
      turnId,
      callId: "",
      toolName: "",
      cwd: context.cwd || cwd,
      sessionTitle: context.sessionTitle || sessionTitle,
      extra: "session_meta",
      sourceFile,
      sourceType: "codex",
      callType: "Raw",
      rawType: obj.type || "",
      rawSubType: obj.payload?.type || "",
      content: summarizeRawObject(obj),
      summary: summarizeRawObject(obj),
      raw: obj,
    };
  }

  if (obj.type === "response_item" && obj.payload?.type === "message") {
    const role = obj.payload.role;
    if (role === "user" || role === "assistant") {
      const content = parseContentFromMessage(obj.payload.content);
      return {
        time: ts,
        sessionId,
        model,
        turnId,
        callId: "",
        toolName: "",
        cwd,
        sessionTitle,
        extra: `role=${role}`,
        sourceFile,
        sourceType: "codex",
        callType: role === "user" ? "Prompt" : "Agent",
        content,
        summary: clip(content),
      };
    }
  }

  if (obj.type === "event_msg" && obj.payload?.type === "agent_message") {
    const content = obj.payload?.message || "";
    return {
      time: ts,
      sessionId,
      model,
      turnId,
      callId: "",
      toolName: "",
      cwd,
      sessionTitle,
      extra: "agent_message",
      sourceFile,
      sourceType: "codex",
      callType: "Agent",
      content,
      summary: clip(content),
    };
  }

  if (obj.type === "event_msg" && obj.payload?.type === "token_count") {
    const usage = obj.payload?.info?.last_token_usage || {};
    const content = [
      `Token usage`,
      `In ${fmtTokenHuman(usage.input_tokens)} (${fmtNum(usage.input_tokens)})`,
      `Out ${fmtTokenHuman(usage.output_tokens)} (${fmtNum(usage.output_tokens)})`,
      `Total ${fmtTokenHuman(usage.total_tokens)} (${fmtNum(usage.total_tokens)})`,
      `Cache ${fmtTokenHuman(usage.cached_input_tokens)} (${fmtNum(usage.cached_input_tokens)})`,
      `Reason ${fmtTokenHuman(usage.reasoning_output_tokens)} (${fmtNum(usage.reasoning_output_tokens)})`,
    ].join(" · ");
    return {
      time: ts,
      sessionId,
      model,
      turnId,
      callId: "",
      toolName: "",
      cwd,
      sessionTitle,
      extra: "token_count",
      sourceFile,
      sourceType: "codex",
      callType: "Token_Usage",
      content,
      summary: clip(content, 220),
      tokenUsage: {
        input: usage.input_tokens ?? null,
        output: usage.output_tokens ?? null,
        total: usage.total_tokens ?? null,
        cachedInput: usage.cached_input_tokens ?? null,
        reasoningOutput: usage.reasoning_output_tokens ?? null,
      },
    };
  }

  if (obj.type === "response_item" && obj.payload?.type === "function_call") {
    const name = obj.payload?.name || "unknown_tool";
    const args = obj.payload?.arguments || "";
    const content = `tool=${name}\nargs=${args}`;
    return {
      time: ts,
      sessionId,
      model,
      turnId,
      callId: obj.payload?.call_id || "",
      toolName: name,
      cwd,
      sessionTitle,
      extra: `call_id=${obj.payload?.call_id || ""}`,
      sourceFile,
      sourceType: "codex",
      callType: "Tool_Call",
      content,
      summary: clip(content),
    };
  }

  if (obj.type === "response_item" && obj.payload?.type === "function_call_output") {
    const output = obj.payload?.output || "";
    return {
      time: ts,
      sessionId,
      model,
      turnId,
      callId: obj.payload?.call_id || "",
      toolName: "",
      cwd,
      sessionTitle,
      extra: `call_id=${obj.payload?.call_id || ""}`,
      sourceFile,
      sourceType: "codex",
      callType: "Tool_Result",
      content: output,
      summary: clip(output),
    };
  }
  return {
    time: ts,
    sessionId,
    model,
    turnId,
    callId: obj.payload?.call_id || "",
    toolName: obj.payload?.name || "",
    cwd,
    sessionTitle,
    extra: "",
    sourceFile,
    sourceType: "codex",
    callType: "Raw",
    rawType: obj.type || "",
    rawSubType: obj.payload?.type || "",
    content: summarizeRawObject(obj),
    summary: summarizeRawObject(obj),
    raw: obj,
  };
}

function extractTextFromContent(content) {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .filter((item) => item && typeof item === "object" && item.type === "text")
    .map((item) => item.text || "")
    .filter(Boolean)
    .join("\n");
}

function extractThinkingFromContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && typeof item === "object" && item.type === "thinking")
    .map((item) => item.thinking || "")
    .filter(Boolean)
    .join("\n");
}

function extractToolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content
    .filter((item) => item && typeof item === "object" && item.type === "tool_use")
    .map((item) => ({ name: item.name || "unknown", id: item.id || "", input: item.input }));
}

function parseClaudeCodeLineToEvent(obj, context) {
  const ts = obj.timestamp || "";
  const sessionId = obj.sessionId || context.sessionId || "unknown";
  const cwd = obj.cwd || context.cwd || "";
  const sourceFile = context.sourceFile || "unknown";
  const uuid = obj.uuid || "";
  const slug = obj.slug || "";

  if (obj.type === "permission-mode") {
    return {
      time: ts, sessionId, model: context.model || "unknown",
      turnId: uuid, callId: "", toolName: "", cwd,
      sessionTitle: context.sessionTitle || "",
      extra: `mode=${obj.permissionMode || ""}`,
      sourceFile, sourceType: "claude",
      callType: "Raw", rawType: "permission-mode", rawSubType: "",
      content: `Permission mode: ${obj.permissionMode || "unknown"}`,
      summary: `Permission mode: ${obj.permissionMode || "unknown"}`,
    };
  }

  if (obj.type === "file-history-snapshot") {
    const snap = obj.snapshot || {};
    const files = snap.trackedFileBackups ? Object.keys(snap.trackedFileBackups) : [];
    const content = files.length ? `File snapshot: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ` (+${files.length - 5})` : ""}` : "File snapshot";
    return {
      time: ts, sessionId, model: context.model || "unknown",
      turnId: uuid, callId: "", toolName: "", cwd,
      sessionTitle: context.sessionTitle || "",
      extra: "file_history",
      sourceFile, sourceType: "claude",
      callType: "Raw", rawType: "file-history-snapshot", rawSubType: "",
      content, summary: clip(content),
    };
  }

  if (obj.type === "attachment") {
    const att = obj.attachment || {};
    const content = `Attachment: ${att.type || "unknown"}`;
    return {
      time: ts, sessionId, model: context.model || "unknown",
      turnId: uuid, callId: "", toolName: "", cwd,
      sessionTitle: context.sessionTitle || "",
      extra: att.type || "",
      sourceFile, sourceType: "claude",
      callType: "Raw", rawType: "attachment", rawSubType: "",
      content, summary: clip(content),
    };
  }

  if (obj.type === "user") {
    // Meta commands (/model, /help, etc.)
    if (obj.isMeta) {
      const content = typeof obj.message?.content === "string" ? obj.message.content : "";
      const cleaned = content.replace(/<command-name>.*?<\/command-name>/g, "").trim();
      return {
        time: ts, sessionId, model: context.model || "unknown",
        turnId: uuid, callId: "", toolName: "", cwd,
        sessionTitle: context.sessionTitle || "",
        extra: obj.isSidechain ? "sidechain_meta" : "meta_command",
        sourceFile, sourceType: "claude",
        callType: "Raw", rawType: "user-meta", rawSubType: "",
        content: cleaned || "Meta command",
        summary: clip(cleaned || "Meta command"),
      };
    }

    // Tool results (user messages with toolUseResult)
    if (obj.toolUseResult) {
      const msgContent = obj.message?.content;
      const toolResultContent = Array.isArray(msgContent)
        ? msgContent.filter((i) => i?.type === "tool_result").map((i) => i.content || "").join("\n").slice(0, 300)
        : typeof obj.toolUseResult.stdout === "string" ? clip(obj.toolUseResult.stdout, 300) : "";
      const toolName = obj.sourceToolAssistantUUID ? "(tool result)" : "";
      const agentPrefix = obj.agentId ? `[${obj.agentId}] ` : "";
      return {
        time: ts, sessionId, model: context.model || "unknown",
        turnId: uuid, callId: "", toolName, cwd,
        sessionTitle: context.sessionTitle || "",
        extra: `${obj.isSidechain ? "sidechain/" : ""}tool_result${obj.agentId ? ` agent=${obj.agentId}` : ""}`,
        sourceFile, sourceType: "claude",
        callType: "Tool_Result", rawType: "user", rawSubType: "tool_result",
        content: `${agentPrefix}${toolResultContent || "Tool executed"}`,
        summary: clip(`${agentPrefix}${toolResultContent || "Tool executed"}`),
      };
    }

    // Regular user messages
    const content = typeof obj.message?.content === "string" ? obj.message.content : "";
    const agentPrefix = obj.agentId ? `[subagent:${obj.agentId}] ` : "";
    return {
      time: ts, sessionId, model: context.model || "unknown",
      turnId: uuid, callId: "", toolName: "", cwd,
      sessionTitle: context.sessionTitle || "",
      extra: `${obj.isSidechain ? "sidechain/" : ""}user${obj.agentId ? ` agent=${obj.agentId}` : ""}`,
      sourceFile, sourceType: "claude",
      callType: "User",
      content: `${agentPrefix}${content}`,
      summary: clip(`${agentPrefix}${content}`),
    };
  }

  if (obj.type === "assistant") {
    const msg = obj.message || {};
    const content = msg.content || [];
    const toolCalls = extractToolCalls(content);
    const thinking = extractThinkingFromContent(content);
    const text = extractTextFromContent(content);
    const model = msg.model || context.model || "unknown";
    const agentPrefix = obj.agentId ? `[subagent:${obj.agentId}] ` : "";
    const agentTag = obj.agentId || "";

    // Update context model from assistant message
    context.model = model;

    // Helper to build Token_Usage event from usage data
    const buildTokenUsageEvent = (usage) => {
      if (!usage) return null;
      const input = usage.input_tokens ?? usage.cache_read_input_tokens ?? null;
      const output = usage.output_tokens ?? null;
      const total = usage.input_tokens != null && usage.output_tokens != null
        ? (usage.input_tokens + usage.output_tokens)
        : null;
      const cachedInput = usage.cache_read_input_tokens ?? null;
      // Claude Code uses cache_creation_input_tokens for newly cached tokens
      // reasoning tokens not typically in Claude Code usage
      const reasoningOutput = null;
      if (input == null && output == null) return null;
      const content = `Token usage · In ${input ?? 0} · Out ${output ?? 0} · Total ${total ?? 0}` +
        (cachedInput ? ` · Cache ${cachedInput}` : "");
      return {
        time: ts, sessionId, model,
        turnId: uuid, callId: "", toolName: "", cwd,
        sessionTitle: context.sessionTitle || "",
        extra: "token_usage",
        sourceFile, sourceType: "claude",
        callType: "Token_Usage",
        content,
        summary: clip(content, 120),
        tokenUsage: {
          input,
          output,
          total,
          cachedInput,
          reasoningOutput,
        },
      };
    };

    const tokenEvent = buildTokenUsageEvent(msg.usage);

    // Tool calls
    if (toolCalls.length > 0) {
      const events = [];
      for (const tc of toolCalls) {
        const argsStr = typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input || "");
        events.push({
          time: ts, sessionId, model,
          turnId: uuid, callId: tc.id, toolName: tc.name, cwd,
          sessionTitle: context.sessionTitle || "",
          extra: `${obj.isSidechain ? "sidechain/" : ""}tool_call${agentTag ? ` agent=${agentTag}` : ""}`,
          sourceFile, sourceType: "claude",
          callType: "Tool_Call", rawType: "assistant", rawSubType: "tool_use",
          content: `${agentPrefix}tool=${tc.name}\nargs=${clip(argsStr, 200)}`,
          summary: clip(`${agentPrefix}tool=${tc.name}`),
        });
      }
      // Also include text content if present
      if (text) {
        events.push({
          time: ts, sessionId, model,
          turnId: uuid, callId: "", toolName: "", cwd,
          sessionTitle: context.sessionTitle || "",
          extra: `${obj.isSidechain ? "sidechain/" : ""}assistant${agentTag ? ` agent=${agentTag}` : ""}`,
          sourceFile, sourceType: "claude",
          callType: "Agent",
          content: `${agentPrefix}${text}`,
          summary: clip(`${agentPrefix}${text}`),
        });
      }
      // Add Token_Usage event if present
      if (tokenEvent) events.push(tokenEvent);
      return events;
    }

    // Thinking only
    if (thinking && !text) {
      const baseEvent = {
        time: ts, sessionId, model,
        turnId: uuid, callId: "", toolName: "", cwd,
        sessionTitle: context.sessionTitle || "",
        extra: `${obj.isSidechain ? "sidechain/" : ""}thinking${agentTag ? ` agent=${agentTag}` : ""}`,
        sourceFile, sourceType: "claude",
        callType: "Thinking", rawType: "assistant", rawSubType: "thinking",
        content: clip(thinking, 300),
        summary: clip(`[Thinking] ${thinking}`, 200),
      };
      if (tokenEvent) return [baseEvent, tokenEvent];
      return baseEvent;
    }

    // Text response only
    if (text) {
      const baseEvent = {
        time: ts, sessionId, model,
        turnId: uuid, callId: "", toolName: "", cwd,
        sessionTitle: context.sessionTitle || "",
        extra: `${obj.isSidechain ? "sidechain/" : ""}assistant${agentTag ? ` agent=${agentTag}` : ""}`,
        sourceFile, sourceType: "claude",
        callType: "Agent",
        content: `${agentPrefix}${text}`,
        summary: clip(`${agentPrefix}${text}`),
      };
      if (tokenEvent) return [baseEvent, tokenEvent];
      return baseEvent;
    }

    // Empty assistant
    return {
      time: ts, sessionId, model,
      turnId: uuid, callId: "", toolName: "", cwd,
      sessionTitle: context.sessionTitle || "",
      extra: `${obj.isSidechain ? "sidechain/" : ""}assistant-empty`,
      sourceFile, sourceType: "claude",
      callType: "Raw", rawType: "assistant", rawSubType: "empty",
      content: "(empty response)",
      summary: "(empty response)",
    };
  }

  // Fallback for unknown types
  return {
    time: ts, sessionId, model: context.model || "unknown",
    turnId: uuid, callId: "", toolName: "", cwd,
    sessionTitle: context.sessionTitle || "",
    extra: `type=${obj.type || "unknown"}`,
    sourceFile, sourceType: "claude",
    callType: "Raw", rawType: obj.type || "", rawSubType: "",
    content: summarizeRawObject(obj),
    summary: summarizeRawObject(obj),
  };
}

function resolveParserForFile(filePath) {
  if (filePath.includes("/.codex/")) return { parser: parseCodexLineToEvent, sessionsDir: SESSIONS_DIR };
  if (filePath.includes("/.claude/")) return { parser: parseClaudeCodeLineToEvent, sessionsDir: CLAUDE_PROJECTS_DIR };
  // Default to Codex parser for backwards compatibility
  return { parser: parseCodexLineToEvent, sessionsDir: SESSIONS_DIR };
}

function loadThreadMetadataMap() {
  const map = new Map();
  if (!fs.existsSync(STATE_DB)) return map;

  const sql = "select id, coalesce(title, ''), coalesce(cwd, '') from threads;";
  const proc = spawnSync("sqlite3", ["-separator", "\t", STATE_DB, sql], { encoding: "utf8" });
  if (proc.status !== 0 || !proc.stdout) return map;

  const lines = proc.stdout.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const [id, title, cwd] = line.split("\t");
    if (!id) continue;
    map.set(id, { title: title || "", cwd: cwd || "" });
  }
  return map;
}

function loadClaudeCodeSessionMeta() {
  const map = new Map();
  const claudeSessionsDir = path.join(os.homedir(), ".claude", "sessions");
  if (!fs.existsSync(claudeSessionsDir)) return map;

  const sessionFiles = fs.readdirSync(claudeSessionsDir).filter((f) => f.endsWith(".json"));
  for (const file of sessionFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(claudeSessionsDir, file), "utf8"));
      if (data.sessionId) {
        map.set(data.sessionId, {
          title: data.name || "",
          cwd: data.cwd || "",
        });
      }
    } catch {
      // skip invalid files
    }
  }
  return map;
}

function getStateSignature() {
  if (!fs.existsSync(STATE_DB)) return "missing";
  const stat = fs.statSync(STATE_DB);
  return `${stat.size}:${stat.mtimeMs}`;
}

function computeAggregateSignature() {
  const codexFiles = listJsonlFiles(SESSIONS_DIR);
  const claudeFiles = listJsonlFiles(CLAUDE_PROJECTS_DIR);
  const files = [...codexFiles, ...claudeFiles];
  const stateSignature = getStateSignature();
  const parts = files.map((file) => {
    const stat = fs.statSync(file);
    return `${file}:${stat.size}:${stat.mtimeMs}`;
  });
  return {
    files,
    stateSignature,
    aggregateKey: `${stateSignature}|${parts.join("|")}`,
  };
}

function parseFileEvents(file, stateSignature, threadMeta) {
  const stat = fs.statSync(file);
  const { parser, sessionsDir: srcDir } = resolveParserForFile(file);
  const cached = fileEventCache.get(file);
  const canAppendIncrementally =
    cached &&
    cached.stateSignature === stateSignature &&
    stat.size >= cached.size &&
    cached.context;

  if (cached && cached.stateSignature === stateSignature && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    return cached.events;
  }

  const context = canAppendIncrementally
    ? { ...cached.context, sourceFile: file }
    : { model: "unknown", sessionId: "unknown", sourceFile: file, cwd: "", sessionTitle: "" };
  const parsed = canAppendIncrementally ? cached.events.slice() : [];
  let tailBuffer = canAppendIncrementally ? cached.tailBuffer || "" : "";
  let text = "";

  if (canAppendIncrementally && stat.size > cached.size) {
    const fd = fs.openSync(file, "r");
    try {
      const length = stat.size - cached.size;
      const buf = Buffer.alloc(length);
      fs.readSync(fd, buf, 0, length, cached.size);
      text = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } else if (!canAppendIncrementally) {
    text = fs.readFileSync(file, "utf8");
  }

  const chunk = `${tailBuffer}${text}`;
  const lines = chunk.split(/\r?\n/);
  tailBuffer = lines.pop() || "";

  const pushLine = (line) => {
    if (!line) return;
    try {
      const obj = JSON.parse(line);
      const evtOrArray = parser(obj, context);
      const events = Array.isArray(evtOrArray) ? evtOrArray : [evtOrArray].filter(Boolean);
      for (const evt of events) {
        const meta = threadMeta.get(evt.sessionId);
        if (meta) {
          if (!evt.sessionTitle && meta.title) evt.sessionTitle = meta.title;
          if (!evt.cwd && meta.cwd) evt.cwd = meta.cwd;
        }
        parsed.push(evt);
      }
    } catch {
      // skip invalid lines
    }
  };

  for (const line of lines) pushLine(line);
  if (tailBuffer && stat.size > 0) {
    const lastChar = text ? text[text.length - 1] : "";
    const fileEndedWithNewline = lastChar === "\n";
    if (fileEndedWithNewline) {
      pushLine(tailBuffer);
      tailBuffer = "";
    }
  }

  fileEventCache.set(file, {
    stateSignature,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    tailBuffer,
    context: { ...context },
    events: parsed,
  });
  return parsed;
}

function computeAggregate() {
  const threadMeta = loadThreadMetadataMap();
  const claudeMeta = loadClaudeCodeSessionMeta();
  // Merge Claude Code metadata into threadMeta (no key collisions expected since session IDs are unique)
  for (const [id, meta] of claudeMeta) {
    if (!threadMeta.has(id)) threadMeta.set(id, meta);
  }
  const { files, stateSignature, aggregateKey } = computeAggregateSignature();
  const liveFiles = new Set(files);
  for (const cachedFile of fileEventCache.keys()) {
    if (!liveFiles.has(cachedFile)) fileEventCache.delete(cachedFile);
  }
  if (aggregateCache.key === aggregateKey) {
    return { aggregateKey, events: aggregateCache.events };
  }

  const all = [];
  for (const file of files) {
    all.push(...parseFileEvents(file, stateSignature, threadMeta));
  }
  all.sort((a, b) => (a.time < b.time ? -1 : 1));
  const deduped = dedupeEvents(all);
  aggregateCache = { key: aggregateKey, events: deduped };
  return { aggregateKey, events: deduped };
}

function scheduleIndexRefresh(reason = "unknown") {
  indexState.dirty = true;
  if (indexState.refreshTimer) clearTimeout(indexState.refreshTimer);
  indexState.refreshTimer = setTimeout(() => {
    indexState.refreshTimer = null;
    try {
      refreshIndex(reason);
    } catch {
      // leave dirty state to retry on next request/tick
    }
  }, INDEX_REFRESH_DEBOUNCE_MS);
}

function refreshIndex(reason = "manual") {
  try {
    const built = computeAggregate();
    indexState.events = built.events;
    indexState.aggregateKey = built.aggregateKey;
    indexState.lastBuiltAt = new Date().toISOString();
    indexState.lastError = "";
    indexState.dirty = false;
    return indexState.events;
  } catch (err) {
    indexState.lastError = String(err);
    throw err;
  }
}

function ensureIndexReady() {
  const { aggregateKey } = computeAggregateSignature();
  if (!indexState.events.length || indexState.dirty || indexState.aggregateKey !== aggregateKey) {
    refreshIndex(indexState.events.length ? "dirty-read" : "cold-start");
  }
  return { events: indexState.events, currentAggregateKey: aggregateKey };
}

function watchPath(target, listener) {
  if (!fs.existsSync(target)) return null;
  try {
    return fs.watch(target, { recursive: true }, listener);
  } catch {
    try {
      return fs.watch(target, listener);
    } catch {
      return null;
    }
  }
}

function startIndexWatchers() {
  const sessionWatcher = watchPath(SESSIONS_DIR, () => scheduleIndexRefresh("sessions-watch"));
  const stateWatcher = watchPath(STATE_DB, () => scheduleIndexRefresh("state-watch"));
  const claudeWatcher = watchPath(CLAUDE_PROJECTS_DIR, () => scheduleIndexRefresh("claude-watch"));
  if (!sessionWatcher) {
    console.warn(`Session watcher unavailable for ${SESSIONS_DIR}, fallback warmup tick enabled.`);
  }
  if (!stateWatcher && fs.existsSync(STATE_DB)) {
    console.warn(`State DB watcher unavailable for ${STATE_DB}, fallback warmup tick enabled.`);
  }
  if (!claudeWatcher) {
    console.warn(`Claude Code watcher unavailable for ${CLAUDE_PROJECTS_DIR}, fallback warmup tick enabled.`);
  }
  setInterval(() => {
    if (indexState.dirty) {
      try {
        refreshIndex("warmup-tick");
      } catch {
        // keep retrying lazily
      }
    }
  }, INDEX_WARMUP_INTERVAL_MS).unref();
}

function queryEvents(filters) {
  const ready = ensureIndexReady();
  const allEvents = ready.events;
  const visibleEvents = allEvents.filter((event) => eventMatchesMode(event, filters.mode));
  const meta = collectMeta(visibleEvents);
  const matched = visibleEvents.filter((event) => eventMatchesFilters(event, filters));
  matched.sort((a, b) => {
    const am = toTimeMs(a.time) ?? 0;
    const bm = toTimeMs(b.time) ?? 0;
    return filters.order === "asc" ? am - bm : bm - am;
  });
  const paged = matched.slice(filters.offset, filters.offset + filters.limit);
  return {
    generatedAt: new Date().toISOString(),
    sessionsDir: SESSIONS_DIR,
    mode: filters.mode,
    index: {
      dirty: indexState.dirty,
      lastBuiltAt: indexState.lastBuiltAt,
      lastError: indexState.lastError,
      aggregateKey: indexState.aggregateKey,
      currentAggregateKey: ready.currentAggregateKey,
    },
    totalVisible: visibleEvents.length,
    totalMatching: matched.length,
    sessions: buildSessionGroups(matched),
    meta,
    page: {
      offset: filters.offset,
      limit: filters.limit,
      hasMore: filters.offset + paged.length < matched.length,
    },
    events: paged,
  };
}

function serveStatic(reqPath, res) {
  let filePath = reqPath === "/" ? "/index.html" : reqPath;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const abs = path.join(ROOT, filePath);
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
    res.writeHead(404);
    return res.end("Not Found");
  }
  const ext = path.extname(abs);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(abs).pipe(res);
}

function loadCodexSessionIndex() {
  const indexPath = path.join(os.homedir(), ".codex", "session_index.jsonl");
  const map = new Map();
  if (!fs.existsSync(indexPath)) return map;
  const lines = fs.readFileSync(indexPath, "utf8").split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      // Get the most recent entry for each session (last one wins)
      if (obj.id && obj.thread_name) {
        map.set(obj.id, obj.thread_name);
      }
    } catch {
      // skip
    }
  }
  return map;
}

function querySessions() {
  const ready = ensureIndexReady();
  const groups = buildSessionGroups(ready.events);

  // Load Codex session index to override session titles
  const codexIndex = loadCodexSessionIndex();
  for (const g of groups) {
    // If it's a Codex session and we have a name in the index, use it
    if (g.sourceType === "codex" && codexIndex.has(g.sessionId)) {
      g.sessionTitle = codexIndex.get(g.sessionId);
    }
  }

  // Group by cwd
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

function findClaudeSessionFile(sessionId) {
  const claudeSessionsDir = path.join(os.homedir(), ".claude", "sessions");
  if (!fs.existsSync(claudeSessionsDir)) return null;
  const files = fs.readdirSync(claudeSessionsDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(claudeSessionsDir, file), "utf8"));
      if (data.sessionId === sessionId) return path.join(claudeSessionsDir, file);
    } catch {
      // skip
    }
  }
  return null;
}

function findClaudeTranscriptFiles(sessionId) {
  // Find JSONL files in ~/.claude/projects/**/ that match the sessionId
  const files = [];
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return files;
  const projects = fs.readdirSync(CLAUDE_PROJECTS_DIR);
  for (const project of projects) {
    const projectDir = path.join(CLAUDE_PROJECTS_DIR, project);
    if (!fs.statSync(projectDir).isDirectory()) continue;
    try {
      const entries = fs.readdirSync(projectDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.startsWith(sessionId) && e.name.endsWith(".jsonl")) {
          files.push(path.join(projectDir, e.name));
        } else if (e.isDirectory()) {
          // Check subagent directories
          try {
            const subEntries = fs.readdirSync(path.join(projectDir, e.name), { withFileTypes: true });
            for (const se of subEntries) {
              if (se.isFile() && se.name.endsWith(".jsonl")) {
                files.push(path.join(projectDir, e.name, se.name));
              }
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
      // skip
    }
  }
  return files;
}

function findCodexSessionFiles(sessionId) {
  const codexSessionsDir = path.join(os.homedir(), ".codex", "sessions");
  if (!fs.existsSync(codexSessionsDir)) return [];
  const files = [];
  // Recursively search for JSONL files matching the sessionId
  const searchDir = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        searchDir(fullPath);
      } else if (entry.isFile() && entry.name.includes(sessionId) && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  };
  searchDir(codexSessionsDir);
  return files;
}

function updateCodexSessionIndex(sessionId, newName) {
  const indexPath = path.join(os.homedir(), ".codex", "session_index.jsonl");
  if (!fs.existsSync(indexPath)) {
    // Create new index file with the session entry
    const entry = JSON.stringify({
      id: sessionId,
      thread_name: newName,
      updated_at: new Date().toISOString(),
    });
    fs.writeFileSync(indexPath, entry + "\n", "utf8");
    return true;
  }
  const lines = fs.readFileSync(indexPath, "utf8").split("\n").filter((l) => l.trim());
  const updated = [];
  let found = false;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.id === sessionId) {
        obj.thread_name = newName;
        obj.updated_at = new Date().toISOString();
        found = true;
      }
      updated.push(JSON.stringify(obj));
    } catch {
      updated.push(line);
    }
  }
  // If not found, append a new entry
  if (!found) {
    updated.push(JSON.stringify({
      id: sessionId,
      thread_name: newName,
      updated_at: new Date().toISOString(),
    }));
  }
  fs.writeFileSync(indexPath, updated.join("\n") + "\n", "utf8");
  return true;
}

function removeCodexSessionFromIndex(sessionId) {
  const indexPath = path.join(os.homedir(), ".codex", "session_index.jsonl");
  if (!fs.existsSync(indexPath)) return;
  const lines = fs.readFileSync(indexPath, "utf8").split("\n").filter((l) => l.trim());
  const updated = lines.filter((line) => {
    try {
      const obj = JSON.parse(line);
      return obj.id !== sessionId;
    } catch {
      return true;
    }
  });
  fs.writeFileSync(indexPath, updated.join("\n") + (updated.length > 0 ? "\n" : ""), "utf8");
}

function deleteClaudeSessionFiles(sessionId) {
  const home = os.homedir();
  const dirs = [
    { dir: path.join(home, ".claude", "session-env", sessionId), recursive: true },
    { dir: path.join(home, ".claude", "tasks", sessionId), recursive: true },
    { dir: path.join(home, ".claude", "file-history", sessionId), recursive: true },
    { dir: path.join(home, ".claude", "debug", `${sessionId}.txt`), recursive: false },
    { dir: path.join(home, ".claude", "shell-snapshots", `${sessionId}.sh`), recursive: false },
  ];

  // Find and delete transcript files
  if (fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    const projects = fs.readdirSync(CLAUDE_PROJECTS_DIR);
    for (const project of projects) {
      const projectDir = path.join(CLAUDE_PROJECTS_DIR, project);
      if (!fs.statSync(projectDir).isDirectory()) continue;
      try {
        const entries = fs.readdirSync(projectDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.startsWith(sessionId) && e.name.endsWith(".jsonl")) {
            fs.unlinkSync(path.join(projectDir, e.name));
          }
        }
      } catch {
        // skip
      }
    }
  }

  for (const { dir, recursive } of dirs) {
    try {
      if (recursive) {
        if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      } else {
        if (fs.existsSync(dir)) fs.unlinkSync(dir);
      }
    } catch {
      // skip
    }
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);

  if (u.pathname === "/api/events") {
    try {
      const filters = parseRequestFilters(u.searchParams);
      return sendJson(res, 200, queryEvents(filters));
    } catch (err) {
      return sendJson(res, 500, { error: String(err), index: indexState });
    }
  }

  if (u.pathname === "/api/sessions" && req.method === "GET") {
    try {
      return sendJson(res, 200, querySessions());
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  }

  if (u.pathname === "/api/sessions/rename" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { sessionId, newName } = JSON.parse(body);
        if (!sessionId || !newName) return sendJson(res, 400, { error: "sessionId and newName required" });

        // Try Claude Code first
        const claudeFile = findClaudeSessionFile(sessionId);
        if (claudeFile) {
          const data = JSON.parse(fs.readFileSync(claudeFile, "utf8"));
          data.name = newName;
          fs.writeFileSync(claudeFile, JSON.stringify(data), "utf8");
          scheduleIndexRefresh("session-renamed");
          return sendJson(res, 200, { success: true, sessionId, name: newName, platform: "claude" });
        }

        // Try Codex
        if (updateCodexSessionIndex(sessionId, newName)) {
          scheduleIndexRefresh("session-renamed");
          return sendJson(res, 200, { success: true, sessionId, name: newName, platform: "codex" });
        }

        return sendJson(res, 404, { error: "Session not found" });
      } catch (err) {
        return sendJson(res, 500, { error: String(err) });
      }
    });
    return;
  }

  // Batch delete sessions
  if (u.pathname === "/api/sessions/batch-delete" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        const { sessionIds } = JSON.parse(body);
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          return sendJson(res, 400, { error: "sessionIds array required" });
        }

        const results = [];
        for (const sessionId of sessionIds) {
          try {
            // Try Claude Code deletion
            const claudeFile = findClaudeSessionFile(sessionId);
            const claudeTranscripts = findClaudeTranscriptFiles(sessionId);

            if (claudeFile || claudeTranscripts.length > 0) {
              if (claudeFile && fs.existsSync(claudeFile)) fs.unlinkSync(claudeFile);
              deleteClaudeSessionFiles(sessionId);
              results.push({ sessionId, success: true, platform: "claude" });
              continue;
            }

            // Try Codex deletion
            const codexFiles = findCodexSessionFiles(sessionId);
            if (codexFiles.length > 0) {
              for (const f of codexFiles) {
                if (fs.existsSync(f)) fs.unlinkSync(f);
              }
              removeCodexSessionFromIndex(sessionId);
              results.push({ sessionId, success: true, platform: "codex" });
              continue;
            }

            results.push({ sessionId, success: false, error: "not found" });
          } catch (err) {
            results.push({ sessionId, success: false, error: String(err) });
          }
        }

        scheduleIndexRefresh("batch-delete");
        const deletedCount = results.filter((r) => r.success).length;
        return sendJson(res, 200, { success: true, total: sessionIds.length, deleted: deletedCount, results });
      } catch (err) {
        return sendJson(res, 500, { error: String(err) });
      }
    });
    return;
  }

  if (u.pathname.startsWith("/api/sessions/") && req.method === "DELETE") {
    const sessionId = u.pathname.split("/").pop();
    if (!sessionId) return sendJson(res, 400, { error: "sessionId required" });
    try {
      // Try Claude Code deletion
      const claudeFile = findClaudeSessionFile(sessionId);
      const claudeTranscripts = findClaudeTranscriptFiles(sessionId);

      if (claudeFile || claudeTranscripts.length > 0) {
        // Delete session metadata JSON if exists
        if (claudeFile && fs.existsSync(claudeFile)) fs.unlinkSync(claudeFile);
        // Delete transcript JSONL files and other session data
        deleteClaudeSessionFiles(sessionId);
        scheduleIndexRefresh("session-deleted");
        return sendJson(res, 200, { success: true, sessionId, platform: "claude" });
      }

      // Try Codex deletion
      const codexFiles = findCodexSessionFiles(sessionId);
      if (codexFiles.length > 0) {
        for (const f of codexFiles) {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        }
        removeCodexSessionFromIndex(sessionId);
        scheduleIndexRefresh("session-deleted");
        return sendJson(res, 200, { success: true, sessionId, platform: "codex" });
      }

      return sendJson(res, 404, { error: "Session not found" });
    } catch (err) {
      return sendJson(res, 500, { error: String(err) });
    }
  }

  return serveStatic(u.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Session Observer running at http://${HOST}:${PORT}`);
  console.log(`Codex sessions: ${SESSIONS_DIR}`);
  console.log(`Claude Code sessions: ${CLAUDE_PROJECTS_DIR}`);
  startIndexWatchers();
  try {
    refreshIndex("startup");
  } catch (err) {
    console.error(`Initial index build failed: ${err}`);
  }
});
