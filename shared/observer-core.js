(function bootstrapObserverCore(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverCore() {
  "use strict";

  const ALERT_PATTERN = /(error|failed|exception|timeout|invalid|reject|denied|拒绝|失败|错误|异常)/i;
  const traceModelApi = (() => {
    try {
      if (typeof require === "function") return require("./trace-model");
    } catch {
      // Browser builds can use the global fallback below.
    }
    return typeof globalThis !== "undefined" ? globalThis.ObserverTraceModel : null;
  })();
  const tokenPricingApi = (() => {
    try {
      if (typeof require === "function") return require("./token-pricing");
    } catch {
      // Browser builds can use the global fallback below.
    }
    return typeof globalThis !== "undefined" ? globalThis.ObserverTokenPricing : null;
  })();

  function clip(text, max = 140) {
    const raw = String(text || "");
    const sample = raw.length > max * 6 ? raw.slice(0, max * 6) : raw;
    const s = sample.trim().replace(/\s+/g, " ");
    return s.length <= max ? s : `${s.slice(0, max)}...`;
  }

  function fmtNum(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString("zh-CN");
  }

  function fmtTokenHuman(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(n);
  }

  function finiteTokenOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function hasTokenUsageData(tokenUsage) {
    if (!tokenUsage) return false;
    return ["input", "output", "total", "cachedInput", "cacheReadInput", "cacheCreationInput", "reasoningOutput"].some((key) => {
      const value = tokenUsage[key];
      return value != null && Number.isFinite(Number(value));
    });
  }

  function addTokenUsage(base, next) {
    const out = base
      ? { ...base }
      : { input: 0, output: 0, total: 0, cachedInput: 0, cacheReadInput: 0, cacheCreationInput: 0, reasoningOutput: 0 };
    if (!hasTokenUsageData(next)) return out;
    for (const key of ["input", "output", "total", "cachedInput", "cacheReadInput", "cacheCreationInput", "reasoningOutput"]) {
      const value = next[key];
      if (value != null && Number.isFinite(Number(value))) out[key] += Number(value);
    }
    if (next.cacheReadInput == null && next.cacheCreationInput == null && next.cachedInput != null && Number.isFinite(Number(next.cachedInput))) {
      out.cacheReadInput += Number(next.cachedInput);
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

  function summarizeRawObject(obj) {
    const payload = obj?.payload;
    if (typeof payload?.message === "string" && payload.message.trim()) return clip(payload.message, 220);
    if (typeof payload?.name === "string" && payload.name.trim()) return clip(payload.name, 220);
    if (typeof payload?.status === "string" && payload.status.trim()) return clip(payload.status, 220);
    if (typeof payload?.phase === "string" && payload.phase.trim()) return clip(payload.phase, 220);
    const raw = JSON.stringify(payload ?? obj);
    return clip(raw || "", 220);
  }

  function parserContentLimit(context, fallback = 1000) {
    const value = Number(context?.contentLimit ?? context?.contentPreviewLength);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(16000, Math.max(120, Math.floor(value)));
  }

  function compactTextForContext(text, context, fallbackLimit = 1000) {
    const raw = String(text || "");
    if (!context?.compactContent) return raw;
    const limit = parserContentLimit(context, fallbackLimit);
    return raw.length > limit ? `${raw.slice(0, limit)}...` : raw;
  }

  function compactObjectSummary(value, max = 220) {
    if (value == null) return "";
    if (typeof value === "string") return clip(value, max);
    if (typeof value !== "object") return clip(String(value), max);
    if (Array.isArray(value)) return `[${value.length} items]`;
    const parts = [];
    for (const [key, entry] of Object.entries(value).slice(0, 12)) {
      if (typeof entry === "string") parts.push(`${key}: ${clip(entry, 80)}`);
      else if (entry == null) parts.push(`${key}: null`);
      else if (Array.isArray(entry)) parts.push(`${key}: [${entry.length} items]`);
      else if (typeof entry === "object") parts.push(`${key}: {${Object.keys(entry).slice(0, 6).join(", ")}}`);
      else parts.push(`${key}: ${String(entry)}`);
    }
    return clip(`{${parts.join(", ")}}`, max);
  }

  function summarizeRawObjectForContext(obj, context) {
    if (!context?.compactContent) return summarizeRawObject(obj);
    const payload = obj?.payload;
    if (typeof payload?.message === "string" && payload.message.trim()) return clip(payload.message, 220);
    if (typeof payload?.name === "string" && payload.name.trim()) return clip(payload.name, 220);
    if (typeof payload?.status === "string" && payload.status.trim()) return clip(payload.status, 220);
    if (typeof payload?.phase === "string" && payload.phase.trim()) return clip(payload.phase, 220);
    return compactObjectSummary(payload ?? obj, 220);
  }

  function rawForContext(obj, context) {
    return context?.compactContent ? undefined : obj;
  }

  function normalizeEventText(text) {
    return String(text || "").trim().replace(/\s+/g, " ");
  }

  function toTimeMs(value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function toPositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(n, max);
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

  function isDuplicateEvent(prev, next) {
    if (!prev || !next) return false;
    if (prev.sessionId !== next.sessionId) return false;
    if ((prev.turnId || "") !== (next.turnId || "")) return false;
    if (prev.callType !== next.callType) return false;
    if (normalizeEventText(prev.content) !== normalizeEventText(next.content)) return false;

    const prevMs = toTimeMs(prev.time);
    const nextMs = toTimeMs(next.time);
    if (prevMs != null && nextMs != null && Math.abs(prevMs - nextMs) > 5000) return false;
    return true;
  }

  function preferEvent(prev, next) {
    if (prev.callType === "Agent" && next.callType === "Agent") {
      return preferAgentEvent(prev, next);
    }
    const prevIsSidechain = (prev.extra || "").startsWith("sidechain/");
    const nextIsSidechain = (next.extra || "").startsWith("sidechain/");
    if (prevIsSidechain && !nextIsSidechain) return next;
    if (!prevIsSidechain && nextIsSidechain) return prev;
    return prev;
  }

  function dedupeEvents(events, options = {}) {
    const source = Array.isArray(events) ? events : [];
    const inPlace = options.inPlace === true;
    const out = inPlace ? source : [];
    let writeIndex = 0;
    for (const event of source) {
      const prev = out[writeIndex - 1];
      if (isDuplicateAgentEvent(prev, event)) {
        out[writeIndex - 1] = preferAgentEvent(prev, event);
        continue;
      }
      if (isDuplicateEvent(prev, event)) {
        out[writeIndex - 1] = preferEvent(prev, event);
        continue;
      }
      out[writeIndex] = event;
      writeIndex += 1;
    }
    if (inPlace) out.length = writeIndex;
    return out;
  }

  function isAlertEvent(event) {
    if (!event) return false;
    if (event.callType === "Tool_Result" || event.callType === "Tool_Call") {
      return ALERT_PATTERN.test(event.searchText || "") || ALERT_PATTERN.test(event.content || "") || ALERT_PATTERN.test(event.extra || "");
    }
    if (event.callType === "Agent") {
      return ALERT_PATTERN.test(event.searchText || "") || ALERT_PATTERN.test(event.content || "");
    }
    return false;
  }

  function eventMatchesMode(event, mode) {
    if (mode === "raw") return true;
    if (event.callType === "Raw") return false;
    if ((event.extra || "").startsWith("sidechain/")) return false;
    return true;
  }

  function isDialogueEvent(event) {
    const type = String(event?.callType || "").toLowerCase();
    return type === "prompt" || type === "user" || type === "agent";
  }

  function searchableDialogueText(event) {
    if (!isDialogueEvent(event)) return "";
    return [
      event.searchText,
      event.content,
      event.contentPreview,
      event.summary,
    ].map((value) => String(value || "")).join("\n");
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
    return searchableDialogueText(event).toLowerCase().includes(filters.query);
  }

  function deriveFallbackTitleFromEvent(event) {
    if (!event || (event.callType !== "Prompt" && event.callType !== "User")) return "";
    const content = String(event.content || "");
    let raw = (content.length > 512 ? content.slice(0, 512) : content).trim().replace(/\s+/g, " ");
    if (!raw) return "";
    raw = raw.replace(/<[^>]+>/g, "").trim();
    if (!raw) return "";
    if (raw.startsWith("<environment_context>")) return "";
    if (raw.startsWith("# AGENTS.md")) return "";
    if (raw.length < 2) return "";
    return clip(raw, 36);
  }

  function buildSessionGroups(events) {
    const groups = new Map();
    for (const event of events) {
      const group = groups.get(event.sessionId) || {
        sessionId: event.sessionId,
        sessionTitle: "",
        fallbackTitle: "",
        cwd: "",
        latestToken: null,
        aggregateToken: null,
        models: new Set(),
        count: 0,
        startedAt: "",
        latest: "",
        prompt: 0,
        agent: 0,
        tool: 0,
        toolCalls: 0,
        toolResults: 0,
        sourceType: event.sourceType || "unknown",
        sourceFiles: new Set(),
      };
      group.count += 1;
      if (event.time && (!group.startedAt || event.time < group.startedAt)) group.startedAt = event.time;
      group.latest = !group.latest || event.time > group.latest ? event.time : group.latest;
      if (event.sessionTitle) group.sessionTitle = event.sessionTitle;
      if (!group.fallbackTitle) group.fallbackTitle = deriveFallbackTitleFromEvent(event);
      if (event.cwd) group.cwd = event.cwd;
      if (event.model && event.model !== "unknown") group.models.add(event.model);
      if (event.sourceFile) group.sourceFiles.add(event.sourceFile);
      if (event.callType === "Token_Usage" && hasTokenUsageData(event.tokenUsage)) {
        group.latestToken = event.tokenUsage;
        group.aggregateToken = addTokenUsage(group.aggregateToken, event.tokenUsage);
      }
      if (event.callType === "Prompt" || event.callType === "User") group.prompt += 1;
      else if (event.callType === "Agent") group.agent += 1;
      else group.tool += 1;
      if (event.callType === "Tool_Call") group.toolCalls += 1;
      if (event.callType === "Tool_Result") group.toolResults += 1;
      groups.set(event.sessionId, group);
    }

    return [...groups.values()]
      .filter((group) => group.sessionId !== "unknown")
      .map((group) => {
        group.models = [...group.models].sort();
        group.sourceFiles = [...group.sourceFiles].sort();
        return group;
      })
      .sort((a, b) => (a.latest < b.latest ? 1 : -1));
  }

  function mergeSessionMetaRecords(base, incoming) {
    const left = base && typeof base === "object" ? base : {};
    const right = incoming && typeof incoming === "object" ? incoming : {};
    const leftUpdatedAtMs = Number.isFinite(Number(left.updatedAtMs)) ? Number(left.updatedAtMs) : 0;
    const rightUpdatedAtMs = Number.isFinite(Number(right.updatedAtMs)) ? Number(right.updatedAtMs) : 0;

    return {
      title:
        (typeof right.title === "string" && right.title.trim()) ||
        (typeof left.title === "string" && left.title.trim()) ||
        "",
      cwd:
        (typeof right.cwd === "string" && right.cwd.trim()) ||
        (typeof left.cwd === "string" && left.cwd.trim()) ||
        "",
      updatedAtMs: Math.max(leftUpdatedAtMs, rightUpdatedAtMs),
    };
  }

  function applyEventSessionMeta(event, meta, options = {}) {
    if (!event || !meta || typeof meta !== "object") return event;
    const title = typeof meta.title === "string" ? meta.title.trim() : "";
    const cwd = typeof meta.cwd === "string" ? meta.cwd.trim() : "";
    const titleStrategy = options.titleStrategy === "always" ? "always" : "missing-only";

    if (cwd && !event.cwd) event.cwd = cwd;
    if (title && (titleStrategy === "always" || !String(event.sessionTitle || "").trim())) {
      event.sessionTitle = title;
    }
    return event;
  }

  function applySessionTitleOverrides(groups, overrides, sourceType = "") {
    if (!Array.isArray(groups) || !groups.length || !overrides) return groups;
    for (const group of groups) {
      if (sourceType && group.sourceType !== sourceType) continue;
      const title = overrides instanceof Map ? overrides.get(group.sessionId) : overrides[group.sessionId];
      if (typeof title === "string" && title.trim()) {
        group.sessionTitle = title.trim();
      }
    }
    return groups;
  }

  function collectMeta(events) {
    const models = new Set();
    const types = new Set();
    const platforms = new Set();
    for (const event of events || []) {
      models.add(event?.model);
      types.add(event?.callType);
      platforms.add(event?.sourceType);
    }
    return {
      models: [...models].sort(),
      types: [...types].sort(),
      platforms: [...platforms].sort(),
    };
  }

  function getTimezoneOffsetMinutes(nowMs, explicitOffsetMinutes) {
    if (Number.isFinite(Number(explicitOffsetMinutes))) return Number(explicitOffsetMinutes);
    return -new Date(nowMs).getTimezoneOffset();
  }

  function getStartOfDayMs(nowMs, timezoneOffsetMinutes) {
    const shiftedMs = nowMs + timezoneOffsetMinutes * 60 * 1000;
    const shifted = new Date(shiftedMs);
    const startUtcMs = Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      0,
      0,
      0,
      0,
    );
    return startUtcMs - timezoneOffsetMinutes * 60 * 1000;
  }

  function getStartOfWeekMs(nowMs, timezoneOffsetMinutes) {
    const startOfDayMs = getStartOfDayMs(nowMs, timezoneOffsetMinutes);
    const shifted = new Date(startOfDayMs + timezoneOffsetMinutes * 60 * 1000);
    const weekday = shifted.getUTCDay();
    const diff = weekday === 0 ? 6 : weekday - 1;
    return startOfDayMs - diff * 24 * 60 * 60 * 1000;
  }

  function getStartOfHourMs(nowMs) {
    const date = new Date(nowMs);
    date.setUTCMinutes(0, 0, 0);
    return date.getTime();
  }

  function formatHourLabel(ms, timezoneOffsetMinutes) {
    const shifted = new Date(ms + timezoneOffsetMinutes * 60 * 1000);
    const hours = String(shifted.getUTCHours()).padStart(2, "0");
    return `${hours}:00`;
  }

  function formatDayLabel(ms, timezoneOffsetMinutes) {
    const shifted = new Date(ms + timezoneOffsetMinutes * 60 * 1000);
    const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
    const day = String(shifted.getUTCDate()).padStart(2, "0");
    return `${month}/${day}`;
  }

  function mapTotalsToSortedEntries(totals) {
    return [...totals.entries()]
      .map(([key, total]) => ({ key, total }))
      .sort((left, right) => {
        if (right.total !== left.total) return right.total - left.total;
        return String(left.key).localeCompare(String(right.key), "zh-CN");
      });
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

  function buildTokenUsageWindows(events, options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(nowMs, options.timezoneOffsetMinutes);
    const startOfDayMs = getStartOfDayMs(nowMs, timezoneOffsetMinutes);
    const startOfWeekMs = getStartOfWeekMs(nowMs, timezoneOffsetMinutes);
    const windows = {
      day: {
        total: 0,
        rawTotal: 0,
        input: 0,
        inputTotal: 0,
        output: 0,
        cachedInput: 0,
        cacheReadInput: 0,
        cacheCreationInput: 0,
        reasoningOutput: 0,
        platforms: new Map(),
      },
      week: {
        total: 0,
        rawTotal: 0,
        input: 0,
        inputTotal: 0,
        output: 0,
        cachedInput: 0,
        cacheReadInput: 0,
        cacheCreationInput: 0,
        reasoningOutput: 0,
        platforms: new Map(),
      },
    };

    function addUsageToWindow(window, tokenUsage, sourceType, countedTotal, platformKey) {
      window.total += countedTotal;
      window.rawTotal += Number.isFinite(Number(tokenUsage?.total)) ? Number(tokenUsage.total) : 0;
      window.input += Number.isFinite(Number(tokenUsage?.input)) ? Number(tokenUsage.input) : 0;
      window.inputTotal += tokenInputTotal(tokenUsage, sourceType);
      window.output += Number.isFinite(Number(tokenUsage?.output)) ? Number(tokenUsage.output) : 0;
      window.cachedInput += Number.isFinite(Number(tokenUsage?.cachedInput)) ? Number(tokenUsage.cachedInput) : 0;
      window.cacheReadInput += tokenCacheReadInput(tokenUsage);
      window.cacheCreationInput += tokenCacheCreationInput(tokenUsage);
      window.reasoningOutput += Number.isFinite(Number(tokenUsage?.reasoningOutput)) ? Number(tokenUsage.reasoningOutput) : 0;
      window.platforms.set(platformKey, (window.platforms.get(platformKey) || 0) + countedTotal);
    }

    for (const event of events || []) {
      const eventMs = toTimeMs(event?.time);
      if (eventMs == null) continue;
      const countedTotal = tokenCountedTotal(event?.tokenUsage, event?.sourceType);
      if (countedTotal <= 0) continue;
      const platformKey = event?.sourceType || "unknown";

      if (eventMs >= startOfWeekMs && eventMs <= nowMs) {
        addUsageToWindow(windows.week, event?.tokenUsage, event?.sourceType, countedTotal, platformKey);
      }

      if (eventMs >= startOfDayMs && eventMs <= nowMs) {
        addUsageToWindow(windows.day, event?.tokenUsage, event?.sourceType, countedTotal, platformKey);
      }
    }

    return {
      day: {
        total: windows.day.total,
        rawTotal: windows.day.rawTotal,
        input: windows.day.input,
        inputTotal: windows.day.inputTotal,
        output: windows.day.output,
        cachedInput: windows.day.cachedInput,
        cacheReadInput: windows.day.cacheReadInput,
        cacheCreationInput: windows.day.cacheCreationInput,
        reasoningOutput: windows.day.reasoningOutput,
        platforms: mapTotalsToSortedEntries(windows.day.platforms),
      },
      week: {
        total: windows.week.total,
        rawTotal: windows.week.rawTotal,
        input: windows.week.input,
        inputTotal: windows.week.inputTotal,
        output: windows.week.output,
        cachedInput: windows.week.cachedInput,
        cacheReadInput: windows.week.cacheReadInput,
        cacheCreationInput: windows.week.cacheCreationInput,
        reasoningOutput: windows.week.reasoningOutput,
        platforms: mapTotalsToSortedEntries(windows.week.platforms),
      },
    };
  }

  function sortedValueEntries(map, valueKey = "total") {
    return [...map.entries()]
      .map(([key, value]) => ({ key, [valueKey]: value }))
      .sort((left, right) => {
        if (right[valueKey] !== left[valueKey]) return right[valueKey] - left[valueKey];
        return String(left.key).localeCompare(String(right.key), "zh-CN");
      });
  }

  function sessionDisplayTitle(session) {
    return session?.sessionTitle?.trim() || session?.fallbackTitle?.trim() || "未命名会话";
  }

  function tokenCacheReadInput(tokenUsage) {
    const cacheReadInput = Number(tokenUsage?.cacheReadInput);
    if (Number.isFinite(cacheReadInput)) return cacheReadInput;
    const cachedInput = Number(tokenUsage?.cachedInput);
    return Number.isFinite(cachedInput) ? cachedInput : 0;
  }

  function tokenCacheCreationInput(tokenUsage) {
    const cacheCreationInput = Number(tokenUsage?.cacheCreationInput);
    return Number.isFinite(cacheCreationInput) ? cacheCreationInput : 0;
  }

  function tokenInputTotal(tokenUsage, sourceType) {
    if (!hasTokenUsageData(tokenUsage)) return 0;
    const input = Number(tokenUsage?.input);
    const countedInput = Number.isFinite(input) ? input : 0;
    if (sourceType === "claude" || sourceType === "codex") {
      return countedInput + tokenCacheReadInput(tokenUsage) + tokenCacheCreationInput(tokenUsage);
    }
    return countedInput;
  }

  function tokenCountedTotal(tokenUsage, sourceType) {
    if (!hasTokenUsageData(tokenUsage)) return 0;
    const total = Number(tokenUsage?.total);
    const countedTotal = Number.isFinite(total) ? total : 0;
    if (sourceType === "claude") {
      return countedTotal + tokenCacheReadInput(tokenUsage) + tokenCacheCreationInput(tokenUsage);
    }
    return countedTotal;
  }

  function addMapValue(map, key, amount) {
    const normalizedKey = key || "unknown";
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
  }

  const TOOL_CATEGORY_DEFINITIONS = [
    { key: "terminal", label: "终端执行", pattern: /(exec|bash|shell|terminal|command|write_stdin|run_command)/i },
    { key: "browser", label: "浏览器", pattern: /(browser|chrome|playwright|navigate|click|screenshot|evaluate_script|devtools|web__)/i },
    { key: "code", label: "代码修改", pattern: /(apply_patch|edit|write|create_file|replace|notebook)/i },
    { key: "search", label: "检索", pattern: /(search|grep|find|glob|ripgrep|query)/i },
    { key: "files", label: "文件读取", pattern: /(read|view|list|tree|stat|file)/i },
  ];

  function classifyToolName(name) {
    const value = String(name || "").trim();
    return TOOL_CATEGORY_DEFINITIONS.find((category) => category.pattern.test(value)) || {
      key: "other",
      label: "其他工具",
    };
  }

  function buildToolCategories(tools = []) {
    const categories = new Map();
    for (const tool of tools || []) {
      const calls = Number(tool?.calls) || 0;
      if (calls <= 0) continue;
      const category = classifyToolName(tool?.key);
      const current = categories.get(category.key) || { key: category.key, label: category.label, calls: 0, tools: 0 };
      current.calls += calls;
      current.tools += 1;
      categories.set(category.key, current);
    }
    return [...categories.values()].sort((left, right) => right.calls - left.calls || left.label.localeCompare(right.label, "zh-CN"));
  }

  function percentageChange(current, previous) {
    const currentValue = Number(current) || 0;
    const previousValue = Number(previous) || 0;
    if (previousValue <= 0) return currentValue > 0 ? null : 0;
    return ((currentValue - previousValue) / previousValue) * 100;
  }

  function medianValue(values) {
    const rows = (values || []).filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
    if (!rows.length) return 0;
    const middle = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
  }

  function usageRowTime(row) {
    return toTimeMs(row?.time);
  }

  function summarizeUsageWindow(rows, startMs, endMs) {
    const result = {
      activeDays: 0,
      sessions: 0,
      events: 0,
      prompts: 0,
      agentMessages: 0,
      interactions: 0,
      toolCalls: 0,
      tokens: 0,
      estimatedUsd: 0,
    };
    const sessionIds = new Set();
    let fallbackSessions = 0;
    let hasSessionIds = false;

    for (const row of rows || []) {
      const rowMs = usageRowTime(row);
      if (rowMs == null || rowMs < startMs || rowMs > endMs) continue;
      const events = Number(row?.events) || 0;
      const prompts = Number(row?.prompts) || 0;
      const agentMessages = Number(row?.agentMessages) || 0;
      const interactions = Number.isFinite(Number(row?.interactions))
        ? Number(row.interactions)
        : prompts + agentMessages;
      if (events > 0 || interactions > 0 || Number(row?.sessions) > 0) result.activeDays += 1;
      result.events += events;
      result.prompts += prompts;
      result.agentMessages += agentMessages;
      result.interactions += interactions;
      result.toolCalls += Number(row?.toolCalls) || 0;
      result.tokens += Number(row?.tokens) || 0;
      result.estimatedUsd += Number(row?.estimatedUsd) || 0;
      if (Array.isArray(row?.sessionIds)) {
        hasSessionIds = true;
        for (const sessionId of row.sessionIds) if (sessionId) sessionIds.add(sessionId);
      } else {
        fallbackSessions += Number(row?.sessions) || 0;
      }
    }
    result.sessions = hasSessionIds ? sessionIds.size : fallbackSessions;
    return result;
  }

  function buildUsageStatistics(input = {}, options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const now = new Date(nowMs);
    const dayStart = new Date(nowMs);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();
    const recent7StartMs = dayStartMs - 6 * 24 * 60 * 60 * 1000;
    const previous7StartMs = recent7StartMs - 7 * 24 * 60 * 60 * 1000;
    const recent30StartMs = dayStartMs - 29 * 24 * 60 * 60 * 1000;
    const monthStartMs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const currentHour = new Date(nowMs);
    currentHour.setMinutes(0, 0, 0);
    const fiveHourStartMs = currentHour.getTime() - 4 * 60 * 60 * 1000;
    const sessions = (input.sessions || []).filter((session) => session?.sessionId && session.sessionId !== "unknown");
    const daily = input.daily || [];
    const hourly = input.hourly || [];
    const sessionCount = sessions.length;
    const prompts = sessions.reduce((total, session) => total + (Number(session.prompt) || 0), 0);
    const agentMessages = sessions.reduce((total, session) => total + (Number(session.agent) || 0), 0);
    const toolCalls = sessions.reduce((total, session) => total + (Number(session.toolCalls) || 0), 0);
    const toolResults = sessions.reduce((total, session) => total + (Number(session.toolResults) || 0), 0);
    const durationRows = sessions
      .map((session) => {
        const startedAtMs = toTimeMs(session.startedAt);
        const latestMs = toTimeMs(session.latest);
        return startedAtMs != null && latestMs != null ? Math.max(0, latestMs - startedAtMs) : 0;
      })
      .filter((durationMs) => durationMs > 0);
    const longestSession = sessions
      .map((session) => {
        const startedAtMs = toTimeMs(session.startedAt);
        const latestMs = toTimeMs(session.latest);
        return {
          sessionId: session.sessionId,
          title: sessionDisplayTitle(session),
          sourceType: session.sourceType || "unknown",
          cwd: session.cwd || "unknown",
          durationMs: startedAtMs != null && latestMs != null ? Math.max(0, latestMs - startedAtMs) : 0,
          prompts: Number(session.prompt) || 0,
          toolCalls: Number(session.toolCalls) || 0,
          tokens: Number(session.tokens) || tokenCountedTotal(session.aggregateToken, session.sourceType),
        };
      })
      .sort((left, right) => right.durationMs - left.durationMs)[0] || null;
    const today = summarizeUsageWindow(daily, dayStartMs, nowMs);
    const recent7 = summarizeUsageWindow(daily, recent7StartMs, nowMs);
    const previous7 = summarizeUsageWindow(daily, previous7StartMs, recent7StartMs - 1);
    const recent30 = summarizeUsageWindow(daily, recent30StartMs, nowMs);
    const currentMonth = summarizeUsageWindow(daily, monthStartMs, nowMs);
    const recentFiveHours = summarizeUsageWindow(hourly, fiveHourStartMs, nowMs);
    const hourProfile = new Map();

    for (const row of hourly) {
      const rowMs = usageRowTime(row);
      if (rowMs == null) continue;
      const hour = new Date(rowMs).getHours();
      const profile = hourProfile.get(hour) || { hour, events: 0, interactions: 0, tokens: 0 };
      profile.events += Number(row.events) || 0;
      profile.interactions += Number(row.interactions) || 0;
      profile.tokens += Number(row.tokens) || 0;
      hourProfile.set(hour, profile);
    }
    const busiestHour = [...hourProfile.values()]
      .sort((left, right) => right.interactions - left.interactions || right.events - left.events || right.tokens - left.tokens)[0] || null;
    if (busiestHour) busiestHour.label = `${String(busiestHour.hour).padStart(2, "0")}:00`;

    const monthCost = currentMonth.estimatedUsd;
    const monthTokens = currentMonth.tokens;
    const dailyAverageCost = monthCost / Math.max(1, dayOfMonth);
    const dailyAverageTokens = monthTokens / Math.max(1, dayOfMonth);

    return {
      today,
      interactions: {
        prompts,
        agentMessages,
        toolCalls,
        toolResults,
        messages: prompts + agentMessages,
        repliesPerPrompt: agentMessages / Math.max(1, prompts),
        toolCallsPerPrompt: toolCalls / Math.max(1, prompts),
        tokensPerPrompt: (Number(input.totalTokens) || 0) / Math.max(1, prompts),
      },
      sessions: {
        total: sessionCount,
        measuredDurationSessions: durationRows.length,
        averageDurationMs: durationRows.reduce((total, value) => total + value, 0) / Math.max(1, durationRows.length),
        medianDurationMs: medianValue(durationRows),
        averagePrompts: prompts / Math.max(1, sessionCount),
        averageToolCalls: toolCalls / Math.max(1, sessionCount),
        averageEvents: (Number(input.totalEvents) || 0) / Math.max(1, sessionCount),
        longest: longestSession,
      },
      cadence: {
        activeDays7: recent7.activeDays,
        activeDays30: recent30.activeDays,
        recent7,
        previous7,
        sessionChangePercent: percentageChange(recent7.sessions, previous7.sessions),
        interactionChangePercent: percentageChange(recent7.interactions, previous7.interactions),
        tokenChangePercent: percentageChange(recent7.tokens, previous7.tokens),
        costChangePercent: percentageChange(recent7.estimatedUsd, previous7.estimatedUsd),
        busiestHour,
        recentFiveHours,
      },
      forecast: {
        monthCost,
        projectedMonthCost: dailyAverageCost * daysInMonth,
        dailyAverageCost,
        monthTokens,
        projectedMonthTokens: dailyAverageTokens * daysInMonth,
        dayOfMonth,
        daysInMonth,
      },
    };
  }

  function buildHourlyChart(events, options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(nowMs, options.timezoneOffsetMinutes);
    const currentHourMs = getStartOfHourMs(nowMs);
    const bucketCount = Number.isFinite(Number(options.hourlyBucketCount))
      ? Math.max(1, Math.min(72, Number(options.hourlyBucketCount)))
      : 24;
    const firstBucketMs = currentHourMs - (bucketCount - 1) * 60 * 60 * 1000;
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({
      time: new Date(firstBucketMs + index * 60 * 60 * 1000).toISOString(),
      label: formatHourLabel(firstBucketMs + index * 60 * 60 * 1000, timezoneOffsetMinutes),
      events: 0,
      alerts: 0,
      prompts: 0,
      agentMessages: 0,
      toolCalls: 0,
      tokens: 0,
      estimatedUsd: 0,
      knownTokenTotal: 0,
      sessionSet: new Set(),
      platformMap: new Map(),
    }));

    for (const event of events || []) {
      const eventMs = toTimeMs(event?.time);
      if (eventMs == null || eventMs < firstBucketMs || eventMs >= currentHourMs + 60 * 60 * 1000) continue;
      const bucketIndex = Math.floor((eventMs - firstBucketMs) / (60 * 60 * 1000));
      const bucket = buckets[bucketIndex];
      if (!bucket) continue;
      bucket.events += 1;
      if (isAlertEvent(event)) bucket.alerts += 1;
      if (event?.callType === "Prompt" || event?.callType === "User") bucket.prompts += 1;
      if (event?.callType === "Agent") bucket.agentMessages += 1;
      if (event?.callType === "Tool_Call") bucket.toolCalls += 1;
      if (event?.sessionId && event.sessionId !== "unknown") bucket.sessionSet.add(event.sessionId);
      const tokenTotal = tokenCountedTotal(event?.tokenUsage, event?.sourceType);
      if (tokenTotal <= 0) continue;
      bucket.tokens += tokenTotal;
      const estimate = tokenPricingApi?.estimateTokenCost
        ? tokenPricingApi.estimateTokenCost(event?.tokenUsage, event?.model, event?.sourceType === "codex" ? { speed: options.costSpeedTier } : {})
        : null;
      if (estimate?.known) {
        bucket.estimatedUsd += Number(estimate.estimatedUsd) || 0;
        bucket.knownTokenTotal += Number(estimate.knownTokenTotal) || 0;
      }
      addMapValue(bucket.platformMap, event?.sourceType, tokenTotal);
    }

    return buckets.map((bucket) => ({
      time: bucket.time,
      label: bucket.label,
      events: bucket.events,
      alerts: bucket.alerts,
      prompts: bucket.prompts,
      agentMessages: bucket.agentMessages,
      interactions: bucket.prompts + bucket.agentMessages,
      toolCalls: bucket.toolCalls,
      sessions: bucket.sessionSet.size,
      tokens: bucket.tokens,
      estimatedUsd: bucket.estimatedUsd,
      knownTokenTotal: bucket.knownTokenTotal,
      platforms: mapTotalsToSortedEntries(bucket.platformMap),
    }));
  }

  function buildDailyChart(events, options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(nowMs, options.timezoneOffsetMinutes);
    const currentDayMs = getStartOfDayMs(nowMs, timezoneOffsetMinutes);
    const bucketCount = Number.isFinite(Number(options.dailyBucketCount))
      ? Math.max(1, Math.min(90, Number(options.dailyBucketCount)))
      : 14;
    const firstBucketMs = currentDayMs - (bucketCount - 1) * 24 * 60 * 60 * 1000;
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({
      time: new Date(firstBucketMs + index * 24 * 60 * 60 * 1000).toISOString(),
      label: formatDayLabel(firstBucketMs + index * 24 * 60 * 60 * 1000, timezoneOffsetMinutes),
      events: 0,
      alerts: 0,
      prompts: 0,
      agentMessages: 0,
      toolCalls: 0,
      tokens: 0,
      estimatedUsd: 0,
      knownTokenTotal: 0,
      sessionSet: new Set(),
      platformMap: new Map(),
    }));

    for (const event of events || []) {
      const eventMs = toTimeMs(event?.time);
      if (eventMs == null || eventMs < firstBucketMs || eventMs >= currentDayMs + 24 * 60 * 60 * 1000) continue;
      const bucketIndex = Math.floor((eventMs - firstBucketMs) / (24 * 60 * 60 * 1000));
      const bucket = buckets[bucketIndex];
      if (!bucket) continue;
      bucket.events += 1;
      if (isAlertEvent(event)) bucket.alerts += 1;
      if (event?.callType === "Prompt" || event?.callType === "User") bucket.prompts += 1;
      if (event?.callType === "Agent") bucket.agentMessages += 1;
      if (event?.callType === "Tool_Call") bucket.toolCalls += 1;
      if (event?.sessionId && event.sessionId !== "unknown") bucket.sessionSet.add(event.sessionId);
      const tokenTotal = tokenCountedTotal(event?.tokenUsage, event?.sourceType);
      if (tokenTotal <= 0) continue;
      bucket.tokens += tokenTotal;
      const estimate = tokenPricingApi?.estimateTokenCost
        ? tokenPricingApi.estimateTokenCost(event?.tokenUsage, event?.model, event?.sourceType === "codex" ? { speed: options.costSpeedTier } : {})
        : null;
      if (estimate?.known) {
        bucket.estimatedUsd += Number(estimate.estimatedUsd) || 0;
        bucket.knownTokenTotal += Number(estimate.knownTokenTotal) || 0;
      }
      addMapValue(bucket.platformMap, event?.sourceType, tokenTotal);
    }

    return buckets.map((bucket) => ({
      time: bucket.time,
      label: bucket.label,
      events: bucket.events,
      alerts: bucket.alerts,
      prompts: bucket.prompts,
      agentMessages: bucket.agentMessages,
      interactions: bucket.prompts + bucket.agentMessages,
      toolCalls: bucket.toolCalls,
      sessions: bucket.sessionSet.size,
      tokens: bucket.tokens,
      estimatedUsd: bucket.estimatedUsd,
      knownTokenTotal: bucket.knownTokenTotal,
      platforms: mapTotalsToSortedEntries(bucket.platformMap),
    }));
  }

  function buildDailySessionHeatmap(events, options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(nowMs, options.timezoneOffsetMinutes);
    const currentDayMs = getStartOfDayMs(nowMs, timezoneOffsetMinutes);
    const bucketCount = Number.isFinite(Number(options.dailyBucketCount))
      ? Math.max(1, Math.min(90, Number(options.dailyBucketCount)))
      : 14;
    const firstBucketMs = currentDayMs - (bucketCount - 1) * 24 * 60 * 60 * 1000;
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({
      time: new Date(firstBucketMs + index * 24 * 60 * 60 * 1000).toISOString(),
      label: formatDayLabel(firstBucketMs + index * 24 * 60 * 60 * 1000, timezoneOffsetMinutes),
      events: 0,
      prompts: 0,
      agentMessages: 0,
      toolCalls: 0,
      tokens: 0,
      estimatedUsd: 0,
      knownTokenTotal: 0,
      sessionSet: new Set(),
      workspaceMap: new Map(),
    }));

    for (const event of events || []) {
      const eventMs = toTimeMs(event?.time);
      if (eventMs == null || eventMs < firstBucketMs || eventMs >= currentDayMs + 24 * 60 * 60 * 1000) continue;
      const bucketIndex = Math.floor((eventMs - firstBucketMs) / (24 * 60 * 60 * 1000));
      const bucket = buckets[bucketIndex];
      if (!bucket) continue;

      const sessionId = event?.sessionId && event.sessionId !== "unknown" ? event.sessionId : "";
      const cwd = event?.cwd || "unknown";
      const tokenTotal = tokenCountedTotal(event?.tokenUsage, event?.sourceType);
      const workspace = bucket.workspaceMap.get(cwd) || {
        cwd,
        events: 0,
        tokens: 0,
        sessionSet: new Set(),
      };

      bucket.events += 1;
      if (event?.callType === "Prompt" || event?.callType === "User") bucket.prompts += 1;
      if (event?.callType === "Agent") bucket.agentMessages += 1;
      if (event?.callType === "Tool_Call") bucket.toolCalls += 1;
      if (sessionId) {
        bucket.sessionSet.add(sessionId);
        workspace.sessionSet.add(sessionId);
      }
      if (tokenTotal > 0) {
        bucket.tokens += tokenTotal;
        workspace.tokens += tokenTotal;
        const estimate = tokenPricingApi?.estimateTokenCost
          ? tokenPricingApi.estimateTokenCost(event?.tokenUsage, event?.model, event?.sourceType === "codex" ? { speed: options.costSpeedTier } : {})
          : null;
        if (estimate?.known) {
          bucket.estimatedUsd += Number(estimate.estimatedUsd) || 0;
          bucket.knownTokenTotal += Number(estimate.knownTokenTotal) || 0;
        }
      }
      workspace.events += 1;
      bucket.workspaceMap.set(cwd, workspace);
    }

    return buckets.map((bucket) => {
      const topWorkspace = [...bucket.workspaceMap.values()]
        .map((workspace) => ({
          cwd: workspace.cwd,
          events: workspace.events,
          sessions: workspace.sessionSet.size,
          tokens: workspace.tokens,
        }))
        .sort((left, right) => {
          if (right.sessions !== left.sessions) return right.sessions - left.sessions;
          if (right.events !== left.events) return right.events - left.events;
          if (right.tokens !== left.tokens) return right.tokens - left.tokens;
          return String(left.cwd).localeCompare(String(right.cwd), "zh-CN");
        })[0] || null;

      return {
        time: bucket.time,
        label: bucket.label,
        sessions: bucket.sessionSet.size,
        events: bucket.events,
        prompts: bucket.prompts,
        agentMessages: bucket.agentMessages,
        interactions: bucket.prompts + bucket.agentMessages,
        toolCalls: bucket.toolCalls,
        tokens: bucket.tokens,
        estimatedUsd: bucket.estimatedUsd,
        knownTokenTotal: bucket.knownTokenTotal,
        topWorkspace,
      };
    });
  }

  function buildObservabilitySummary(events, options = {}) {
    const eventList = Array.isArray(events) ? events : [];
    const sessions = buildSessionGroups(eventList);
    let traceSummary = { traces: sessions.length, spans: eventList.length, llmSpans: 0, toolSpans: 0, tokenSpans: 0, thinkingSpans: 0, maxDepth: 0 };
    if (traceModelApi?.summarizeEvents) {
      traceSummary = traceModelApi.summarizeEvents(eventList);
    } else if (traceModelApi?.summarizeTraceModel) {
      traceSummary = traceModelApi.summarizeTraceModel(traceModelApi.buildTraceModel(eventList));
    }
    const costSummary = tokenPricingApi?.estimateCostSummary
      ? tokenPricingApi.estimateCostSummary(eventList, {
        resolveOptions: (event) => (event?.sourceType === "codex" ? { speed: options.costSpeedTier } : {}),
      })
      : { estimatedUsd: 0, knownTokenTotal: 0, currency: "USD", source: "unavailable", unknownModels: [], byModel: [] };
    const sessionById = new Map();
    for (const session of sessions) sessionById.set(session.sessionId, session);
    const platformTokens = new Map();
    const modelTokens = new Map();
    const workspaceTokens = new Map();
    const workspaceStats = new Map();
    const toolStats = new Map();
    const alertTypeCounts = new Map();
    const alertPlatformCounts = new Map();
    const sessionAlertCounts = new Map();
    const totals = {
      input: 0,
      inputTotal: 0,
      output: 0,
      total: 0,
      cachedInput: 0,
      cacheReadInput: 0,
      cacheCreationInput: 0,
      reasoningOutput: 0,
    };
    let effectiveTotal = 0;
    let firstEventAt = "";
    let lastEventAt = "";
    let alertEvents = 0;
    let highTokenEvents = 0;
    const alertRecent = [];
    const workspaceSessions = new Map();

    for (const event of eventList) {
      const time = event?.time || "";
      if (time && (!firstEventAt || time < firstEventAt)) firstEventAt = time;
      if (time && (!lastEventAt || time > lastEventAt)) lastEventAt = time;

      const cwd = event?.cwd || "unknown";
      const workspace = workspaceStats.get(cwd) || {
        cwd,
        events: 0,
        sessions: 0,
        tokens: 0,
        alerts: 0,
      };
      workspace.events += 1;
      workspaceStats.set(cwd, workspace);
      if (!workspaceSessions.has(cwd)) workspaceSessions.set(cwd, new Set());
      if (event?.sessionId && event.sessionId !== "unknown") workspaceSessions.get(cwd).add(event.sessionId);

      const alert = isAlertEvent(event);
      if (alert) {
        alertEvents += 1;
        workspace.alerts += 1;
        addMapValue(sessionAlertCounts, event?.sessionId, 1);
        addMapValue(alertTypeCounts, event?.callType, 1);
        addMapValue(alertPlatformCounts, event?.sourceType, 1);
        pushRecentByTime(alertRecent, {
          time,
          sessionId: event?.sessionId || "",
          sessionTitle: sessionDisplayTitle(sessionById.get(event?.sessionId)),
          sourceType: event?.sourceType || "unknown",
          callType: event?.callType || "Unknown",
          toolName: event?.toolName || "",
          model: event?.model || "unknown",
          cwd,
          summary: clip(event?.summary || event?.content || event?.contentPreview || "", 180),
          extra: event?.extra || "",
        }, 30);
      }

      if (event?.callType === "Tool_Call" || event?.callType === "Tool_Result") {
        const toolKey = event?.toolName || (event?.callType === "Tool_Result" ? "(tool result)" : "unknown");
        const tool = toolStats.get(toolKey) || { key: toolKey, calls: 0, results: 0, alerts: 0 };
        if (event.callType === "Tool_Call") tool.calls += 1;
        if (event.callType === "Tool_Result") tool.results += 1;
        if (alert) tool.alerts += 1;
        toolStats.set(toolKey, tool);
      }

      if (!hasTokenUsageData(event?.tokenUsage)) continue;
      const token = event.tokenUsage;
      const tokenTotal = tokenCountedTotal(token, event?.sourceType);
      if (tokenTotal >= Number(options.highTokenThreshold || 20000)) highTokenEvents += 1;
      effectiveTotal += tokenTotal;
      totals.input += Number.isFinite(Number(token.input)) ? Number(token.input) : 0;
      totals.inputTotal += tokenInputTotal(token, event?.sourceType);
      totals.output += Number.isFinite(Number(token.output)) ? Number(token.output) : 0;
      totals.total += Number.isFinite(Number(token.total)) ? Number(token.total) : 0;
      totals.cachedInput += Number.isFinite(Number(token.cachedInput)) ? Number(token.cachedInput) : 0;
      totals.cacheReadInput += tokenCacheReadInput(token);
      totals.cacheCreationInput += tokenCacheCreationInput(token);
      totals.reasoningOutput += Number.isFinite(Number(token.reasoningOutput)) ? Number(token.reasoningOutput) : 0;
      addMapValue(platformTokens, event?.sourceType, tokenTotal);
      addMapValue(modelTokens, event?.model, tokenTotal);
      addMapValue(workspaceTokens, cwd, tokenTotal);
      workspace.tokens += tokenTotal;
    }

    for (const [cwd, sessionSet] of workspaceSessions) {
      const workspace = workspaceStats.get(cwd);
      if (workspace) workspace.sessions = sessionSet.size;
    }

    const topSessions = sessions
      .map((session) => ({
        sessionId: session.sessionId,
        title: sessionDisplayTitle(session),
        sourceType: session.sourceType || "unknown",
        cwd: session.cwd || "unknown",
        latest: session.latest || "",
        events: session.count || 0,
        tokens: tokenCountedTotal(session.aggregateToken, session.sourceType),
        alerts: sessionAlertCounts.get(session.sessionId) || 0,
      }))
      .sort((left, right) => {
        if (right.tokens !== left.tokens) return right.tokens - left.tokens;
        return String(right.latest).localeCompare(String(left.latest));
      })
      .slice(0, 12);

    const meta = collectMeta(eventList);
    const tokenPlatformShare = sortedValueEntries(platformTokens);
    const tokenModelChart = sortedValueEntries(modelTokens).slice(0, 10);
    const workspaceChart = [...workspaceStats.values()]
      .sort((left, right) => {
        if (right.tokens !== left.tokens) return right.tokens - left.tokens;
        if (right.events !== left.events) return right.events - left.events;
        return String(left.cwd).localeCompare(String(right.cwd), "zh-CN");
      })
      .slice(0, 10);
    const alertTypeChart = sortedValueEntries(alertTypeCounts, "count");
    let totalToolCalls = 0;
    let totalToolResults = 0;
    const topTools = [...toolStats.values()];
    for (const item of topTools) {
      totalToolCalls += item.calls;
      totalToolResults += item.results;
    }
    topTools.sort((left, right) => {
      const rightTotal = right.calls + right.results;
      const leftTotal = left.calls + left.results;
      if (rightTotal !== leftTotal) return rightTotal - leftTotal;
      if (right.alerts !== left.alerts) return right.alerts - left.alerts;
      return String(left.key).localeCompare(String(right.key), "zh-CN");
    });
    const hourlyChart = buildHourlyChart(eventList, options);
    const dailyChart = buildDailyChart(eventList, options);
    const dailySessionChart = buildDailySessionHeatmap(eventList, options);
    const usageStats = buildUsageStatistics({
      sessions,
      daily: dailySessionChart,
      hourly: hourlyChart,
      totalTokens: effectiveTotal,
      totalEvents: eventList.length,
    }, options);

    return {
      health: {
        eventsTotal: eventList.length,
        sessionsTotal: sessions.length,
        platformCount: meta.platforms.length,
        modelCount: meta.models.length,
        firstEventAt,
        lastEventAt,
        alertEvents,
        highTokenEvents,
      },
      tokens: {
        ...totals,
        effectiveTotal,
        cost: costSummary,
        windows: buildTokenUsageWindows(eventList, options),
        byPlatform: tokenPlatformShare,
        byModel: tokenModelChart,
        byWorkspace: sortedValueEntries(workspaceTokens).map((item) => ({ cwd: item.key, total: item.total })),
        topSessions,
      },
      alerts: {
        total: alertEvents,
        byType: sortedValueEntries(alertTypeCounts, "count"),
        byPlatform: sortedValueEntries(alertPlatformCounts, "count"),
        recent: alertRecent,
      },
      tools: {
        totalCalls: totalToolCalls,
        totalResults: totalToolResults,
        topTools: topTools.slice(0, 20),
        categories: buildToolCategories(topTools),
      },
      workspaces: {
        total: workspaceStats.size,
        topWorkspaces: workspaceChart.slice(0, 20),
      },
      charts: {
        hourly: hourlyChart,
        daily: dailyChart,
        dailySessions: dailySessionChart,
        platformShare: tokenPlatformShare,
        modelTokens: tokenModelChart,
        workspaceTokens: workspaceChart,
        alertTypes: alertTypeChart,
      },
      traces: traceSummary,
      usageStats,
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
        content: summarizeRawObjectForContext(obj, context),
        summary: summarizeRawObjectForContext(obj, context),
        raw: rawForContext(obj, context),
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
        content: summarizeRawObjectForContext(obj, context),
        summary: summarizeRawObjectForContext(obj, context),
        raw: rawForContext(obj, context),
      };
    }

    if (obj.type === "response_item" && obj.payload?.type === "message") {
      const role = obj.payload.role;
      if (role === "user" || role === "assistant") {
        const content = compactTextForContext(parseContentFromMessage(obj.payload.content), context);
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
        content: compactTextForContext(obj.payload?.message || "", context),
        summary: clip(obj.payload?.message || ""),
      };
    }

    if (obj.type === "event_msg" && obj.payload?.type === "token_count") {
      const usage = obj.payload?.info?.last_token_usage || {};
      const inputTokens = finiteTokenOrNull(usage.input_tokens);
      const cacheReadTokens = finiteTokenOrNull(usage.cached_input_tokens);
      const nonCachedInput = inputTokens == null
        ? null
        : Math.max(0, inputTokens - (cacheReadTokens || 0));
      const content = [
        "Token usage",
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
          input: nonCachedInput,
          output: usage.output_tokens ?? null,
          total: usage.total_tokens ?? null,
          cachedInput: usage.cached_input_tokens ?? null,
          cacheReadInput: usage.cached_input_tokens ?? null,
          cacheCreationInput: 0,
          reasoningOutput: usage.reasoning_output_tokens ?? null,
        },
      };
    }

    if (obj.type === "response_item" && obj.payload?.type === "function_call") {
      const name = obj.payload?.name || "unknown_tool";
      const args = compactTextForContext(obj.payload?.arguments || "", context);
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
        content: `tool=${name}\nargs=${args}`,
        summary: clip(`tool=${name}\nargs=${args}`),
      };
    }

    if (obj.type === "response_item" && obj.payload?.type === "function_call_output") {
      const output = compactTextForContext(obj.payload?.output || "", context);
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
      content: summarizeRawObjectForContext(obj, context),
      summary: summarizeRawObjectForContext(obj, context),
      raw: rawForContext(obj, context),
    };
  }

  function parseClaudeCodeLineToEvent(obj, context) {
    const ts = obj.timestamp || "";
    const sessionId = obj.sessionId || context.sessionId || "unknown";
    const cwd = obj.cwd || context.cwd || "";
    const sourceFile = context.sourceFile || "unknown";
    const uuid = obj.uuid || "";

    if (obj.type === "custom-title" || obj.type === "agent-name") {
      const recordTitle = obj.type === "custom-title" ? obj.customTitle : obj.agentName;
      const title = typeof recordTitle === "string" ? recordTitle.trim() : "";
      if (obj.sessionId) context.sessionId = obj.sessionId;
      if (cwd) context.cwd = cwd;
      if (title && (obj.type === "custom-title" || !context.sessionTitle)) {
        context.sessionTitle = title;
      }
      return {
        time: ts,
        sessionId,
        model: context.model || "unknown",
        turnId: uuid,
        callId: "",
        toolName: "",
        cwd,
        sessionTitle: context.sessionTitle || "",
        extra: obj.type,
        sourceFile,
        sourceType: "claude",
        callType: "Raw",
        rawType: obj.type,
        rawSubType: "",
        content: title || summarizeRawObjectForContext(obj, context),
        summary: clip(title || summarizeRawObjectForContext(obj, context), 220),
        raw: rawForContext(obj, context),
      };
    }

    if (obj.type === "permission-mode") {
      return {
        time: ts,
        sessionId,
        model: context.model || "unknown",
        turnId: uuid,
        callId: "",
        toolName: "",
        cwd,
        sessionTitle: context.sessionTitle || "",
        extra: `mode=${obj.permissionMode || ""}`,
        sourceFile,
        sourceType: "claude",
        callType: "Raw",
        rawType: "permission-mode",
        rawSubType: "",
        content: `Permission mode: ${obj.permissionMode || "unknown"}`,
        summary: `Permission mode: ${obj.permissionMode || "unknown"}`,
      };
    }

    if (obj.type === "file-history-snapshot") {
      const snap = obj.snapshot || {};
      const files = snap.trackedFileBackups ? Object.keys(snap.trackedFileBackups) : [];
      const content = files.length ? `File snapshot: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ` (+${files.length - 5})` : ""}` : "File snapshot";
      return {
        time: ts,
        sessionId,
        model: context.model || "unknown",
        turnId: uuid,
        callId: "",
        toolName: "",
        cwd,
        sessionTitle: context.sessionTitle || "",
        extra: "file_history",
        sourceFile,
        sourceType: "claude",
        callType: "Raw",
        rawType: "file-history-snapshot",
        rawSubType: "",
        content,
        summary: clip(content),
      };
    }

    if (obj.type === "attachment") {
      const att = obj.attachment || {};
      const content = `Attachment: ${att.type || "unknown"}`;
      return {
        time: ts,
        sessionId,
        model: context.model || "unknown",
        turnId: uuid,
        callId: "",
        toolName: "",
        cwd,
        sessionTitle: context.sessionTitle || "",
        extra: att.type || "",
        sourceFile,
        sourceType: "claude",
        callType: "Raw",
        rawType: "attachment",
        rawSubType: "",
        content,
        summary: clip(content),
      };
    }

    if (obj.type === "user") {
      if (obj.isMeta) {
        const content = typeof obj.message?.content === "string" ? obj.message.content : "";
        const cleaned = content.replace(/<command-name>.*?<\/command-name>/g, "").trim();
        return {
          time: ts,
          sessionId,
          model: context.model || "unknown",
          turnId: uuid,
          callId: "",
          toolName: "",
          cwd,
          sessionTitle: context.sessionTitle || "",
          extra: obj.isSidechain ? "sidechain_meta" : "meta_command",
          sourceFile,
          sourceType: "claude",
          callType: "Raw",
          rawType: "user-meta",
          rawSubType: "",
        content: compactTextForContext(cleaned || "Meta command", context),
          summary: clip(cleaned || "Meta command"),
        };
      }

      if (obj.toolUseResult) {
        const msgContent = obj.message?.content;
        const toolResultContent = Array.isArray(msgContent)
          ? msgContent.filter((item) => item?.type === "tool_result").map((item) => item.content || "").join("\n").slice(0, 300)
          : typeof obj.toolUseResult.stdout === "string" ? clip(obj.toolUseResult.stdout, 300) : "";
        const toolName = obj.sourceToolAssistantUUID ? "(tool result)" : "";
        const agentPrefix = obj.agentId ? `[${obj.agentId}] ` : "";
        return {
          time: ts,
          sessionId,
          model: context.model || "unknown",
          turnId: uuid,
          callId: "",
          toolName,
          cwd,
          sessionTitle: context.sessionTitle || "",
          extra: `${obj.isSidechain ? "sidechain/" : ""}tool_result${obj.agentId ? ` agent=${obj.agentId}` : ""}`,
          sourceFile,
          sourceType: "claude",
          callType: "Tool_Result",
          rawType: "user",
          rawSubType: "tool_result",
          content: `${agentPrefix}${toolResultContent || "Tool executed"}`,
          summary: clip(`${agentPrefix}${toolResultContent || "Tool executed"}`),
        };
      }

      const content = compactTextForContext(typeof obj.message?.content === "string" ? obj.message.content : "", context);
      const agentPrefix = obj.agentId ? `[subagent:${obj.agentId}] ` : "";
      return {
        time: ts,
        sessionId,
        model: context.model || "unknown",
        turnId: uuid,
        callId: "",
        toolName: "",
        cwd,
        sessionTitle: context.sessionTitle || "",
        extra: `${obj.isSidechain ? "sidechain/" : ""}user${obj.agentId ? ` agent=${obj.agentId}` : ""}`,
        sourceFile,
        sourceType: "claude",
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

      context.model = model;

      const buildTokenUsageEvent = (usage) => {
        if (!usage) return null;
        const input = usage.input_tokens ?? null;
        const output = usage.output_tokens ?? null;
        const total = usage.input_tokens != null && usage.output_tokens != null
          ? usage.input_tokens + usage.output_tokens
          : null;
        const cacheReadInput = usage.cache_read_input_tokens ?? null;
        const cacheCreationInput = usage.cache_creation_input_tokens ?? null;
        const cachedInput = [cacheReadInput, cacheCreationInput].reduce((sum, value) => (
          value != null && Number.isFinite(Number(value)) ? sum + Number(value) : sum
        ), 0) || null;
        const reasoningOutput = null;
        if (input == null && output == null && cachedInput == null) return null;
        const contentText = `Token usage · In ${input ?? 0} · Out ${output ?? 0} · Total ${total ?? 0}` +
          (cachedInput ? ` · Cache ${cachedInput}` : "");
        return {
          time: ts,
          sessionId,
          model,
          turnId: uuid,
          callId: "",
          toolName: "",
          cwd,
          sessionTitle: context.sessionTitle || "",
          extra: "token_usage",
          sourceFile,
          sourceType: "claude",
          callType: "Token_Usage",
          content: contentText,
          summary: clip(contentText, 120),
          tokenUsage: {
            input,
            output,
            total,
            cachedInput,
            cacheReadInput,
            cacheCreationInput,
            reasoningOutput,
          },
        };
      };

      const tokenEvent = buildTokenUsageEvent(msg.usage);

      if (toolCalls.length > 0) {
        const events = [];
        for (const toolCall of toolCalls) {
          const argsStr = typeof toolCall.input === "string" ? toolCall.input : JSON.stringify(toolCall.input || "");
          const fullClipLimit = (toolCall.name === "Edit" || toolCall.name === "Write" || toolCall.name === "ApplyPatch") ? 16000 : 200;
          const clipLimit = context?.compactContent ? parserContentLimit(context, 1000) : fullClipLimit;
          events.push({
            time: ts,
            sessionId,
            model,
            turnId: uuid,
            callId: toolCall.id,
            toolName: toolCall.name,
            cwd,
            sessionTitle: context.sessionTitle || "",
            extra: `${obj.isSidechain ? "sidechain/" : ""}tool_call${agentTag ? ` agent=${agentTag}` : ""}`,
            sourceFile,
            sourceType: "claude",
            callType: "Tool_Call",
            rawType: "assistant",
            rawSubType: "tool_use",
            content: `${agentPrefix}tool=${toolCall.name}\nargs=${clip(argsStr, clipLimit)}`,
            summary: clip(`${agentPrefix}tool=${toolCall.name}`),
          });
        }
        if (text) {
          events.push({
            time: ts,
            sessionId,
            model,
            turnId: uuid,
            callId: "",
            toolName: "",
            cwd,
            sessionTitle: context.sessionTitle || "",
            extra: `${obj.isSidechain ? "sidechain/" : ""}assistant${agentTag ? ` agent=${agentTag}` : ""}`,
            sourceFile,
            sourceType: "claude",
            callType: "Agent",
            content: `${agentPrefix}${compactTextForContext(text, context)}`,
            summary: clip(`${agentPrefix}${text}`),
          });
        }
        if (tokenEvent) events.push(tokenEvent);
        return events;
      }

      if (thinking && !text) {
        const baseEvent = {
          time: ts,
          sessionId,
          model,
          turnId: uuid,
          callId: "",
          toolName: "",
          cwd,
          sessionTitle: context.sessionTitle || "",
          extra: `${obj.isSidechain ? "sidechain/" : ""}thinking${agentTag ? ` agent=${agentTag}` : ""}`,
          sourceFile,
          sourceType: "claude",
          callType: "Thinking",
          rawType: "assistant",
          rawSubType: "thinking",
          content: clip(thinking, 300),
          summary: clip(`[Thinking] ${thinking}`, 200),
        };
        if (tokenEvent) return [baseEvent, tokenEvent];
        return baseEvent;
      }

      if (text) {
        const baseEvent = {
          time: ts,
          sessionId,
          model,
          turnId: uuid,
          callId: "",
          toolName: "",
          cwd,
          sessionTitle: context.sessionTitle || "",
          extra: `${obj.isSidechain ? "sidechain/" : ""}assistant${agentTag ? ` agent=${agentTag}` : ""}`,
          sourceFile,
          sourceType: "claude",
          callType: "Agent",
          content: `${agentPrefix}${compactTextForContext(text, context)}`,
          summary: clip(`${agentPrefix}${text}`),
        };
        if (tokenEvent) return [baseEvent, tokenEvent];
        return baseEvent;
      }

      return {
        time: ts,
        sessionId,
        model,
        turnId: uuid,
        callId: "",
        toolName: "",
        cwd,
        sessionTitle: context.sessionTitle || "",
        extra: `${obj.isSidechain ? "sidechain/" : ""}assistant-empty`,
        sourceFile,
        sourceType: "claude",
        callType: "Raw",
        rawType: "assistant",
        rawSubType: "empty",
        content: "(empty response)",
        summary: "(empty response)",
      };
    }

    return {
      time: ts,
      sessionId,
      model: context.model || "unknown",
      turnId: uuid,
      callId: "",
      toolName: "",
      cwd,
      sessionTitle: context.sessionTitle || "",
      extra: `type=${obj.type || "unknown"}`,
      sourceFile,
      sourceType: "claude",
      callType: "Raw",
      rawType: obj.type || "",
      rawSubType: "",
      content: summarizeRawObjectForContext(obj, context),
      summary: summarizeRawObjectForContext(obj, context),
    };
  }

  return {
    applyEventSessionMeta,
    addTokenUsage,
    applySessionTitleOverrides,
    buildObservabilitySummary,
    buildToolCategories,
    buildTokenUsageWindows,
    buildUsageStatistics,
    buildSessionGroups,
    clip,
    collectMeta,
    dedupeEvents,
    eventMatchesFilters,
    eventMatchesMode,
    fmtNum,
    fmtTokenHuman,
    hasTokenUsageData,
    isAlertEvent,
    mergeSessionMetaRecords,
    parseClaudeCodeLineToEvent,
    parseCodexLineToEvent,
    tokenCacheCreationInput,
    tokenCacheReadInput,
    tokenCountedTotal,
    tokenInputTotal,
    toPositiveInt,
    toTimeMs,
  };
});
