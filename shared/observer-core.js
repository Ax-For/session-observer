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

  function clip(text, max = 140) {
    const s = (text || "").trim().replace(/\s+/g, " ");
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

  function dedupeEvents(events) {
    const out = [];
    for (const event of events) {
      const prev = out[out.length - 1];
      if (isDuplicateAgentEvent(prev, event)) {
        out[out.length - 1] = preferAgentEvent(prev, event);
        continue;
      }
      if (isDuplicateEvent(prev, event)) {
        out[out.length - 1] = preferEvent(prev, event);
        continue;
      }
      out.push(event);
    }
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
      event.searchText,
      event.content,
      event.contentPreview,
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

  function deriveFallbackTitleFromEvent(event) {
    if (!event || (event.callType !== "Prompt" && event.callType !== "User")) return "";
    let raw = (event.content || "").trim().replace(/\s+/g, " ");
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
        latest: "",
        prompt: 0,
        agent: 0,
        tool: 0,
        sourceType: event.sourceType || "unknown",
        sourceFiles: new Set(),
      };
      group.count += 1;
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
    return {
      models: [...new Set(events.map((event) => event.model))].sort(),
      types: [...new Set(events.map((event) => event.callType))].sort(),
      platforms: [...new Set(events.map((event) => event.sourceType))].sort(),
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

  function buildTokenUsageWindows(events, options = {}) {
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const timezoneOffsetMinutes = getTimezoneOffsetMinutes(nowMs, options.timezoneOffsetMinutes);
    const startOfDayMs = getStartOfDayMs(nowMs, timezoneOffsetMinutes);
    const startOfWeekMs = getStartOfWeekMs(nowMs, timezoneOffsetMinutes);
    const windows = {
      day: {
        total: 0,
        platforms: new Map(),
      },
      week: {
        total: 0,
        platforms: new Map(),
      },
    };

    for (const event of events || []) {
      const eventMs = toTimeMs(event?.time);
      if (eventMs == null) continue;
      const total = Number(event?.tokenUsage?.total);
      const cachedInput = Number(event?.tokenUsage?.cachedInput);
      const usageTotal = (Number.isFinite(total) ? total : 0) + (Number.isFinite(cachedInput) ? cachedInput : 0);
      const countedTotal = Number.isFinite(usageTotal) ? usageTotal : 0;
      if (countedTotal <= 0) continue;
      const platformKey = event?.sourceType || "unknown";

      if (eventMs >= startOfWeekMs && eventMs <= nowMs) {
        windows.week.total += countedTotal;
        windows.week.platforms.set(platformKey, (windows.week.platforms.get(platformKey) || 0) + countedTotal);
      }

      if (eventMs >= startOfDayMs && eventMs <= nowMs) {
        windows.day.total += countedTotal;
        windows.day.platforms.set(platformKey, (windows.day.platforms.get(platformKey) || 0) + countedTotal);
      }
    }

    return {
      day: {
        total: windows.day.total,
        platforms: mapTotalsToSortedEntries(windows.day.platforms),
      },
      week: {
        total: windows.week.total,
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

  function tokenEffectiveTotal(tokenUsage) {
    if (!hasTokenUsageData(tokenUsage)) return 0;
    const total = Number(tokenUsage?.total);
    const cachedInput = Number(tokenUsage?.cachedInput);
    return (Number.isFinite(total) ? total : 0) + (Number.isFinite(cachedInput) ? cachedInput : 0);
  }

  function addMapValue(map, key, amount) {
    const normalizedKey = key || "unknown";
    map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
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
      tokens: 0,
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
      const tokenTotal = tokenEffectiveTotal(event?.tokenUsage);
      if (tokenTotal <= 0) continue;
      bucket.tokens += tokenTotal;
      addMapValue(bucket.platformMap, event?.sourceType, tokenTotal);
    }

    return buckets.map((bucket) => ({
      time: bucket.time,
      label: bucket.label,
      events: bucket.events,
      alerts: bucket.alerts,
      tokens: bucket.tokens,
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
      tokens: 0,
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
      const tokenTotal = tokenEffectiveTotal(event?.tokenUsage);
      if (tokenTotal <= 0) continue;
      bucket.tokens += tokenTotal;
      addMapValue(bucket.platformMap, event?.sourceType, tokenTotal);
    }

    return buckets.map((bucket) => ({
      time: bucket.time,
      label: bucket.label,
      events: bucket.events,
      alerts: bucket.alerts,
      tokens: bucket.tokens,
      platforms: mapTotalsToSortedEntries(bucket.platformMap),
    }));
  }

  function buildObservabilitySummary(events, options = {}) {
    const eventList = Array.isArray(events) ? events : [];
    const sessions = buildSessionGroups(eventList);
    const sessionById = new Map(sessions.map((session) => [session.sessionId, session]));
    const platformTokens = new Map();
    const modelTokens = new Map();
    const workspaceTokens = new Map();
    const workspaceStats = new Map();
    const toolStats = new Map();
    const alertTypeCounts = new Map();
    const alertPlatformCounts = new Map();
    const totals = {
      input: 0,
      output: 0,
      total: 0,
      cachedInput: 0,
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
        addMapValue(alertTypeCounts, event?.callType, 1);
        addMapValue(alertPlatformCounts, event?.sourceType, 1);
        alertRecent.push({
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
        });
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
      const tokenTotal = tokenEffectiveTotal(token);
      if (tokenTotal >= Number(options.highTokenThreshold || 20000)) highTokenEvents += 1;
      effectiveTotal += tokenTotal;
      totals.input += Number.isFinite(Number(token.input)) ? Number(token.input) : 0;
      totals.output += Number.isFinite(Number(token.output)) ? Number(token.output) : 0;
      totals.total += Number.isFinite(Number(token.total)) ? Number(token.total) : 0;
      totals.cachedInput += Number.isFinite(Number(token.cachedInput)) ? Number(token.cachedInput) : 0;
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
        tokens: tokenEffectiveTotal(session.aggregateToken),
        alerts: eventList.filter((event) => event.sessionId === session.sessionId && isAlertEvent(event)).length,
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
        recent: alertRecent
          .sort((left, right) => String(right.time).localeCompare(String(left.time)))
          .slice(0, 30),
      },
      tools: {
        totalCalls: [...toolStats.values()].reduce((sum, item) => sum + item.calls, 0),
        totalResults: [...toolStats.values()].reduce((sum, item) => sum + item.results, 0),
        topTools: [...toolStats.values()]
          .sort((left, right) => {
            const rightTotal = right.calls + right.results;
            const leftTotal = left.calls + left.results;
            if (rightTotal !== leftTotal) return rightTotal - leftTotal;
            if (right.alerts !== left.alerts) return right.alerts - left.alerts;
            return String(left.key).localeCompare(String(right.key), "zh-CN");
          })
          .slice(0, 20),
      },
      workspaces: {
        total: workspaceStats.size,
        topWorkspaces: workspaceChart.slice(0, 20),
      },
      charts: {
        hourly: buildHourlyChart(eventList, options),
        daily: buildDailyChart(eventList, options),
        platformShare: tokenPlatformShare,
        modelTokens: tokenModelChart,
        workspaceTokens: workspaceChart,
        alertTypes: alertTypeChart,
      },
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
        content: obj.payload?.message || "",
        summary: clip(obj.payload?.message || ""),
      };
    }

    if (obj.type === "event_msg" && obj.payload?.type === "token_count") {
      const usage = obj.payload?.info?.last_token_usage || {};
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
        content: title || summarizeRawObject(obj),
        summary: clip(title || summarizeRawObject(obj), 220),
        raw: obj,
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
          content: cleaned || "Meta command",
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

      const content = typeof obj.message?.content === "string" ? obj.message.content : "";
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
            reasoningOutput,
          },
        };
      };

      const tokenEvent = buildTokenUsageEvent(msg.usage);

      if (toolCalls.length > 0) {
        const events = [];
        for (const toolCall of toolCalls) {
          const argsStr = typeof toolCall.input === "string" ? toolCall.input : JSON.stringify(toolCall.input || "");
          const clipLimit = (toolCall.name === "Edit" || toolCall.name === "Write" || toolCall.name === "ApplyPatch") ? 16000 : 200;
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
            content: `${agentPrefix}${text}`,
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
          content: `${agentPrefix}${text}`,
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
      content: summarizeRawObject(obj),
      summary: summarizeRawObject(obj),
    };
  }

  return {
    applyEventSessionMeta,
    addTokenUsage,
    applySessionTitleOverrides,
    buildObservabilitySummary,
    buildTokenUsageWindows,
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
    toPositiveInt,
    toTimeMs,
  };
});
