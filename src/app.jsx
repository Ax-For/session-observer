import { startTransition, useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Checkbox,
  Divider,
  FileButton,
  Group,
  MantineProvider,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  createTheme,
} from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";
import { useLocalStorage } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconBulb,
  IconCloudDownload,
  IconCloudUpload,
  IconMoon,
  IconRefresh,
  IconSearch,
  IconSun,
} from "@tabler/icons-react";
import ObserverCore from "../shared/observer-core.js";
import ObserverData from "../shared/observer-data.js";
import { apiClient } from "./api/client";
import { ConversationDrawer } from "./components/conversation-drawer";
import { EventDrawer } from "./components/event-drawer";
import { SessionWorkspace } from "./components/session-workspace";
import { StreamWorkspace } from "./components/stream-workspace";
import {
  CONVERSATION_PAGE_LIMIT,
  createEmptyConversationPage,
  mergeConversationPage,
  sliceConversationPage,
} from "./lib/conversation-paging";
import {
  downloadJson,
  downloadJsonl,
  formatFullDateTime,
  formatNumber,
} from "./lib/formatters";
import {
  buildDashboardSummary,
  buildSessionSections,
  buildStreamScope,
} from "./lib/workspace-models";

const {
  buildSessionGroups,
  collectMeta,
  eventMatchesFilters,
  toTimeMs,
} = ObserverCore;
const { parseFiles } = ObserverData;

const PAGE_LIMIT = 250;
const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "xl",
  fontFamily: "Manrope, PingFang SC, Hiragino Sans GB, sans-serif",
  headings: {
    fontFamily: "Sora, Manrope, PingFang SC, sans-serif",
  },
});

const defaultStreamFilters = {
  query: "",
  model: "",
  type: "",
  platform: "",
  start: "",
  end: "",
  order: "desc",
};

const defaultSessionFilters = {
  query: "",
  platform: "",
  namedOnly: false,
};

function groupSessionsByCwd(sessions) {
  return (sessions || []).reduce((groups, session) => {
    const key = session.cwd || "未分类";
    if (!groups[key]) groups[key] = [];
    groups[key].push(session);
    return groups;
  }, {});
}

function buildLocalPayload(events, filters, selectedSessionId, quickFilter, tokenThreshold, mode) {
  const query = String(filters.query || "").trim().toLowerCase();
  const baseFilters = {
    mode,
    platform: filters.platform,
    model: filters.model,
    type: filters.type,
    quickFilter,
    tokenThreshold,
    query,
    sessionId: "",
    startMs: filters.start ? toTimeMs(filters.start) : null,
    endMs: filters.end ? toTimeMs(filters.end) : null,
  };

  const sessionEvents = (events || []).filter((event) => eventMatchesFilters(event, baseFilters));
  const filtered = sessionEvents.filter((event) => {
    if (!selectedSessionId) return true;
    return event.sessionId === selectedSessionId;
  });

  filtered.sort((left, right) => {
    if (filters.order === "asc") return String(left.time).localeCompare(String(right.time));
    return String(right.time).localeCompare(String(left.time));
  });

  return {
    events: filtered,
    sessions: buildSessionGroups(sessionEvents),
    meta: collectMeta(sessionEvents),
    totalVisible: events.length,
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

async function fetchAllSessionEvents(sessionId) {
  const events = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const payload = await apiClient.fetchEvents({
      sessionId,
      order: "asc",
      limit: 1000,
      offset,
      mode: "raw",
    });
    events.push(...payload.events);
    hasMore = Boolean(payload.page?.hasMore);
    offset += Number(payload.page?.limit || 1000);
  }

  return events;
}

export function App() {
  const searchRef = useRef(null);
  const eventRequestId = useRef(0);
  const sessionsRequestId = useRef(0);
  const conversationRequestId = useRef(0);
  const conversationEventsRef = useRef([]);
  const conversationPageRef = useRef(createEmptyConversationPage());
  const conversationLocalSource = useRef([]);
  const [tab, setTab] = useState("stream");
  const [themeMode, setThemeMode] = useLocalStorage({
    key: "observer-theme-mode",
    defaultValue: "dark",
  });
  const [density, setDensity] = useLocalStorage({
    key: "observer-density-mode",
    defaultValue: "cozy",
  });
  const [autoRefresh, setAutoRefresh] = useLocalStorage({
    key: "observer-auto-refresh",
    defaultValue: false,
  });
  const [mode, setMode] = useState("observe");
  const [quickFilter, setQuickFilter] = useState("all");
  const [tokenThreshold, setTokenThreshold] = useState("20000");
  const [streamFilters, setStreamFilters] = useState(defaultStreamFilters);
  const [sessionFilters, setSessionFilters] = useState(defaultSessionFilters);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [selectedSessionIds, setSelectedSessionIds] = useState([]);
  const [dataSource, setDataSource] = useState("server");
  const [localEvents, setLocalEvents] = useState([]);
  const [streamPayload, setStreamPayload] = useState({
    events: [],
    sessions: [],
    meta: { models: [], types: [], platforms: [] },
    totalVisible: 0,
    totalMatching: 0,
    page: { offset: 0, limit: PAGE_LIMIT, hasMore: false },
    generatedAt: "",
    codexVersion: null,
    claudeVersion: null,
  });
  const [sessionsPayload, setSessionsPayload] = useState({
    groups: {},
    total: 0,
    generatedAt: "",
  });
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState(null);
  const [conversationSession, setConversationSession] = useState(null);
  const [conversationEvents, setConversationEvents] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationLoadingMore, setConversationLoadingMore] = useState(false);
  const [conversationPage, setConversationPage] = useState(createEmptyConversationPage());
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const deferredQuery = useDeferredValue(streamFilters.query);

  const localPayload = buildLocalPayload(localEvents, { ...streamFilters, query: deferredQuery }, selectedSessionId, quickFilter, Number(tokenThreshold) || 20000, mode);
  const currentStream = dataSource === "server" ? streamPayload : localPayload;
  const streamSummary = buildDashboardSummary({
    events: currentStream.events,
    sessions: currentStream.sessions,
    totalVisible: currentStream.totalVisible,
    totalMatching: currentStream.totalMatching,
    totalLoaded: currentStream.events.length,
  });
  const streamScope = buildStreamScope({
    selectedSessionId,
    sessions: currentStream.sessions,
    quickFilter,
    platform: streamFilters.platform,
    query: deferredQuery,
    mode,
  });
  const streamSessions = currentStream.sessions.map((session) => ({
    ...session,
    title: session.sessionTitle?.trim() || session.fallbackTitle?.trim() || "未命名会话",
    totalTokens: Number(session.aggregateToken?.total) || 0,
  }));

  const sessionSections = buildSessionSections(
    dataSource === "server" ? sessionsPayload.groups : groupSessionsByCwd(buildSessionGroups(localEvents)),
    sessionFilters,
  );

  async function loadEvents({ append = false } = {}) {
    if (dataSource !== "server") return;

    const requestId = ++eventRequestId.current;
    setLoadingEvents(true);
    try {
      const payload = await apiClient.fetchEvents({
        mode,
        quickFilter,
        tokenThreshold,
        q: deferredQuery.trim().toLowerCase(),
        model: streamFilters.model,
        type: streamFilters.type,
        platform: streamFilters.platform,
        start: streamFilters.start,
        end: streamFilters.end,
        order: streamFilters.order,
        sessionId: selectedSessionId,
        limit: PAGE_LIMIT,
        offset: append ? Number(streamPayload.page?.offset || 0) + PAGE_LIMIT : 0,
      });

      if (requestId !== eventRequestId.current) return;
      startTransition(() => {
        setStreamPayload((current) => {
          if (!append) return payload;
          return {
            ...payload,
            events: [...current.events, ...payload.events],
          };
        });
      });
    } catch (error) {
      notifications.show({
        title: "事件流加载失败",
        message: String(error.message || error),
        color: "red",
      });
    } finally {
      if (requestId === eventRequestId.current) setLoadingEvents(false);
    }
  }

  async function loadSessions() {
    if (dataSource !== "server") return;

    const requestId = ++sessionsRequestId.current;
    setLoadingSessions(true);
    try {
      const payload = await apiClient.fetchSessions();
      if (requestId !== sessionsRequestId.current) return;
      startTransition(() => {
        setSessionsPayload(payload);
      });
    } catch (error) {
      notifications.show({
        title: "会话列表加载失败",
        message: String(error.message || error),
        color: "red",
      });
    } finally {
      if (requestId === sessionsRequestId.current) setLoadingSessions(false);
    }
  }

  function commitConversationChunk(nextEvents, total, options = {}) {
    const merged = mergeConversationPage(
      conversationEventsRef.current,
      conversationPageRef.current,
      nextEvents,
      { total, replace: Boolean(options.replace) },
    );
    conversationEventsRef.current = merged.events;
    conversationPageRef.current = merged.page;
    startTransition(() => {
      setConversationEvents(merged.events);
      setConversationPage(merged.page);
    });
  }

  function closeConversation() {
    conversationRequestId.current += 1;
    conversationLocalSource.current = [];
    conversationEventsRef.current = [];
    conversationPageRef.current = createEmptyConversationPage();
    setConversationSession(null);
    setConversationLoading(false);
    setConversationLoadingMore(false);
    startTransition(() => {
      setConversationEvents([]);
      setConversationPage(createEmptyConversationPage());
    });
  }

  useEffect(() => {
    document.documentElement.dataset.observerTheme = themeMode;
    return () => {
      delete document.documentElement.dataset.observerTheme;
    };
  }, [themeMode]);

  useEffect(() => {
    if (dataSource !== "server") return undefined;
    const timer = window.setTimeout(() => {
      loadEvents();
    }, 140);

    return () => window.clearTimeout(timer);
  }, [
    dataSource,
    deferredQuery,
    mode,
    quickFilter,
    tokenThreshold,
    selectedSessionId,
    streamFilters.model,
    streamFilters.type,
    streamFilters.platform,
    streamFilters.start,
    streamFilters.end,
    streamFilters.order,
  ]);

  useEffect(() => {
    loadSessions();
  }, [dataSource]);

  useEffect(() => {
    if (dataSource !== "server" || !autoRefresh || tab !== "stream") return undefined;
    const id = window.setInterval(() => {
      loadEvents();
    }, 5000);
    return () => window.clearInterval(id);
  }, [autoRefresh, dataSource, tab, deferredQuery, mode, quickFilter, tokenThreshold, selectedSessionId]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "r" && !event.metaKey && !event.ctrlKey && dataSource === "server") {
        event.preventDefault();
        loadEvents();
      }
      if (event.key === "a" && !event.metaKey && !event.ctrlKey && dataSource === "server") {
        event.preventDefault();
        setAutoRefresh((value) => !value);
      }
      if (event.key === "t" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setThemeMode((value) => (value === "dark" ? "light" : "dark"));
      }
      if (event.key === "m" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setMode((value) => (value === "observe" ? "raw" : "observe"));
      }
      if (event.key === "Escape") {
        setFiltersOpen(false);
        setHelpOpen(false);
        setDetailEvent(null);
        closeConversation();
        setRenameTarget(null);
        setDeleteTarget(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dataSource]);

  function toggleTheme() {
    setThemeMode((value) => (value === "dark" ? "light" : "dark"));
  }

  function toggleDensity() {
    setDensity((value) => (value === "compact" ? "cozy" : "compact"));
  }

  function selectSession(sessionId) {
    setSelectedSessionId((current) => (current === sessionId ? "" : sessionId));
  }

  async function handleImport(files) {
    if (!files?.length) return;
    try {
      const events = await parseFiles(Array.from(files));
      setAutoRefresh(false);
      setDataSource("local");
      setSelectedSessionId("");
      startTransition(() => {
        setLocalEvents(events);
        setTab("stream");
      });
      notifications.show({
        title: "本地日志已导入",
        message: `已载入 ${formatNumber(events.length)} 条事件`,
        color: "blue",
      });
    } catch (error) {
      notifications.show({
        title: "导入失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }

  function returnToLiveMode() {
    closeConversation();
    setDataSource("server");
    setLocalEvents([]);
    setSelectedSessionId("");
    setSelectedSessionIds([]);
    notifications.show({
      title: "已切回实时索引",
      message: "当前视图重新使用本地服务端聚合数据。",
      color: "blue",
    });
  }

  function exportCurrentView() {
    if (tab === "stream") {
      downloadJsonl(`session-observer-events-${Date.now()}.jsonl`, currentStream.events);
      return;
    }
    downloadJson(`session-observer-sessions-${Date.now()}.json`, sessionSections);
  }

  async function openConversation(session) {
    const requestId = ++conversationRequestId.current;
    conversationLocalSource.current = [];
    conversationEventsRef.current = [];
    conversationPageRef.current = createEmptyConversationPage();
    setConversationSession(session);
    setConversationEvents([]);
    setConversationPage(createEmptyConversationPage());
    setConversationLoadingMore(false);
    setConversationLoading(true);

    if (dataSource !== "server") {
      const allEvents = localEvents
        .filter((event) => event.sessionId === session.sessionId)
        .sort((left, right) => String(left.time).localeCompare(String(right.time)));
      const firstSlice = sliceConversationPage(allEvents, 0, CONVERSATION_PAGE_LIMIT);
      conversationLocalSource.current = allEvents;
      commitConversationChunk(firstSlice.events, firstSlice.page.total, { replace: true });
      setConversationLoading(false);
      return;
    }

    try {
      const payload = await apiClient.fetchEvents({
        sessionId: session.sessionId,
        order: "asc",
        limit: CONVERSATION_PAGE_LIMIT,
        offset: 0,
        mode: "raw",
      });
      if (requestId !== conversationRequestId.current) return;
      commitConversationChunk(payload.events || [], Number(payload.totalMatching) || payload.events?.length || 0, { replace: true });
    } catch (error) {
      if (requestId !== conversationRequestId.current) return;
      notifications.show({
        title: "会话加载失败",
        message: String(error.message || error),
        color: "red",
      });
    } finally {
      if (requestId === conversationRequestId.current) setConversationLoading(false);
    }
  }

  async function loadMoreConversation() {
    if (!conversationSession || conversationLoading || conversationLoadingMore || !conversationPageRef.current.hasMore) return;

    if (dataSource !== "server") {
      setConversationLoadingMore(true);
      try {
        const nextSlice = sliceConversationPage(
          conversationLocalSource.current,
          conversationPageRef.current.nextOffset,
          CONVERSATION_PAGE_LIMIT,
        );
        commitConversationChunk(nextSlice.events, nextSlice.page.total);
      } finally {
        setConversationLoadingMore(false);
      }
      return;
    }

    const requestId = ++conversationRequestId.current;
    setConversationLoadingMore(true);
    try {
      const payload = await apiClient.fetchEvents({
        sessionId: conversationSession.sessionId,
        order: "asc",
        limit: CONVERSATION_PAGE_LIMIT,
        offset: conversationPageRef.current.nextOffset,
        mode: "raw",
      });
      if (requestId !== conversationRequestId.current) return;
      commitConversationChunk(payload.events || [], Number(payload.totalMatching) || payload.events?.length || 0);
    } catch (error) {
      if (requestId !== conversationRequestId.current) return;
      notifications.show({
        title: "继续加载失败",
        message: String(error.message || error),
        color: "red",
      });
    } finally {
      if (requestId === conversationRequestId.current) setConversationLoadingMore(false);
    }
  }

  async function confirmRename() {
    if (!renameTarget || !renameValue.trim()) return;
    try {
      await apiClient.renameSession(renameTarget.sessionId, renameValue.trim());
      setRenameTarget(null);
      setRenameValue("");
      await loadSessions();
      await loadEvents();
      notifications.show({
        title: "会话已重命名",
        message: renameValue.trim(),
        color: "blue",
      });
    } catch (error) {
      notifications.show({
        title: "重命名失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await apiClient.deleteSession(deleteTarget.sessionId);
      setDeleteTarget(null);
      setSelectedSessionIds((current) => current.filter((id) => id !== deleteTarget.sessionId));
      await loadSessions();
      await loadEvents();
      notifications.show({
        title: "会话已删除",
        message: deleteTarget.title || deleteTarget.sessionTitle || deleteTarget.fallbackTitle || deleteTarget.sessionId,
        color: "red",
      });
    } catch (error) {
      notifications.show({
        title: "删除失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }

  function toggleSessionSelection(sessionId) {
    setSelectedSessionIds((current) => (
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId]
    ));
  }

  async function batchDelete() {
    if (selectedSessionIds.length === 0) return;
    try {
      await apiClient.batchDeleteSessions(selectedSessionIds);
      setSelectedSessionIds([]);
      await loadSessions();
      await loadEvents();
      notifications.show({
        title: "批量删除完成",
        message: `已处理 ${formatNumber(selectedSessionIds.length)} 个会话`,
        color: "red",
      });
    } catch (error) {
      notifications.show({
        title: "批量删除失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }

  async function batchExport() {
    if (selectedSessionIds.length === 0) return;
    try {
      const chunks = [];
      for (const sessionId of selectedSessionIds) {
        const events = await fetchAllSessionEvents(sessionId);
        chunks.push(...events);
      }
      downloadJsonl(`session-observer-selection-${Date.now()}.jsonl`, chunks);
      notifications.show({
        title: "批量导出完成",
        message: `已导出 ${formatNumber(chunks.length)} 条事件`,
        color: "blue",
      });
    } catch (error) {
      notifications.show({
        title: "批量导出失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }

  const canMutateSessions = dataSource === "server";
  const headerStatus = dataSource === "server"
    ? `实时索引 · 最近更新 ${formatFullDateTime(streamPayload.generatedAt)}`
    : `本地导入 · ${formatNumber(localEvents.length)} 条事件`;

  async function copySessionId(sessionId) {
    if (!sessionId) return;
    await navigator.clipboard.writeText(sessionId);
    notifications.show({
      title: "已复制会话 ID",
      message: shortMessage(sessionId),
      color: "blue",
    });
  }

  return (
    <MantineProvider theme={theme} forceColorScheme={themeMode}>
      <Notifications position="top-right" />
      <div className={`observer-root theme-${themeMode} density-${density}`}>
        <AppShell header={{ height: { base: 156, sm: 104 } }} padding="md">
          <AppShell.Header className="shell-header">
            <div className="shell-header__inner">
              <Group justify="space-between" align="flex-start" wrap="nowrap">
                <div>
                  <Group gap="sm" mb={6}>
                    <div className="brand-mark">SO</div>
                    <div>
                      <Title order={3}>Session Observer</Title>
                      <Text className="header-status">{headerStatus}</Text>
                    </div>
                  </Group>
                  <Group gap="xs">
                    <Badge radius="xl" variant="light" color={dataSource === "server" ? "blue" : "orange"}>
                      {dataSource === "server" ? "Live" : "Import"}
                    </Badge>
                    <Badge radius="xl" variant="light" color="gray">
                      匹配 {formatNumber(currentStream.totalMatching || currentStream.events.length)}
                    </Badge>
                    <Badge radius="xl" variant="light" color="gray">
                      会话 {formatNumber(streamSummary.counts.sessions)}
                    </Badge>
                  </Group>
                </div>
                <Group gap="xs" align="center" className="header-actions">
                  <Switch
                    checked={autoRefresh}
                    onChange={(event) => setAutoRefresh(event.currentTarget.checked)}
                    disabled={dataSource !== "server"}
                    label="自动刷新"
                    color="blue"
                  />
                  <ActionIcon radius="xl" variant="light" color="blue" size="lg" onClick={() => loadEvents()}>
                    <IconRefresh size={18} />
                  </ActionIcon>
                  <ActionIcon radius="xl" variant="light" color="gray" size="lg" onClick={toggleTheme}>
                    {themeMode === "dark" ? <IconSun size={18} /> : <IconMoon size={18} />}
                  </ActionIcon>
                  <ActionIcon radius="xl" variant="light" color="gray" size="lg" onClick={toggleDensity}>
                    <IconBulb size={18} />
                  </ActionIcon>
                  <ActionIcon radius="xl" variant="light" color="gray" size="lg" onClick={() => setHelpOpen(true)}>
                    <IconAlertCircle size={18} />
                  </ActionIcon>
                  <Button variant="light" radius="xl" color="gray" leftSection={<IconCloudDownload size={16} />} onClick={exportCurrentView}>
                    导出
                  </Button>
                  <FileButton onChange={handleImport} accept=".jsonl,.log,.txt" multiple>
                    {(props) => (
                      <Button {...props} variant="light" radius="xl" color="blue" leftSection={<IconCloudUpload size={16} />}>
                        导入
                      </Button>
                    )}
                  </FileButton>
                  {dataSource === "local" ? (
                    <Button variant="light" radius="xl" color="orange" onClick={returnToLiveMode}>
                      返回实时
                    </Button>
                  ) : null}
                </Group>
              </Group>
            </div>
          </AppShell.Header>

          <AppShell.Main>
            <Stack gap="lg" className="app-main">
              <Paper className="toolbar-shell" radius="xl" p="md">
                <Group justify="space-between" wrap="wrap" gap="sm">
                  <SegmentedControl
                    radius="xl"
                    value={tab}
                    onChange={setTab}
                    data={[
                      { label: "事件流", value: "stream" },
                      { label: "会话", value: "sessions" },
                    ]}
                  />
                  {tab === "stream" ? (
                    <Group gap="sm" wrap="wrap">
                      <SegmentedControl
                        radius="xl"
                        value={mode}
                        onChange={setMode}
                        data={[
                          { label: "观测", value: "observe" },
                          { label: "原始", value: "raw" },
                        ]}
                      />
                      <SegmentedControl
                        radius="xl"
                        value={quickFilter}
                        onChange={setQuickFilter}
                        data={[
                          { label: "全部", value: "all" },
                          { label: "异常", value: "alert" },
                          { label: "高 Token", value: "high_token" },
                        ]}
                      />
                      <Button variant="subtle" radius="xl" color="gray" onClick={() => setFiltersOpen(true)}>
                        高级筛选
                      </Button>
                    </Group>
                  ) : (
                    <Group gap="xs">
                      <Badge radius="xl" variant="light" color="gray">
                        {loadingSessions ? "刷新中" : `共 ${formatNumber(sessionSections.reduce((sum, section) => sum + section.total, 0))} 个会话`}
                      </Badge>
                    </Group>
                  )}
                </Group>
              </Paper>

              {tab === "stream" ? (
                <>
                  <Paper className="control-shelf" radius="xl" p="md">
                    <Group wrap="wrap" align="flex-end">
                      <TextInput
                        ref={searchRef}
                        label="搜索"
                        placeholder="内容 / session / tool / cwd"
                        leftSection={<IconSearch size={16} />}
                        value={streamFilters.query}
                        onChange={(event) => setStreamFilters((current) => ({ ...current, query: event.currentTarget.value }))}
                        className="control-field control-field--wide"
                      />
                      <Select
                        label="模型"
                        placeholder="全部模型"
                        data={(currentStream.meta.models || []).map((item) => ({ value: item, label: item }))}
                        value={streamFilters.model}
                        onChange={(value) => setStreamFilters((current) => ({ ...current, model: value || "" }))}
                        clearable
                        className="control-field"
                      />
                      <Select
                        label="类型"
                        placeholder="全部类型"
                        data={(currentStream.meta.types || []).map((item) => ({ value: item, label: item }))}
                        value={streamFilters.type}
                        onChange={(value) => setStreamFilters((current) => ({ ...current, type: value || "" }))}
                        clearable
                        className="control-field"
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
                        className="control-field"
                      />
                    </Group>
                  </Paper>

                  <StreamWorkspace
                    scope={streamScope}
                    summary={streamSummary}
                    sessions={streamSessions}
                    events={currentStream.events}
                    selectedSessionId={selectedSessionId}
                    onSelectSession={selectSession}
                    onOpenFilters={() => setFiltersOpen(true)}
                    onOpenEvent={setDetailEvent}
                    onLoadMore={() => loadEvents({ append: true })}
                    hasMore={Boolean(currentStream.page?.hasMore) && dataSource === "server"}
                    loading={loadingEvents}
                  />
                </>
              ) : (
                <>
                  <Paper className="control-shelf" radius="xl" p="md">
                    <Group wrap="wrap" align="flex-end">
                      <TextInput
                        label="搜索会话"
                        placeholder="会话名 / cwd / session ID"
                        leftSection={<IconSearch size={16} />}
                        value={sessionFilters.query}
                        onChange={(event) => setSessionFilters((current) => ({ ...current, query: event.currentTarget.value }))}
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
                      <Checkbox
                        label="仅显示已命名"
                        checked={sessionFilters.namedOnly}
                        onChange={(event) => setSessionFilters((current) => ({ ...current, namedOnly: event.currentTarget.checked }))}
                        mb={10}
                      />
                      <Button variant="light" radius="xl" color="gray" onClick={loadSessions}>
                        刷新列表
                      </Button>
                      {selectedSessionIds.length > 0 ? (
                        <>
                          <Button variant="light" radius="xl" color="blue" onClick={batchExport}>
                            批量导出 {selectedSessionIds.length}
                          </Button>
                          <Button variant="light" radius="xl" color="red" onClick={batchDelete} disabled={!canMutateSessions}>
                            批量删除 {selectedSessionIds.length}
                          </Button>
                        </>
                      ) : null}
                    </Group>
                  </Paper>

                  <SessionWorkspace
                    sections={sessionSections}
                    selectedIds={selectedSessionIds}
                    onToggleSelect={toggleSessionSelection}
                    onOpenConversation={openConversation}
                    onRename={(session) => {
                      if (!canMutateSessions) return;
                      setRenameTarget(session);
                      setRenameValue(session.title || "");
                    }}
                    onDelete={(session) => {
                      if (!canMutateSessions) return;
                      setDeleteTarget(session);
                    }}
                    onCopySessionId={copySessionId}
                  />
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
              onChange={(event) => setStreamFilters((current) => ({ ...current, start: event.currentTarget.value }))}
            />
            <TextInput
              label="结束时间"
              type="datetime-local"
              value={streamFilters.end}
              onChange={(event) => setStreamFilters((current) => ({ ...current, end: event.currentTarget.value }))}
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
                  setStreamFilters(defaultStreamFilters);
                  setQuickFilter("all");
                  setTokenThreshold("20000");
                }}
              >
                重置
              </Button>
              <Button onClick={() => setFiltersOpen(false)}>完成</Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={helpOpen} onClose={() => setHelpOpen(false)} title="快捷键与说明" centered>
          <Stack gap="sm">
            <Text>/ 聚焦搜索</Text>
            <Text>r 刷新实时事件</Text>
            <Text>a 开关自动刷新</Text>
            <Text>t 切换主题</Text>
            <Text>m 切换观测 / 原始模式</Text>
            <Divider />
            <Text>实时模式读取本地服务端索引；导入模式只在浏览器内查看文件内容，不会改动磁盘数据。</Text>
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

        <EventDrawer
          event={detailEvent}
          opened={Boolean(detailEvent)}
          onClose={() => setDetailEvent(null)}
          onCopySessionId={copySessionId}
          onCopy={(event) => {
            navigator.clipboard.writeText(JSON.stringify(event, null, 2));
            notifications.show({
              title: "已复制 JSON",
              message: shortMessage(event.summary || event.callType),
              color: "blue",
            });
          }}
        />

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
      </div>
    </MantineProvider>
  );
}

function shortMessage(text) {
  return String(text || "").trim().replace(/\s+/g, " ").slice(0, 80);
}
