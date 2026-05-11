import ObserverCore from "../../shared/observer-core.js";

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

function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function compareKeyValuePairs(left, right) {
  if (right.value !== left.value) return right.value - left.value;
  return String(left.key).localeCompare(String(right.key), "zh-CN");
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
  const query = String(filters.query || "").trim().toLowerCase();
  const platform = filters.platform || "";
  const namedOnly = Boolean(filters.namedOnly);

  return Object.entries(groups || {})
    .map(([cwd, items]) => {
      const sessions = (items || [])
        .filter((session) => {
          if (platform && session?.sourceType !== platform) return false;
          if (namedOnly && !String(session?.sessionTitle || "").trim()) return false;

          if (!query) return true;
          const haystack = [
            session?.sessionTitle,
            session?.fallbackTitle,
            session?.cwd,
            session?.sessionId,
            ...(session?.models || []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

          return haystack.includes(query);
        })
        .map((session) => ({
          ...session,
          title: session?.sessionTitle?.trim() || session?.fallbackTitle?.trim() || "未命名会话",
          totalTokens: toFiniteNumber(session?.aggregateToken?.total),
        }))
        .sort((left, right) => String(right.latest).localeCompare(String(left.latest)));

      return { cwd, total: sessions.length, sessions };
    })
    .filter((section) => section.total > 0)
    .sort((left, right) => {
      const rightLatest = right.sessions[0]?.latest || "";
      const leftLatest = left.sessions[0]?.latest || "";
      return String(rightLatest).localeCompare(String(leftLatest));
    });
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
