import ObserverCore from "../../shared/observer-core.js";

/**
 * @typedef {Object} SessionGroup
 * @property {string} sessionId
 * @property {string} sessionTitle
 * @property {string} fallbackTitle
 * @property {string} cwd
 * @property {string} sourceType
 * @property {string} latest
 * @property {number} count
 * @property {Object} [aggregateToken]
 * @property {string[]} models
 * @property {string[]} sourceFiles
 */

const PLATFORM_LABELS = {
  codex: "Codex",
  claude: "Claude Code",
};

const {
  buildSessionGroups,
  buildTokenUsageWindows,
  collectMeta,
  eventMatchesFilters,
  toTimeMs,
} = ObserverCore;

const QUICK_FILTER_LABELS = {
  all: "全部事件",
  alert: "告警视图",
  high_token: "高 Token",
};

const DEFAULT_ACTIVE_SESSION_WINDOW_MS = 30 * 60 * 1000;
const DEFAULT_ACTIVE_SESSION_LIMIT = 6;

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function compareKeyValuePairs(left, right) {
  if (right.value !== left.value) return right.value - left.value;
  return String(left.key).localeCompare(String(right.key), "zh-CN");
}

function toOptionalPositiveNumber(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function flattenSessions(groupsOrSessions) {
  if (Array.isArray(groupsOrSessions)) return groupsOrSessions;
  if (!groupsOrSessions || typeof groupsOrSessions !== "object") return [];
  return Object.values(groupsOrSessions).flat();
}

function mergeSessionTokenAggregates(sessions, aggregateSessions) {
  const aggregateBySessionId = new Map(
    (aggregateSessions || []).map((session) => [session.sessionId, session]),
  );

  return (sessions || []).map((session) => {
    const aggregate = aggregateBySessionId.get(session.sessionId);
    if (!aggregate) return session;

    return {
      ...session,
      sessionTitle: session.sessionTitle || aggregate.sessionTitle,
      fallbackTitle: session.fallbackTitle || aggregate.fallbackTitle,
      cwd: session.cwd || aggregate.cwd,
      sourceType: session.sourceType || aggregate.sourceType,
      models: mergeUniqueValues(session.models, aggregate.models),
      latestToken: aggregate.latestToken || session.latestToken,
      aggregateToken: aggregate.aggregateToken || session.aggregateToken,
    };
  });
}

function mergeUniqueValues(left, right) {
  return [...new Set([...(left || []), ...(right || [])])].filter(Boolean).sort();
}

function sessionHasTokenData(session) {
  return Boolean(session?.hasTokenData || session?.aggregateToken || session?.latestToken);
}

function normalizeSessionForWorkspace(session) {
  return {
    ...session,
    title: session?.sessionTitle?.trim() || session?.fallbackTitle?.trim() || "未命名会话",
    totalTokens: toFiniteNumber(session?.aggregateToken?.total),
    hasTokenData: sessionHasTokenData(session),
    sourceFiles: mergeUniqueValues(session?.sourceFiles, session?.sourceFile ? [session.sourceFile] : []),
  };
}

function matchesSessionBaseFilters(session, filters = {}) {
  const query = String(filters.query || "").trim().toLowerCase();
  const platform = filters.platform || "";
  const namedOnly = Boolean(filters.namedOnly);

  if (platform && session?.sourceType !== platform) return false;
  if (namedOnly && !String(session?.sessionTitle || "").trim()) return false;

  if (!query) return true;
  const haystack = [
    session?.sessionTitle,
    session?.fallbackTitle,
    session?.cwd,
    session?.sessionId,
    ...(session?.sourceFiles || []),
    ...(session?.models || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function matchesSessionContentFilters(session, filters = {}) {
  const tokenMin = toOptionalPositiveNumber(filters.tokenMin);
  const tokenMax = toOptionalPositiveNumber(filters.tokenMax);
  const maxEvents = toOptionalPositiveNumber(filters.maxEvents);
  const totalTokens = toFiniteNumber(session?.totalTokens);

  if (tokenMin != null && totalTokens < tokenMin) return false;
  if (tokenMax != null && totalTokens > tokenMax) return false;
  if (maxEvents != null && toFiniteNumber(session?.count) > maxEvents) return false;
  return true;
}

/**
 * Group sessions by working directory.
 * @param {SessionGroup[]} sessions
 * @returns {Object.<string, SessionGroup[]>}
 */
export function groupSessionsByCwd(sessions) {
  return (sessions || []).reduce((groups, session) => {
    const key = session.cwd || "未分类";
    if (!groups[key]) groups[key] = [];
    groups[key].push(session);
    return groups;
  }, {});
}

export function buildLocalSessionGroups(events) {
  return groupSessionsByCwd(buildSessionGroups(events || []));
}

export function buildLocalStreamPayload({
  events,
  filters,
  selectedSessionId,
  quickFilter,
  tokenThreshold,
  mode,
}) {
  const query = String(filters?.query || "").trim().toLowerCase();
  const baseFilters = {
    mode,
    platform: filters?.platform,
    model: filters?.model,
    type: filters?.type,
    quickFilter,
    tokenThreshold,
    query,
    sessionId: "",
    startMs: filters?.start ? toTimeMs(filters.start) : null,
    endMs: filters?.end ? toTimeMs(filters.end) : null,
  };

  const sessionEvents = (events || []).filter((event) => eventMatchesFilters(event, baseFilters));
  const aggregateEvents = (events || []).filter((event) => eventMatchesFilters(event, {
    ...baseFilters,
    query: "",
    type: "",
    quickFilter: "all",
    sessionId: "",
  }));
  const filtered = sessionEvents.filter((event) => {
    if (!selectedSessionId) return true;
    return event.sessionId === selectedSessionId;
  });

  filtered.sort((left, right) => {
    if (filters?.order === "asc") return String(left.time).localeCompare(String(right.time));
    return String(right.time).localeCompare(String(left.time));
  });

  return {
    events: filtered,
    sessions: mergeSessionTokenAggregates(
      buildSessionGroups(sessionEvents),
      buildSessionGroups(aggregateEvents),
    ),
    meta: collectMeta(sessionEvents),
    totalVisible: events?.length || 0,
    totalMatching: filtered.length,
    page: {
      offset: 0,
      limit: filtered.length,
      hasMore: false,
    },
    generatedAt: new Date().toISOString(),
    mode,
  };
}

export function buildStreamSessionRailItems(sessions) {
  const groups = new Map();

  for (const session of sessions || []) {
    const title = session.sessionTitle?.trim() || session.fallbackTitle?.trim() || "未命名会话";
    const key = [
      session.sourceType || "unknown",
      title,
      session.cwd || "",
    ].join("\u0000");
    const current = groups.get(key);
    const normalized = {
      ...session,
      title,
      totalTokens: toFiniteNumber(session.aggregateToken?.total),
      hasTokenData: sessionHasTokenData(session),
      sessionIds: mergeUniqueValues(session.sessionIds, session.sessionId ? [session.sessionId] : []),
      sourceFiles: mergeUniqueValues(session.sourceFiles, session.sourceFile ? [session.sourceFile] : []),
      groupedCount: 1,
    };

    if (!current) {
      groups.set(key, normalized);
      continue;
    }

    const latest = String(normalized.latest || "") > String(current.latest || "") ? normalized : current;
    groups.set(key, {
      ...latest,
      count: toFiniteNumber(current.count) + toFiniteNumber(normalized.count),
      totalTokens: toFiniteNumber(current.totalTokens) + toFiniteNumber(normalized.totalTokens),
      hasTokenData: Boolean(current.hasTokenData || normalized.hasTokenData),
      sessionIds: mergeUniqueValues(current.sessionIds, normalized.sessionIds),
      models: mergeUniqueValues(current.models, normalized.models),
      sourceFiles: mergeUniqueValues(current.sourceFiles, normalized.sourceFiles),
      groupedCount: toFiniteNumber(current.groupedCount) + 1,
    });
  }

  return [...groups.values()].sort((left, right) => String(right.latest || "").localeCompare(String(left.latest || "")));
}

export function buildDashboardSummary({
  events,
  sessions,
  totalVisible,
  totalMatching,
  totalLoaded,
  tokenWindows,
  nowMs,
  timezoneOffsetMinutes,
}) {
  const flattenedSessions = flattenSessions(sessions);
  const totals = {
    input: 0,
    output: 0,
    total: 0,
    cachedInput: 0,
    reasoningOutput: 0,
  };

  const typeCounts = new Map();
  const modelCounts = new Map();
  const platformEvents = new Map();
  const platformSessions = new Map();
  const hasSessionAggregates = flattenedSessions.some((session) => (
    toFiniteNumber(session?.count) > 0
    || toFiniteNumber(session?.aggregateToken?.total) > 0
    || (session?.models || []).length > 0
  ));

  for (const session of flattenedSessions) {
    const key = session?.sourceType || "unknown";
    platformSessions.set(key, (platformSessions.get(key) || 0) + 1);
  }

  for (const event of events || []) {
    const typeKey = event?.callType || "Unknown";
    const modelKey = event?.model || "unknown";
    const platformKey = event?.sourceType || "unknown";
    typeCounts.set(typeKey, (typeCounts.get(typeKey) || 0) + 1);

    if (!hasSessionAggregates) {
      modelCounts.set(modelKey, (modelCounts.get(modelKey) || 0) + 1);
      platformEvents.set(platformKey, (platformEvents.get(platformKey) || 0) + 1);

      const token = event?.tokenUsage;
      if (!token) continue;
      totals.input += toFiniteNumber(token.input);
      totals.output += toFiniteNumber(token.output);
      totals.total += toFiniteNumber(token.total);
      totals.cachedInput += toFiniteNumber(token.cachedInput);
      totals.reasoningOutput += toFiniteNumber(token.reasoningOutput);
    }
  }

  if (hasSessionAggregates) {
    for (const session of flattenedSessions) {
      const platformKey = session?.sourceType || "unknown";
      const sessionToken = session?.aggregateToken;
      const sessionModels = Array.isArray(session?.models) ? session.models : [];

      platformEvents.set(platformKey, (platformEvents.get(platformKey) || 0) + toFiniteNumber(session?.count));

      totals.input += toFiniteNumber(sessionToken?.input);
      totals.output += toFiniteNumber(sessionToken?.output);
      totals.total += toFiniteNumber(sessionToken?.total);
      totals.cachedInput += toFiniteNumber(sessionToken?.cachedInput);
      totals.reasoningOutput += toFiniteNumber(sessionToken?.reasoningOutput);

      sessionModels.forEach((model) => {
        modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
      });
    }
  }

  return {
    totals,
    tokenWindows: tokenWindows || buildTokenUsageWindows(events, { nowMs, timezoneOffsetMinutes }),
    counts: {
      totalVisible: toFiniteNumber(totalVisible),
      totalMatching: toFiniteNumber(totalMatching),
      totalLoaded: toFiniteNumber(totalLoaded),
      sessions: flattenedSessions.length,
    },
    topTypes: [...typeCounts.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort(compareKeyValuePairs),
    topModels: [...modelCounts.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort(compareKeyValuePairs),
    platforms: [...new Set([...platformSessions.keys(), ...platformEvents.keys()])]
      .map((key) => ({
        key,
        sessions: platformSessions.get(key) || 0,
        events: platformEvents.get(key) || 0,
      }))
      .sort((left, right) => {
        if (right.events !== left.events) return right.events - left.events;
        if (right.sessions !== left.sessions) return right.sessions - left.sessions;
        return String(left.key).localeCompare(String(right.key), "zh-CN");
      }),
  };
}

export function buildSessionSections(groups, filters = {}) {
  const groupBy = filters.groupBy === "sourceFile" || filters.groupBy === "platform" ? filters.groupBy : "cwd";
  const sectionMap = new Map();

  for (const [cwd, items] of Object.entries(groups || {})) {
    const filteredSessions = (items || [])
        .filter((session) => matchesSessionBaseFilters(session, filters))
        .map(normalizeSessionForWorkspace)
        .filter((session) => matchesSessionContentFilters(session, filters));

    const sessions = buildStreamSessionRailItems(filteredSessions);
    for (const session of sessions) {
      const firstSourceFile = session.sourceFiles?.[0] || "未知文件";
      const key = groupBy === "sourceFile"
        ? firstSourceFile
        : groupBy === "platform"
          ? session.sourceType || "unknown"
          : cwd;
      const label = groupBy === "platform" ? (PLATFORM_LABELS[key] || "Unknown") : key;
      const current = sectionMap.get(key) || {
        key,
        cwd: key,
        label,
        groupType: groupBy,
        total: 0,
        sessions: [],
      };
      current.sessions.push(session);
      current.total = current.sessions.length;
      sectionMap.set(key, current);
    }
  }

  return [...sectionMap.values()]
    .filter((section) => section.total > 0)
    .map((section) => ({
      ...section,
      sessions: section.sessions.sort((left, right) => String(right.latest || "").localeCompare(String(left.latest || ""))),
    }))
    .sort((left, right) => {
      const rightLatest = right.sessions[0]?.latest || "";
      const leftLatest = left.sessions[0]?.latest || "";
      return String(rightLatest).localeCompare(String(leftLatest));
    });
}

export function buildActiveSessionOverview(groups, options = {}) {
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const activeWindowMs = Number.isFinite(Number(options.activeWindowMs))
    ? Math.max(60 * 1000, Number(options.activeWindowMs))
    : DEFAULT_ACTIVE_SESSION_WINDOW_MS;
  const limit = Number.isFinite(Number(options.limit))
    ? Math.max(1, Number(options.limit))
    : DEFAULT_ACTIVE_SESSION_LIMIT;
  const filters = options.filters || {};
  const platformCounts = new Map();

  const activeSessions = flattenSessions(groups)
    .filter((session) => matchesSessionBaseFilters(session, filters))
    .map(normalizeSessionForWorkspace)
    .filter((session) => matchesSessionContentFilters(session, filters))
    .map((session) => {
      const latestMs = toTimeMs(session.latest);
      return {
        ...session,
        ageMs: latestMs == null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - latestMs),
      };
    })
    .filter((session) => Number.isFinite(session.ageMs) && session.ageMs <= activeWindowMs)
    .sort((left, right) => {
      if (left.ageMs !== right.ageMs) return left.ageMs - right.ageMs;
      return String(right.latest || "").localeCompare(String(left.latest || ""));
    });

  for (const session of activeSessions) {
    const key = session.sourceType || "unknown";
    platformCounts.set(key, (platformCounts.get(key) || 0) + 1);
  }

  return {
    total: activeSessions.length,
    windowMinutes: Math.round(activeWindowMs / 60000),
    latestAt: activeSessions[0]?.latest || "",
    hasMore: activeSessions.length > limit,
    platforms: [...platformCounts.entries()]
      .map(([key, sessions]) => ({ key, sessions }))
      .sort((left, right) => {
        if (right.sessions !== left.sessions) return right.sessions - left.sessions;
        return String(left.key).localeCompare(String(right.key), "zh-CN");
      }),
    sessions: activeSessions.slice(0, limit),
  };
}

export function buildSessionWorkspaceIndex(sections) {
  const workspaceMap = new Map();

  for (const section of sections || []) {
    for (const session of section.sessions || []) {
      const key = session.cwd || "未分类";
      const current = workspaceMap.get(key) || {
        key,
        cwd: key,
        sessions: 0,
        rawSessions: 0,
        rows: 0,
        events: 0,
        tokens: 0,
        latest: "",
      };

      current.sessions += 1;
      current.rawSessions += Math.max(1, toFiniteNumber(session.groupedCount));
      current.rows += 1;
      current.events += toFiniteNumber(session.count);
      current.tokens += toFiniteNumber(session.totalTokens);
      current.hasTokenData = Boolean(current.hasTokenData || session.hasTokenData);
      if (String(session.latest || "") > String(current.latest || "")) current.latest = session.latest || "";
      workspaceMap.set(key, current);
    }
  }

  return [...workspaceMap.values()].sort((left, right) => {
    if (right.sessions !== left.sessions) return right.sessions - left.sessions;
    if (right.tokens !== left.tokens) return right.tokens - left.tokens;
    return String(right.latest || "").localeCompare(String(left.latest || ""));
  });
}

function splitWorkspacePath(path) {
  const text = String(path || "").trim();
  if (!text || text === "未分类") return [text || "未分类"];
  return text.split("/").filter(Boolean);
}

function findCommonSegments(items) {
  if ((items || []).length < 2) return [];
  const segmentLists = items.map((item) => splitWorkspacePath(item.cwd));
  const [first = []] = segmentLists;
  const common = [];

  for (let index = 0; index < first.length; index += 1) {
    if (!segmentLists.every((segments) => segments[index] === first[index])) break;
    common.push(first[index]);
  }

  return common.length >= 2 ? common : [];
}

function compareWorkspaceNodes(left, right) {
  if (right.sessions !== left.sessions) return right.sessions - left.sessions;
  if (right.tokens !== left.tokens) return right.tokens - left.tokens;
  return String(left.label).localeCompare(String(right.label), "zh-CN");
}

export function buildSessionWorkspaceTree(workspaces) {
  const items = workspaces || [];
  const commonSegments = findCommonSegments(items);
  const rootPath = commonSegments.length ? `/${commonSegments.join("/")}` : "";
  const rootLabel = rootPath || "工作目录";
  const root = {
    key: rootLabel,
    label: rootLabel,
    path: rootPath,
    depth: 0,
    sessions: 0,
    events: 0,
    tokens: 0,
    hasTokenData: false,
    rawSessions: 0,
    latest: "",
    workspace: null,
    children: [],
  };

  function ensureChild(parent, label, path, depth) {
    let child = parent.children.find((item) => item.label === label && item.path === path);
    if (!child) {
      child = {
        key: path || label,
        label,
        path,
        depth,
        sessions: 0,
        events: 0,
        tokens: 0,
        hasTokenData: false,
        rawSessions: 0,
        latest: "",
        workspace: null,
        children: [],
      };
      parent.children.push(child);
    }
    return child;
  }

  for (const item of items) {
    const segments = splitWorkspacePath(item.cwd);
    const relativeSegments = commonSegments.length ? segments.slice(commonSegments.length) : segments;
    const pathSegments = [...commonSegments];
    const trail = [root];
    let parent = root;

    if (relativeSegments.length === 0) {
      parent = ensureChild(root, "当前目录", item.cwd, 1);
      trail.push(parent);
    } else {
      relativeSegments.forEach((segment, index) => {
        pathSegments.push(segment);
        const path = item.cwd?.startsWith("/") ? `/${pathSegments.join("/")}` : pathSegments.join("/");
        parent = ensureChild(parent, segment, path, index + 1);
        trail.push(parent);
      });
    }

    parent.workspace = item;
    for (const node of trail) {
      node.sessions += toFiniteNumber(item.sessions);
      node.rawSessions += toFiniteNumber(item.rawSessions || item.sessions);
      node.events += toFiniteNumber(item.events);
      node.tokens += toFiniteNumber(item.tokens);
      node.hasTokenData = Boolean(node.hasTokenData || item.hasTokenData);
      if (String(item.latest || "") > String(node.latest || "")) node.latest = item.latest || "";
    }
  }

  function sortChildren(node) {
    node.children.sort(compareWorkspaceNodes);
    node.children.forEach(sortChildren);
    return node;
  }

  return sortChildren(root);
}

export function buildLowContentSessionIds(groups, filters = {}, defaults = {}) {
  const tokenMax = toOptionalPositiveNumber(filters.tokenMax)
    ?? toOptionalPositiveNumber(defaults.tokenMax)
    ?? 1000;
  const maxEvents = toOptionalPositiveNumber(filters.maxEvents)
    ?? toOptionalPositiveNumber(defaults.maxEvents)
    ?? 6;
  const tokenMin = toOptionalPositiveNumber(filters.tokenMin);

  return [...new Set(flattenSessions(groups)
    .filter((session) => matchesSessionBaseFilters(session, filters))
    .map(normalizeSessionForWorkspace)
    .filter((session) => {
      if (tokenMin != null && toFiniteNumber(session.totalTokens) < tokenMin) return false;
      return toFiniteNumber(session.totalTokens) <= tokenMax && toFiniteNumber(session.count) <= maxEvents;
    })
    .map((session) => session.sessionId)
    .filter(Boolean))];
}

export function buildStreamScope({
  selectedSessionId,
  sessions,
  quickFilter,
  platform,
  query,
  mode,
}) {
  const activeSession = flattenSessions(sessions).find((session) => session?.sessionId === selectedSessionId) || null;
  const title = activeSession?.sessionTitle?.trim()
    || activeSession?.fallbackTitle?.trim()
    || "全部会话";
  const scopePlatform = activeSession?.sourceType || platform || "";

  return {
    title,
    subtitle: [
      PLATFORM_LABELS[scopePlatform] || "跨平台",
      QUICK_FILTER_LABELS[quickFilter] || QUICK_FILTER_LABELS.all,
      mode || "observe",
    ].join(" · "),
    tags: [query || "", activeSession?.cwd || ""].filter(Boolean),
  };
}
