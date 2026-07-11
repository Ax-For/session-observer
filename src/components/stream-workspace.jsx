import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconChartBar,
  IconChevronDown,
  IconPlayerPause,
  IconPlayerPlay,
  IconX,
} from "@tabler/icons-react";
import {
  activityRunSummary,
  buildActivityRuns,
  filterActivityRuns,
} from "../lib/activity-models";
import {
  callTypeLabel,
  clipText,
  formatCompactNumber,
  formatDateTime,
  formatNumber,
  shortSessionId,
} from "../lib/formatters";
import {
  eventDialogueRole,
  eventTone,
  readableDialogueContent,
  readableEventSummary,
} from "../lib/event-display";

const EVENT_ROW_HEIGHT = 98;
const EVENT_OVERSCAN = 6;
const RUN_RENDER_BATCH = 120;
const MAX_EXPANDED_EVENTS = 24;

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildHighlightTerms(query) {
  const normalized = String(query || "").trim();
  if (normalized.length < 2) return [];
  return [...new Set([normalized, ...normalized.split(/\s+/)].filter((term) => term.length >= 2))]
    .sort((left, right) => right.length - left.length);
}

function HighlightedText({ text, query }) {
  const content = String(text ?? "");
  const terms = buildHighlightTerms(query);
  if (!content || !terms.length) return content;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  const parts = content.split(pattern).filter((part) => part !== "");
  if (parts.length <= 1) {
    const lowerContent = content.toLocaleLowerCase();
    const lowerQuery = String(query || "").toLocaleLowerCase();
    if (content.trim().length >= 4 && lowerQuery.includes(lowerContent)) {
      return <mark className="event-search-highlight">{content}</mark>;
    }
    return content;
  }

  return parts.map((part, index) => {
    const matched = terms.some((term) => part.toLocaleLowerCase() === term.toLocaleLowerCase());
    return matched ? (
      <mark key={`${part}-${index}`} className="event-search-highlight">{part}</mark>
    ) : (
      <Fragment key={`${part}-${index}`}>{part}</Fragment>
    );
  });
}

function formatTimeWithSeconds(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replace("/", "-");
}

function formatDuration(value) {
  const milliseconds = Number(value) || 0;
  if (milliseconds < 1000) return "<1s";
  const seconds = Math.round(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function EventRow({ event, onOpenEvent, onOpenSessionDetail, searchQuery }) {
  const dialogueRole = eventDialogueRole(event.callType);
  const rowClasses = [
    "event-row",
    `event-row--${eventTone(event.callType)}`,
    dialogueRole ? `event-row--dialogue event-row--dialogue-${dialogueRole}` : "",
  ].filter(Boolean).join(" ");
  const summary = dialogueRole ? readableDialogueContent(event) : readableEventSummary(event);

  return (
    <div className={rowClasses}>
      <button type="button" className="event-row__open" onClick={() => onOpenEvent?.(event)}>
        <span className="event-row__rail" aria-hidden="true"><span className="event-row__dot" /></span>
        <div className="event-row__body">
          <div className="event-row__kicker">
            <span className="event-row__platform">{event.sourceType === "codex" ? "CX" : "CC"}</span>
            {dialogueRole ? <span className="event-row__speaker">{dialogueRole === "user" ? "用户" : "Agent"}</span> : null}
            {!dialogueRole ? <span className="event-row__type">{callTypeLabel(event.callType)}</span> : null}
            <span className="event-row__model">{event.model || "unknown"}</span>
          </div>
          <Text className="event-row__summary">
            <HighlightedText text={summary} query={dialogueRole ? searchQuery : ""} />
          </Text>
          <div className="event-row__meta-line">
            <span>{shortSessionId(event.sessionId)}</span>
            <span>{event.extra || "事件详情"}</span>
            <span>{clipText(event.cwd || "", 48)}</span>
          </div>
        </div>
        <div className="event-row__side">
          <Text className="event-row__timestamp">{formatTimeWithSeconds(event.time)}</Text>
          <span className="event-row__arrow" aria-hidden="true"><IconArrowRight size={14} /></span>
        </div>
      </button>
      <button
        type="button"
        className="event-row__session-action"
        aria-label={`查看会话详情 ${shortSessionId(event.sessionId)}`}
        onClick={() => onOpenSessionDetail?.(event, { order: "desc" })}
      >
        会话详情
      </button>
    </div>
  );
}

function dedupeAdjacentDialogueEvents(events) {
  const rows = [];
  let previousDialogue = null;
  for (const event of events || []) {
    const role = eventDialogueRole(event?.callType);
    if (!role) {
      rows.push(event);
      previousDialogue = null;
      continue;
    }
    const content = readableDialogueContent(event, 10_000).trim().replace(/\s+/g, " ");
    const signature = `${event?.sessionId || ""}:${role}:${content}`;
    if (content && signature === previousDialogue) continue;
    rows.push(event);
    previousDialogue = content ? signature : null;
  }
  return rows;
}

function virtualEventKey(event, absoluteIndex) {
  const identity = event?.eventId
    || event?.id
    || `${event?.time || "unknown"}-${event?.sessionId || "unknown"}-${event?.callType || "unknown"}-${event?.extra || ""}`;
  return `${identity}:${absoluteIndex}`;
}

function VirtualEventList({ events, onOpenEvent, onOpenSessionDetail, searchQuery }) {
  const viewportRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(520);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const syncViewportHeight = () => setViewportHeight(viewport.clientHeight || 520);
    syncViewportHeight();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(syncViewportHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  const eventList = dedupeAdjacentDialogueEvents(events);
  const totalHeight = eventList.length * EVENT_ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / EVENT_ROW_HEIGHT) - EVENT_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / EVENT_ROW_HEIGHT) + EVENT_OVERSCAN * 2;
  const endIndex = Math.min(eventList.length, startIndex + visibleCount);
  const visibleEvents = eventList.slice(startIndex, endIndex);

  return (
    <div
      ref={viewportRef}
      className="feed-virtual-scroll"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{ "--event-row-height": `${EVENT_ROW_HEIGHT}px` }}
    >
      <div className="feed-virtual-scroll__spacer" style={{ height: totalHeight }}>
        {visibleEvents.map((event, index) => {
          const absoluteIndex = startIndex + index;
          return (
            <div
              key={virtualEventKey(event, absoluteIndex)}
              className="feed-virtual-scroll__item"
              style={{ transform: `translateY(${absoluteIndex * EVENT_ROW_HEIGHT}px)` }}
            >
              <EventRow
                event={event}
                onOpenEvent={onOpenEvent}
                onOpenSessionDetail={onOpenSessionDetail}
                searchQuery={searchQuery}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityRunRow({ run, onOpenEvent, onOpenSessionDetail, searchQuery }) {
  const [expanded, setExpanded] = useState(false);
  const meaningfulEvents = dedupeAdjacentDialogueEvents(
    run.events.filter((event) => !["Token_Usage", "Raw"].includes(event.callType)),
  );
  const eventRows = meaningfulEvents.slice(-MAX_EXPANDED_EVENTS).reverse();
  const hiddenEvents = Math.max(0, run.events.length - eventRows.length);
  const sessionTarget = {
    ...(run.latestEvent || {}),
    sessionId: run.sessionId,
    title: run.title,
    cwd: run.cwd,
    sourceType: run.sourceType,
  };

  return (
    <article className={`activity-run${expanded ? " is-expanded" : ""}${run.toolErrors ? " has-errors" : ""}`}>
      <div className="activity-run__main">
        <button type="button" className="activity-run__toggle" onClick={() => setExpanded((current) => !current)}>
          <span className={`activity-run__source is-${run.sourceType}`}>{run.sourceType === "codex" ? "CX" : "CC"}</span>
          <span className="activity-run__copy">
            <span className="activity-run__kicker">
              <strong>{run.userPreview ? "用户回合" : run.hasTools ? "工具运行" : "会话活动"}</strong>
              <span>{run.models.at(-1) || "unknown"}</span>
              <span>{shortSessionId(run.sessionId)}</span>
            </span>
            <span className="activity-run__prompt">
              <HighlightedText text={run.userPreview || activityRunSummary(run)} query={searchQuery} />
            </span>
            {run.assistantPreview ? (
              <span className="activity-run__answer">
                <HighlightedText text={run.assistantPreview} query={searchQuery} />
              </span>
            ) : null}
          </span>
          <span className="activity-run__side">
            <time>{formatTimeWithSeconds(run.endedAt)}</time>
            <IconChevronDown size={15} aria-hidden="true" />
          </span>
        </button>
        <button
          type="button"
          className="activity-run__session"
          aria-label={`查看会话详情 ${run.title}`}
          onClick={() => onOpenSessionDetail?.(sessionTarget, { order: "desc" })}
        >
          <IconArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="activity-run__facts" aria-label="活动摘要">
        <span>{formatNumber(run.eventCount)} 事件</span>
        {run.toolCalls ? <span>{formatNumber(run.toolCalls)} 工具</span> : null}
        {run.toolErrors ? <span className="is-error">{formatNumber(run.toolErrors)} 错误</span> : null}
        {run.tokenTotal ? <span>{formatCompactNumber(run.tokenTotal)} Tok</span> : null}
        {run.durationMs ? <span>{formatDuration(run.durationMs)}</span> : null}
        <span title={run.cwd}>{clipText(run.cwd, 56) || "工作目录未知"}</span>
      </div>
      {expanded ? (
        <div className="activity-run__events">
          {hiddenEvents ? <Text>已折叠 {formatNumber(hiddenEvents)} 条 Token、原始或更早事件</Text> : null}
          {eventRows.map((event, index) => (
            <button
              key={virtualEventKey(event, index)}
              type="button"
              onClick={() => onOpenEvent?.(event)}
            >
              <span>{callTypeLabel(event.callType)}</span>
              <strong>{readableEventSummary(event, 140)}</strong>
              <time>{formatTimeWithSeconds(event.time)}</time>
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ActivityRunList({ runs, onOpenEvent, onOpenSessionDetail, searchQuery }) {
  const viewportRef = useRef(null);
  const latestIdRef = useRef("");
  const [renderLimit, setRenderLimit] = useState(RUN_RENDER_BATCH);
  const [following, setFollowing] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const visibleRuns = runs.slice(0, renderLimit);

  useEffect(() => {
    const latestId = runs[0]?.id || "";
    if (latestIdRef.current && latestId && latestIdRef.current !== latestId) {
      if (following) viewportRef.current?.scrollTo?.({ top: 0 });
      else setPendingCount((current) => current + 1);
    }
    latestIdRef.current = latestId;
  }, [following, runs]);

  useEffect(() => {
    setRenderLimit(RUN_RENDER_BATCH);
  }, [searchQuery]);

  function resumeFollowing() {
    setFollowing(true);
    setPendingCount(0);
    viewportRef.current?.scrollTo?.({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="activity-feed">
      <div className="activity-feed__status">
        <Button
          size="compact-xs"
          variant="subtle"
          color={following ? "teal" : "gray"}
          leftSection={following ? <IconPlayerPlay size={13} /> : <IconPlayerPause size={13} />}
          onClick={() => (following ? setFollowing(false) : resumeFollowing())}
        >
          {following ? "跟随最新" : "已暂停"}
        </Button>
        {pendingCount ? (
          <Button size="compact-xs" variant="light" color="teal" onClick={resumeFollowing}>
            {formatNumber(pendingCount)} 条新活动
          </Button>
        ) : null}
      </div>
      <ScrollArea
        viewportRef={viewportRef}
        className="activity-feed__scroll"
        offsetScrollbars
        onScrollPositionChange={({ y }) => {
          if (y <= 20 && !following) resumeFollowing();
          if (y > 80 && following) setFollowing(false);
        }}
      >
        <div className="activity-feed__list">
          {visibleRuns.map((run) => (
            <ActivityRunRow
              key={run.id}
              run={run}
              onOpenEvent={onOpenEvent}
              onOpenSessionDetail={onOpenSessionDetail}
              searchQuery={searchQuery}
            />
          ))}
          {!runs.length ? <Text className="activity-feed__empty">当前范围没有可展示的语义活动。</Text> : null}
          {renderLimit < runs.length ? (
            <Button variant="subtle" color="gray" onClick={() => setRenderLimit((current) => current + RUN_RENDER_BATCH)}>
              显示更早活动
            </Button>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
}

function formatInsightList(rows, valueSelector, labelSelector = (row) => row.key) {
  const visibleRows = (rows || []).slice(0, 3);
  if (!visibleRows.length) return "暂无数据";
  return visibleRows
    .map((row) => `${labelSelector(row)} ${formatCompactNumber(valueSelector(row))}`)
    .join(" · ");
}

function StreamWindowInsights({ summary, runs }) {
  const groupedEvents = runs.reduce((total, run) => total + (Number(run.eventCount) || 0), 0);
  const compression = runs.length ? groupedEvents / runs.length : 0;
  const typeSummary = formatInsightList(
    summary?.topTypes,
    (row) => row.value,
    (row) => callTypeLabel(row.key),
  );
  const modelSummary = formatInsightList(summary?.topModels, (row) => row.value);
  const platformSummary = formatInsightList(
    summary?.platforms,
    (row) => row.sessions,
    (row) => row.key === "codex" ? "Codex" : row.key === "claude" ? "Claude" : row.key,
  );

  return (
    <section className="stream-window-insights" aria-label="当前窗口分析">
      <div>
        <span>语义归组</span>
        <strong>{formatNumber(runs.length)} 个活动</strong>
        <em>{formatNumber(groupedEvents)} 条记录 · {compression ? `${compression.toFixed(1)}:1` : "-"}</em>
      </div>
      <div>
        <span>主事件</span>
        <strong>{typeSummary}</strong>
        <em>按当前匹配范围排序</em>
      </div>
      <div>
        <span>主模型</span>
        <strong>{modelSummary}</strong>
        <em>按覆盖会话数统计</em>
      </div>
      <div>
        <span>平台覆盖</span>
        <strong>{platformSummary}</strong>
        <em>{formatNumber(summary?.counts?.sessions || 0)} 个匹配会话</em>
      </div>
    </section>
  );
}

export function StreamWorkspace({
  scope,
  summary,
  sessions,
  events,
  selectedSessionId,
  onSelectSession,
  onClearSessionFocus,
  onOpenEvent,
  onOpenSessionDetail,
  onLoadMore,
  hasMore,
  loading,
  generatedAt,
  searchQuery,
  viewMode = "activity",
}) {
  const matchingCount = Number(summary?.counts?.totalMatching) || 0;
  const loadedCount = Number(summary?.counts?.totalLoaded) || 0;
  const sessionsCount = Number(summary?.counts?.sessions) || 0;
  const runs = useMemo(() => buildActivityRuns(events, sessions), [events, sessions]);
  const filteredRuns = useMemo(() => filterActivityRuns(runs, viewMode), [runs, viewMode]);
  const scopeFacts = [
    { label: "匹配", value: formatNumber(matchingCount) },
    { label: "已载入", value: `${formatNumber(loadedCount)} / ${formatNumber(matchingCount || loadedCount)}` },
    { label: viewMode === "raw" ? "会话" : "活动", value: formatNumber(viewMode === "raw" ? sessionsCount : filteredRuns.length) },
    { label: "更新", value: generatedAt ? formatTimeWithSeconds(generatedAt) : "实时" },
  ];

  return (
    <section className="stream-workbench" role="region" aria-label="事件工作台" data-layout="event-explorer">
      <div className="stream-layout">
        <Paper className="session-rail" radius="md" p="md">
          <Group justify="space-between" mb="sm">
            <div>
              <Text className="eyebrow">会话上下文</Text>
              <Title order={3}>最近活跃</Title>
            </div>
            <Badge radius="sm" variant="light" color="gray">{formatNumber((sessions || []).length)}</Badge>
          </Group>
          <ScrollArea offsetScrollbars className="session-rail__scroll">
            <Stack gap={2}>
              {(sessions || []).map((session) => {
                const active = session.sessionId === selectedSessionId;
                const preview = session.latestAgentMessage || session.latestUserMessage || session.firstUserMessage || session.cwd;
                return (
                  <div key={session.sessionId} className={`session-rail__item${active ? " is-active" : ""}`}>
                    <button type="button" className="session-rail__focus" onClick={() => onSelectSession?.(session.sessionId)}>
                      <span className={`session-rail__mark session-rail__mark--${session.sourceType === "codex" ? "codex" : "claude"}`}>
                        {session.sourceType === "codex" ? "CX" : "CC"}
                      </span>
                      <span className="session-rail__main">
                        <span className="session-rail__title-row">
                          <strong className="session-rail__title" title={session.title || "未命名会话"}>{session.title || "未命名会话"}</strong>
                          <time>{formatTimeWithSeconds(session.latest)}</time>
                        </span>
                        <span className="session-rail__preview" title={preview}>{clipText(preview, 72)}</span>
                        <span className="session-rail__metrics">
                          <span>{formatCompactNumber(session.totalTokens)} Tok</span>
                          <span>{formatNumber(session.count || 0)} 事件</span>
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="session-rail__detail"
                      aria-label={`查看会话详情 ${session.title || session.sessionId}`}
                      onClick={() => onOpenSessionDetail?.(session, { order: "desc" })}
                    >
                      <IconArrowRight size={15} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </Stack>
          </ScrollArea>
        </Paper>

        <Paper className="feed-panel" radius="md" p="md">
          <Group justify="space-between" mb="sm" align="flex-start">
            <div className="feed-panel__heading">
              <Text className="eyebrow">{viewMode === "raw" ? "RAW EVENTS" : "SEMANTIC ACTIVITY"}</Text>
              <Title order={3}>{scope.title}</Title>
              <Text className="feed-panel__scope">{scope.subtitle}</Text>
            </div>
            <Group gap="xs" className="feed-panel__actions">
              {selectedSessionId ? (
                <Button
                  variant="subtle"
                  radius="sm"
                  color="gray"
                  size="xs"
                  leftSection={<IconX size={14} />}
                  onClick={onClearSessionFocus}
                >
                  返回全部会话
                </Button>
              ) : null}
              {scopeFacts.map((fact) => (
                <span key={fact.label} className="feed-panel__fact">{fact.label} <strong>{fact.value}</strong></span>
              ))}
            </Group>
          </Group>

          {viewMode === "raw" ? (
            <VirtualEventList
              events={events}
              onOpenEvent={onOpenEvent}
              onOpenSessionDetail={onOpenSessionDetail}
              searchQuery={searchQuery}
            />
          ) : (
            <>
              <ActivityRunList
                runs={filteredRuns}
                onOpenEvent={onOpenEvent}
                onOpenSessionDetail={onOpenSessionDetail}
                searchQuery={searchQuery}
              />
              <StreamWindowInsights summary={summary} runs={filteredRuns} />
            </>
          )}

          <Group justify="space-between" mt="sm">
            <Text className="feed-footer">
              <IconChartBar size={14} stroke={1.8} />
              <span>
                {loading
                  ? "正在刷新数据..."
                  : viewMode === "raw"
                    ? `当前显示 ${formatNumber((events || []).length)} 条事件`
                    : `${formatNumber(filteredRuns.length)} 个活动 · 来自 ${formatNumber((events || []).length)} 条底层事件`}
              </span>
            </Text>
            {hasMore ? (
              <Button variant="light" radius="sm" size="xs" onClick={onLoadMore} loading={loading}>
                加载更早事件
              </Button>
            ) : null}
          </Group>
        </Paper>
      </div>
    </section>
  );
}
