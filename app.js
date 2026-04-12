const state = {
  events: [],
  filtered: [],
  sessions: [],
  meta: { models: [], types: [] },
  totalVisible: 0,
  totalMatching: 0,
  pageOffset: 0,
  pageLimit: 250,
  hasMore: false,
  dataSource: "server",
  selectedSessionId: "",
  selectedRowIndex: -1,
  quickFilter: "all",
  viewMode: "observe",
  autoRefreshEnabled: false,
  autoRefreshTimer: null,
  filterTimer: null,
  theme: "light",
  density: "cozy",
  dashboardCollapsed: false,
  sessionPaneWidth: 320,
  rowHeight: 156,
  scrollTop: 0,
  viewportHeight: 0,
  sessionGroups: [],
  sessionRowHeight: 152,
  sessionScrollTop: 0,
  sessionViewportHeight: 0,
  activeTab: "stream",
  sessionMgmtData: null,
  renameTargetSessionId: null,
  deleteTargetSessionId: null,
  fromSessionMgmt: false,
  lastViewedSessionId: null,
  selectedSessionIds: new Set(),
  batchConfirmAction: null,
  // Inline conversation panel state
  inlineConvEvents: [],
  inlineConvTotal: 0,
  inlineConvOffset: 0,
  inlineConvSessionId: null,
  inlineConvSessionInfo: null,
};

const els = {
  fileInput: document.getElementById("fileInput"),
  searchInput: document.getElementById("searchInput"),
  modelSelect: document.getElementById("modelSelect"),
  typeSelect: document.getElementById("typeSelect"),
  platformSelect: document.getElementById("platformSelect"),
  startTime: document.getElementById("startTime"),
  endTime: document.getElementById("endTime"),
  sortOrder: document.getElementById("sortOrder"),
  clearBtn: document.getElementById("clearBtn"),
  resetFiltersBtn: document.getElementById("resetFiltersBtn"),
  helpBtn: document.getElementById("helpBtn"),
  helpModal: document.getElementById("helpModal"),
  helpModalCloseBtn: document.getElementById("helpModalCloseBtn"),
  exportBtn: document.getElementById("exportBtn"),
  allSessionsBtn: document.getElementById("allSessionsBtn"),
  sessionList: document.getElementById("sessionList"),
  manualRefreshBtn: document.getElementById("manualRefreshBtn"),
  autoRefreshBtn: document.getElementById("autoRefreshBtn"),
  modeToggleBtn: document.getElementById("modeToggleBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  densityToggleBtn: document.getElementById("densityToggleBtn"),
  dashCollapseBtn: document.getElementById("dashCollapseBtn"),
  dashGrid: document.getElementById("dashGrid"),
  resizeHandle: document.getElementById("resizeHandle"),
  realtimeStatus: document.getElementById("realtimeStatus"),
  quickFilters: document.getElementById("quickFilters"),
  tokenThresholdInput: document.getElementById("tokenThresholdInput"),
  rows: document.getElementById("rows"),
  loadMoreBtn: document.getElementById("loadMoreBtn"),
  detailModal: document.getElementById("detailModal"),
  modalJson: document.getElementById("modalJson"),
  modalCloseBtn: document.getElementById("modalCloseBtn"),
  copyJsonBtn: document.getElementById("copyJsonBtn"),
  prevEventBtn: document.getElementById("prevEventBtn"),
  nextEventBtn: document.getElementById("nextEventBtn"),
  stats: document.getElementById("stats"),
  tabBar: document.getElementById("tabBar"),
  streamView: document.getElementById("streamView"),
  sessionsView: document.getElementById("sessionsView"),
  streamFilters: document.getElementById("streamFilters"),
  quickFiltersSection: document.getElementById("quickFilters"),
  statsSection: document.querySelector(".stats"),
  sessionMgmtSearch: document.getElementById("sessionMgmtSearch"),
  sessionMgmtPlatform: document.getElementById("sessionMgmtPlatform"),
  sessionMgmtNamedOnly: document.getElementById("sessionMgmtNamedOnly"),
  sessionMgmtRefreshBtn: document.getElementById("sessionMgmtRefreshBtn"),
  sessionGroups: document.getElementById("sessionGroups"),
  sessionDetailModal: document.getElementById("sessionDetailModal"),
  sessionDetailBody: document.getElementById("sessionDetailBody"),
  sessionDetailCloseBtn: document.getElementById("sessionDetailCloseBtn"),
  renameModal: document.getElementById("renameModal"),
  renameInput: document.getElementById("renameInput"),
  renameConfirmBtn: document.getElementById("renameConfirmBtn"),
  renameModalCloseBtn: document.getElementById("renameModalCloseBtn"),
  deleteModal: document.getElementById("deleteModal"),
  deleteMessage: document.getElementById("deleteMessage"),
  deleteConfirmBtn: document.getElementById("deleteConfirmBtn"),
  deleteModalCloseBtn: document.getElementById("deleteModalCloseBtn"),
  selectAllCheckbox: document.getElementById("selectAllCheckbox"),
  batchDeleteBtn: document.getElementById("batchDeleteBtn"),
  batchExportBtn: document.getElementById("batchExportBtn"),
  batchConfirmModal: document.getElementById("batchConfirmModal"),
  batchConfirmTitle: document.getElementById("batchConfirmTitle"),
  batchConfirmMessage: document.getElementById("batchConfirmMessage"),
  batchConfirmList: document.getElementById("batchConfirmList"),
  batchConfirmCloseBtn: document.getElementById("batchConfirmCloseBtn"),
  batchConfirmCancelBtn: document.getElementById("batchConfirmCancelBtn"),
  batchConfirmOkBtn: document.getElementById("batchConfirmOkBtn"),
  // Inline conversation panel elements
  inlineConvPanel: document.getElementById("inlineConvPanel"),
  inlineConvClose: document.getElementById("inlineConvClose"),
  inlineConvTitle: document.getElementById("inlineConvTitle"),
  inlineConvPlatform: document.getElementById("inlineConvPlatform"),
  inlineConvStats: document.getElementById("inlineConvStats"),
  inlineConvLoadStatus: document.getElementById("inlineConvLoadStatus"),
  inlineConvBody: document.getElementById("inlineConvBody"),
};
const ALERT_PATTERN = /(error|failed|exception|timeout|invalid|reject|denied|拒绝|失败|错误|异常)/i;

// Tool display configurations (following claudecodeui toolConfigs pattern)
const TOOL_DISPLAY_CONFIGS = {
  Bash: {
    category: "bash",
    inputStyle: "terminal",
    inputAction: "copy",
    hideResult: true, // Hide successful results
  },
  Read: {
    category: "read",
    inputStyle: "one-line",
    inputAction: "open-file",
    getInputValue: (input) => input.file_path || "",
    hideResult: true,
  },
  Edit: {
    category: "edit",
    inputStyle: "collapsible",
    contentType: "diff",
    getInputTitle: (input) => {
      const filename = input.file_path?.split('/').pop() || input.file_path || 'file';
      return filename;
    },
    hideResult: true,
  },
  Write: {
    category: "edit",
    inputStyle: "collapsible",
    contentType: "diff",
    getInputTitle: (input) => {
      const filename = input.file_path?.split('/').pop() || input.file_path || 'file';
      return filename;
    },
    hideResult: true,
  },
  ApplyPatch: {
    category: "edit",
    inputStyle: "collapsible",
    contentType: "diff",
    hideResult: true,
  },
  Grep: {
    category: "search",
    inputStyle: "one-line",
    getInputValue: (input) => input.pattern || "",
    getInputSecondary: (input) => input.path ? `in ${input.path}` : null,
    resultStyle: "collapsible",
    getResultTitle: (result) => {
      const count = result?.numFiles || result?.filenames?.length || 0;
      return `Found ${count} ${count === 1 ? 'file' : 'files'}`;
    },
  },
  Glob: {
    category: "search",
    inputStyle: "one-line",
    getInputValue: (input) => input.pattern || "",
    getInputSecondary: (input) => input.path ? `in ${input.path}` : null,
    resultStyle: "collapsible",
    getResultTitle: (result) => {
      const count = result?.numFiles || result?.filenames?.length || 0;
      return `Found ${count} ${count === 1 ? 'file' : 'files'}`;
    },
  },
  TodoWrite: {
    category: "violet",
    inputStyle: "collapsible",
    contentType: "todo",
    getInputTitle: () => "Updating todo list",
    hideResult: true,
  },
  TodoRead: {
    category: "violet",
    inputStyle: "one-line",
    getInputValue: () => "reading list",
    resultStyle: "collapsible",
  },
  TaskCreate: {
    category: "violet",
    inputStyle: "one-line",
    getInputValue: (input) => input.subject || "Creating task",
    getInputSecondary: (input) => input.status || null,
    hideResult: true,
  },
  TaskUpdate: {
    category: "violet",
    inputStyle: "one-line",
    getInputValue: (input) => {
      const parts = [];
      if (input.taskId) parts.push(`#${input.taskId}`);
      if (input.status) parts.push(input.status);
      if (input.subject) parts.push(`"${input.subject}"`);
      return parts.join(' → ') || 'updating';
    },
    hideResult: true,
  },
  TaskList: {
    category: "violet",
    inputStyle: "one-line",
    getInputValue: () => "listing tasks",
    resultStyle: "collapsible",
  },
  TaskGet: {
    category: "violet",
    inputStyle: "one-line",
    getInputValue: (input) => input.taskId ? `#${input.taskId}` : "fetching",
    resultStyle: "collapsible",
  },
  Agent: {
    category: "purple",
    inputStyle: "collapsible",
    contentType: "markdown",
    getInputTitle: (input) => {
      const subagentType = input.subagent_type || "Agent";
      const description = input.description || "Running task";
      return `Subagent / ${subagentType}: ${description}`;
    },
    resultStyle: "collapsible",
  },
  AskUserQuestion: {
    category: "interactive",
    inputStyle: "collapsible",
    contentType: "question",
    getInputTitle: (input) => {
      const count = input.questions?.length || 0;
      const hasAnswers = input.answers && Object.keys(input.answers).length > 0;
      if (count === 1) {
        const header = input.questions[0]?.header || "Question";
        return hasAnswers ? `${header} — answered` : header;
      }
      return hasAnswers ? `${count} questions — answered` : `${count} questions`;
    },
    hideResult: true,
  },
  Default: {
    category: "default",
    inputStyle: "collapsible",
    getInputTitle: () => "Parameters",
    resultStyle: "collapsible",
  }
};

function getToolConfig(toolName) {
  return TOOL_DISPLAY_CONFIGS[toolName] || TOOL_DISPLAY_CONFIGS.Default;
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  // Fallback for older browsers
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return true;
  } catch {
    document.body.removeChild(textarea);
    return false;
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function highlightMatch(text, query) {
  if (!query || !text) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const lowerEscaped = escaped.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Find all match positions
  let result = "";
  let lastIdx = 0;
  let idx = lowerEscaped.indexOf(lowerQuery, 0);

  while (idx !== -1) {
    result += escaped.slice(lastIdx, idx);
    result += `<mark>${escaped.slice(idx, idx + query.length)}</mark>`;
    lastIdx = idx + query.length;
    idx = lowerEscaped.indexOf(lowerQuery, lastIdx);
  }
  result += escaped.slice(lastIdx);
  return result;
}

function clip(text, max = 140) {
  const s = (text || "").trim().replace(/\s+/g, " ");
  return s.length <= max ? s : `${s.slice(0, max)}...`;
}

function deriveFallbackTitleFromEvent(event) {
  if (!event || (event.callType !== "Prompt" && event.callType !== "User")) return "";
  let raw = (event.content || "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  // Strip XML-style command tags for Claude Code meta commands
  raw = raw.replace(/<[^>]+>/g, "").trim();
  if (!raw) return "";
  if (raw.startsWith("<environment_context>")) return "";
  if (raw.startsWith("# AGENTS.md")) return "";
  if (raw.length < 2) return "";
  return clip(raw, 36);
}

function shortId(v, n = 8) {
  if (!v) return "-";
  return v.length <= n ? v : v.slice(0, n);
}

function shortPath(v) {
  if (!v) return "-";
  const parts = v.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}

function shortPathN(v, n = 3) {
  if (!v) return "-";
  const parts = v.split(/[\\/]/).filter(Boolean);
  if (parts.length <= n) return v;
  return `.../${parts.slice(-n).join("/")}`;
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

function rowHeightForDensity() {
  return state.density === "compact" ? 132 : 156;
}

function sessionRowHeightForDensity() {
  return state.density === "compact" ? 122 : 152;
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

function isDuplicateAgentEvent(prev, next) {
  if (!prev || !next) return false;
  if (prev.callType !== "Agent" || next.callType !== "Agent") return false;
  if (prev.sessionId !== next.sessionId) return false;
  if ((prev.turnId || "") !== (next.turnId || "")) return false;
  if (normalizeEventText(prev.content) !== normalizeEventText(next.content)) return false;

  const prevMs = toDateMs(prev.time);
  const nextMs = toDateMs(next.time);
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

const shFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatShanghaiTime(input) {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  const parts = shFormatter.formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}.${ms}`;
}

function highlightJson(value) {
  const json = JSON.stringify(value, null, 2);
  const safe = escapeHtml(json);
  return safe.replace(
    /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/g,
    (m, str, _esc, keyPart) => {
      if (str) {
        if (keyPart) return `<span class="json-key">${m}</span>`;
        return `<span class="json-string">${m}</span>`;
      }
      if (m === "true" || m === "false") return `<span class="json-boolean">${m}</span>`;
      if (m === "null") return `<span class="json-null">${m}</span>`;
      return `<span class="json-number">${m}</span>`;
    }
  );
}

function typeClass(callType) {
  switch (callType) {
    case "Prompt":
    case "User":
      return "type-prompt";
    case "Agent":
      return "type-agent";
    case "Tool_Call":
      return "type-tool-call";
    case "Tool_Result":
      return "type-tool-result";
    case "Token_Usage":
      return "type-token-usage";
    case "Thinking":
      return "type-thinking";
    case "Raw":
      return "type-raw";
    default:
      return "type-default";
  }
}

function parseContentFromMessage(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => item?.text || item?.input_text || item?.output_text || "")
    .filter(Boolean)
    .join("\n");
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
      time: ts, sessionId: context.sessionId || sessionId, model: context.model || model,
      turnId, callId: "", toolName: "", cwd: context.cwd || cwd, sessionTitle,
      extra: "context_update", sourceFile, sourceType: "codex",
      callType: "Raw", rawType: obj.type || "", rawSubType: obj.payload?.type || "",
      content: summarizeRawObject(obj), summary: summarizeRawObject(obj), raw: obj,
    };
  }

  if (obj.type === "session_meta") {
    context.sessionId = obj.payload?.id || context.sessionId;
    context.cwd = obj.payload?.cwd || context.cwd;
    context.sessionTitle = obj.payload?.title || obj.payload?.session_title || obj.payload?.session_name || obj.payload?.name || obj.payload?.thread_title || obj.payload?.display_name || context.sessionTitle;
    return {
      time: ts, sessionId: context.sessionId || sessionId, model,
      turnId, callId: "", toolName: "", cwd: context.cwd || cwd,
      sessionTitle: context.sessionTitle || sessionTitle,
      extra: "session_meta", sourceFile, sourceType: "codex",
      callType: "Raw", rawType: obj.type || "", rawSubType: obj.payload?.type || "",
      content: summarizeRawObject(obj), summary: summarizeRawObject(obj), raw: obj,
    };
  }

  if (obj.type === "response_item" && obj.payload?.type === "message") {
    const role = obj.payload.role;
    if (role === "user" || role === "assistant") {
      const content = parseContentFromMessage(obj.payload.content);
      return {
        time: ts, sessionId, model, turnId, callId: "", toolName: "",
        cwd, sessionTitle, extra: `role=${role}`, sourceFile, sourceType: "codex",
        callType: role === "user" ? "Prompt" : "Agent", content, summary: clip(content),
      };
    }
  }

  if (obj.type === "event_msg" && obj.payload?.type === "agent_message") {
    return {
      time: ts, sessionId, model, turnId, callId: "", toolName: "",
      cwd, sessionTitle, extra: "agent_message", sourceFile, sourceType: "codex",
      callType: "Agent", content: obj.payload?.message || "",
      summary: clip(obj.payload?.message || ""),
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
      time: ts, sessionId, model, turnId, callId: "", toolName: "",
      cwd, sessionTitle, extra: "token_count", sourceFile, sourceType: "codex",
      callType: "Token_Usage", content, summary: clip(content, 220),
      tokenUsage: {
        input: usage.input_tokens ?? null, output: usage.output_tokens ?? null,
        total: usage.total_tokens ?? null, cachedInput: usage.cached_input_tokens ?? null,
        reasoningOutput: usage.reasoning_output_tokens ?? null,
      },
    };
  }

  if (obj.type === "response_item" && obj.payload?.type === "function_call") {
    const name = obj.payload?.name || "unknown_tool";
    const args = obj.payload?.arguments || "";
    return {
      time: ts, sessionId, model, turnId,
      callId: obj.payload?.call_id || "", toolName: name,
      cwd, sessionTitle, extra: `call_id=${obj.payload?.call_id || ""}`,
      sourceFile, sourceType: "codex",
      callType: "Tool_Call", content: `tool=${name}\nargs=${args}`,
      summary: clip(`tool=${name}\nargs=${args}`),
    };
  }

  if (obj.type === "response_item" && obj.payload?.type === "function_call_output") {
    const output = obj.payload?.output || "";
    return {
      time: ts, sessionId, model, turnId,
      callId: obj.payload?.call_id || "", toolName: "",
      cwd, sessionTitle, extra: `call_id=${obj.payload?.call_id || ""}`,
      sourceFile, sourceType: "codex",
      callType: "Tool_Result", content: output, summary: clip(output),
    };
  }

  return {
    time: ts, sessionId, model, turnId,
    callId: obj.payload?.call_id || "", toolName: obj.payload?.name || "",
    cwd, sessionTitle, extra: "", sourceFile, sourceType: "codex",
    callType: "Raw", rawType: obj.type || "", rawSubType: obj.payload?.type || "",
    content: summarizeRawObject(obj), summary: summarizeRawObject(obj), raw: obj,
  };
}

function toDateMs(input) {
  if (!input) return null;
  const ms = Date.parse(input);
  return Number.isNaN(ms) ? null : ms;
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

function isVisibleInCurrentMode(event) {
  if (state.viewMode === "raw") return true;
  return event.callType !== "Raw";
}

function isServerMode() {
  return state.dataSource === "server";
}

function matchFilters(event) {
  const q = els.searchInput.value.trim().toLowerCase();
  const model = els.modelSelect.value;
  const type = els.typeSelect.value;
  const platform = els.platformSelect?.value || "";
  const start = toDateMs(els.startTime.value);
  const end = toDateMs(els.endTime.value);
  const eventMs = toDateMs(event.time);

  if (!isVisibleInCurrentMode(event)) return false;
  if (platform && event.sourceType !== platform) return false;
  if (model && event.model !== model) return false;
  if (type && event.callType !== type) return false;
  if (state.selectedSessionId && event.sessionId !== state.selectedSessionId) return false;
  if (state.quickFilter === "alert" && !isAlertEvent(event)) return false;
  if (state.quickFilter === "high_token") {
    const total = Number(event.tokenUsage?.total);
    const threshold = Number(els.tokenThresholdInput?.value || 20000);
    if (!(Number.isFinite(total) && total >= threshold)) return false;
  }
  if (start && eventMs && eventMs < start) return false;
  if (end && eventMs && eventMs > end) return false;

  if (!q) return true;
    return (
    event.content.toLowerCase().includes(q) ||
    event.callType.toLowerCase().includes(q) ||
    event.model.toLowerCase().includes(q) ||
    event.sessionId.toLowerCase().includes(q) ||
    event.turnId.toLowerCase().includes(q) ||
    event.callId.toLowerCase().includes(q) ||
    event.toolName.toLowerCase().includes(q) ||
    event.extra.toLowerCase().includes(q) ||
    (event.rawType || "").toLowerCase().includes(q) ||
    (event.rawSubType || "").toLowerCase().includes(q) ||
    (event.cwd || "").toLowerCase().includes(q) ||
    (event.sessionTitle || "").toLowerCase().includes(q) ||
    (event.tokenUsage ? JSON.stringify(event.tokenUsage).toLowerCase().includes(q) : false)
  );
}

function renderStats() {
  const stats = computeDashboardStats();

  // Update scope label
  const scopeEl = document.getElementById("dashScope");
  if (scopeEl) {
    scopeEl.textContent = state.selectedSessionId
      ? `Session: ${shortId(state.selectedSessionId, 12)}`
      : "全部会话";
  }

  // Token summary
  document.getElementById("tokenInput").textContent = fmtTokenHuman(stats.tokenTotal.input);
  document.getElementById("tokenOutput").textContent = fmtTokenHuman(stats.tokenTotal.output);
  document.getElementById("tokenTotal").textContent = fmtTokenHuman(stats.tokenTotal.total);
  document.getElementById("tokenCached").textContent = fmtTokenHuman(stats.tokenTotal.cachedInput);
  document.getElementById("tokenReason").textContent = fmtTokenHuman(stats.tokenTotal.reasoningOutput);

  // Count stats
  document.getElementById("countTotal").textContent = fmtNum(stats.totalVisible);
  document.getElementById("countMatch").textContent = fmtNum(stats.totalMatching);
  document.getElementById("countSessions").textContent = fmtNum(stats.sessionCount);
  document.getElementById("countLoaded").textContent = fmtNum(stats.loadedCount);

  // Type bars
  renderTypeBars(stats.typeCounts, stats.totalVisible);

  // Model list
  renderModelList(stats.modelCounts);

  // Platform bars
  renderPlatformBars(stats.platformCounts);
}

function computeDashboardStats() {
  // Token total - aggregate from sessions
  let tokenTotal = { input: 0, output: 0, total: 0, cachedInput: 0, reasoningOutput: 0 };

  if (isServerMode()) {
    for (const s of state.sessions) {
      if (s.aggregateToken) {
        tokenTotal = addTokenUsage(tokenTotal, s.aggregateToken);
      }
    }
  } else {
    for (const e of state.filtered) {
      if (e.tokenUsage) {
        tokenTotal = addTokenUsage(tokenTotal, e.tokenUsage);
      }
    }
  }

  // Type distribution
  const typeCounts = {};
  // Always use filtered events for type distribution (both server and local mode)
  for (const e of state.filtered) {
    const t = e.callType || "Unknown";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  // Model distribution - based on sessions in server mode
  const modelCounts = {};
  if (isServerMode()) {
    // Count how many sessions use each model
    for (const s of state.sessions) {
      for (const m of s.models || []) {
        modelCounts[m] = (modelCounts[m] || 0) + 1;
      }
    }
  } else {
    // Local mode: count from filtered events
    for (const e of state.filtered) {
      const m = e.model || "unknown";
      modelCounts[m] = (modelCounts[m] || 0) + 1;
    }
  }

  // Platform distribution
  const platformCounts = { codex: 0, claude: 0 };
  if (isServerMode()) {
    for (const s of state.sessions) {
      const p = s.sourceType || "unknown";
      if (p === "codex" || p === "claude") {
        platformCounts[p]++;
      }
    }
  } else {
    const visibleEvents = state.events.filter(isVisibleInCurrentMode);
    for (const e of visibleEvents) {
      const p = e.sourceType || "unknown";
      if (p === "codex" || p === "claude") {
        platformCounts[p]++;
      }
    }
  }

  return {
    tokenTotal,
    typeCounts,
    modelCounts,
    platformCounts,
    totalVisible: isServerMode() ? state.totalVisible : state.events.filter(isVisibleInCurrentMode).length,
    totalMatching: isServerMode() ? state.totalMatching : state.filtered.length,
    sessionCount: isServerMode() ? state.sessions.length : state.sessionGroups.length,
    loadedCount: state.filtered.length,
  };
}

function typeClass(type) {
  const map = {
    Prompt: "type-prompt",
    User: "type-prompt",
    Agent: "type-agent",
    Tool_Call: "type-tool-call",
    Tool_Result: "type-tool-result",
    Token_Usage: "type-token-usage",
    Thinking: "type-thinking",
    Raw: "type-raw",
  };
  return map[type] || "type-raw";
}

function renderTypeBars(typeCounts, total) {
  const container = document.getElementById("typeBars");
  if (!container) return;

  if (Object.keys(typeCounts).length === 0) {
    container.innerHTML = '<div style="color: var(--ink-soft); font-size: 0.66rem;">无数据</div>';
    return;
  }

  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

  container.innerHTML = sortedTypes
    .map(([type, count]) => {
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      const barClass = typeClass(type);
      const typeDesc = getTypeDescription(type);
      return `<div class="type-bar-row">
      <span class="type-bar-label has-tip" data-tip="${typeDesc}">${escapeHtml(type)}</span>
      <div class="type-bar-track">
        <div class="type-bar-fill ${barClass}" style="width: ${pct}%"></div>
      </div>
      <span class="type-bar-count">${fmtNum(count)}</span>
    </div>`;
    })
    .join("");
}

function getTypeDescription(type) {
  const descriptions = {
    Prompt: "用户输入的消息（Codex 格式）",
    User: "用户输入的消息（Claude Code 格式）",
    Agent: "AI 模型生成的回复消息",
    Tool_Call: "工具调用请求，包含工具名称和参数",
    Tool_Result: "工具执行返回的结果",
    Token_Usage: "Token 使用量统计事件",
    Thinking: "模型的内部推理过程（仅 Claude 模型）",
    Raw: "未解析或特殊格式的原始事件",
  };
  return descriptions[type] || "未知事件类型";
}

function renderModelList(modelCounts) {
  const container = document.getElementById("modelList");
  if (!container) return;

  if (Object.keys(modelCounts).length === 0) {
    container.innerHTML = '<div style="color: var(--ink-soft); font-size: 0.66rem;">无数据</div>';
    return;
  }

  const sortedModels = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const isSessionBased = isServerMode();

  container.innerHTML = sortedModels
    .map(([model, count]) => {
      const tip = isSessionBased
        ? `在 ${fmtNum(count)} 个会话中被使用`
        : `产生 ${fmtNum(count)} 个事件`;
      return `<div class="model-item">
      <span class="model-name has-tip" data-tip="${tip}">${escapeHtml(model)}</span>
      <span class="model-count">${fmtNum(count)}</span>
    </div>`;
    })
    .join("");
}

function renderPlatformBars(platformCounts) {
  const container = document.getElementById("platformBars");
  if (!container) return;

  const codexTip = "Codex 是 OpenAI 的 CLI 工具，日志存储在 ~/.codex/sessions/";
  const claudeTip = "Claude Code 是 Anthropic 的 CLI 工具，日志存储在 ~/.claude/projects/";

  container.innerHTML = `
    <div class="platform-bar">
      <div class="platform-bar-fill codex has-tip" data-tip="${codexTip}">${fmtNum(platformCounts.codex || 0)}</div>
      <span class="platform-label">Codex</span>
    </div>
    <div class="platform-bar">
      <div class="platform-bar-fill claude has-tip" data-tip="${claudeTip}">${fmtNum(platformCounts.claude || 0)}</div>
      <span class="platform-label">Claude</span>
    </div>`;
}

function renderEmptyRows() {
  els.rows.innerHTML = '<div class="empty">无匹配数据</div>';
  els.rows.scrollTop = 0;
  state.scrollTop = 0;
  state.viewportHeight = els.rows.clientHeight || 0;
  if (els.loadMoreBtn) {
    els.loadMoreBtn.hidden = !state.hasMore;
    els.loadMoreBtn.textContent = state.hasMore ? "加载更多" : "已全部加载";
  }
  renderStats();
}

function getVirtualSlice() {
  const total = state.filtered.length;
  const rowHeight = rowHeightForDensity();
  const viewportHeight = els.rows.clientHeight || state.viewportHeight || 640;
  const overscan = 6;
  const start = Math.max(0, Math.floor(state.scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(total, start + visibleCount);
  return {
    total,
    rowHeight,
    viewportHeight,
    start,
    end,
    offsetTop: start * rowHeight,
    totalHeight: total * rowHeight,
  };
}

function renderVirtualRows() {
  if (state.filtered.length === 0) {
    renderEmptyRows();
    return;
  }

  state.rowHeight = rowHeightForDensity();
  state.viewportHeight = els.rows.clientHeight || state.viewportHeight || 640;
  const slice = getVirtualSlice();
  const q = els.searchInput.value.trim();
  const html = state.filtered
    .slice(slice.start, slice.end)
    .map((e, localIdx) => {
      const idx = slice.start + localIdx;
      const active = idx === state.selectedRowIndex ? "active" : "";
      const toolOrExtra = e.toolName ? `tool:${e.toolName}` : e.extra;
      const rawLabel = e.callType === "Raw" ? `${e.rawType || "-"}/${e.rawSubType || "-"}` : "";
      const shownTime = formatShanghaiTime(e.time);
      const cwdLabel = e.cwd ? `cwd:${e.cwd}` : "cwd:-";
      const tokenLabel = e.tokenUsage
        ? `Tok ${fmtTokenHuman(e.tokenUsage.total)} total · ${fmtTokenHuman(e.tokenUsage.input)} in · ${fmtTokenHuman(e.tokenUsage.output)} out`
        : "";
      const tokenTitle = e.tokenUsage
        ? `In ${fmtNum(e.tokenUsage.input)} | Out ${fmtNum(e.tokenUsage.output)} | Total ${fmtNum(e.tokenUsage.total)} | Cache ${fmtNum(e.tokenUsage.cachedInput)} | Reason ${fmtNum(e.tokenUsage.reasoningOutput)}`
        : "";
      return `<article class="log-item ${active}" data-index="${idx}">
        <header class="log-top">
          <span class="log-type ${typeClass(e.callType)}">${highlightMatch(e.callType, q)}</span>
          ${e.sourceType ? `<span class="chip chip-platform chip-${escapeHtml(e.sourceType)}">${highlightMatch(e.sourceType, q)}</span>` : ""}
          ${rawLabel ? `<span class="chip chip-raw">${highlightMatch(rawLabel, q)}</span>` : ""}
          <span class="chip">${highlightMatch(e.model, q)}</span>
          <span class="chip">session:${highlightMatch(shortId(e.sessionId, 12), q)}</span>
          ${e.cwd ? `<span class="chip chip-cwd has-tip" data-tip="${escapeHtml(e.cwd)}">${highlightMatch(cwdLabel, q)}</span>` : ""}
          ${tokenLabel ? `<span class="chip chip-token has-tip" data-tip="${escapeHtml(tokenTitle)}">${highlightMatch(tokenLabel, q)}</span>` : ""}
          ${e.callId ? `<span class="chip">call:${highlightMatch(shortId(e.callId, 12), q)}</span>` : ""}
          ${e.turnId ? `<span class="chip">turn:${highlightMatch(shortId(e.turnId, 12), q)}</span>` : ""}
          <time class="log-time has-tip" data-tip="${escapeHtml(e.time)}">${escapeHtml(shownTime)}</time>
        </header>
        <div class="log-main-wrap">
          <div class="log-main has-tip" data-tip="${escapeHtml(e.content || e.summary || "")}" data-full-content="${escapeHtml(e.content || "")}">${highlightMatch(e.summary || "", q)}</div>
          ${e.content && e.content.length > (e.summary?.length || 0) ? `<button class="log-expand-btn" data-expand="true" type="button">展开</button>` : ""}
        </div>
        <footer class="log-meta">
          <span>${highlightMatch(toolOrExtra || "-", q)}</span>
          <span>${highlightMatch(shortPath(e.sourceFile || ""), q)}</span>
        </footer>
      </article>`;
    })
    .join("");

  els.rows.innerHTML = `<div class="virtual-spacer" style="height:${slice.totalHeight}px;"></div>
    <div class="virtual-window" style="transform:translateY(${slice.offsetTop}px)">${html}</div>`;
  if (els.loadMoreBtn) {
    els.loadMoreBtn.hidden = !state.hasMore;
    els.loadMoreBtn.textContent = state.hasMore
      ? `加载更多 (${state.filtered.length}/${isServerMode() ? state.totalMatching : state.filtered.length})`
      : "已全部加载";
  }
  renderStats();
}

function renderRows() {
  if (state.filtered.length === 0) {
    state.selectedRowIndex = -1;
  }
  renderVirtualRows();
}

function getVirtualSessionSlice() {
  const total = state.sessionGroups.length;
  const rowHeight = sessionRowHeightForDensity();
  const viewportHeight = els.sessionList.clientHeight || state.sessionViewportHeight || 640;
  const overscan = 5;
  const start = Math.max(0, Math.floor(state.sessionScrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(total, start + visibleCount);
  return {
    total,
    rowHeight,
    start,
    end,
    offsetTop: start * rowHeight,
    totalHeight: total * rowHeight,
  };
}

function sessionItemHtml(g) {
  const active = g.sessionId === state.selectedSessionId ? "active" : "";
  const title = g.sessionTitle || g.fallbackTitle || "未命名会话";
  const tokenMeta = hasTokenUsageData(g.aggregateToken) ? `Tok ${fmtTokenHuman(g.aggregateToken.total)}` : "Tok -";
  const sidShort = shortId(g.sessionId, 18);
  const cwdShort = shortPathN(g.cwd, 4);
  const compactMeta = `事件 ${g.count} · ${tokenMeta} · 最近 ${formatShanghaiTime(g.latest)}`;
  const platform = g.sourceType || "unknown";
  const platformLabel = platform === "claude" ? "CC" : platform === "codex" ? "CX" : platform;
  const platformFullName = platform === "claude" ? "Claude Code" : platform === "codex" ? "Codex" : platform;
  return `<li class="session-row">
    <div class="session-item ${active}" data-session-id="${escapeHtml(g.sessionId)}" role="button" tabindex="0">
      <div class="session-title-row">
        <span class="chip chip-platform chip-${escapeHtml(platform)} session-platform" title="${escapeHtml(platformFullName)}">${escapeHtml(platformLabel)}</span>
        <span class="sname has-tip" data-tip="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="session-nav-hint" title="点击查看事件流">→</span>
      </div>
      <div class="sid-line">
        <span class="sid has-tip" data-tip="${escapeHtml(g.sessionId)}">${escapeHtml(sidShort)}</span>
        <button class="session-copy-inline" data-copy-session-id="${escapeHtml(g.sessionId)}" type="button" title="复制 Session ID">复制</button>
      </div>
      <span class="meta meta-compact has-tip" data-tip="${escapeHtml(compactMeta)}">${escapeHtml(compactMeta)}</span>
      <span class="meta cwd-line has-tip" data-tip="${escapeHtml(g.cwd || "-")}">cwd <span class="cwd-value">${escapeHtml(cwdShort)}</span></span>
    </div>
  </li>`;
}

function renderVirtualSessionGroups() {
  if (!state.sessionGroups.length) {
    els.sessionList.innerHTML = '<li class="session-empty">暂无 Session</li>';
    els.sessionList.scrollTop = 0;
    state.sessionScrollTop = 0;
    state.sessionViewportHeight = els.sessionList.clientHeight || 0;
    return;
  }

  state.sessionRowHeight = sessionRowHeightForDensity();
  state.sessionViewportHeight = els.sessionList.clientHeight || state.sessionViewportHeight || 640;
  const slice = getVirtualSessionSlice();
  const html = state.sessionGroups
    .slice(slice.start, slice.end)
    .map((g) => sessionItemHtml(g))
    .join("");
  els.sessionList.innerHTML = `<div class="session-virtual-spacer" style="height:${slice.totalHeight}px;"></div>
    <div class="session-virtual-window" style="transform:translateY(${slice.offsetTop}px)">${html}</div>`;
}

function refreshFiltersMeta() {
  if (isServerMode()) {
    const models = state.meta.models || [];
    const types = state.meta.types || [];
    const platforms = state.meta.platforms || [];
    const currentModel = els.modelSelect.value;
    const currentType = els.typeSelect.value;
    const currentPlatform = els.platformSelect?.value || "";
    els.modelSelect.innerHTML = `<option value="">全部</option>${models
      .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
      .join("")}`;
    els.typeSelect.innerHTML = `<option value="">全部</option>${types
      .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join("")}`;
    if (els.platformSelect) {
      els.platformSelect.innerHTML = `<option value="">全部</option>${platforms
        .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
        .join("")}`;
    }
    els.modelSelect.value = models.includes(currentModel) ? currentModel : "";
    els.typeSelect.value = types.includes(currentType) ? currentType : "";
    if (els.platformSelect) {
      els.platformSelect.value = platforms.includes(currentPlatform) ? currentPlatform : "";
    }
    return;
  }
  const visibleEvents = state.events.filter(isVisibleInCurrentMode);
  const models = [...new Set(visibleEvents.map((e) => e.model))].sort();
  const types = [...new Set(visibleEvents.map((e) => e.callType))].sort();

  const currentModel = els.modelSelect.value;
  const currentType = els.typeSelect.value;

  els.modelSelect.innerHTML = `<option value="">全部</option>${models
    .map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)
    .join("")}`;
  els.typeSelect.innerHTML = `<option value="">全部</option>${types
    .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
    .join("")}`;

  els.modelSelect.value = models.includes(currentModel) ? currentModel : "";
  els.typeSelect.value = types.includes(currentType) ? currentType : "";
}

function renderSessionGroups() {
  if (isServerMode()) {
    state.sessionGroups = state.sessions;
    renderVirtualSessionGroups();
    return;
  }
  const visibleEvents = state.events.filter(isVisibleInCurrentMode);
  if (visibleEvents.length === 0) {
    state.sessionGroups = [];
    els.sessionList.innerHTML = '<li class="session-empty">暂无 Session</li>';
    return;
  }

  const groups = new Map();
  for (const e of visibleEvents) {
    const g = groups.get(e.sessionId) || {
      sessionId: e.sessionId,
      sessionTitle: "",
      fallbackTitle: "",
      cwd: "",
      latestToken: null,
      aggregateToken: null,
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
    if (!g.fallbackTitle) g.fallbackTitle = deriveFallbackTitleFromEvent(e);
    if (e.cwd) g.cwd = e.cwd;
    if (e.callType === "Token_Usage" && hasTokenUsageData(e.tokenUsage)) {
      g.latestToken = e.tokenUsage;
      g.aggregateToken = addTokenUsage(g.aggregateToken, e.tokenUsage);
    }
    if (e.callType === "Prompt" || e.callType === "User") g.prompt += 1;
    else if (e.callType === "Agent") g.agent += 1;
    else g.tool += 1;
    groups.set(e.sessionId, g);
  }

  const sorted = [...groups.values()].sort((a, b) => (a.latest < b.latest ? 1 : -1));
  state.sessionGroups = sorted;
  renderVirtualSessionGroups();
}

function renderQuickFilterUi() {
  const buttons = els.quickFilters?.querySelectorAll("button[data-quick-filter]") || [];
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.quickFilter === state.quickFilter);
  });
}

function applyViewMode(mode) {
  state.viewMode = mode === "raw" ? "raw" : "observe";
  if (els.modeToggleBtn) {
    els.modeToggleBtn.textContent = state.viewMode === "raw" ? "观测模式" : "原始模式";
    els.modeToggleBtn.classList.toggle("active", state.viewMode === "raw");
  }
  localStorage.setItem("observer_view_mode", state.viewMode);
  syncUrl();
}

function applyTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.body.setAttribute("data-theme", state.theme);
  localStorage.setItem("observer_theme", state.theme);
  if (els.themeToggleBtn) {
    els.themeToggleBtn.textContent = state.theme === "dark" ? "白天模式" : "夜间模式";
  }
}

function applyDensity(mode) {
  state.density = mode === "compact" ? "compact" : "cozy";
  state.rowHeight = rowHeightForDensity();
  state.sessionRowHeight = sessionRowHeightForDensity();
  document.body.setAttribute("data-density", state.density);
  localStorage.setItem("observer_density", state.density);
  if (els.densityToggleBtn) {
    els.densityToggleBtn.textContent = state.density === "compact" ? "舒展视图" : "紧凑视图";
  }
}

function initResizeHandle() {
  const handle = els.resizeHandle;
  if (!handle) return;

  // Restore saved width
  const savedWidth = localStorage.getItem("observer_session_pane_width");
  if (savedWidth) {
    state.sessionPaneWidth = parseInt(savedWidth, 10) || 320;
    applySessionPaneWidth();
  }

  let startX = 0;
  let startWidth = 0;

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = state.sessionPaneWidth;
    handle.classList.add("dragging");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  function onMouseMove(e) {
    const container = document.querySelector(".content-grid");
    if (!container) return;
    const containerWidth = container.offsetWidth;
    const delta = e.clientX - startX;
    const newWidth = Math.max(260, Math.min(startWidth + delta, containerWidth / 2));
    state.sessionPaneWidth = newWidth;
    applySessionPaneWidth();
  }

  function onMouseUp() {
    handle.classList.remove("dragging");
    localStorage.setItem("observer_session_pane_width", String(state.sessionPaneWidth));
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }
}

function applySessionPaneWidth() {
  document.documentElement.style.setProperty("--session-pane-width", `${state.sessionPaneWidth}px`);
}

// --- URL State Synchronization ---

let urlSyncTimer = null;

function encodeStateToUrl() {
  try {
    const params = new URLSearchParams();
    if (state.activeTab !== "stream") params.set("tab", state.activeTab);
    if (state.selectedSessionId) params.set("session", state.selectedSessionId);
    if (els.searchInput?.value) params.set("q", els.searchInput.value);
    if (els.modelSelect?.value) params.set("model", els.modelSelect.value);
    if (els.typeSelect?.value) params.set("type", els.typeSelect.value);
    if (els.platformSelect?.value) params.set("platform", els.platformSelect.value);
    if (state.quickFilter !== "all") params.set("qf", state.quickFilter);
    if (state.viewMode !== "observe") params.set("mode", state.viewMode);
    if (els.sortOrder?.value && els.sortOrder.value !== "desc") params.set("sort", els.sortOrder.value);
    if (els.startTime?.value) params.set("from", els.startTime.value);
    if (els.endTime?.value) params.set("to", els.endTime.value);
    if (state.dashboardCollapsed) params.set("dash", "1");
    if (state.autoRefreshEnabled) params.set("ar", "1");

    const newSearch = params.toString();
    const currentSearch = window.location.search.slice(1);
    if (newSearch !== currentSearch) {
      const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
      history.replaceState(null, "", newUrl);
    }
  } catch (e) {
    // Silently ignore if history API unavailable
  }
}

function decodeStateFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.toString()) return false;

    let applied = false;

    if (params.has("tab")) {
      const tab = params.get("tab");
      if (tab === "stream" || tab === "sessions") {
        state.activeTab = tab;
        applied = true;
      }
    }

    if (params.has("session")) {
      state.selectedSessionId = params.get("session");
      applied = true;
    }

    if (params.has("q") && els.searchInput) {
      els.searchInput.value = params.get("q");
      applied = true;
    }

    if (params.has("model") && els.modelSelect) {
      els.modelSelect.value = params.get("model");
      applied = true;
    }

    if (params.has("type") && els.typeSelect) {
      els.typeSelect.value = params.get("type");
      applied = true;
    }

    if (params.has("platform") && els.platformSelect) {
      els.platformSelect.value = params.get("platform");
      applied = true;
    }

    if (params.has("qf")) {
      const qf = params.get("qf");
      if (qf === "all" || qf === "alert" || qf === "high_token") {
        state.quickFilter = qf;
        applied = true;
      }
    }

    if (params.has("mode")) {
      const mode = params.get("mode");
      if (mode === "observe" || mode === "raw") {
        state.viewMode = mode;
        applied = true;
      }
    }

    if (params.has("sort") && els.sortOrder) {
      const sort = params.get("sort");
      if (sort === "asc" || sort === "desc") {
        els.sortOrder.value = sort;
        applied = true;
      }
    }

    if (params.has("from") && els.startTime) {
      els.startTime.value = params.get("from");
      applied = true;
    }

    if (params.has("to") && els.endTime) {
      els.endTime.value = params.get("to");
      applied = true;
    }

    if (params.has("dash")) {
      state.dashboardCollapsed = params.get("dash") === "1";
      applied = true;
    }

    if (params.has("ar")) {
      state.autoRefreshEnabled = params.get("ar") === "1";
      applied = true;
    }

    return applied;
  } catch (e) {
    return false;
  }
}

function syncUrl() {
  if (urlSyncTimer) clearTimeout(urlSyncTimer);
  urlSyncTimer = setTimeout(() => {
    encodeStateToUrl();
    urlSyncTimer = null;
  }, 150);
}

function initAppearance() {
  const savedTheme = localStorage.getItem("observer_theme") || "light";
  const savedDensity = localStorage.getItem("observer_density") || "cozy";
  const savedViewMode = localStorage.getItem("observer_view_mode") || "observe";
  const savedThreshold = localStorage.getItem("observer_high_token_threshold") || "20000";
  const savedDashCollapsed = localStorage.getItem("observer_dash_collapsed") === "true";
  applyViewMode(savedViewMode);
  applyTheme(savedTheme);
  applyDensity(savedDensity);
  if (savedDashCollapsed) {
    state.dashboardCollapsed = true;
    els.stats?.classList.add("collapsed");
  }
  if (els.tokenThresholdInput) {
    els.tokenThresholdInput.value = savedThreshold;
  }
}

function applyFilters() {
  if (isServerMode()) {
    state.scrollTop = 0;
    els.rows.scrollTop = 0;
    refreshOnce("筛选刷新");
    syncUrl();
    return;
  }
  state.filtered = state.events.filter(matchFilters);
  const order = els.sortOrder.value || "desc";
  state.filtered.sort((a, b) => {
    const am = toDateMs(a.time) ?? 0;
    const bm = toDateMs(b.time) ?? 0;
    return order === "asc" ? am - bm : bm - am;
  });
  if (state.selectedRowIndex >= state.filtered.length) {
    state.selectedRowIndex = -1;
  }
  state.scrollTop = 0;
  els.rows.scrollTop = 0;
  renderRows();
  syncUrl();
}

function buildRealtimeQuery(offset = 0) {
  const params = new URLSearchParams();
  params.set("mode", state.viewMode);
  params.set("order", els.sortOrder.value || "desc");
  params.set("offset", String(offset));
  params.set("limit", String(state.pageLimit));
  params.set("quickFilter", state.quickFilter);
  params.set("tokenThreshold", String(Number(els.tokenThresholdInput?.value || 20000)));
  if (els.searchInput.value.trim()) params.set("q", els.searchInput.value.trim());
  if (els.platformSelect?.value) params.set("platform", els.platformSelect.value);
  if (els.modelSelect.value) params.set("model", els.modelSelect.value);
  if (els.typeSelect.value) params.set("type", els.typeSelect.value);
  if (els.startTime.value) params.set("start", els.startTime.value);
  if (els.endTime.value) params.set("end", els.endTime.value);
  if (state.selectedSessionId) params.set("sessionId", state.selectedSessionId);
  return params.toString();
}

function scheduleApplyFilters(delay = 100) {
  if (state.filterTimer) clearTimeout(state.filterTimer);
  state.filterTimer = setTimeout(() => {
    state.filterTimer = null;
    applyFilters();
  }, delay);
}

function showDetail(index) {
  const item = state.filtered[index];
  if (!item) return;
  state.selectedRowIndex = index;
  renderRows();
  const payload = {
    time_iso: item.time,
    time_shanghai: formatShanghaiTime(item.time),
    sessionId: item.sessionId,
    model: item.model,
    turnId: item.turnId,
    callId: item.callId,
    toolName: item.toolName,
    cwd: item.cwd,
    session_title: item.sessionTitle || "",
    token_usage: item.tokenUsage || null,
    raw_type: item.rawType || "",
    raw_sub_type: item.rawSubType || "",
    extra: item.extra,
    sourceFile: item.sourceFile,
    call_type: item.callType,
    content: item.content,
    raw: item.raw,
  };
  els.modalJson.innerHTML = highlightJson(payload);
  els.detailModal.classList.remove("hidden");
  els.detailModal.setAttribute("aria-hidden", "false");
  updateNavBtnsState();
}

function updateNavBtnsState() {
  const total = state.filtered.length;
  const current = state.selectedRowIndex;
  els.prevEventBtn.disabled = current <= 0;
  els.nextEventBtn.disabled = current >= total - 1;
}

function closeModal() {
  els.detailModal.classList.add("hidden");
  els.detailModal.setAttribute("aria-hidden", "true");
}

function closeHelpModal() {
  els.helpModal.classList.add("hidden");
  els.helpModal.setAttribute("aria-hidden", "true");
}

function extractTextFromContent(content) {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content.filter((i) => i?.type === "text").map((i) => i.text || "").filter(Boolean).join("\n");
}
function extractThinkingFromContent(content) {
  if (!Array.isArray(content)) return "";
  return content.filter((i) => i?.type === "thinking").map((i) => i.thinking || "").filter(Boolean).join("\n");
}
function extractToolCalls(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((i) => i?.type === "tool_use").map((i) => ({ name: i.name || "unknown", id: i.id || "", input: i.input }));
}

function parseClaudeCodeLineToEvent(obj, context) {
  const ts = obj.timestamp || "";
  const sessionId = obj.sessionId || context.sessionId || "unknown";
  const cwd = obj.cwd || context.cwd || "";
  const sourceFile = context.sourceFile || "unknown";
  const uuid = obj.uuid || "";

  if (obj.type === "permission-mode") {
    return { time: ts, sessionId, model: context.model || "unknown", turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: `mode=${obj.permissionMode || ""}`, sourceFile, sourceType: "claude", callType: "Raw", rawType: "permission-mode", rawSubType: "", content: `Permission mode: ${obj.permissionMode || "unknown"}`, summary: `Permission mode: ${obj.permissionMode || "unknown"}` };
  }
  if (obj.type === "file-history-snapshot") {
    const snap = obj.snapshot || {};
    const files = snap.trackedFileBackups ? Object.keys(snap.trackedFileBackups) : [];
    const content = files.length ? `File snapshot: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ` (+${files.length - 5})` : ""}` : "File snapshot";
    return { time: ts, sessionId, model: context.model || "unknown", turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: "file_history", sourceFile, sourceType: "claude", callType: "Raw", rawType: "file-history-snapshot", rawSubType: "", content, summary: clip(content) };
  }
  if (obj.type === "attachment") {
    const att = obj.attachment || {};
    const content = `Attachment: ${att.type || "unknown"}`;
    return { time: ts, sessionId, model: context.model || "unknown", turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: att.type || "", sourceFile, sourceType: "claude", callType: "Raw", rawType: "attachment", rawSubType: "", content, summary: clip(content) };
  }
  if (obj.type === "user") {
    if (obj.isMeta) {
      const content = typeof obj.message?.content === "string" ? obj.message.content : "";
      const cleaned = content.replace(/<command-name>.*?<\/command-name>/g, "").trim();
      return { time: ts, sessionId, model: context.model || "unknown", turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: obj.isSidechain ? "sidechain_meta" : "meta_command", sourceFile, sourceType: "claude", callType: "Raw", rawType: "user-meta", rawSubType: "", content: cleaned || "Meta command", summary: clip(cleaned || "Meta command") };
    }
    if (obj.toolUseResult) {
      const msgContent = obj.message?.content;
      const toolResultContent = Array.isArray(msgContent) ? msgContent.filter((i) => i?.type === "tool_result").map((i) => i.content || "").join("\n").slice(0, 300) : typeof obj.toolUseResult.stdout === "string" ? clip(obj.toolUseResult.stdout, 300) : "";
      const agentPrefix = obj.agentId ? `[subagent:${obj.agentId}] ` : "";
      return { time: ts, sessionId, model: context.model || "unknown", turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: `${obj.isSidechain ? "sidechain/" : ""}tool_result${obj.agentId ? ` agent=${obj.agentId}` : ""}`, sourceFile, sourceType: "claude", callType: "Tool_Result", rawType: "user", rawSubType: "tool_result", content: `${agentPrefix}${toolResultContent || "Tool executed"}`, summary: clip(`${agentPrefix}${toolResultContent || "Tool executed"}`) };
    }
    const content = typeof obj.message?.content === "string" ? obj.message.content : "";
    const agentPrefix = obj.agentId ? `[subagent:${obj.agentId}] ` : "";
    return { time: ts, sessionId, model: context.model || "unknown", turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: `${obj.isSidechain ? "sidechain/" : ""}user${obj.agentId ? ` agent=${obj.agentId}` : ""}`, sourceFile, sourceType: "claude", callType: "User", content: `${agentPrefix}${content}`, summary: clip(`${agentPrefix}${content}`) };
  }
  if (obj.type === "assistant") {
    const msg = obj.message || {};
    const content = msg.content || [];
    const toolCalls = extractToolCalls(content);
    const thinking = extractThinkingFromContent(content);
    const text = extractTextFromContent(content);
    const model = msg.model || context.model || "unknown";
    context.model = model;
    const agentPrefix = obj.agentId ? `[subagent:${obj.agentId}] ` : "";
    const agentTag = obj.agentId || "";

    if (toolCalls.length > 0) {
      const events = [];
      for (const tc of toolCalls) {
        const argsStr = typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input || "");
        events.push({ time: ts, sessionId, model, turnId: uuid, callId: tc.id, toolName: tc.name, cwd, sessionTitle: context.sessionTitle || "", extra: `${obj.isSidechain ? "sidechain/" : ""}tool_call${agentTag ? ` agent=${agentTag}` : ""}`, sourceFile, sourceType: "claude", callType: "Tool_Call", rawType: "assistant", rawSubType: "tool_use", content: `${agentPrefix}tool=${tc.name}\nargs=${clip(argsStr, 200)}`, summary: clip(`${agentPrefix}tool=${tc.name}`) });
      }
      if (text) {
        events.push({ time: ts, sessionId, model, turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: `${obj.isSidechain ? "sidechain/" : ""}assistant${agentTag ? ` agent=${agentTag}` : ""}`, sourceFile, sourceType: "claude", callType: "Agent", content: `${agentPrefix}${text}`, summary: clip(`${agentPrefix}${text}`) });
      }
      return events;
    }
    if (thinking && !text) {
      return { time: ts, sessionId, model, turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: `${obj.isSidechain ? "sidechain/" : ""}thinking${agentTag ? ` agent=${agentTag}` : ""}`, sourceFile, sourceType: "claude", callType: "Thinking", rawType: "assistant", rawSubType: "thinking", content: clip(thinking, 300), summary: clip(`[Thinking] ${thinking}`, 200) };
    }
    if (text) {
      return { time: ts, sessionId, model, turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: `${obj.isSidechain ? "sidechain/" : ""}assistant${agentTag ? ` agent=${agentTag}` : ""}`, sourceFile, sourceType: "claude", callType: "Agent", content: `${agentPrefix}${text}`, summary: clip(`${agentPrefix}${text}`) };
    }
    return { time: ts, sessionId, model, turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: `${obj.isSidechain ? "sidechain/" : ""}assistant-empty`, sourceFile, sourceType: "claude", callType: "Raw", rawType: "assistant", rawSubType: "empty", content: "(empty response)", summary: "(empty response)" };
  }
  return { time: ts, sessionId, model: context.model || "unknown", turnId: uuid, callId: "", toolName: "", cwd, sessionTitle: context.sessionTitle || "", extra: `type=${obj.type || "unknown"}`, sourceFile, sourceType: "claude", callType: "Raw", rawType: obj.type || "", rawSubType: "", content: summarizeRawObject(obj), summary: summarizeRawObject(obj) };
}

async function parseFile(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const parsed = [];
  const context = { model: "unknown", sessionId: "unknown", sourceFile: file.name, cwd: "", sessionTitle: "" };

  // Detect file type by name/path
  const isClaudeCode = /claude|\.claude/i.test(file.name) || /\/\.claude\//i.test(file.name);
  const parser = isClaudeCode ? parseClaudeCodeLineToEvent : parseCodexLineToEvent;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const evtOrArray = parser(obj, context);
      const events = Array.isArray(evtOrArray) ? evtOrArray : [evtOrArray].filter(Boolean);
      for (const evt of events) {
        if (evt) parsed.push(evt);
      }
    } catch {
      // Ignore invalid JSON lines.
    }
  }
  return dedupeEvents(parsed);
}

async function handleFiles(files) {
  if (!files.length) return;
  state.dataSource = "local";
  const all = [];
  for (const file of files) {
    const parsed = await parseFile(file);
    all.push(...parsed);
  }
  all.sort((a, b) => (a.time < b.time ? -1 : 1));
  state.events = dedupeEvents(all);
  state.filtered = [];
  state.sessions = [];
  state.meta = { models: [], types: [] };
  state.totalVisible = state.events.filter(isVisibleInCurrentMode).length;
  state.totalMatching = state.totalVisible;
  state.pageOffset = 0;
  state.hasMore = false;
  state.sessionScrollTop = 0;
  els.sessionList.scrollTop = 0;
  state.scrollTop = 0;
  els.rows.scrollTop = 0;
  refreshFiltersMeta();
  renderSessionGroups();
  applyFilters();
  closeModal();
}

function wireEvents() {
  els.fileInput.addEventListener("change", (e) => {
    handleFiles(Array.from(e.target.files || []));
  });

  els.searchInput.addEventListener("input", () => scheduleApplyFilters(120));
  els.modelSelect.addEventListener("change", applyFilters);
  els.typeSelect.addEventListener("change", applyFilters);
  if (els.platformSelect) els.platformSelect.addEventListener("change", applyFilters);
  els.sortOrder.addEventListener("change", applyFilters);
  // Time quick buttons handler
  document.querySelectorAll(".time-quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const quick = btn.dataset.timeQuick;
      const now = new Date();
      let start = null;
      let end = now;

      switch (quick) {
        case "1h":
          start = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case "today":
          start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
          break;
        case "week":
          const dayOfWeek = now.getDay();
          const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToMonday, 0, 0, 0);
          break;
        case "month":
          start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
          break;
        default:
          return;
      }

      // Format to datetime-local format: YYYY-MM-DDTHH:MM
      const formatDateTimeLocal = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        const hours = String(d.getHours()).padStart(2, "0");
        const minutes = String(d.getMinutes()).padStart(2, "0");
        return `${year}-${month}-${day}T${hours}:${minutes}`;
      };

      els.startTime.value = formatDateTimeLocal(start);
      els.endTime.value = formatDateTimeLocal(end);

      // Update active state
      document.querySelectorAll(".time-quick-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      applyFilters();
      setStatus(`时间范围已设置: ${quick === "1h" ? "最近1小时" : quick === "today" ? "今天" : quick === "week" ? "本周" : "本月"}`);
    });
  });

  // Clear active state when manually changing time inputs
  els.startTime.addEventListener("input", () => {
    document.querySelectorAll(".time-quick-btn").forEach((b) => b.classList.remove("active"));
    scheduleApplyFilters(220);
  });
  els.endTime.addEventListener("input", () => {
    document.querySelectorAll(".time-quick-btn").forEach((b) => b.classList.remove("active"));
    scheduleApplyFilters(220);
  });

  els.startTime.addEventListener("change", applyFilters);
  els.endTime.addEventListener("change", applyFilters);

  els.rows.addEventListener("click", (e) => {
    // Handle expand button click
    const expandBtn = e.target.closest(".log-expand-btn");
    if (expandBtn) {
      const logMain = expandBtn.previousElementSibling;
      if (!logMain) return;
      const isExpanded = logMain.classList.toggle("expanded");
      expandBtn.textContent = isExpanded ? "收起" : "展开";
      expandBtn.dataset.expand = isExpanded ? "false" : "true";
      return;
    }

    const item = e.target.closest(".log-item");
    if (!item || item.dataset.index == null) return;
    showDetail(Number(item.dataset.index));
  });

  els.rows.addEventListener("scroll", () => {
    state.scrollTop = els.rows.scrollTop;
    renderVirtualRows();
  });

  els.sessionList.addEventListener("scroll", () => {
    state.sessionScrollTop = els.sessionList.scrollTop;
    renderVirtualSessionGroups();
  });

  els.loadMoreBtn.addEventListener("click", async () => {
    if (!state.hasMore || !isServerMode()) return;
    try {
      await loadRealtimeEventsPage({ append: true });
      setStatus(`已加载更多，当前显示 ${state.filtered.length} / ${state.totalMatching}`);
    } catch (err) {
      setStatus(`加载更多失败: ${err.message}`);
    }
  });

  els.modalCloseBtn.addEventListener("click", closeModal);
  els.copyJsonBtn.addEventListener("click", () => {
    const item = state.filtered[state.selectedRowIndex];
    if (!item) return;
    const payload = {
      time_iso: item.time,
      time_shanghai: formatShanghaiTime(item.time),
      sessionId: item.sessionId,
      model: item.model,
      turnId: item.turnId,
      callId: item.callId,
      toolName: item.toolName,
      cwd: item.cwd,
      session_title: item.sessionTitle || "",
      token_usage: item.tokenUsage || null,
      raw_type: item.rawType || "",
      raw_sub_type: item.rawSubType || "",
      extra: item.extra,
      sourceFile: item.sourceFile,
      call_type: item.callType,
      content: item.content,
      raw: item.raw,
    };
    const json = JSON.stringify(payload, null, 2);
    navigator.clipboard
      .writeText(json)
      .then(() => setStatus("JSON 已复制到剪贴板"))
      .catch(() => setStatus("复制失败：浏览器未授权剪贴板"));
  });

  els.exportBtn.addEventListener("click", () => {
    const events = state.filtered;
    if (events.length === 0) {
      setStatus("无数据可导出");
      return;
    }
    const jsonl = events.map((e) => {
      const payload = {
        time_iso: e.time,
        time_shanghai: formatShanghaiTime(e.time),
        sessionId: e.sessionId,
        model: e.model,
        turnId: e.turnId,
        callId: e.callId,
        toolName: e.toolName,
        cwd: e.cwd,
        session_title: e.sessionTitle || "",
        token_usage: e.tokenUsage || null,
        raw_type: e.rawType || "",
        raw_sub_type: e.rawSubType || "",
        extra: e.extra,
        sourceFile: e.sourceFile,
        call_type: e.callType,
        content: e.content,
        raw: e.raw,
      };
      return JSON.stringify(payload);
    }).join("\n");

    const blob = new Blob([jsonl], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const sessionSuffix = state.selectedSessionId ? `_${shortId(state.selectedSessionId, 8)}` : "";
    a.download = `session-export_${timestamp}${sessionSuffix}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`已导出 ${events.length} 条事件`);
  });

  els.prevEventBtn.addEventListener("click", () => {
    if (state.selectedRowIndex > 0) {
      showDetail(state.selectedRowIndex - 1);
    }
  });

  els.nextEventBtn.addEventListener("click", () => {
    if (state.selectedRowIndex < state.filtered.length - 1) {
      showDetail(state.selectedRowIndex + 1);
    }
  });

  els.detailModal.addEventListener("click", (e) => {
    const closeTarget = e.target.closest("[data-close='1']");
    if (closeTarget) closeModal();
  });
  window.addEventListener("keydown", (e) => {
    // Close modals on Escape
    if (e.key === "Escape") {
      closeModal();
      closeSessionDetail();
      closeRenameModal();
      closeDeleteModal();
      closeHelpModal();
      return;
    }

    // Global shortcuts (only when not in an input field)
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") {
      return;
    }

    // '/' - Focus search
    if (e.key === "/" || (e.key === "f" && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      els.searchInput.focus();
      return;
    }

    // 'r' - Manual refresh
    if (e.key === "r" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      els.manualRefreshBtn.click();
      return;
    }

    // 'a' - Toggle auto refresh
    if (e.key === "a" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      els.autoRefreshBtn.click();
      return;
    }

    // 't' - Toggle theme
    if (e.key === "t" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      els.themeToggleBtn.click();
      return;
    }

    // 'm' - Toggle view mode
    if (e.key === "m" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      els.modeToggleBtn.click();
      return;
    }

    // Navigation in event stream
    if (state.activeTab === "stream" && state.filtered.length > 0) {
      // 'j' or ArrowDown - Next event
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        if (state.selectedRowIndex < state.filtered.length - 1) {
          state.selectedRowIndex += 1;
          renderRows();
          // Scroll into view if needed
          const rowHeight = rowHeightForDensity();
          const viewportHeight = els.rows.clientHeight;
          const scrollTop = els.rows.scrollTop;
          const targetTop = state.selectedRowIndex * rowHeight;
          if (targetTop < scrollTop || targetTop > scrollTop + viewportHeight - rowHeight) {
            els.rows.scrollTop = targetTop - rowHeight;
          }
        }
        return;
      }

      // 'k' or ArrowUp - Previous event
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        if (state.selectedRowIndex > 0) {
          state.selectedRowIndex -= 1;
          renderRows();
          const rowHeight = rowHeightForDensity();
          const viewportHeight = els.rows.clientHeight;
          const scrollTop = els.rows.scrollTop;
          const targetTop = state.selectedRowIndex * rowHeight;
          if (targetTop < scrollTop || targetTop > scrollTop + viewportHeight - rowHeight) {
            els.rows.scrollTop = targetTop - rowHeight;
          }
        }
        return;
      }

      // Enter - Open detail
      if (e.key === "Enter" && state.selectedRowIndex >= 0) {
        e.preventDefault();
        showDetail(state.selectedRowIndex);
        return;
      }

      // 'g' then 'g' - Go to top (first event)
      if (e.key === "g") {
        state._ggPending = true;
        setTimeout(() => { state._ggPending = false; }, 500);
        return;
      }
      if (e.key === "g" && state._ggPending) {
        e.preventDefault();
        state.selectedRowIndex = 0;
        state.scrollTop = 0;
        els.rows.scrollTop = 0;
        renderRows();
        state._ggPending = false;
        return;
      }

      // 'G' (Shift+g) - Go to bottom (last event)
      if (e.key === "G" || (e.key === "g" && e.shiftKey)) {
        e.preventDefault();
        state.selectedRowIndex = state.filtered.length - 1;
        const rowHeight = rowHeightForDensity();
        els.rows.scrollTop = state.selectedRowIndex * rowHeight;
        renderRows();
        return;
      }
    }
  });

  els.sessionList.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("button[data-copy-session-id]");
    if (copyBtn) {
      const sid = copyBtn.dataset.copySessionId || "";
      if (!sid) return;
      navigator.clipboard
        .writeText(sid)
        .then(() => setStatus(`已复制 Session ID: ${sid}`))
        .catch(() => setStatus("复制失败：浏览器未授权剪贴板"));
      return;
    }
    const btn = e.target.closest("[data-session-id]");
    if (!btn) return;
    state.selectedSessionId = btn.dataset.sessionId || "";
    state.selectedRowIndex = -1;
    renderSessionGroups();
    applyFilters();
  });

  els.sessionList.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".session-item[data-session-id]");
    if (!card) return;
    e.preventDefault();
    state.selectedSessionId = card.dataset.sessionId || "";
    state.selectedRowIndex = -1;
    renderSessionGroups();
    applyFilters();
  });

  els.allSessionsBtn.addEventListener("click", () => {
    state.selectedSessionId = "";
    state.selectedRowIndex = -1;
    renderSessionGroups();
    applyFilters();
  });

  els.resetFiltersBtn.addEventListener("click", () => {
    // Reset all filter conditions but keep the data
    state.selectedSessionId = "";
    state.selectedRowIndex = -1;
    state.quickFilter = "all";
    els.searchInput.value = "";
    els.startTime.value = "";
    els.endTime.value = "";
    els.sortOrder.value = "desc";
    // Reset select dropdowns to "全部"
    if (els.modelSelect.options.length > 0) els.modelSelect.value = "";
    if (els.typeSelect.options.length > 0) els.typeSelect.value = "";
    if (els.platformSelect && els.platformSelect.options.length > 0) els.platformSelect.value = "";
    renderQuickFilterUi();
    renderSessionGroups();
    applyFilters();
    setStatus("筛选条件已重置");
  });

  els.clearBtn.addEventListener("click", () => {
    state.events = [];
    state.filtered = [];
    state.sessions = [];
    state.meta = { models: [], types: [] };
    state.totalVisible = 0;
    state.totalMatching = 0;
    state.pageOffset = 0;
    state.hasMore = false;
    state.selectedSessionId = "";
    state.selectedRowIndex = -1;
    state.sessionGroups = [];
    state.sessionScrollTop = 0;
    state.sessionViewportHeight = 0;
    state.scrollTop = 0;
    state.viewportHeight = 0;
    state.quickFilter = "all";
    els.fileInput.value = "";
    els.searchInput.value = "";
    els.modelSelect.innerHTML = '<option value="">全部</option>';
    els.typeSelect.innerHTML = '<option value="">全部</option>';
    if (els.platformSelect) els.platformSelect.innerHTML = '<option value="">全部</option>';
    els.startTime.value = "";
    els.endTime.value = "";
    els.sortOrder.value = "desc";
    els.rows.innerHTML = "";
    els.sessionList.scrollTop = 0;
    els.rows.scrollTop = 0;
    closeModal();
    renderQuickFilterUi();
    renderSessionGroups();
    renderStats();
  });

  els.manualRefreshBtn.addEventListener("click", async () => {
    await refreshOnce("手动刷新");
  });

  els.autoRefreshBtn.addEventListener("click", async () => {
    if (state.autoRefreshEnabled) {
      stopAutoRefresh("自动刷新已停止");
      return;
    }
    await startAutoRefresh();
  });

  els.modeToggleBtn.addEventListener("click", () => {
    applyViewMode(state.viewMode === "raw" ? "observe" : "raw");
    state.selectedRowIndex = -1;
    state.scrollTop = 0;
    els.rows.scrollTop = 0;
    refreshFiltersMeta();
    renderSessionGroups();
    applyFilters();
  });

  els.themeToggleBtn.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  els.densityToggleBtn.addEventListener("click", () => {
    applyDensity(state.density === "compact" ? "cozy" : "compact");
    renderRows();
  });

  // Dashboard collapse toggle
  if (els.dashCollapseBtn) {
    els.dashCollapseBtn.addEventListener("click", () => {
      state.dashboardCollapsed = !state.dashboardCollapsed;
      els.stats.classList.toggle("collapsed", state.dashboardCollapsed);
      els.dashCollapseBtn.textContent = state.dashboardCollapsed ? "(+)" : "(−)";
      localStorage.setItem("observer_dash_collapsed", state.dashboardCollapsed ? "true" : "false");
      syncUrl();
    });
  }

  els.quickFilters.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-quick-filter]");
    if (!btn) return;
    state.quickFilter = btn.dataset.quickFilter || "all";
    state.selectedRowIndex = -1;
    renderQuickFilterUi();
    applyFilters();
  });

  els.tokenThresholdInput.addEventListener("input", () => {
    const raw = Number(els.tokenThresholdInput.value || 0);
    const normalized = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0;
    els.tokenThresholdInput.value = String(normalized);
    localStorage.setItem("observer_high_token_threshold", String(normalized));
    if (state.quickFilter === "high_token") {
      scheduleApplyFilters(80);
    }
  });

  // Help modal
  els.helpBtn.addEventListener("click", () => {
    els.helpModal.classList.remove("hidden");
    els.helpModal.setAttribute("aria-hidden", "false");
  });
  els.helpModalCloseBtn.addEventListener("click", closeHelpModal);
  els.helpModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-help]")) closeHelpModal();
  });

  // Back to session management button (delegated on document)
  document.addEventListener("click", (e) => {
    if (e.target.id === "backToSessionMgmt") {
      e.preventDefault();
      goBackToSessionMgmt();
    }
  });
}

function setAutoRefreshUi(enabled) {
  state.autoRefreshEnabled = enabled;
  els.autoRefreshBtn.classList.toggle("active", enabled);
  els.autoRefreshBtn.textContent = enabled ? "停止自动刷新" : "自动刷新(5s)";
  syncUrl();
}

function setStatus(message) {
  els.realtimeStatus.textContent = message;
}

async function loadRealtimeEvents() {
  return loadRealtimeEventsPage({ append: false });
}

async function loadRealtimeEventsPage({ append }) {
  state.dataSource = "server";
  const offset = append ? state.filtered.length : 0;
  const resp = await fetch(`/api/events?${buildRealtimeQuery(offset)}`, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const data = await resp.json();
  if (!Array.isArray(data.events)) {
    throw new Error("invalid payload");
  }
  const incoming = dedupeEvents(data.events);
  state.events = append ? [...state.events, ...incoming] : incoming;
  state.filtered = state.events;
  state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
  state.meta = data.meta || { models: [], types: [] };
  state.totalVisible = Number(data.totalVisible) || 0;
  state.totalMatching = Number(data.totalMatching) || state.filtered.length;
  state.pageOffset = Number(data.page?.offset) || 0;
  state.pageLimit = Number(data.page?.limit) || state.pageLimit;
  state.hasMore = Boolean(data.page?.hasMore);
  if (!append) {
    state.scrollTop = 0;
    els.rows.scrollTop = 0;
    state.sessionScrollTop = 0;
    els.sessionList.scrollTop = 0;
  }
  refreshFiltersMeta();
  renderSessionGroups();
  renderRows();
  return state.totalMatching;
}

async function refreshOnce(prefix) {
  try {
    const count = await loadRealtimeEventsPage({ append: false });
    const now = new Date().toLocaleTimeString();
    const mode = state.autoRefreshEnabled ? "自动刷新中" : prefix;
    setStatus(`${mode}成功，最近刷新: ${now}，匹配事件: ${count}`);
  } catch (err) {
    setStatus(`${prefix}失败: ${err.message}`);
  }
}

async function startAutoRefresh() {
  setAutoRefreshUi(true);
  await refreshOnce("自动刷新");

  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = setInterval(async () => {
    try {
      await refreshOnce("自动刷新");
    } catch (err) {
      setStatus(`自动刷新失败: ${err.message}`);
    }
  }, 5000);
}

function stopAutoRefresh(message) {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = null;
  setAutoRefreshUi(false);
  setStatus(message || "自动刷新未启用");
}

// --- Tab Switching ---
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  // Hide all views
  els.streamView.hidden = true;
  document.getElementById("sessionsWrapper").hidden = true;
  els.inlineConvPanel.hidden = true;
  els.streamFilters.hidden = true;
  document.getElementById("stats").hidden = true;
  document.getElementById("quickFilters").hidden = true;
  // Reset conv layout
  const wrapper = document.getElementById("sessionsWrapper");
  wrapper.classList.remove("with-conv");

  // Show the selected view
  if (tab === "stream") {
    els.streamView.hidden = false;
    els.streamFilters.hidden = false;
    document.getElementById("stats").hidden = false;
    document.getElementById("quickFilters").hidden = false;
  } else if (tab === "sessions") {
    document.getElementById("sessionsWrapper").hidden = false;
    loadSessionMgmtData();
  }
  syncUrl();
}

// --- Session Management ---
async function loadSessionMgmtData() {
  try {
    const resp = await fetch("/api/sessions", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    state.sessionMgmtData = await resp.json();
    renderSessionMgmtView();
  } catch (err) {
    els.sessionGroups.innerHTML = `<div class="empty">加载失败: ${err.message}</div>`;
  }
}

function filterSessionMgmtData() {
  if (!state.sessionMgmtData) return { groups: {} };
  const q = els.sessionMgmtSearch.value.trim().toLowerCase();
  const platform = els.sessionMgmtPlatform.value;
  const namedOnly = els.sessionMgmtNamedOnly.checked;

  const groups = {};
  for (const [cwd, sessions] of Object.entries(state.sessionMgmtData.groups || {})) {
    const filtered = sessions.filter((s) => {
      if (platform && s.sourceType !== platform) return false;
      if (namedOnly && !s.sessionTitle) return false;
      if (q) {
        const title = (s.sessionTitle || s.fallbackTitle || "").toLowerCase();
        const sid = (s.sessionId || "").toLowerCase();
        const cwdLower = cwd.toLowerCase();
        if (!title.includes(q) && !sid.includes(q) && !cwdLower.includes(q)) return false;
      }
      return true;
    });
    if (filtered.length > 0) groups[cwd] = filtered;
  }
  return { ...state.sessionMgmtData, groups };
}

function renderSessionMgmtView() {
  const data = filterSessionMgmtData();
  const entries = Object.entries(data.groups);

  if (entries.length === 0) {
    els.sessionGroups.innerHTML = '<div class="empty">无匹配会话</div>';
    return;
  }

  const html = entries.map(([cwd, sessions]) => {
    const cardsHtml = sessions.map((s) => sessionCardHtml(s, cwd)).join("");
    return `<section class="session-group">
      <header class="group-header">
        <span class="group-cwd-icon">📁</span>
        <span class="group-cwd has-tip" data-tip="${escapeHtml(cwd)}">${escapeHtml(shortPathN(cwd, 5))}</span>
        <span class="group-count">${sessions.length} 个会话</span>
      </header>
      <div class="group-sessions">${cardsHtml}</div>
    </section>`;
  }).join("");

  els.sessionGroups.innerHTML = html;
}

function sessionCardHtml(s) {
  const title = s.sessionTitle || s.fallbackTitle || "未命名会话";
  const tokenMeta = hasTokenUsageData(s.aggregateToken) ? `Tok ${fmtTokenHuman(s.aggregateToken.total)}` : "Tok -";
  const platform = s.sourceType || "unknown";
  const platformLabel = platform === "claude" ? "CC" : platform === "codex" ? "CX" : platform;
  const platformFullName = platform === "claude" ? "Claude Code" : platform === "codex" ? "Codex" : platform;
  const isSelected = state.selectedSessionIds.has(s.sessionId);
  const checkedClass = isSelected ? "checked" : "";
  const selectedClass = isSelected ? "selected" : "";

  return `<article class="session-card ${selectedClass}" data-session-id="${escapeHtml(s.sessionId)}">
    <div class="session-card-checkbox ${checkedClass}" data-checkbox-session-id="${escapeHtml(s.sessionId)}" role="checkbox" aria-checked="${isSelected}" tabindex="0"></div>
    <span class="card-platform"><span class="chip chip-platform chip-${escapeHtml(platform)}" title="${escapeHtml(platformFullName)}">${escapeHtml(platformLabel)}</span></span>
    <div class="card-info">
      <div class="card-title-row">
        <span class="card-title has-tip" data-tip="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="card-nav-hint" title="点击查看事件流">→</span>
      </div>
      <div class="card-meta">
        <span class="mono">${escapeHtml(shortId(s.sessionId, 16))}</span>
        <span>事件 ${s.count}</span>
        <span>${tokenMeta}</span>
        <span>最近 ${formatShanghaiTime(s.latest)}</span>
      </div>
    </div>
    <div class="card-actions">
      <button class="card-btn" data-action="copy-id" data-session-id="${escapeHtml(s.sessionId)}" title="复制 Session ID">复制</button>
      <button class="card-btn" data-action="view-conversation" data-session-id="${escapeHtml(s.sessionId)}">查看对话</button>
      <button class="card-btn" data-action="rename" data-session-id="${escapeHtml(s.sessionId)}" data-session-name="${escapeHtml(s.sessionTitle || "")}">重命名</button>
      <button class="card-btn btn-danger" data-action="delete" data-session-id="${escapeHtml(s.sessionId)}" data-session-name="${escapeHtml(title)}">删除</button>
    </div>
  </article>`;
}

function openSessionDetail(sessionId) {
  if (!state.sessionMgmtData) return;
  let found = null;
  for (const sessions of Object.values(state.sessionMgmtData.groups || {})) {
    found = sessions.find((s) => s.sessionId === sessionId);
    if (found) break;
  }
  if (!found) return;

  const tokenData = found.aggregateToken;
  const models = found.models || [];
  els.sessionDetailBody.innerHTML = `
    <div class="detail-field">
      <span class="detail-label">会话名称</span>
      <span class="detail-value">${escapeHtml(found.sessionTitle || found.fallbackTitle || "未命名")}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">Session ID</span>
      <span class="detail-value mono">${escapeHtml(found.sessionId)}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">平台</span>
      <span class="detail-value"><span class="chip chip-platform chip-${escapeHtml(found.sourceType)}">${escapeHtml(found.sourceType)}</span></span>
    </div>
    <div class="detail-field">
      <span class="detail-label">模型</span>
      <span class="detail-value mono">${models.length > 0 ? models.map((m) => escapeHtml(m)).join("<br>") : "-"}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">事件数</span>
      <span class="detail-value">${found.count}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">最近活跃</span>
      <span class="detail-value">${formatShanghaiTime(found.latest)}</span>
    </div>
    <div class="detail-field">
      <span class="detail-label">工作目录</span>
      <span class="detail-value mono has-tip" data-tip="${escapeHtml(found.cwd || "-")}">${escapeHtml(found.cwd || "-")}</span>
    </div>
    ${hasTokenUsageData(tokenData) ? `
    <div class="detail-field">
      <span class="detail-label">Token 使用</span>
      <span class="detail-value">
        Total: ${fmtNum(tokenData.total)}<br>
        In: ${fmtNum(tokenData.input)} · Out: ${fmtNum(tokenData.output)}<br>
        Cache: ${fmtNum(tokenData.cachedInput)} · Reason: ${fmtNum(tokenData.reasoningOutput)}
      </span>
    </div>` : ""}
    <div class="detail-field" style="grid-column: 1 / -1; margin-top: 8px;">
      <div style="display: flex; gap: 8px;">
        <button class="card-btn" data-action="view-events" data-session-id="${escapeHtml(found.sessionId)}" style="flex: 1; text-align: center;">查看事件流 →</button>
        <button class="card-btn" data-action="view-conversation" data-session-id="${escapeHtml(found.sessionId)}" style="flex: 1; text-align: center;">查看对话 →</button>
      </div>
    </div>
  `;
  els.sessionDetailModal.classList.remove("hidden");
  els.sessionDetailModal.setAttribute("aria-hidden", "false");
}

function closeSessionDetail() {
  els.sessionDetailModal.classList.add("hidden");
  els.sessionDetailModal.setAttribute("aria-hidden", "true");
}

// ==================== Inline Conversation Panel ====================

function copySessionId(sessionId) {
  navigator.clipboard.writeText(sessionId).then(() => {
    setStatus("已复制 Session ID");
  }).catch(() => {
    setStatus("复制失败，请手动复制");
  });
}

async function openInlineConversation(sessionId) {
  if (!state.sessionMgmtData) return;
  let found = null;
  for (const sessions of Object.values(state.sessionMgmtData.groups || {})) {
    found = sessions.find((s) => s.sessionId === sessionId);
    if (found) break;
  }
  if (!found) return;

  // Show dual layout: sessions on left, conversation on right
  const wrapper = document.getElementById("sessionsWrapper");
  wrapper.classList.add("with-conv");
  els.inlineConvPanel.hidden = false;

  state.inlineConvSessionId = sessionId;
  state.inlineConvSessionInfo = found;
  state.inlineConvEvents = [];
  state.inlineConvOffset = 0;
  state.inlineConvTotal = found.count;

  els.inlineConvTitle.textContent = found.sessionTitle || found.fallbackTitle || "未命名会话";
  els.inlineConvPlatform.textContent = found.sourceType;
  els.inlineConvPlatform.className = `chip chip-platform chip-${found.sourceType}`;
  els.inlineConvStats.textContent = `${found.count} 个事件`;
  els.inlineConvLoadStatus.textContent = `已加载 0 / 共 ${found.count}`;
  els.inlineConvBody.innerHTML = '<div class="conv-loading">加载中...</div>';

  await loadInlineConversationEvents(0, 100);
}

function closeInlineConversation() {
  els.inlineConvPanel.hidden = true;
  const wrapper = document.getElementById("sessionsWrapper");
  wrapper.classList.remove("with-conv");
  state.inlineConvSessionId = null;
  state.inlineConvEvents = [];
  state.inlineConvOffset = 0;
  inlineConvIsLoading = false;
}

async function loadInlineConversationEvents(offset, limit) {
  const sessionId = state.inlineConvSessionId;
  if (!sessionId) return;
  try {
    const params = new URLSearchParams({ sessionId, mode: "observe", order: "asc", offset: String(offset), limit: String(limit) });
    const resp = await fetch(`/api/events?${params}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    state.inlineConvEvents = state.inlineConvEvents.concat(data.events || []);
    state.inlineConvOffset = state.inlineConvEvents.length;
    state.inlineConvTotal = data.totalMatching || state.inlineConvSessionInfo?.count || state.inlineConvOffset;
    els.inlineConvLoadStatus.textContent = `已加载 ${state.inlineConvOffset} / 共 ${state.inlineConvTotal}`;
    renderInlineConversationMessages(offset === 0);
  } catch (err) {
    console.error("Failed to load inline conversation events:", err);
    els.inlineConvBody.innerHTML = `<div class="conv-empty">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

// Infinite scroll for inline conversation panel
let inlineConvIsLoading = false;
function setupInlineConvInfiniteScroll() {
  const body = els.inlineConvBody;
  if (!body) return;
  body.removeEventListener("scroll", handleInlineConvScroll);
  body.addEventListener("scroll", handleInlineConvScroll);
}

function handleInlineConvScroll() {
  const body = els.inlineConvBody;
  if (!body) return;
  const scrollTop = body.scrollTop;
  const scrollHeight = body.scrollHeight;
  const clientHeight = body.clientHeight;
  // Load more when within 300px of bottom
  if (scrollHeight - scrollTop - clientHeight < 300) {
    loadMoreInlineConversationEvents();
  }
}

async function loadMoreInlineConversationEvents() {
  if (inlineConvIsLoading) return;
  if (state.inlineConvOffset >= state.inlineConvTotal) return;
  inlineConvIsLoading = true;
  els.inlineConvLoadStatus.textContent = `加载中 ${state.inlineConvOffset} / ${state.inlineConvTotal}...`;
  await loadInlineConversationEvents(state.inlineConvOffset, 100);
  inlineConvIsLoading = false;
}

function renderInlineConversationMessages(isInitial) {
  const events = state.inlineConvEvents;
  if (events.length === 0) { els.inlineConvBody.innerHTML = '<div class="conv-empty">暂无对话记录</div>'; return; }

  const INTERNAL_CONTENT_MARKERS = ['[subagent:', '<command-name>', '<command-message>', '<command-args>', '<local-command-stdout>', '<system-reminder>', '<task-notification>', '<local-command-caveat>', '<environment_context>', 'Caveat:', 'This session is being continued from a previous', '[Request interrupted'];
  const CONTEXT_BLOCK_PATTERN = /<environment_context>[\s\S]*?<\/environment_context>/gi;
  function isInternalContent(content) { return content && typeof content === 'string' && INTERNAL_CONTENT_MARKERS.some(m => content.includes(m)); }
  function cleanContent(content) { return content && typeof content === 'string' ? content.replace(CONTEXT_BLOCK_PATTERN, '').trim() : content; }

  const conversationEvents = events.filter(e => {
    if (e.callType === "Token_Usage") return false;
    if (e.callType === "Raw" && isInternalContent(e.content)) return false;
    if ((e.callType === "User" || e.callType === "Prompt") && isInternalContent(e.content)) return false;
    if (e.callType === "Agent" && isInternalContent(e.content)) return false;
    return true;
  }).map(e => (e.callType === "User" || e.callType === "Prompt" || e.callType === "Agent") ? { ...e, content: cleanContent(e.content) } : e);

  const messagesHtml = conversationEvents.map((e, idx) => renderConvMessage(e, idx > 0 ? conversationEvents[idx - 1] : null)).join("");
  const hasMore = state.inlineConvOffset < state.inlineConvTotal;
  const loadingIndicatorHtml = hasMore ? `<div class="conv-loading-more" id="inlineConvLoadingMore">向下滚动加载更多...</div>` : `<div style="text-align:center;padding:12px;color:var(--ink-soft);font-size:var(--font-xs);">已全部加载</div>`;

  els.inlineConvBody.innerHTML = messagesHtml + loadingIndicatorHtml;
  setupInlineConvInfiniteScroll();
  if (isInitial) els.inlineConvBody.scrollTop = 0;
}

function renderConvMessage(event, prevEvent) {
  const callType = event.callType;
  const isGrouped = prevEvent && prevEvent.callType === callType &&
    (callType === "Agent" || callType === "User" || callType === "Prompt");

  // Determine message type and position
  let msgType = "agent";
  let avatar = "A";
  let avatarClass = "agent";

  if (callType === "User" || callType === "Prompt") {
    msgType = "user";
    avatar = "U";
    avatarClass = "user";
  } else if (callType === "Tool_Call" || callType === "Tool_Result") {
    msgType = "tool";
    avatar = "🔧";
    avatarClass = "tool";
  } else if (callType === "Thinking") {
    msgType = "thinking";
    avatar = "💭";
    avatarClass = "agent";
  } else if (callType === "Raw") {
    msgType = "agent";
    avatar = "R";
    avatarClass = "agent";
  }

  // Extract agent prefix if present (for subagent messages)
  let agentPrefix = "";
  let content = event.content || "";
  const agentMatch = content.match(/^\[agent=([^\]]+)\]/);
  if (agentMatch) {
    agentPrefix = agentMatch[1];
    content = content.slice(agentMatch[0].length).trim();
  }

  // Format timestamp
  const timeStr = formatShanghaiTime(event.time);

  // Build message HTML based on type
  if (msgType === "tool") {
    return renderToolMessage(event, prevEvent, timeStr);
  } else if (msgType === "thinking") {
    return renderThinkingMessage(event, content, timeStr);
  } else {
    return renderTextMessage(event, msgType, avatar, avatarClass, isGrouped, content, agentPrefix, timeStr);
  }
}

function renderTextMessage(event, msgType, avatar, avatarClass, isGrouped, content, agentPrefix, timeStr) {
  const groupedClass = isGrouped ? "grouped" : "";
  const avatarHtml = isGrouped ? "" : `<div class="conv-avatar ${avatarClass}">${avatar}</div>`;
  const contentId = `content-${event.callId || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Render content as markdown for agent messages
  let contentHtml;
  if (msgType === "agent") {
    contentHtml = renderMarkdown(content);
  } else {
    contentHtml = escapeHtml(content);
  }

  const prefixHtml = agentPrefix ? `<div class="conv-agent-prefix">[agent=${escapeHtml(agentPrefix)}]</div>` : "";

  return `
    <div class="conv-message ${msgType} ${groupedClass}">
      ${msgType === "user" ? "" : avatarHtml}
      <div class="conv-bubble">
        ${prefixHtml}
        <div class="conv-markdown" id="${contentId}">${contentHtml}</div>
        <div class="conv-footer-line">
          <button class="conv-copy-btn" onclick="copyConvContent('${contentId}')">复制</button>
          <span class="conv-time">${timeStr}</span>
        </div>
      </div>
      ${msgType === "user" ? avatarHtml : ""}
    </div>`;
}

function renderToolMessage(event, prevEvent, timeStr) {
  const toolName = event.toolName || "unknown";
  const callType = event.callType;
  const content = event.content || "";
  const config = getToolConfig(toolName);
  const category = config.category || "default";

  // Check if previous event is the input for this result
  const isResultForPrevInput = callType === "Tool_Result" && prevEvent && prevEvent.callType === "Tool_Call" && prevEvent.toolName === toolName;

  // Determine if this is input or result
  const isInput = callType === "Tool_Call";
  const isError = content && ALERT_PATTERN.test(content);

  // Tool class with category
  const errorClass = isError ? "error" : "";

  // Build tool content based on style
  let toolContentHtml = "";

  if (isInput) {
    toolContentHtml = renderToolInput(event, toolName, config);
  } else {
    // Result - check if we should hide it (hideOnSuccess pattern)
    if (config.hideResult && !isError) {
      return ""; // Don't render successful results for tools like Bash, Read, Edit
    }
    toolContentHtml = renderToolResult(event, toolName, config, isError);
  }

  // Don't render if empty
  if (!toolContentHtml) return "";

  // Simplified header - just tool name and time, no separate "input/result" label
  return `
    <div class="conv-message tool ${category} ${errorClass}">
      ${toolContentHtml}
      <div class="conv-tool-time">${timeStr}</div>
    </div>`;
}

function renderToolInput(event, toolName, config) {
  const style = config.inputStyle || "collapsible";
  const extra = event.extra || "";
  const category = config.category || "default";
  const content = event.content || "";

  // Parse input JSON - content has format "tool=name\nargs={json}"
  // Also check extra field for JSON args
  let inputObj = {};

  // Try to parse from content first
  const argsMatch = content.match(/args=(.+)$/m);
  if (argsMatch) {
    try {
      inputObj = JSON.parse(argsMatch[1]);
    } catch {
      // argsMatch[1] might be clipped or not full JSON
    }
  }

  // Also try to parse extra field (some events have JSON there)
  if (!inputObj || Object.keys(inputObj).length === 0) {
    try {
      inputObj = JSON.parse(extra);
    } catch {
      inputObj = {};
    }
  }

  // Terminal style for Bash (OneLineDisplay terminal pattern)
  if (style === "terminal") {
    const command = inputObj.command || content.replace(/^tool=Bash\nargs=/, "").replace(/^tool=\w+\n/, "") || extra || "";
    const description = inputObj.description || null;
    const contentId = `bash-${event.callId || Date.now()}`;

    return `
      <div class="conv-terminal-wrap" data-content-id="${contentId}">
        <div class="conv-terminal-icon">⌘</div>
        <div class="conv-terminal-pill">
          <code class="conv-terminal-code">${escapeHtml(command)}</code>
          <button class="conv-terminal-copy-btn" onclick="copyConvTerminal('${contentId}')">⧉</button>
        </div>
      </div>
      ${description ? `<div class="conv-terminal-desc">${escapeHtml(description)}</div>` : ""}`;
  }

  // One-line display (Read, Grep, Glob, Task, etc.)
  if (style === "one-line") {
    const getValue = config.getInputValue || ((i) => i);
    const getSecondary = config.getInputSecondary || null;
    const action = config.inputAction || "none";

    const value = getValue(inputObj) || extra || "";
    const secondary = getSecondary ? getSecondary(inputObj) : null;

    // File path style for Read
    if (action === "open-file") {
      const filename = value.split('/').pop() || value;
      return `
        <div class="conv-tool-one-line ${category} file-open">
          <span class="tool-label">${toolName}</span>
          <span class="tool-sep">/</span>
          <span class="tool-value" title="${escapeHtml(value)}">${escapeHtml(filename)}</span>
        </div>`;
    }

    return `
      <div class="conv-tool-one-line ${category}">
        <span class="tool-label">${toolName}</span>
        <span class="tool-sep">/</span>
        <span class="tool-value wrap">${escapeHtml(value)}</span>
        ${secondary ? `<span class="tool-secondary">${escapeHtml(secondary)}</span>` : ""}
      </div>`;
  }

  // Collapsible style (Edit, Write, Agent, etc.) - CollapsibleSection pattern
  if (style === "collapsible") {
    const getTitle = config.getInputTitle || (() => "Parameters");
    const title = getTitle(inputObj);
    const contentType = config.contentType || "text";

    // Diff display for Edit/Write
    if (contentType === "diff") {
      const oldContent = inputObj.old_string || "";
      const newContent = inputObj.new_string || inputObj.content || "";
      const filePath = inputObj.file_path || "";
      const badge = toolName === "Write" ? "New" : "Edit";
      const badgeColor = toolName === "Write" ? "new" : "edit";

      return `
        <details class="conv-collapsible">
          <summary>
            <span class="coll-arrow">▶</span>
            <span class="coll-tool-name">${toolName}</span>
            <span class="coll-sep">/</span>
            <span class="coll-title">${escapeHtml(title)}</span>
          </summary>
          <div class="conv-collapsible-content">
            <div class="conv-diff">
              <div class="conv-diff-header">
                <span class="conv-diff-badge ${badgeColor}">${badge}</span>
                <span>${escapeHtml(filePath)}</span>
              </div>
              ${oldContent ? `<div class="conv-diff-old">--- old\n${escapeHtml(oldContent)}</div>` : ""}
              <div class="conv-diff-new">+++ new\n${escapeHtml(newContent)}</div>
            </div>
          </div>
        </details>`;
    }

    // Markdown content for Agent prompts
    if (contentType === "markdown") {
      let content = "";
      if (inputObj.prompt) {
        content = inputObj.prompt;
      } else {
        content = typeof inputObj === 'string' ? inputObj : JSON.stringify(inputObj, null, 2);
      }

      return `
        <details class="conv-collapsible">
          <summary>
            <span class="coll-arrow">▶</span>
            <span class="coll-tool-name">${toolName}</span>
            <span class="coll-sep">/</span>
            <span class="coll-title">${escapeHtml(title)}</span>
          </summary>
          <div class="conv-collapsible-content">
            <div class="conv-markdown">${renderMarkdown(content)}</div>
          </div>
        </details>`;
    }

    // Default: show JSON
    return `
      <details class="conv-collapsible">
        <summary>
          <span class="coll-arrow">▶</span>
          <span class="coll-tool-name">${toolName}</span>
          <span class="coll-sep">/</span>
          <span class="coll-title-plain">${escapeHtml(title)}</span>
        </summary>
        <div class="conv-collapsible-content">
          <pre>${highlightJson(inputObj)}</pre>
        </div>
      </details>`;
  }

  // Fallback
  return `<div class="conv-tool-one-line ${category}"><span class="tool-value">${escapeHtml(extra)}</span></div>`;
}

function renderToolResult(event, toolName, config, isError) {
  const content = event.content || "";
  const style = config.resultStyle || "collapsible";
  const category = config.category || "default";

  // Check if we should hide result (hideOnSuccess pattern)
  if (config.hideResult && !isError) {
    return "";
  }

  // Error display
  if (isError) {
    return `
      <div class="conv-tool-error">
        <div class="conv-error-icon">✕</div>
        <div class="conv-error-content">${escapeHtml(content)}</div>
      </div>`;
  }

  // File list display (Grep/Glob results)
  if (style === "collapsible" && (toolName === "Grep" || toolName === "Glob")) {
    let filenames = [];
    try {
      // Try to parse tool result
      const parsed = JSON.parse(content);
      filenames = parsed.filenames || [];
    } catch {
      // Content might be a list format
      filenames = content.split('\n').filter(line => line.trim());
    }

    const getResultTitle = config.getResultTitle || (() => "Result");
    const title = getResultTitle({ filenames, numFiles: filenames.length });

    return `
      <details class="conv-collapsible">
        <summary>
          <span class="coll-arrow">▶</span>
          <span class="coll-title">${escapeHtml(title)}</span>
        </summary>
        <div class="conv-collapsible-content">
          <div class="conv-file-list">
            ${filenames.map(f => `<div class="conv-file-item">${escapeHtml(f)}</div>`).join("")}
          </div>
        </div>
      </details>`;
  }

  // Default collapsible result
  const truncatedContent = content.length > 2000 ? content.slice(0, 2000) + "..." : content;

  return `
    <details class="conv-collapsible">
      <summary>
        <span class="coll-arrow">▶</span>
        <span class="coll-title">Result</span>
      </summary>
      <div class="conv-collapsible-content">
        <pre>${escapeHtml(truncatedContent)}</pre>
      </div>
    </details>`;
}

// Global function for copy button
window.copyConvContent = function(contentId) {
  const el = document.getElementById(contentId);
  if (!el) return;
  const text = el.textContent || el.innerText;
  const success = copyToClipboard(text);
  if (success) {
    // Find the button and show copied state
    const btn = el.parentElement.querySelector(".conv-copy-btn");
    if (btn) {
      btn.textContent = "已复制";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "复制";
        btn.classList.remove("copied");
      }, 2000);
    }
  }
};

// Global function for terminal copy button
window.copyConvTerminal = function(contentId) {
  const wrap = document.querySelector(`[data-content-id="${contentId}"]`);
  if (!wrap) return;
  const code = wrap.querySelector(".conv-terminal-code");
  if (!code) return;
  const text = code.textContent || "";
  const success = copyToClipboard(text);
  if (success) {
    const btn = wrap.querySelector(".conv-terminal-copy-btn");
    if (btn) {
      btn.textContent = "✓";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "⧉";
        btn.classList.remove("copied");
      }, 2000);
    }
  }
};

function renderThinkingMessage(event, content, timeStr) {
  const contentId = `thinking-${event.callId || Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const truncatedContent = content.length > 500 ? content.slice(0, 500) + "..." : content;

  return `
    <div class="conv-message thinking">
      <div class="conv-avatar agent">💭</div>
      <div class="conv-bubble">
        <details class="conv-collapsible">
          <summary>思考过程</summary>
          <div class="conv-collapsible-content" id="${contentId}">${escapeHtml(truncatedContent)}</div>
        </details>
        <div class="conv-footer-line">
          <button class="conv-copy-btn" onclick="copyConvContent('${contentId}')">复制</button>
          <span class="conv-time">${timeStr}</span>
        </div>
      </div>
    </div>`;
}

function renderMarkdown(text) {
  if (!text) return "";
  try {
    // Use marked library if available
    if (typeof marked !== "undefined") {
      return marked.parse(text);
    }
  } catch (err) {
    console.error("Markdown parse error:", err);
  }
  // Fallback to escaped text
  return escapeHtml(text);
}

// Close inline conversation panel handler
function closeInlineConversationHandler() {
  closeInlineConversation();
}

// ==================== Rename Modal ====================

function openRenameModal(sessionId, currentName) {
  state.renameTargetSessionId = sessionId;
  els.renameInput.value = currentName || "";
  els.renameModal.classList.remove("hidden");
  els.renameModal.setAttribute("aria-hidden", "false");
  setTimeout(() => els.renameInput.focus(), 100);
}

function closeRenameModal() {
  els.renameModal.classList.add("hidden");
  els.renameModal.setAttribute("aria-hidden", "true");
  state.renameTargetSessionId = null;
}

async function confirmRename() {
  const sessionId = state.renameTargetSessionId;
  const newName = els.renameInput.value.trim();
  if (!sessionId || !newName) return;

  try {
    const resp = await fetch("/api/sessions/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, newName }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed");

    // Update session title in the data
    for (const sessions of Object.values(state.sessionMgmtData?.groups || {})) {
      const s = sessions.find((s) => s.sessionId === sessionId);
      if (s) {
        s.sessionTitle = newName;
        s.fallbackTitle = "";
      }
    }
    renderSessionMgmtView();
    closeRenameModal();
    setStatus(`已重命名会话: ${newName}`);
  } catch (err) {
    setStatus(`重命名失败: ${err.message}`);
  }
}

function openDeleteModal(sessionId, name) {
  state.deleteTargetSessionId = sessionId;
  els.deleteMessage.textContent = `确定要删除会话 "${name}" 吗？此操作不可撤销。`;
  els.deleteModal.classList.remove("hidden");
  els.deleteModal.setAttribute("aria-hidden", "false");
}

function closeDeleteModal() {
  els.deleteModal.classList.add("hidden");
  els.deleteModal.setAttribute("aria-hidden", "true");
  state.deleteTargetSessionId = null;
}

async function confirmDelete() {
  const sessionId = state.deleteTargetSessionId;
  if (!sessionId) return;

  try {
    const resp = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed");

    // Remove from local data
    for (const [cwd, sessions] of Object.entries(state.sessionMgmtData?.groups || {})) {
      const idx = sessions.findIndex((s) => s.sessionId === sessionId);
      if (idx !== -1) {
        sessions.splice(idx, 1);
        if (sessions.length === 0) delete state.sessionMgmtData.groups[cwd];
        break;
      }
    }
    renderSessionMgmtView();
    closeDeleteModal();
    setStatus(`已删除会话`);
  } catch (err) {
    setStatus(`删除失败: ${err.message}`);
  }
}

function navigateToSessionEvents(sessionId) {
  switchTab("stream");
  state.selectedSessionId = sessionId;
  state.fromSessionMgmt = true;
  state.lastViewedSessionId = sessionId; // Remember which session we came from
  applyFilters();
  renderSessionGroups();
  updateStreamHeadMeta();
}

function updateStreamHeadMeta() {
  const metaEl = document.getElementById("streamHeadMeta");
  if (!metaEl) return;
  if (state.fromSessionMgmt && state.selectedSessionId) {
    // Find session title for display
    let sessionTitle = state.selectedSessionId;
    if (state.sessionMgmtData) {
      for (const sessions of Object.values(state.sessionMgmtData.groups || {})) {
        const s = sessions.find((s) => s.sessionId === state.selectedSessionId);
        if (s) {
          sessionTitle = s.sessionTitle || s.fallbackTitle || state.selectedSessionId;
          break;
        }
      }
    }
    metaEl.innerHTML = `<span style="color: var(--ink);">当前: ${escapeHtml(sessionTitle.substring(0, 30))}${sessionTitle.length > 30 ? "..." : ""}</span> <a href="#" id="backToSessionMgmt" style="color: var(--accent); text-decoration: underline; cursor: pointer; margin-left: 12px;">← 返回会话管理</a>`;
  } else {
    metaEl.textContent = "类型标签 / 模型标签 / 会话标签 / 调用标签";
  }
}

function goBackToSessionMgmt() {
  const targetSessionId = state.lastViewedSessionId;
  state.selectedSessionId = "";
  state.fromSessionMgmt = false;
  switchTab("sessions");
  updateStreamHeadMeta();
  // Highlight and scroll to the target session card
  if (targetSessionId) {
    setTimeout(() => {
      highlightAndScrollToSessionCard(targetSessionId);
    }, 100);
  }
}

function highlightAndScrollToSessionCard(sessionId) {
  const card = document.querySelector(`.session-card[data-session-id="${sessionId}"]`);
  if (!card) return;
  // Remove any existing highlights
  document.querySelectorAll(".session-card.highlighted").forEach((c) => c.classList.remove("highlighted"));
  // Add highlight
  card.classList.add("highlighted");
  // Scroll into view
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  // Remove highlight after 3 seconds
  setTimeout(() => card.classList.remove("highlighted"), 3000);
}

// --- Wire session management events ---
function wireSessionMgmt() {
  // Tab switching
  els.tabBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (!btn) return;
    switchTab(btn.dataset.tab);
  });

  // Session mgmt filters
  els.sessionMgmtSearch.addEventListener("input", () => renderSessionMgmtView());
  els.sessionMgmtPlatform.addEventListener("change", () => renderSessionMgmtView());
  els.sessionMgmtNamedOnly.addEventListener("change", () => renderSessionMgmtView());
  els.sessionMgmtRefreshBtn.addEventListener("click", () => loadSessionMgmtData());

  // Batch actions
  els.selectAllCheckbox.addEventListener("change", toggleSelectAll);
  els.batchDeleteBtn.addEventListener("click", openBatchDeleteConfirm);
  els.batchExportBtn.addEventListener("click", openBatchExportConfirm);

  // Session card actions (delegated)
  els.sessionGroups.addEventListener("click", (e) => {
    // Checkbox click
    const checkbox = e.target.closest(".session-card-checkbox");
    if (checkbox) {
      e.stopPropagation();
      const sessionId = checkbox.dataset.checkboxSessionId;
      if (sessionId) toggleSessionSelection(sessionId);
      return;
    }

    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn) {
      e.stopPropagation();
      const action = actionBtn.dataset.action;
      const sessionId = actionBtn.dataset.sessionId;
      if (action === "copy-id") copySessionId(sessionId);
      else if (action === "view-conversation") openInlineConversation(sessionId);
      else if (action === "rename") openRenameModal(sessionId, actionBtn.dataset.sessionName);
      else if (action === "delete") openDeleteModal(sessionId, actionBtn.dataset.sessionName);
      else if (action === "view-events") navigateToSessionEvents(sessionId);
      return;
    }
    const card = e.target.closest(".session-card");
    if (card) navigateToSessionEvents(card.dataset.sessionId);
  });

  // Checkbox keyboard support
  els.sessionGroups.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      const checkbox = e.target.closest(".session-card-checkbox");
      if (checkbox) {
        e.preventDefault();
        const sessionId = checkbox.dataset.checkboxSessionId;
        if (sessionId) toggleSessionSelection(sessionId);
      }
    }
  });

  // Session detail modal
  els.sessionDetailCloseBtn.addEventListener("click", closeSessionDetail);
  els.sessionDetailModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-session-detail]")) closeSessionDetail();
    // Handle view-events button inside modal
    const viewEventsBtn = e.target.closest("[data-action='view-events']");
    if (viewEventsBtn) {
      closeSessionDetail();
      navigateToSessionEvents(viewEventsBtn.dataset.sessionId);
    }
    // Handle view-conversation button inside modal
    const viewConvBtn = e.target.closest("[data-action='view-conversation']");
    if (viewConvBtn) {
      closeSessionDetail();
      openInlineConversation(viewConvBtn.dataset.sessionId);
    }
  });

  // Inline conversation panel events
  els.inlineConvClose.addEventListener("click", closeInlineConversation);

  // Rename modal
  els.renameModalCloseBtn.addEventListener("click", closeRenameModal);
  els.renameModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-rename]")) closeRenameModal();
  });
  els.renameConfirmBtn.addEventListener("click", confirmRename);
  els.renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmRename();
    if (e.key === "Escape") closeRenameModal();
  });

  // Delete modal
  els.deleteModalCloseBtn.addEventListener("click", closeDeleteModal);
  els.deleteModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-delete]")) closeDeleteModal();
  });
  els.deleteConfirmBtn.addEventListener("click", confirmDelete);

  // Batch confirm modal
  els.batchConfirmCloseBtn.addEventListener("click", closeBatchConfirmModal);
  els.batchConfirmCancelBtn.addEventListener("click", closeBatchConfirmModal);
  els.batchConfirmModal.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-batch-confirm]")) closeBatchConfirmModal();
  });
  els.batchConfirmOkBtn.addEventListener("click", confirmBatchAction);
}

// --- Batch operations ---
function toggleSessionSelection(sessionId) {
  if (state.selectedSessionIds.has(sessionId)) {
    state.selectedSessionIds.delete(sessionId);
  } else {
    state.selectedSessionIds.add(sessionId);
  }
  updateBatchUi();
  renderSessionMgmtView();
}

function toggleSelectAll() {
  const data = filterSessionMgmtData();
  const allSessionIds = [];
  for (const sessions of Object.values(data.groups || {})) {
    for (const s of sessions) {
      allSessionIds.push(s.sessionId);
    }
  }

  const allSelected = allSessionIds.length > 0 && allSessionIds.every((id) => state.selectedSessionIds.has(id));

  if (allSelected) {
    state.selectedSessionIds.clear();
  } else {
    for (const id of allSessionIds) {
      state.selectedSessionIds.add(id);
    }
  }

  updateBatchUi();
  renderSessionMgmtView();
}

function updateBatchUi() {
  const count = state.selectedSessionIds.size;

  els.selectAllCheckbox.checked = count > 0 && isAllSelected();

  els.batchDeleteBtn.disabled = count === 0;
  els.batchDeleteBtn.textContent = `批量删除 (${count})`;

  els.batchExportBtn.disabled = count === 0;
  els.batchExportBtn.textContent = `批量导出 (${count})`;
}

function isAllSelected() {
  const data = filterSessionMgmtData();
  const allSessionIds = [];
  for (const sessions of Object.values(data.groups || {})) {
    for (const s of sessions) {
      allSessionIds.push(s.sessionId);
    }
  }
  return allSessionIds.length > 0 && allSessionIds.every((id) => state.selectedSessionIds.has(id));
}

function openBatchDeleteConfirm() {
  if (state.selectedSessionIds.size === 0) return;

  state.batchConfirmAction = "delete";

  const selectedList = [];
  for (const sessions of Object.values(state.sessionMgmtData?.groups || {})) {
    for (const s of sessions) {
      if (state.selectedSessionIds.has(s.sessionId)) {
        selectedList.push({
          sessionId: s.sessionId,
          title: s.sessionTitle || s.fallbackTitle || "未命名会话",
        });
      }
    }
  }

  els.batchConfirmTitle.textContent = "批量删除确认";
  els.batchConfirmMessage.textContent = `确定要删除 ${selectedList.length} 个会话吗？此操作不可撤销。`;
  els.batchConfirmList.innerHTML = selectedList
    .map(
      (s) =>
        `<div class="batch-confirm-item">
      <span>${escapeHtml(s.title)}</span>
      <span class="mono">${escapeHtml(shortId(s.sessionId, 8))}</span>
    </div>`
    )
    .join("");
  els.batchConfirmOkBtn.textContent = "确认删除";
  els.batchConfirmOkBtn.className = "btn-danger";

  els.batchConfirmModal.classList.remove("hidden");
  els.batchConfirmModal.setAttribute("aria-hidden", "false");
}

function openBatchExportConfirm() {
  if (state.selectedSessionIds.size === 0) return;

  state.batchConfirmAction = "export";

  const selectedList = [];
  for (const sessions of Object.values(state.sessionMgmtData?.groups || {})) {
    for (const s of sessions) {
      if (state.selectedSessionIds.has(s.sessionId)) {
        selectedList.push({
          sessionId: s.sessionId,
          title: s.sessionTitle || s.fallbackTitle || "未命名会话",
        });
      }
    }
  }

  els.batchConfirmTitle.textContent = "批量导出确认";
  els.batchConfirmMessage.textContent = `确定要导出 ${selectedList.length} 个会话的事件数据吗？`;
  els.batchConfirmList.innerHTML = selectedList
    .map(
      (s) =>
        `<div class="batch-confirm-item">
      <span>${escapeHtml(s.title)}</span>
      <span class="mono">${escapeHtml(shortId(s.sessionId, 8))}</span>
    </div>`
    )
    .join("");
  els.batchConfirmOkBtn.textContent = "确认导出";
  els.batchConfirmOkBtn.className = "";

  els.batchConfirmModal.classList.remove("hidden");
  els.batchConfirmModal.setAttribute("aria-hidden", "false");
}

function closeBatchConfirmModal() {
  els.batchConfirmModal.classList.add("hidden");
  els.batchConfirmModal.setAttribute("aria-hidden", "true");
  state.batchConfirmAction = null;
}

async function confirmBatchAction() {
  if (state.batchConfirmAction === "delete") {
    await executeBatchDelete();
  } else if (state.batchConfirmAction === "export") {
    await executeBatchExport();
  }
}

async function executeBatchDelete() {
  const sessionIds = [...state.selectedSessionIds];
  if (sessionIds.length === 0) return;

  try {
    const resp = await fetch("/api/sessions/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Failed");

    // Remove from local data
    for (const sessionId of sessionIds) {
      for (const [cwd, sessions] of Object.entries(state.sessionMgmtData?.groups || {})) {
        const idx = sessions.findIndex((s) => s.sessionId === sessionId);
        if (idx !== -1) {
          sessions.splice(idx, 1);
          if (sessions.length === 0) delete state.sessionMgmtData.groups[cwd];
          break;
        }
      }
    }

    state.selectedSessionIds.clear();
    updateBatchUi();
    renderSessionMgmtView();
    closeBatchConfirmModal();
    setStatus(`已删除 ${data.deleted} 个会话`);
  } catch (err) {
    setStatus(`批量删除失败: ${err.message}`);
  }
}

async function executeBatchExport() {
  const sessionIds = [...state.selectedSessionIds];
  if (sessionIds.length === 0) return;

  try {
    const exportData = [];
    for (const sessionId of sessionIds) {
      const resp = await fetch(`/api/events?sessionId=${sessionId}&limit=10000`);
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.events) {
        exportData.push(
          ...data.events.map((e) => ({
            sessionId: e.sessionId,
            time: e.time,
            callType: e.callType,
            model: e.model,
            content: e.content,
            tokenUsage: e.tokenUsage,
          }))
        );
      }
    }

    if (exportData.length === 0) {
      setStatus("无数据可导出");
      return;
    }

    const jsonl = exportData.map((e) => JSON.stringify(e)).join("\n");
    const blob = new Blob([jsonl], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.download = `batch-export-${timestamp}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    state.selectedSessionIds.clear();
    updateBatchUi();
    closeBatchConfirmModal();
    setStatus(`已导出 ${exportData.length} 条事件，来自 ${sessionIds.length} 个会话`);
  } catch (err) {
    setStatus(`批量导出失败: ${err.message}`);
  }
}

wireEvents();
wireSessionMgmt();
initAppearance();
decodeStateFromUrl();
// Apply URL-overridden state
if (state.viewMode) {
  applyViewMode(state.viewMode);
}
if (state.dashboardCollapsed) {
  els.stats?.classList.add("collapsed");
}
if (state.autoRefreshEnabled) {
  setAutoRefreshUi(true);
}
initResizeHandle();
renderQuickFilterUi();
renderSessionGroups();
renderStats();

// Apply URL-specified tab after initial render
if (state.activeTab && state.activeTab !== "stream") {
  switchTab(state.activeTab);
}

// 自动加载初始数据
setStatus("正在加载数据...");
refreshOnce("初始加载");

window.addEventListener("resize", () => {
  state.viewportHeight = els.rows.clientHeight || 0;
  state.sessionViewportHeight = els.sessionList.clientHeight || 0;
  renderVirtualSessionGroups();
  renderVirtualRows();
});
