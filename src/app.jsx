import { lazy, startTransition, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Checkbox,
  Divider,
  Group,
  MantineProvider,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  createTheme,
} from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import { useLocalStorage } from "@mantine/hooks";
import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconChartBar,
  IconClock,
  IconMessageCircle,
  IconMoon,
  IconRefresh,
  IconSearch,
  IconStack2,
  IconSun,
  IconX,
} from "@tabler/icons-react";
import { apiClient } from "./api/client";
import { formatNumber } from "./lib/formatters";
import { hydrateDialogueEvents } from "./lib/conversation-hydration";
import {
  DEFAULT_SESSION_FILTERS,
  DEFAULT_STREAM_FILTERS,
  DEFAULT_TOKEN_THRESHOLD,
  parseUrlState,
} from "./lib/url-state";
import {
  buildActiveSessionOverview,
  buildDashboardSummary,
  buildLowContentSessionIds,
  buildSessionSections,
  buildSessionWorkspaceIndex,
  buildSessionWorkspaceTree,
  buildStreamSessionRailItems,
  buildStreamScope,
} from "./lib/workspace-models";
import { useConversationData } from "./hooks/use-conversation-data";
import { useCodexUsage } from "./hooks/use-codex-usage";
import { useObservabilityData } from "./hooks/use-observability-data";
import { useSessionActions } from "./hooks/use-session-actions";
import { useSessionData } from "./hooks/use-session-data";
import { useSourceChangeStream } from "./hooks/use-source-change-stream";
import { useStreamData } from "./hooks/use-stream-data";
import { useUrlStateSync } from "./hooks/use-url-state-sync";

const DATA_SOURCE = "server";
const EMPTY_LOCAL_EVENTS = [];
const NAV_ITEMS = [
  { value: "overview", label: "总览", detail: "实时态势", shortcut: "1", icon: IconActivity },
  { value: "tokens", label: "Token", detail: "用量与成本", shortcut: "2", icon: IconChartBar },
  { value: "stream", label: "事件流", detail: "检索与追踪", shortcut: "3", icon: IconClock },
  { value: "sessions", label: "会话", detail: "归档与详情", shortcut: "4", icon: IconMessageCircle },
];

const VIEW_META = {
  overview: { eyebrow: "01 / PULSE", title: "运行总览", description: "活跃会话、使用节奏与服务状态" },
  tokens: { eyebrow: "02 / LEDGER", title: "Token 账本", description: "用量构成、趋势与成本归因" },
  stream: { eyebrow: "03 / LIVE", title: "事件流", description: "最近事件、搜索与会话上下文" },
  sessions: { eyebrow: "04 / LIBRARY", title: "会话管理", description: "检索、分组与完整对话" },
};

const StreamWorkspace = lazy(() => import("./components/stream-workspace").then((module) => ({
  default: module.StreamWorkspace,
})));
const SessionWorkspace = lazy(() => import("./components/session-workspace").then((module) => ({
  default: module.SessionWorkspace,
})));
const ObservabilityWorkspace = lazy(() => import("./components/observability-workspace").then((module) => ({
  default: module.ObservabilityWorkspace,
})));
const EventDrawer = lazy(() => import("./components/event-drawer").then((module) => ({
  default: module.EventDrawer,
})));
const ConversationDrawer = lazy(() => import("./components/conversation-drawer").then((module) => ({
  default: module.ConversationDrawer,
})));

const theme = createTheme({
  primaryColor: "teal",
  defaultRadius: "md",
  fontFamily: "Manrope, PingFang SC, Hiragino Sans GB, sans-serif",
  headings: {
    fontFamily: "Sora, Manrope, PingFang SC, sans-serif",
  },
});

function isEditableShortcutTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"));
}

function hasShortcutModifier(event) {
  return event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
}

function getNavigationSessionId(target) {
  if (!target) return "";
  if (typeof target === "string") return target;
  return target.sessionId || target.id || "";
}

function buildSessionDetailSeed(target) {
  if (!target || typeof target === "string") return null;
  const sessionId = getNavigationSessionId(target);
  if (!sessionId) return null;
  return {
    ...target,
    sessionId,
    title: target.displayTitle || target.title || target.sessionTitle || target.fallbackTitle || target.summary || "未命名会话",
    sessionTitle: target.sessionTitle || target.title || target.fallbackTitle || target.summary || "",
    fallbackTitle: target.fallbackTitle || target.title || target.summary || "",
    latest: target.latest || target.time || "",
    count: Number(target.count || target.events || 0),
    totalTokens: Number(target.totalTokens || target.tokens || target.tokenUsage?.total || 0),
    sourceFiles: target.sourceFiles || (target.sourceFile ? [target.sourceFile] : []),
    models: target.models || (target.model ? [target.model] : []),
  };
}

function sessionMatchesId(session, sessionId) {
  if (!session || !sessionId) return false;
  return session.sessionId === sessionId || (session.sessionIds || []).includes(sessionId);
}

function findSessionInSections(sections, sessionId) {
  if (!sessionId) return null;
  for (const section of sections || []) {
    const match = (section.sessions || []).find((session) => sessionMatchesId(session, sessionId));
    if (match) return match;
  }
  return null;
}

function createSessionDetailPage() {
  return {
    total: 0,
    offset: 0,
    limit: 400,
    order: "desc",
    hasMore: false,
    nextOffset: 0,
  };
}

function hasVisibleConversationBoundary(events) {
  return (events || []).some((event) => {
    if (!["Prompt", "User"].includes(event?.callType)) return false;
    const content = String(event?.content || event?.summary || "");
    return content && !/<turn_aborted>|the user interrupted the previous turn on purpose/i.test(content);
  });
}

export function App() {
  const initialUrlState = useRef(
    parseUrlState(typeof window !== "undefined" ? window.location.search : ""),
  ).current;
  const searchRef = useRef(null);
  const [tab, setTab] = useState(initialUrlState.tab);
  const [themeMode, setThemeMode] = useLocalStorage({
    key: "observer-theme-mode",
    defaultValue: "dark",
  });
  const [mode, setMode] = useState(initialUrlState.mode);
  const [quickFilter, setQuickFilter] = useState(initialUrlState.quickFilter);
  const [streamView, setStreamView] = useState(
    initialUrlState.mode === "raw" ? "raw" : initialUrlState.quickFilter === "high_token" ? "usage" : "activity",
  );
  const [tokenThreshold, setTokenThreshold] = useState(initialUrlState.tokenThreshold || DEFAULT_TOKEN_THRESHOLD);
  const [streamFilters, setStreamFilters] = useState(initialUrlState.streamFilters || DEFAULT_STREAM_FILTERS);
  const [sessionFilters, setSessionFilters] = useState(initialUrlState.sessionFilters || DEFAULT_SESSION_FILTERS);
  const [selectedSessionId, setSelectedSessionId] = useState(initialUrlState.selectedSessionId);
  const [sessionComparison, setSessionComparison] = useState(null);
  const [sessionComparisonLoading, setSessionComparisonLoading] = useState(false);
  const dataSource = DATA_SOURCE;
  const localEvents = EMPTY_LOCAL_EVENTS;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sessionFiltersOpen, setSessionFiltersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState(null);
  const [sessionDetailSeed, setSessionDetailSeed] = useState(null);
  const [sessionDetailEvents, setSessionDetailEvents] = useState([]);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [sessionDetailPage, setSessionDetailPage] = useState(createSessionDetailPage());
  const [sessionDetailOrder, setSessionDetailOrder] = useState("desc");
  const [pendingWorkspaceKey, setPendingWorkspaceKey] = useState("");
  const sessionDetailRequestId = useRef(0);
  const [streamSearchDraft, setStreamSearchDraft] = useState(initialUrlState.streamFilters?.query || "");
  const deferredQuery = useDeferredValue(streamFilters.query);
  const submittedStreamQuery = streamFilters.query || "";
  const normalizedStreamSearchDraft = streamSearchDraft.trim();
  const streamSearchDirty = normalizedStreamSearchDraft !== submittedStreamQuery.trim();
  const notify = useCallback((options) => notifications.show(options), []);
  const isObservabilityTab = tab === "overview" || tab === "tokens";
  const { streamPayload, loadingEvents, loadEvents } = useStreamData({
    dataSource,
    enabled: tab === "stream",
    mode,
    quickFilter,
    tokenThreshold,
    selectedSessionId,
    streamFilters,
    query: deferredQuery,
    notify,
  });
  const sourceChangeStream = useSourceChangeStream({
    enabled: dataSource === "server" && tab === "stream",
    onChange: () => {
      loadEvents();
    },
  });
  const refreshStatus = useMemo(() => {
    if (tab === "stream") {
      return sourceChangeStream.connected
        ? {
            label: "实时连接",
            color: "teal",
            tone: "live",
            title: "事件流已订阅本地文件变化，新事件会自动更新。",
          }
        : {
            label: "等待实时",
            color: "yellow",
            tone: "pending",
            title: "实时连接尚未建立，可使用右侧刷新按钮手动读取最新事件。",
          };
    }
    return {
      label: "按需读取",
      color: "blue",
      tone: "ondemand",
      title: "当前页面按需读取摘要数据，使用刷新按钮重新加载。",
    };
  }, [sourceChangeStream.connected, tab]);
  const { sessionsPayload, loadSessions } = useSessionData({
    dataSource,
    notify,
  });
  const {
    conversationSession,
    conversationEvents,
    conversationLoading,
    conversationLoadingMore,
    conversationPage,
    openConversation,
    loadMoreConversation,
    closeConversation,
  } = useConversationData({
    dataSource,
    localEvents,
    notify,
  });
  const {
    observabilityPayload,
    loadingObservability,
    loadObservability,
    recalculateObservability,
    recalculatingObservability,
  } = useObservabilityData({
    dataSource,
    localEvents,
    notify,
    enabled: isObservabilityTab,
  });
  const { codexUsagePayload, queryCodexUsage } = useCodexUsage({
    enabled: dataSource === "server" && tab === "overview",
  });
  const {
    selectedSessionIds,
    renameTarget,
    renameValue,
    deleteTarget,
    setRenameValue,
    setRenameTarget,
    setDeleteTarget,
    setSelectedSessionIds,
    openRename,
    openDelete,
    confirmRename,
    confirmDelete,
    toggleSessionSelection,
    batchDelete,
  } = useSessionActions({
    loadSessions,
    loadEvents,
    notify,
  });

  const currentStream = streamPayload;
  const currentStreamIndex = currentStream?.index || {};
  const summaryCache = observabilityPayload.summary?.cache || {};
  const liveIndexState = (
    Number(currentStreamIndex.cachedFiles)
    || Number(currentStreamIndex.totalFiles)
    || Number(currentStreamIndex.scannedFiles)
  )
    ? currentStreamIndex
    : (observabilityPayload?.index || {});
  const cachedFileCountFromIndex = Number(liveIndexState.cachedFiles)
    || Number(summaryCache.cachedFiles)
    || Number(liveIndexState.totalFiles)
    || Number(summaryCache.totalFiles)
    || 0;
  const observabilitySessionGroups = useMemo(
    () => observabilityPayload.summary?.sessions?.byCwd
      || observabilityPayload.summary?.sessions?.groups
      || {},
    [observabilityPayload.summary?.sessions?.byCwd, observabilityPayload.summary?.sessions?.groups],
  );
  const streamSummary = useMemo(() => buildDashboardSummary({
    events: currentStream.events,
    sessions: currentStream.sessions,
    totalVisible: currentStream.totalVisible,
    totalMatching: currentStream.totalMatching,
    totalLoaded: currentStream.events.length,
    tokenWindows: currentStream.tokenWindows,
  }), [currentStream]);
  const streamScope = useMemo(() => buildStreamScope({
    selectedSessionId,
    sessions: currentStream.sessions,
    quickFilter,
    platform: streamFilters.platform,
    query: deferredQuery,
    mode,
  }), [currentStream.sessions, deferredQuery, mode, quickFilter, selectedSessionId, streamFilters.platform]);
  const streamSessions = useMemo(
    () => buildStreamSessionRailItems(currentStream.sessions),
    [currentStream.sessions],
  );

  const sessionGroups = sessionsPayload.groups;
  const activeOverviewGroups = isObservabilityTab
    ? observabilitySessionGroups
    : tab === "stream"
      ? currentStream.sessions
      : sessionGroups;
  const activeSessionOverview = useMemo(() => buildActiveSessionOverview(activeOverviewGroups, {
    filters: sessionFilters,
  }), [activeOverviewGroups, sessionFilters]);
  const sessionSections = useMemo(
    () => buildSessionSections(sessionGroups, sessionFilters),
    [sessionGroups, sessionFilters],
  );
  const sessionSourceFileCount = useMemo(() => {
    const files = new Set();
    for (const section of sessionSections || []) {
      for (const session of section.sessions || []) {
        for (const file of session.sourceFiles || []) {
          if (file) files.add(file);
        }
      }
    }
    return files.size;
  }, [sessionSections]);
  const cachedFileCount = cachedFileCountFromIndex || sessionSourceFileCount;
  const sessionWorkspaceIndex = useMemo(
    () => buildSessionWorkspaceIndex(sessionSections),
    [sessionSections],
  );
  const sessionWorkspaceTree = useMemo(
    () => buildSessionWorkspaceTree(sessionWorkspaceIndex),
    [sessionWorkspaceIndex],
  );
  const selectedDetailSession = useMemo(
    () => findSessionInSections(sessionSections, selectedSessionId) || sessionDetailSeed,
    [selectedSessionId, sessionDetailSeed, sessionSections],
  );

  async function loadSessionDetailEvents(sessionId = selectedSessionId, options = {}) {
    if (!sessionId) {
      sessionDetailRequestId.current += 1;
      setSessionDetailEvents([]);
      setSessionDetailPage(createSessionDetailPage());
      setSessionDetailLoading(false);
      return;
    }

    const append = Boolean(options.append);
    const order = options.order || (append ? sessionDetailPage.order : sessionDetailOrder) || "desc";
    const limit = sessionDetailPage.limit || 400;
    const offset = append ? sessionDetailPage.nextOffset : 0;
    const requestId = ++sessionDetailRequestId.current;
    setSessionDetailLoading(true);

    if (dataSource !== "server") {
      const allEvents = localEvents
        .filter((event) => event.sessionId === sessionId)
        .sort((left, right) => String(left.time).localeCompare(String(right.time)));
      if (requestId !== sessionDetailRequestId.current) return;
      setSessionDetailEvents(allEvents);
      setSessionDetailPage({
        total: allEvents.length,
        offset: 0,
        limit: allEvents.length,
        order: "asc",
        hasMore: false,
        nextOffset: allEvents.length,
      });
      setSessionDetailLoading(false);
      return;
    }

    try {
      const payload = await apiClient.fetchEvents({
        sessionId,
        order,
        limit,
        offset,
        mode: "raw",
        summary: 0,
      });
      if (requestId !== sessionDetailRequestId.current) return;
      let nextEvents = payload.events || [];
      let total = Number(payload.totalMatching) || nextEvents.length;
      let hasTurnBoundary = hasVisibleConversationBoundary(nextEvents);
      let boundaryAttempts = 0;
      let boundaryPageHasMore = Boolean(payload.page?.hasMore);
      while (!append && order === "desc" && !hasTurnBoundary && boundaryAttempts < 4) {
        const boundaryOffset = offset + nextEvents.length;
        const boundaryPayload = await apiClient.fetchEvents({
          sessionId,
          order,
          limit: 160,
          offset: boundaryOffset,
          mode: "raw",
          summary: 0,
        });
        if (requestId !== sessionDetailRequestId.current) return;
        const boundaryEvents = boundaryPayload.events || [];
        if (!boundaryEvents.length) break;
        nextEvents = [...nextEvents, ...boundaryEvents];
        hasTurnBoundary = hasVisibleConversationBoundary(boundaryEvents);
        boundaryPageHasMore = Boolean(boundaryPayload.page?.hasMore);
        total = Math.max(
          total,
          Number(boundaryPayload.totalMatching) || 0,
          boundaryOffset + boundaryEvents.length + (boundaryPageHasMore ? 1 : 0),
        );
        boundaryAttempts += 1;
      }
      const nextOffset = offset + nextEvents.length;
      const hydratedEvents = await hydrateDialogueEvents(nextEvents);
      if (requestId !== sessionDetailRequestId.current) return;
      setSessionDetailEvents((current) => (append ? [...current, ...hydratedEvents] : hydratedEvents)
        .sort((left, right) => String(left?.time || "").localeCompare(String(right?.time || ""))));
      setSessionDetailPage({
        total,
        offset,
        limit,
        order,
        hasMore: boundaryPageHasMore || nextOffset < total,
        nextOffset,
      });
    } catch (error) {
      if (requestId !== sessionDetailRequestId.current) return;
      notify({
        title: "会话详情加载失败",
        message: String(error.message || error),
        color: "red",
      });
    } finally {
      if (requestId === sessionDetailRequestId.current) setSessionDetailLoading(false);
    }
  }

  useEffect(() => {
    if (!pendingWorkspaceKey || tab !== "sessions" || sessionFilters.groupBy !== "cwd") return undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = [...document.querySelectorAll("[data-session-section-key]")].find((element) => (
        element.dataset.sessionSectionKey === pendingWorkspaceKey
      ));
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingWorkspaceKey("");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingWorkspaceKey, sessionFilters.groupBy, sessionSections, tab]);

  useEffect(() => {
    if (tab !== "sessions" || !selectedSessionId) return undefined;
    void loadSessionDetailEvents(selectedSessionId, { append: false, order: sessionDetailOrder });
    return undefined;
  }, [dataSource, selectedSessionId, sessionDetailOrder, tab]);

  useEffect(() => {
    document.documentElement.dataset.observerTheme = themeMode;
    return () => {
      delete document.documentElement.dataset.observerTheme;
    };
  }, [themeMode]);

  useUrlStateSync({
    dataSource,
    tab,
    selectedSessionId,
    mode,
    quickFilter,
    tokenThreshold,
    streamFilters,
    sessionFilters,
  });

  useEffect(() => {
    if (dataSource !== "server" || tab !== "sessions") return;
    loadSessions();
  }, [dataSource, loadSessions, tab]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.defaultPrevented || event.isComposing) return;
      const isEditing = isEditableShortcutTarget(event.target);
      const hasModifier = hasShortcutModifier(event);

      if (event.key === "/" && !hasModifier && !isEditing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "r" && !hasModifier && !isEditing && dataSource === "server") {
        event.preventDefault();
        if (tab === "overview" || tab === "tokens") {
          loadObservability();
        } else if (tab === "sessions") {
          loadSessions();
        } else {
          loadEvents();
        }
      }
      if (event.key === "t" && !hasModifier && !isEditing) {
        event.preventDefault();
        setThemeMode((value) => (value === "dark" ? "light" : "dark"));
      }
      if (event.key === "m" && !hasModifier && !isEditing) {
        event.preventDefault();
        setMode((value) => (value === "observe" ? "raw" : "observe"));
      }
      if (event.key === "Escape") {
        setFiltersOpen(false);
        setSessionFiltersOpen(false);
        setHelpOpen(false);
        setDetailEvent(null);
        closeConversation();
        setRenameTarget(null);
        setDeleteTarget(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dataSource, loadEvents, loadObservability, loadSessions, setThemeMode, tab]);

  function toggleTheme() {
    setThemeMode((value) => (value === "dark" ? "light" : "dark"));
  }

  function selectSession(sessionId) {
    setSelectedSessionId((current) => (current === sessionId ? "" : sessionId));
  }

  function clearSessionFocus() {
    setSelectedSessionId("");
    setSessionDetailSeed(null);
    setSessionDetailEvents([]);
    setSessionDetailPage(createSessionDetailPage());
    setSessionDetailOrder("asc");
  }

  function refreshCurrentView() {
    if (tab === "overview" || tab === "tokens") {
      loadObservability();
      return;
    }
    if (tab === "sessions") {
      loadSessions();
      return;
    }
    loadEvents();
  }

  function submitStreamSearch(event) {
    event?.preventDefault();
    const query = streamSearchDraft.trim();
    setStreamSearchDraft(query);

    if (query === submittedStreamQuery.trim()) {
      if (tab === "stream") loadEvents();
      return;
    }

    setStreamFilters((current) => ({ ...current, query }));
  }

  function clearStreamSearch() {
    setStreamSearchDraft("");
    setStreamFilters((current) => (current.query ? { ...current, query: "" } : current));
    window.requestAnimationFrame(() => searchRef.current?.focus());
  }

  function selectLowContentSessions() {
    const uniqueIds = buildLowContentSessionIds(sessionGroups, sessionFilters);
    setSelectedSessionIds(uniqueIds);
    notifications.show({
      title: "已选中低内容会话",
      message: uniqueIds.length
        ? `已选中 ${formatNumber(uniqueIds.length)} 个原始会话。列表仍按相同标题合并展示。`
        : "当前筛选下没有符合条件的会话。",
      color: uniqueIds.length ? "blue" : "gray",
    });
  }

  function focusWorkspaceSessions(cwd) {
    setTab("sessions");
    setPendingWorkspaceKey(cwd);
    setSessionFilters((current) => ({
      ...current,
      groupBy: "cwd",
    }));
  }

  function openSessionDetail(target, options = {}) {
    const sessionId = getNavigationSessionId(target);
    if (!sessionId) return;
    const seed = buildSessionDetailSeed(target);
    const preferredOrder = options.order || "desc";
    setSessionDetailSeed(seed);
    setSessionDetailOrder(preferredOrder);
    setSelectedSessionId(sessionId);
    if (options.closeEventDrawer) setDetailEvent(null);
    startTransition(() => {
      setTab("sessions");
    });
  }

  function focusStreamSession(target) {
    const sessionId = getNavigationSessionId(target);
    if (!sessionId) return;
    const seed = buildSessionDetailSeed(target);
    setSessionDetailSeed(seed);
    setSelectedSessionId(sessionId);
    startTransition(() => {
      setTab("stream");
    });
  }

  const canMutateSessions = true;
  const activeStreamFilters = [
    deferredQuery ? {
      key: "query",
      label: `搜索 ${deferredQuery}`,
      clear: clearStreamSearch,
    } : null,
    streamFilters.model ? {
      key: "model",
      label: `模型 ${streamFilters.model}`,
      clear: () => setStreamFilters((current) => ({ ...current, model: "" })),
    } : null,
    streamFilters.type ? {
      key: "type",
      label: `类型 ${streamFilters.type}`,
      clear: () => setStreamFilters((current) => ({ ...current, type: "" })),
    } : null,
    streamFilters.platform ? {
      key: "platform",
      label: `平台 ${streamFilters.platform === "codex" ? "Codex" : "Claude Code"}`,
      clear: () => setStreamFilters((current) => ({ ...current, platform: "" })),
    } : null,
    streamFilters.start ? {
      key: "start",
      label: `开始 ${streamFilters.start}`,
      clear: () => setStreamFilters((current) => ({ ...current, start: "" })),
    } : null,
    streamFilters.end ? {
      key: "end",
      label: `结束 ${streamFilters.end}`,
      clear: () => setStreamFilters((current) => ({ ...current, end: "" })),
    } : null,
    streamFilters.order !== DEFAULT_STREAM_FILTERS.order ? {
      key: "order",
      label: streamFilters.order === "asc" ? "最早在前" : "最新在前",
      clear: () => setStreamFilters((current) => ({ ...current, order: DEFAULT_STREAM_FILTERS.order })),
    } : null,
    quickFilter !== "all" ? {
      key: "quick",
      label: "高 Token",
      clear: () => setQuickFilter("all"),
    } : null,
    selectedSessionId ? {
      key: "session",
      label: `会话 ${selectedSessionId.slice(0, 8)}`,
      clear: clearSessionFocus,
    } : null,
  ].filter(Boolean);
  const streamSearchStatus = loadingEvents
    ? "正在按当前条件查询事件..."
    : streamSearchDirty
      ? "输入已修改，点击搜索后生效"
      : submittedStreamQuery
        ? `当前搜索：${submittedStreamQuery}`
        : "输入用户或 Agent 问答关键词后点击搜索";

  async function copySessionId(sessionId) {
    if (!sessionId) return;
    await navigator.clipboard.writeText(sessionId);
    notifications.show({
      title: "已复制会话 ID",
      message: shortMessage(sessionId),
      color: "blue",
    });
  }

  async function compareSelectedSessions() {
    if (selectedSessionIds.length !== 2) return;
    setSessionComparisonLoading(true);
    try {
      const payload = await apiClient.compareSessions(selectedSessionIds[0], selectedSessionIds[1]);
      setSessionComparison(payload);
    } catch (error) {
      notify({
        title: "会话对比失败",
        message: String(error.message || error),
        color: "red",
      });
    } finally {
      setSessionComparisonLoading(false);
    }
  }

  async function openEventDetail(event) {
    setDetailEvent(event);
    if (dataSource !== "server" || !event?.eventId || !event?.contentTruncated) return;

    try {
      const payload = await apiClient.fetchEventDetail(event.eventId);
      setDetailEvent((current) => (
        current?.eventId === event.eventId ? payload.event || current : current
      ));
    } catch (error) {
      notify({
        title: "事件详情加载失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }

  const currentView = VIEW_META[tab] || VIEW_META.overview;

  return (
    <MantineProvider theme={theme} forceColorScheme={themeMode}>
      <Notifications position="top-right" />
      <div className={`observer-root theme-${themeMode} density-compact`}>
        <AppShell
          layout="alt"
          header={{ height: 68 }}
          navbar={{ width: 76, breakpoint: 0 }}
          padding={0}
        >
          <AppShell.Navbar className="instrument-rail" data-testid="instrument-rail" aria-label="主导航">
            <div className="instrument-rail__brand" title="Session Observer">
              <span className="instrument-rail__brand-mark">SO</span>
              <span className="instrument-rail__brand-line" />
            </div>

            <div className="instrument-rail__nav" aria-label="主视图" role="radiogroup">
              {NAV_ITEMS.map(({ value, label, detail, shortcut, icon: Icon }) => {
                const active = tab === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={label}
                    title={`${label} · ${detail}`}
                    className={`instrument-nav${active ? " is-active" : ""}`}
                    onClick={() => setTab(value)}
                  >
                    <span className="instrument-nav__index" aria-hidden="true">{shortcut}</span>
                    <Icon size={21} stroke={1.7} aria-hidden="true" />
                    <span className="instrument-nav__label">{label}</span>
                  </button>
                );
              })}
            </div>

            <div className="instrument-rail__footer" title={refreshStatus.title}>
              <span className={`instrument-rail__signal is-${refreshStatus.tone}`} />
              <IconStack2 size={17} stroke={1.7} aria-hidden="true" />
              <strong>{formatNumber(cachedFileCount)}</strong>
              <small>files</small>
            </div>
          </AppShell.Navbar>

          <AppShell.Header className="command-header">
            <div className="command-header__inner">
              <div className="command-header__identity">
                <div className="command-header__product">
                  <Text>SESSION OBSERVER</Text>
                  <span>LOCAL AGENT TELEMETRY</span>
                </div>
                <span className="command-header__divider" />
                <div className="command-header__view">
                  <Text className="command-header__eyebrow">{currentView.eyebrow}</Text>
                  <div className="command-header__title-line">
                    <Title order={1} className="command-header__view-title">{currentView.title}</Title>
                    <Text>{currentView.description}</Text>
                  </div>
                </div>
              </div>

                <Group gap={6} align="center" className="command-header__actions" wrap="nowrap">
                  <Badge
                    radius="sm"
                    variant="outline"
                    color={refreshStatus.color}
                    title={refreshStatus.title}
                    className="refresh-status-badge"
                    leftSection={<span className={`refresh-status-dot is-${refreshStatus.tone}`} />}
                  >
                    {refreshStatus.label}
                  </Badge>
                  <ActionIcon aria-label="刷新当前视图" title="刷新当前视图" radius="sm" variant="subtle" color="teal" size="lg" onClick={refreshCurrentView}>
                    <IconRefresh size={18} />
                  </ActionIcon>
                  <ActionIcon aria-label="切换主题" title="切换主题" radius="sm" variant="subtle" color="gray" size="lg" onClick={toggleTheme}>
                    {themeMode === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
                  </ActionIcon>
                  <ActionIcon aria-label="打开帮助" title="打开帮助" radius="sm" variant="subtle" color="gray" size="lg" onClick={() => setHelpOpen(true)}>
                    <IconAlertCircle size={18} />
                  </ActionIcon>
                </Group>
            </div>
          </AppShell.Header>

          <AppShell.Main className="workspace-canvas" data-testid="workspace-canvas" data-workbench-view={tab}>
            <Stack gap="md" className="app-main">
              {tab === "overview" || tab === "tokens" ? (
                <Suspense fallback={<WorkspaceFallback label="正在加载可观测视图…" />}>
                  <ObservabilityWorkspace
                    payload={observabilityPayload}
                    view={tab}
                    activeOverview={activeSessionOverview}
                    codexUsagePayload={codexUsagePayload}
                    onQueryCodexUsage={queryCodexUsage}
                    loading={loadingObservability}
                    recalculating={recalculatingObservability}
                    onRefresh={loadObservability}
                    onRecalculate={recalculateObservability}
                    onOpenConversation={openConversation}
                    onOpenSessionDetail={openSessionDetail}
                  />
                </Suspense>
              ) : tab === "stream" ? (
                <>
                  <Paper component="section" aria-label="事件查询" className="control-shelf command-deck command-deck--stream" radius="md" p="md">
                    <div className="stream-query-grid">
                      <div className="command-deck__modes">
                        <SegmentedControl
                          size="xs"
                          radius="sm"
                          value={streamView}
                          onChange={(value) => {
                            setStreamView(value);
                            setMode(value === "raw" ? "raw" : "observe");
                            setQuickFilter("all");
                          }}
                          data={[
                            { label: "活动", value: "activity" },
                            { label: "问答", value: "dialogue" },
                            { label: "工具", value: "tools" },
                            { label: "用量", value: "usage" },
                            { label: "原始", value: "raw" },
                          ]}
                        />
                      </div>
                      <form className="stream-search-form" onSubmit={submitStreamSearch}>
                        <TextInput
                          ref={searchRef}
                          label="搜索"
                          placeholder="用户 / Agent 问答内容"
                          leftSection={<IconSearch size={16} />}
                          value={streamSearchDraft}
                          onChange={(event) => {
                            setStreamSearchDraft(event.currentTarget.value);
                          }}
                          aria-describedby="stream-search-status"
                          className="control-field control-field--wide stream-search-form__input"
                        />
                        <Button
                          type="submit"
                          variant={streamSearchDirty ? "filled" : "light"}
                          radius="sm"
                          color="teal"
                          leftSection={<IconSearch size={15} />}
                          loading={dataSource === "server" && loadingEvents}
                        >
                          {dataSource === "server" && loadingEvents ? "搜索中" : "搜索"}
                        </Button>
                        {submittedStreamQuery || streamSearchDraft ? (
                          <Button
                            type="button"
                            variant="subtle"
                            radius="sm"
                            color="gray"
                            onClick={clearStreamSearch}
                            disabled={dataSource === "server" && loadingEvents}
                          >
                            清除
                          </Button>
                        ) : null}
                      </form>
                      <Select
                        label="模型"
                        placeholder="全部模型"
                        data={(currentStream.meta.models || []).map((item) => ({ value: item, label: item }))}
                        value={streamFilters.model}
                        onChange={(value) => setStreamFilters((current) => ({ ...current, model: value || "" }))}
                        clearable
                        className="control-field stream-filter-field"
                      />
                      <Select
                        label="类型"
                        placeholder="全部类型"
                        data={(currentStream.meta.types || []).map((item) => ({ value: item, label: item }))}
                        value={streamFilters.type}
                        onChange={(value) => setStreamFilters((current) => ({ ...current, type: value || "" }))}
                        clearable
                        className="control-field stream-filter-field"
                      />
                      <Select
                        label="平台"
                        placeholder="全部平台"
                        data={[
                          { value: "codex", label: "Codex" },
                          { value: "claude", label: "Claude Code" },
                        ]}
                        value={streamFilters.platform}
                        onChange={(value) => setStreamFilters((current) => ({ ...current, platform: value || "" }))}
                        clearable
                        className="control-field stream-filter-field"
                      />
                      <Button
                        variant="subtle"
                        radius="sm"
                        color="gray"
                        leftSection={<IconAdjustmentsHorizontal size={15} />}
                        onClick={() => setFiltersOpen(true)}
                        className="stream-query-grid__advanced"
                      >
                        更多条件
                      </Button>
                    </div>
                    <Text id="stream-search-status" className="stream-search-form__status" aria-live="polite">
                      {streamSearchStatus}
                    </Text>
                    {activeStreamFilters.length ? (
                      <Group gap="xs" className="active-filter-bar">
                        <Text className="active-filter-bar__label">当前筛选</Text>
                        {activeStreamFilters.map((filter) => (
                          <Button
                            key={filter.key}
                            variant="light"
                            color="gray"
                            radius="sm"
                            size="xs"
                            rightSection={<IconX size={13} />}
                            onClick={filter.clear}
                          >
                            {filter.label}
                          </Button>
                        ))}
                        <Button
                          variant="subtle"
                          color="gray"
                          radius="sm"
                          size="xs"
                          onClick={() => {
                            setStreamSearchDraft("");
                            setStreamFilters({ ...DEFAULT_STREAM_FILTERS });
                            setQuickFilter("all");
                            setSelectedSessionId("");
                          }}
                        >
                          清空全部
                        </Button>
                      </Group>
                    ) : null}
                  </Paper>

                  <Suspense fallback={<WorkspaceFallback label="正在加载事件流…" />}>
                    <StreamWorkspace
                      scope={streamScope}
                      summary={streamSummary}
                      sessions={streamSessions}
                      events={currentStream.events}
                      selectedSessionId={selectedSessionId}
                      onSelectSession={selectSession}
                      onClearSessionFocus={clearSessionFocus}
                      onOpenFilters={() => setFiltersOpen(true)}
                      onOpenEvent={openEventDetail}
                      onOpenSessionDetail={openSessionDetail}
                      onLoadMore={() => loadEvents({ append: true })}
                      hasMore={Boolean(currentStream.page?.hasMore) && dataSource === "server"}
                      loading={loadingEvents}
                      generatedAt={currentStream.generatedAt}
                      searchQuery={deferredQuery}
                      viewMode={streamView}
                    />
                  </Suspense>
                </>
              ) : (
                <>
                  <Paper component="section" aria-label="会话查询" className="control-shelf command-deck command-deck--sessions" radius="md" p="md">
                    <Group wrap="nowrap" align="flex-end" className="session-command-fields session-command-fields--primary">
                      <TextInput
                        label="搜索会话"
                        placeholder="会话名 / cwd / session ID"
                        leftSection={<IconSearch size={16} />}
                        value={sessionFilters.query}
                        onChange={(event) => {
                          const query = event.currentTarget.value;
                          setSessionFilters((current) => ({ ...current, query }));
                        }}
                        className="control-field control-field--wide"
                      />
                      <Select
                        label="平台"
                        placeholder="全部平台"
                        data={[
                          { value: "codex", label: "Codex" },
                          { value: "claude", label: "Claude Code" },
                        ]}
                        value={sessionFilters.platform}
                        onChange={(value) => setSessionFilters((current) => ({ ...current, platform: value || "" }))}
                        clearable
                        className="control-field"
                      />
                      <Select
                        label="分组"
                        placeholder="分组方式"
                        data={[
                          { value: "cwd", label: "工作目录" },
                          { value: "sourceFile", label: "文件位置" },
                          { value: "platform", label: "平台" },
                        ]}
                        value={sessionFilters.groupBy}
                        onChange={(value) => setSessionFilters((current) => ({ ...current, groupBy: value || "cwd" }))}
                        className="control-field"
                      />
                      <Group gap="xs" wrap="nowrap" className="session-query-actions">
                        <Text className="command-deck__summary">
                          {formatNumber(sessionsPayload.total || sessionSections.reduce((sum, section) => sum + section.total, 0))} 会话
                        </Text>
                        <Button
                          variant="subtle"
                          radius="sm"
                          color="gray"
                          leftSection={<IconAdjustmentsHorizontal size={15} />}
                          onClick={() => setSessionFiltersOpen(true)}
                        >
                          更多条件
                        </Button>
                        {selectedSessionId ? (
                          <Button
                            variant="light"
                            radius="sm"
                            color="gray"
                            leftSection={<IconX size={14} />}
                            onClick={clearSessionFocus}
                          >
                            取消聚焦 {selectedSessionId.slice(0, 8)}
                          </Button>
                        ) : null}
                      </Group>
                    </Group>
                    {selectedSessionIds.length > 0 ? (
                      <div className="session-selection-bar">
                        <Text>已选择 {formatNumber(selectedSessionIds.length)} 个原始会话</Text>
                        <Button
                          variant="light"
                          radius="sm"
                          color="teal"
                          size="xs"
                          onClick={compareSelectedSessions}
                          loading={sessionComparisonLoading}
                          disabled={selectedSessionIds.length !== 2}
                        >
                          对比会话
                        </Button>
                        <Button variant="light" radius="sm" color="red" size="xs" onClick={batchDelete} disabled={!canMutateSessions}>
                          批量删除
                        </Button>
                      </div>
                    ) : null}
                  </Paper>

                  <Suspense fallback={<WorkspaceFallback label="正在加载会话列表…" />}>
                    <SessionWorkspace
                      activeOverview={activeSessionOverview}
                      sections={sessionSections}
                      workspaceIndex={sessionWorkspaceIndex}
                      workspaceTree={sessionWorkspaceTree}
                      selectedIds={selectedSessionIds}
                      selectedSessionId={selectedSessionId}
                      detailSession={selectedDetailSession}
                      detailEvents={sessionDetailEvents}
                      detailLoading={sessionDetailLoading}
                      detailPage={sessionDetailPage}
                      onToggleSelect={toggleSessionSelection}
                      onOpenConversation={openConversation}
                      onOpenSessionDetail={openSessionDetail}
                      onFocusStreamSession={focusStreamSession}
                      onClearSessionFocus={clearSessionFocus}
                      onFocusWorkspace={focusWorkspaceSessions}
                      onRename={(session) => {
                        if (canMutateSessions) openRename(session);
                      }}
                      onDelete={(session) => {
                        if (canMutateSessions) openDelete(session);
                      }}
                      onCopySessionId={copySessionId}
                      onOpenEvent={openEventDetail}
                      onLoadMoreSessionDetail={() => loadSessionDetailEvents(selectedSessionId, { append: true })}
                      onAnnotationSaved={loadSessions}
                      comparison={sessionComparison}
                      comparisonLoading={sessionComparisonLoading}
                      onCloseComparison={() => setSessionComparison(null)}
                    />
                  </Suspense>
                </>
              )}
            </Stack>
          </AppShell.Main>
        </AppShell>

        <Modal opened={filtersOpen} onClose={() => setFiltersOpen(false)} title="高级筛选" centered>
          <Stack>
            <TextInput
              label="开始时间"
              type="datetime-local"
              value={streamFilters.start}
              onChange={(event) => {
                const start = event.currentTarget.value;
                setStreamFilters((current) => ({ ...current, start }));
              }}
            />
            <TextInput
              label="结束时间"
              type="datetime-local"
              value={streamFilters.end}
              onChange={(event) => {
                const end = event.currentTarget.value;
                setStreamFilters((current) => ({ ...current, end }));
              }}
            />
            <Select
              label="排序"
              data={[
                { value: "desc", label: "最新在前" },
                { value: "asc", label: "最早在前" },
              ]}
              value={streamFilters.order}
              onChange={(value) => setStreamFilters((current) => ({ ...current, order: value || "desc" }))}
            />
            <TextInput
              label="高 Token 阈值"
              value={tokenThreshold}
              onChange={(event) => setTokenThreshold(event.currentTarget.value)}
            />
            <Group justify="space-between">
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  setStreamSearchDraft("");
                  setStreamFilters({ ...DEFAULT_STREAM_FILTERS });
                  setQuickFilter("all");
                  setTokenThreshold(DEFAULT_TOKEN_THRESHOLD);
                }}
              >
                重置
              </Button>
              <Button onClick={() => setFiltersOpen(false)}>完成</Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={sessionFiltersOpen} onClose={() => setSessionFiltersOpen(false)} title="会话高级筛选" centered>
          <Stack>
            <Group grow align="flex-start">
              <TextInput
                label="Token 下限"
                placeholder="例如 1000"
                value={sessionFilters.tokenMin}
                onChange={(event) => setSessionFilters((current) => ({ ...current, tokenMin: event.currentTarget.value }))}
              />
              <TextInput
                label="Token 上限"
                placeholder="例如 100000"
                value={sessionFilters.tokenMax}
                onChange={(event) => setSessionFilters((current) => ({ ...current, tokenMax: event.currentTarget.value }))}
              />
            </Group>
            <TextInput
              label="最大事件数"
              placeholder="例如 6"
              value={sessionFilters.maxEvents}
              onChange={(event) => setSessionFilters((current) => ({ ...current, maxEvents: event.currentTarget.value }))}
            />
            <Checkbox
              label="仅显示已命名"
              checked={sessionFilters.namedOnly}
              onChange={(event) => setSessionFilters((current) => ({ ...current, namedOnly: event.currentTarget.checked }))}
            />
            <Divider />
            <Group justify="space-between">
              <Button variant="subtle" color="gray" onClick={selectLowContentSessions}>选中低内容会话</Button>
              <Group gap="xs">
                <Button
                  variant="subtle"
                  color="gray"
                  onClick={() => setSessionFilters((current) => ({
                    ...DEFAULT_SESSION_FILTERS,
                    query: current.query,
                    platform: current.platform,
                    groupBy: current.groupBy,
                  }))}
                >
                  重置条件
                </Button>
                <Button onClick={() => setSessionFiltersOpen(false)}>完成</Button>
              </Group>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={helpOpen} onClose={() => setHelpOpen(false)} title="快捷键与说明" centered>
          <Stack gap="sm">
            <Text>/ 聚焦搜索</Text>
            <Text>r 刷新当前视图</Text>
            <Text>t 切换主题</Text>
            <Text>m 切换观测 / 原始模式</Text>
            <Divider />
            <Text>事件流打开时会订阅本地文件变化并自动更新；其他页面按需读取摘要数据。刷新按钮只会重新读取当前视图。</Text>
          </Stack>
        </Modal>

        <Modal opened={Boolean(renameTarget)} onClose={() => setRenameTarget(null)} title="重命名会话" centered>
          <Stack>
            <TextInput value={renameValue} onChange={(event) => setRenameValue(event.currentTarget.value)} />
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={() => setRenameTarget(null)}>取消</Button>
              <Button onClick={confirmRename}>保存</Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="确认删除" centered>
          <Stack>
            <Text>将删除会话 {deleteTarget?.title || deleteTarget?.sessionTitle || deleteTarget?.fallbackTitle || deleteTarget?.sessionId}，此操作不可撤销。</Text>
            <Group justify="flex-end">
              <Button variant="subtle" color="gray" onClick={() => setDeleteTarget(null)}>取消</Button>
              <Button color="red" onClick={confirmDelete}>删除</Button>
            </Group>
          </Stack>
        </Modal>

        {detailEvent ? (
          <Suspense fallback={null}>
            <EventDrawer
              event={detailEvent}
              opened={Boolean(detailEvent)}
              onClose={() => setDetailEvent(null)}
              onCopySessionId={copySessionId}
              onOpenSessionDetail={(event) => openSessionDetail(event, { closeEventDrawer: true })}
              onCopy={(event) => {
                navigator.clipboard.writeText(JSON.stringify(event, null, 2));
                notifications.show({
                  title: "已复制 JSON",
                  message: shortMessage(event.summary || event.callType),
                  color: "blue",
                });
              }}
            />
          </Suspense>
        ) : null}

        {conversationSession ? (
          <Suspense fallback={null}>
            <ConversationDrawer
              opened={Boolean(conversationSession)}
              onClose={closeConversation}
              session={conversationSession}
              events={conversationEvents}
              loading={conversationLoading}
              loadingMore={conversationLoadingMore}
              hasMore={conversationPage.hasMore}
              page={conversationPage}
              onLoadMore={loadMoreConversation}
              onCopySessionId={copySessionId}
            />
          </Suspense>
        ) : null}
      </div>
    </MantineProvider>
  );
}

function WorkspaceFallback({ label }) {
  return (
    <Paper className="control-shelf" radius="xl" p="xl">
      <Text c="dimmed">{label}</Text>
    </Paper>
  );
}

function shortMessage(text) {
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, 80);
}
