import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconBolt,
  IconChartBar,
  IconX,
} from "@tabler/icons-react";
import {
  callTypeLabel,
  clipText,
  formatCompactNumber,
  formatDateTime,
  formatNumber,
  platformLabel,
  shortSessionId,
} from "../lib/formatters";
import {
  eventDialogueRole,
  eventTone,
  readableDialogueContent,
  readableEventSummary,
} from "../lib/event-display";

const EVENT_ROW_HEIGHT = 136;
const EVENT_OVERSCAN = 6;

function formatHeroNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";

  const compactUnits = [
    { value: 1_0000_0000_0000, suffix: "万亿" },
    { value: 1_0000_0000, suffix: "亿" },
    { value: 1_0000, suffix: "万" },
  ];

  for (const unit of compactUnits) {
    if (Math.abs(amount) < unit.value) continue;
    return `${(amount / unit.value).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}${unit.suffix}`;
  }

  return formatNumber(amount);
}

function getWindowPlatformTotal(windowSummary, platformKey) {
  const match = (windowSummary?.platforms || []).find((item) => item.key === platformKey);
  return Number(match?.total) || 0;
}

function EventRow({ event, onOpenEvent }) {
  const dialogueRole = eventDialogueRole(event.callType);
  const rowClasses = [
    "event-row",
    `event-row--${eventTone(event.callType)}`,
    dialogueRole ? `event-row--dialogue event-row--dialogue-${dialogueRole}` : "",
  ].filter(Boolean).join(" ");
  const summary = dialogueRole ? readableDialogueContent(event) : readableEventSummary(event);

  return (
    <button
      type="button"
      className={rowClasses}
      onClick={() => onOpenEvent(event)}
    >
      <span className="event-row__rail" aria-hidden="true">
        <span className="event-row__dot" />
      </span>

      <div className="event-row__body">
        <div className="event-row__kicker">
          <span className="event-row__platform">{event.sourceType === "codex" ? "CX" : "CC"}</span>
          <span className="event-row__type">{callTypeLabel(event.callType)}</span>
          <span className="event-row__model">{event.model || "unknown"}</span>
        </div>
        {dialogueRole ? (
          <div className="event-row__speaker">
            {dialogueRole === "user" ? "用户" : "Agent"}
          </div>
        ) : null}
        <Text className="event-row__summary">{summary}</Text>
        <div className="event-row__meta-line">
          <span>{shortSessionId(event.sessionId)}</span>
          <span>{event.extra || "事件详情"}</span>
          <span>{clipText(event.cwd || "", 48)}</span>
        </div>
      </div>

      <div className="event-row__side">
        <Text className="event-row__timestamp">{formatDateTime(event.time)}</Text>
        <span className="event-row__arrow" aria-hidden="true">
          <IconArrowRight size={14} />
        </span>
      </div>
    </button>
  );
}

function VirtualEventList({ events, onOpenEvent }) {
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

  const eventList = events || [];
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
              key={`${event.time}-${event.sessionId}-${event.callType}-${event.extra || ""}`}
              className="feed-virtual-scroll__item"
              style={{ transform: `translateY(${absoluteIndex * EVENT_ROW_HEIGHT}px)` }}
            >
              <EventRow event={event} onOpenEvent={onOpenEvent} />
            </div>
          );
        })}
      </div>
    </div>
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
  onOpenFilters,
  onOpenEvent,
  onLoadMore,
  hasMore,
  loading,
  generatedAt,
}) {
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const activeSession = (sessions || []).find((session) => session?.sessionId === selectedSessionId) || null;
  const matchingCount = Number(summary?.counts?.totalMatching) || 0;
  const loadedCount = Number(summary?.counts?.totalLoaded) || 0;
  const visibleCount = Number(summary?.counts?.totalVisible) || 0;
  const sessionsCount = Number(summary?.counts?.sessions) || 0;
  const selectedScope = selectedSessionId ? `已聚焦会话 ${shortSessionId(selectedSessionId)}` : "当前为跨会话观测";
  const loadProgress = matchingCount > 0
    ? Math.min(100, Math.round((loadedCount / matchingCount) * 100))
    : 100;
  const scopeFacts = [
    `匹配 ${formatNumber(matchingCount)}`,
    `已加载 ${formatNumber(loadedCount)} / ${formatNumber(matchingCount || loadedCount)}`,
    `会话 ${formatNumber(sessionsCount)}`,
  ];
  const tokenInput = Number(summary?.totals?.input) || 0;
  const tokenOutput = Number(summary?.totals?.output) || 0;
  const tokenCached = Number(summary?.totals?.cachedInput) || 0;
  const tokenReasoning = Number(summary?.totals?.reasoningOutput) || 0;
  const topTypes = (summary.topTypes || []).slice(0, 3);
  const topModels = (summary.topModels || []).slice(0, 3);
  const topPlatforms = (summary.platforms || []).slice(0, 3);
  const tokenWindows = summary?.tokenWindows || {
    day: { total: 0, platforms: [] },
    week: { total: 0, platforms: [] },
  };
  const modelPeak = Math.max(1, ...topModels.map((item) => Number(item.value) || 0));
  const platformPeak = Math.max(1, ...topPlatforms.map((item) => Number(item.events) || 0));
  const tokenHeadline = formatHeroNumber(summary?.totals?.total);
  const coverageLabel = `${formatNumber(sessionsCount)} 会话`;
  const loadLabel = `已加载 ${formatNumber(loadedCount)} / ${formatNumber(matchingCount || loadedCount)}`;
  const signalChips = [
    `输入 ${formatHeroNumber(tokenInput)}`,
    `输出 ${formatHeroNumber(tokenOutput)}`,
    `缓存 ${formatHeroNumber(tokenCached)}`,
    `推理 ${formatHeroNumber(tokenReasoning)}`,
  ];
  const contextRows = [
    {
      label: "当前聚焦",
      value: activeSession
        ? `${activeSession.title || activeSession.sessionTitle || "当前会话"} · ${shortSessionId(activeSession.sessionId)}`
        : "全部会话",
    },
    {
      label: "搜索关键词",
      value: scope?.tags?.[0] || "无关键词",
    },
    {
      label: "工作区范围",
      value: activeSession?.cwd || scope?.tags?.[1] || "跨工作区",
    },
    {
      label: "最近刷新",
      value: generatedAt ? formatDateTime(generatedAt) : "实时",
    },
  ];
  const tokenCadence = [
    {
      key: "day",
      label: "今日 Token",
      hint: "按本地自然日累计",
      window: tokenWindows.day,
    },
    {
      key: "week",
      label: "本周 Token",
      hint: "按当前自然周累计",
      window: tokenWindows.week,
    },
  ];

  return (
    <Stack gap="lg" className="workspace-stack">
      <Paper className="overview-shell" radius="xl" p="md">
        <Group justify="space-between" align="flex-start" className="overview-shell__top">
          <div className="overview-shell__scope">
            <Group gap="sm" mb={8} wrap="nowrap">
              <ThemeIcon size={36} radius="xl" variant="light" color="blue">
                <IconBolt size={18} />
              </ThemeIcon>
              <div>
                <Text className="eyebrow">当前观测范围</Text>
                <Title order={2} className="scope-title">{scope.title}</Title>
                <Text className="scope-subtitle">{scope.subtitle}</Text>
              </div>
            </Group>
          </div>
          <Group gap="xs">
            <Button
              variant="subtle"
              color="gray"
              radius="xl"
              onClick={() => setOverviewExpanded((current) => !current)}
            >
              {overviewExpanded ? "收起统计" : "展开统计"}
            </Button>
            <Button
              leftSection={<IconAdjustmentsHorizontal size={16} />}
              variant="light"
              color="blue"
              radius="xl"
              onClick={onOpenFilters}
            >
              筛选器
            </Button>
          </Group>
        </Group>

        <div className="overview-ribbon">
          <Group gap="xs" className="overview-ribbon__facts">
            {scopeFacts.map((fact) => (
              <Badge key={fact} radius="xl" variant="light" color="blue" className="scope-fact">{fact}</Badge>
            ))}
          </Group>
          {(scope.tags || []).length ? (
            <Group gap="xs" className="overview-ribbon__tags">
              {(scope.tags || []).map((tag) => (
                <Badge key={tag} radius="xl" variant="light" color="gray" className="soft-badge scope-tag">{tag}</Badge>
              ))}
            </Group>
          ) : null}
        </div>

        <div className={`overview-board${overviewExpanded ? " is-expanded" : ""}`} aria-hidden={!overviewExpanded}>
          <section className="overview-panel overview-panel--primary">
            <div className="overview-panel__head overview-panel__head--compact">
              <Text className="overview-section-label">观测总览</Text>
              <Text className="overview-panel__value">{`匹配 ${formatNumber(matchingCount)}`}</Text>
            </div>

            <div className="overview-primary-grid">
              <div className="overview-stat overview-stat--hero">
                <Text className="overview-stat__label">Token 总量</Text>
                <Text className="overview-stat__value">{tokenHeadline}</Text>
                <Text className="overview-stat__meta">{`总计 ${formatNumber(summary.totals.total)} Tok`}</Text>
              </div>

              <div className="overview-stat">
                <Text className="overview-stat__label">加载进度</Text>
                <Text className="overview-stat__value">{loadLabel}</Text>
                <Progress
                  value={loadProgress}
                  radius="xl"
                  size="xs"
                  className="overview-stat__progress"
                  aria-label="加载进度"
                />
                <Text className="overview-stat__meta">{`总事件 ${formatNumber(visibleCount)} · 已覆盖 ${formatNumber(loadProgress)}%`}</Text>
              </div>

              <div className="overview-stat">
                <Text className="overview-stat__label">范围覆盖</Text>
                <Text className="overview-stat__value">{coverageLabel}</Text>
                <Text className="overview-stat__meta">{selectedScope}</Text>
              </div>
            </div>

            <div className="overview-primary-foot">
              <Group gap="xs" className="overview-chip-row overview-chip-row--inline">
                {signalChips.map((chip) => (
                  <Badge key={chip} radius="xl" variant="light" color="gray" className="overview-chip">{chip}</Badge>
                ))}
              </Group>

              <div className="overview-window-section overview-window-section--compact">
                <div className="overview-window-section__head">
                  <Text className="overview-section-label">时间消耗</Text>
                  <Text className="overview-panel__value">按当前筛选范围聚合</Text>
                </div>
                <div className="overview-window-stack">
                  {tokenCadence.map((item) => (
                    <div key={item.key} className="overview-window-row">
                      <div className="overview-window-row__lead">
                        <Text className="overview-window-card__label">{item.label}</Text>
                        <Text className="overview-window-row__value">{formatHeroNumber(item.window?.total || 0)}</Text>
                      </div>
                      <Text className="overview-window-row__hint">{item.hint}</Text>
                      <div className="overview-window-row__breakdown">
                        <Text className="overview-window-pill overview-window-breakdown__row overview-window-breakdown__row--strong">{`合计 ${formatHeroNumber(item.window?.total || 0)}`}</Text>
                        <Text className="overview-window-pill overview-window-breakdown__row">{`Codex ${formatHeroNumber(getWindowPlatformTotal(item.window, "codex"))}`}</Text>
                        <Text className="overview-window-pill overview-window-breakdown__row">{`Claude Code ${formatHeroNumber(getWindowPlatformTotal(item.window, "claude"))}`}</Text>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="overview-panel overview-panel--intel">
            <div className="overview-compact-section overview-compact-section--platform">
              <div className="overview-panel__head overview-panel__head--compact">
                <Text className="overview-section-label">平台分布</Text>
                <Text className="overview-panel__value">{`${formatNumber(topPlatforms.length)} 平台`}</Text>
              </div>
              <Stack gap="xs">
                {topPlatforms.map((item) => (
                  <div key={item.key} className="overview-rank-row overview-rank-row--platform">
                    <div className="overview-rank-row__title">
                      <Text className="overview-rank-row__label">{platformLabel(item.key)}</Text>
                      <Text className="overview-rank-row__meta">{`${formatNumber(item.sessions)} 会话`}</Text>
                    </div>
                    <div className="overview-meter">
                      <span style={{ width: `${Math.max(12, Math.round((Number(item.events) / platformPeak) * 100))}%` }} />
                    </div>
                    <Text className="overview-rank-row__value">{`${formatNumber(item.events)} 事件`}</Text>
                  </div>
                ))}
              </Stack>
            </div>

            <div className="overview-compact-grid">
              <div className="overview-compact-section">
                <div className="overview-panel__head overview-panel__head--compact">
                  <Text className="overview-section-label">观测上下文</Text>
                  <Text className="overview-panel__value">{selectedScope}</Text>
                </div>
                <div className="overview-context-list">
                  {contextRows.map((item) => (
                    <div key={item.label} className="overview-context-row">
                      <Text className="overview-context-row__label">{item.label}</Text>
                      <Text className="overview-context-row__value">{item.value}</Text>
                    </div>
                  ))}
                </div>
              </div>

              <div className="overview-compact-section">
                <div className="overview-panel__head overview-panel__head--compact">
                  <Text className="overview-section-label">模型焦点</Text>
                  <Text className="overview-panel__value">{topModels[0]?.key || "-"}</Text>
                </div>
                <Stack gap="xs">
                  {topModels.map((item) => (
                    <div key={item.key} className="overview-rank-row">
                      <Text className="overview-rank-row__label">{item.key}</Text>
                      <div className="overview-meter">
                        <span style={{ width: `${Math.max(12, Math.round((Number(item.value) / modelPeak) * 100))}%` }} />
                      </div>
                      <Text className="overview-rank-row__value">{formatNumber(item.value)}</Text>
                    </div>
                  ))}
                </Stack>
              </div>
            </div>
          </section>
        </div>
      </Paper>

      <div className="stream-layout">
        <Paper className="session-rail" radius="xl" p="md">
          <Group justify="space-between" mb="sm">
            <div>
              <Text className="eyebrow">会话侧栏</Text>
              <Title order={4}>最近活跃会话</Title>
            </div>
            <Badge radius="xl" variant="light" color="gray">
              {formatNumber((sessions || []).length)}
            </Badge>
          </Group>
          <ScrollArea offsetScrollbars className="session-rail__scroll">
            <Stack gap={4}>
              {(sessions || []).map((session) => {
                const active = session.sessionId === selectedSessionId;
                return (
                  <button
                    key={session.sessionId}
                    type="button"
                    className={`session-rail__item${active ? " is-active" : ""}`}
                    onClick={() => onSelectSession(session.sessionId)}
                  >
                    <span className={`session-rail__mark session-rail__mark--${session.sourceType === "codex" ? "codex" : "claude"}`}>
                      {session.sourceType === "codex" ? "CX" : "CC"}
                    </span>
                    <span className="session-rail__main">
                      <span className="session-rail__title">{session.title || "未命名会话"}</span>
                      <span className="session-rail__meta">
                        {formatCompactNumber(session.totalTokens)} Tok · {formatDateTime(session.latest)} · {formatNumber(session.count || 0)} 事件
                      </span>
                      <span className="session-rail__path">{clipText(session.cwd, 44)}</span>
                    </span>
                    <span className="session-rail__id">{shortSessionId(session.sessionId)}</span>
                  </button>
                );
              })}
            </Stack>
          </ScrollArea>
        </Paper>

        <Paper className="feed-panel" radius="xl" p="md">
          <Group justify="space-between" mb="md">
            <div>
              <Text className="eyebrow">事件时间线</Text>
              <Title order={4}>按观测顺序展开</Title>
            </div>
            <Group gap="xs" className="feed-panel__actions">
              {selectedSessionId ? (
                <>
                  <Badge radius="xl" variant="light" color="blue" className="soft-badge">
                    {`已聚焦 ${shortSessionId(selectedSessionId)}`}
                  </Badge>
                  <Button
                    variant="subtle"
                    radius="xl"
                    color="gray"
                    size="xs"
                    leftSection={<IconX size={14} />}
                    onClick={onClearSessionFocus}
                  >
                    返回全部会话
                  </Button>
                </>
              ) : null}
              {(summary.topTypes || []).slice(0, 3).map((item) => (
                <Badge key={item.key} radius="xl" variant="light" color="gray" className="soft-badge">
                  {callTypeLabel(item.key)} {item.value}
                </Badge>
              ))}
            </Group>
          </Group>
          <VirtualEventList events={events} onOpenEvent={onOpenEvent} />
          <Group justify="space-between" mt="md">
            <Text className="feed-footer">
              <IconChartBar size={14} stroke={1.8} />
              <span>{loading ? "正在刷新数据…" : `当前显示 ${formatNumber((events || []).length)} 条事件`}</span>
            </Text>
            {hasMore ? (
              <Button variant="light" radius="xl" onClick={onLoadMore}>
                加载更多
              </Button>
            ) : null}
          </Group>
        </Paper>
      </div>
    </Stack>
  );
}
