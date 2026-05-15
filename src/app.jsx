import { lazy, startTransition, Suspense, useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
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
  IconX,
} from "@tabler/icons-react";
import ObserverData from "../shared/observer-data.js";
import { apiClient } from "./api/client";
import {
  downloadJson,
  downloadJsonl,
  formatFullDateTime,
  formatNumber,
} from "./lib/formatters";
import {
  DEFAULT_SESSION_FILTERS,
  DEFAULT_STREAM_FILTERS,
  DEFAULT_TOKEN_THRESHOLD,
  parseUrlState,
} from "./lib/url-state";
import {
  buildLocalSessionGroups,
  buildLocalStreamPayload,
  buildDashboardSummary,
  buildSessionSections,
  buildStreamSessionRailItems,
  buildStreamScope,
} from "./lib/workspace-models";
import { useConversationData } from "./hooks/use-conversation-data";
import { useSessionActions } from "./hooks/use-session-actions";
import { useSessionData } from "./hooks/use-session-data";
import { useStreamData } from "./hooks/use-stream-data";
import { useUrlStateSync } from "./hooks/use-url-state-sync";

const { parseFiles } = ObserverData;

const StreamWorkspace = lazy(() => import("./components/stream-workspace").then((module) => ({
  default: module.StreamWorkspace,
})));
const SessionWorkspace = lazy(() => import("./components/session-workspace").then((module) => ({
  default: module.SessionWorkspace,
})));
const EventDrawer = lazy(() => import("./components/event-drawer").then((module) => ({
  default: module.EventDrawer,
})));
const ConversationDrawer = lazy(() => import("./components/conversation-drawer").then((module) => ({
  default: module.ConversationDrawer,
})));

const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "xl",
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
  const [density, setDensity] = useLocalStorage({
    key: "observer-density-mode",
    defaultValue: "cozy",
  });
  const [autoRefresh, setAutoRefresh] = useLocalStorage({
    key: "observer-auto-refresh",
    defaultValue: false,
  });
  const [mode, setMode] = useState(initialUrlState.mode);
  const [quickFilter, setQuickFilter] = useState(initialUrlState.quickFilter);
  const [tokenThreshold, setTokenThreshold] = useState(initialUrlState.tokenThreshold || DEFAULT_TOKEN_THRESHOLD);
  const [streamFilters, setStreamFilters] = useState(initialUrlState.streamFilters || DEFAULT_STREAM_FILTERS);
  const [sessionFilters, setSessionFilters] = useState(initialUrlState.sessionFilters || DEFAULT_SESSION_FILTERS);
  const [selectedSessionId, setSelectedSessionId] = useState(initialUrlState.selectedSessionId);
  const [dataSource, setDataSource] = useState("server");
  const [localEvents, setLocalEvents] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState(null);
  const deferredQuery = useDeferredValue(streamFilters.query);
  const notify = useCallback((options) => notifications.show(options), []);
  const { streamPayload, loadingEvents, loadEvents } = useStreamData({
    dataSource,
    mode,
    quickFilter,
    tokenThreshold,
    selectedSessionId,
    streamFilters,
    query: deferredQuery,
    notify,
  });
  const { sessionsPayload, loadingSessions, loadSessions } = useSessionData({
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
    selectedSessionIds,
    renameTarget,
    renameValue,
    deleteTarget,
    setRenameValue,
    setRenameTarget,
    setDeleteTarget,
    openRename,
    openDelete,
    confirmRename,
    confirmDelete,
    toggleSessionSelection,
    clearSessionSelection,
    batchDelete,
    batchExport,
  } = useSessionActions({
    loadSessions,
    loadEvents,
    notify,
  });

  const localPayload = buildLocalStreamPayload({
    events: localEvents,
    filters: { ...streamFilters, query: deferredQuery },
    selectedSessionId,
    quickFilter,
    tokenThreshold: Number(tokenThreshold) || 20000,
    mode,
  });
  const currentStream = dataSource === "server" ? streamPayload : localPayload;
  const streamSummary = buildDashboardSummary({
    events: currentStream.events,
    sessions: currentStream.sessions,
    totalVisible: currentStream.totalVisible,
    totalMatching: currentStream.totalMatching,
    totalLoaded: currentStream.events.length,
    tokenWindows: currentStream.tokenWindows,
  });
  const streamScope = buildStreamScope({
    selectedSessionId,
    sessions: currentStream.sessions,
    quickFilter,
    platform: streamFilters.platform,
    query: deferredQuery,
    mode,
  });
  const streamSessions = buildStreamSessionRailItems(currentStream.sessions);

  const sessionSections = buildSessionSections(
    dataSource === "server" ? sessionsPayload.groups : buildLocalSessionGroups(localEvents),
    sessionFilters,
  );

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
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (dataSource !== "server" || !autoRefresh || tab !== "stream") return undefined;
    const id = window.setInterval(() => {
      loadEvents();
    }, 5000);
    return () => window.clearInterval(id);
  }, [autoRefresh, dataSource, tab, loadEvents]);

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
        loadEvents();
      }
      if (event.key === "a" && !hasModifier && !isEditing && dataSource === "server") {
        event.preventDefault();
        setAutoRefresh((value) => !value);
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
        setHelpOpen(false);
        setDetailEvent(null);
        closeConversation();
        setRenameTarget(null);
        setDeleteTarget(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dataSource, loadEvents, setAutoRefresh, setThemeMode]);

  function toggleTheme() {
    setThemeMode((value) => (value === "dark" ? "light" : "dark"));
  }

  function toggleDensity() {
    setDensity((value) => (value === "compact" ? "cozy" : "compact"));
  }

  function selectSession(sessionId) {
    setSelectedSessionId((current) => (current === sessionId ? "" : sessionId));
  }

  function clearSessionFocus() {
    setSelectedSessionId("");
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
    clearSessionSelection();
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

  const canMutateSessions = dataSource === "server";
  const headerStatus = dataSource === "server"
    ? `实时索引 · 最近更新 ${formatFullDateTime(streamPayload.generatedAt)}`
    : `本地导入 · ${formatNumber(localEvents.length)} 条事件`;
  const activeStreamFilters = [
    deferredQuery ? {
      key: "query",
      label: `搜索 ${deferredQuery}`,
      clear: () => setStreamFilters((current) => ({ ...current, query: "" })),
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
      label: quickFilter === "alert" ? "异常" : "高 Token",
      clear: () => setQuickFilter("all"),
    } : null,
    selectedSessionId ? {
      key: "session",
      label: `会话 ${selectedSessionId.slice(0, 8)}`,
      clear: clearSessionFocus,
    } : null,
  ].filter(Boolean);

  async function copySessionId(sessionId) {
    if (!sessionId) return;
    await navigator.clipboard.writeText(sessionId);
    notifications.show({
      title: "已复制会话 ID",
      message: shortMessage(sessionId),
      color: "blue",
    });
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
                        onChange={(event) => {
                          const query = event.currentTarget.value;
                          setStreamFilters((current) => ({ ...current, query }));
                        }}
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
                    {activeStreamFilters.length ? (
                      <Group gap="xs" className="active-filter-bar">
                        <Text className="active-filter-bar__label">当前筛选</Text>
                        {activeStreamFilters.map((filter) => (
                          <Button
                            key={filter.key}
                            variant="light"
                            color="gray"
                            radius="xl"
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
                          radius="xl"
                          size="xs"
                          onClick={() => {
                            setStreamFilters(DEFAULT_STREAM_FILTERS);
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
                      onLoadMore={() => loadEvents({ append: true })}
                      hasMore={Boolean(currentStream.page?.hasMore) && dataSource === "server"}
                      loading={loadingEvents}
                      generatedAt={currentStream.generatedAt}
                    />
                  </Suspense>
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
                      <Checkbox
                        label="仅显示已命名"
                        checked={sessionFilters.namedOnly}
                        onChange={(event) => {
                          const namedOnly = event.currentTarget.checked;
                          setSessionFilters((current) => ({ ...current, namedOnly }));
                        }}
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

                  <Suspense fallback={<WorkspaceFallback label="正在加载会话列表…" />}>
                    <SessionWorkspace
                      sections={sessionSections}
                      selectedIds={selectedSessionIds}
                      onToggleSelect={toggleSessionSelection}
                      onOpenConversation={openConversation}
                      onRename={(session) => {
                        if (canMutateSessions) openRename(session);
                      }}
                      onDelete={(session) => {
                        if (canMutateSessions) openDelete(session);
                      }}
                      onCopySessionId={copySessionId}
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
                  setStreamFilters(DEFAULT_STREAM_FILTERS);
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

        {detailEvent ? (
          <Suspense fallback={null}>
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
