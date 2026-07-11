import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  Tree,
  useTree,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowRight,
  IconArrowDown,
  IconActivity,
  IconChevronRight,
  IconCopy,
  IconEdit,
  IconFileText,
  IconFolder,
  IconFolders,
  IconLayersIntersect,
  IconMessage2,
  IconCoin,
  IconHistory,
  IconRoute,
  IconSearch,
  IconTerminal2,
  IconTools,
  IconTrash,
  IconX,
  IconZoomScan,
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
import { readableEventSummary } from "../lib/event-display";
import {
  buildActivityRuns,
  buildSessionArtifacts,
  buildSessionPresentation,
} from "../lib/activity-models";
import { buildConversationTurns } from "../lib/conversation-models";
import { ConversationEntry } from "./conversation-drawer";

const SESSION_VIRTUAL_THRESHOLD = 24;
const SESSION_ROW_HEIGHT = 84;
const SESSION_ROW_OVERSCAN = 4;
const DIALOGUE_TYPES = new Set(["Prompt", "User", "Agent"]);

function formatTokenText(value, hasTokenData = true) {
  return hasTokenData ? `${formatCompactNumber(value)} Tok` : "Token 未记录";
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percentValue(value, total) {
  const denominator = toFiniteNumber(total);
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, (toFiniteNumber(value) / denominator) * 100));
}

function percentLabel(value, total) {
  return `${Math.round(percentValue(value, total))}%`;
}

function formatDurationText(start, end) {
  const startMs = Date.parse(start || "");
  const endMs = Date.parse(end || "");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return "-";
  const minutes = Math.max(1, Math.round((endMs - startMs) / 60000));
  if (minutes < 60) return `${formatNumber(minutes)} 分钟`;
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return hours ? `${formatNumber(days)} 天 ${formatNumber(hours)} 小时` : `${formatNumber(days)} 天`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${formatNumber(hours)} 小时 ${formatNumber(rest)} 分钟` : `${formatNumber(hours)} 小时`;
}

function tokenCacheRead(tokenUsage) {
  if (tokenUsage?.cacheReadInput != null) return toFiniteNumber(tokenUsage.cacheReadInput);
  return toFiniteNumber(tokenUsage?.cachedInput);
}

function tokenCacheCreation(tokenUsage) {
  return toFiniteNumber(tokenUsage?.cacheCreationInput);
}

function addTokenTotals(target, tokenUsage) {
  if (!tokenUsage) return false;
  const keys = ["input", "output", "total", "cachedInput", "reasoningOutput"];
  let hasValue = false;
  keys.forEach((key) => {
    const value = toFiniteNumber(tokenUsage[key]);
    if (value) hasValue = true;
    target[key] += value;
  });
  const cacheRead = tokenCacheRead(tokenUsage);
  const cacheCreation = tokenCacheCreation(tokenUsage);
  if (cacheRead || cacheCreation) hasValue = true;
  target.cacheReadInput += cacheRead;
  target.cacheCreationInput += cacheCreation;
  return hasValue;
}

function createTokenTotals() {
  return {
    input: 0,
    output: 0,
    total: 0,
    cachedInput: 0,
    cacheReadInput: 0,
    cacheCreationInput: 0,
    reasoningOutput: 0,
  };
}

function countBy(items, selector) {
  const counts = new Map();
  for (const item of items || []) {
    const key = selector(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((left, right) => {
      if (right.value !== left.value) return right.value - left.value;
      return String(left.key).localeCompare(String(right.key), "zh-CN");
    });
}

function toolNameFromEvent(event) {
  if (event?.toolName) return event.toolName;
  const summary = `${event?.summary || ""} ${event?.extra || ""}`;
  return summary.match(/tool=([^\s]+)/i)?.[1] || "";
}

function dialogueRoleLabel(event) {
  if (event?.callType === "Agent") return "Agent";
  if (event?.callType === "Prompt" || event?.callType === "User") return "用户";
  return callTypeLabel(event?.callType);
}

function dedupeDialoguePreviewEvents(events) {
  const seen = new Set();
  const rows = [];
  for (const event of events || []) {
    const text = readableEventSummary(event, 360).trim().replace(/\s+/g, " ");
    const signature = `${event?.callType || ""}:${text}`;
    if (!text || seen.has(signature)) continue;
    seen.add(signature);
    rows.push(event);
  }
  return rows;
}

function sessionMatchesId(session, selectedSessionId) {
  if (!selectedSessionId || !session) return false;
  return session.sessionId === selectedSessionId || (session.sessionIds || []).includes(selectedSessionId);
}

function getSessionTitle(session, selectedSessionId) {
  return session?.displayTitle
    || session?.title
    || session?.sessionTitle
    || session?.fallbackTitle
    || shortSessionId(selectedSessionId)
    || "未选择会话";
}

function buildSessionDetailStats(session, events) {
  const eventList = (events || []).slice().sort((left, right) => String(left.time || "").localeCompare(String(right.time || "")));
  const eventTokens = createTokenTotals();
  let hasEventTokens = false;
  for (const event of eventList) {
    hasEventTokens = addTokenTotals(eventTokens, event.tokenUsage) || hasEventTokens;
  }

  const sessionTokens = createTokenTotals();
  addTokenTotals(sessionTokens, session?.aggregateToken);
  if (!sessionTokens.total && session?.totalTokens) {
    sessionTokens.total = toFiniteNumber(session.totalTokens);
  }

  const tokens = hasEventTokens ? eventTokens : sessionTokens;
  const typeRows = countBy(eventList, (event) => event.callType || "Unknown").slice(0, 6);
  const modelRows = eventList.length
    ? countBy(eventList, (event) => event.model || "").slice(0, 5)
    : (session?.models || []).map((model) => ({ key: model, value: 1 })).slice(0, 5);
  const toolRows = countBy(
    eventList.filter((event) => String(event.callType || "").includes("Tool_Call")),
    toolNameFromEvent,
  ).slice(0, 5);
  const userEvents = eventList.filter((event) => ["Prompt", "User"].includes(event.callType)).length;
  const agentEvents = eventList.filter((event) => event.callType === "Agent").length;
  const first = eventList[0]?.time || session?.startedAt || session?.createdAt || "";
  const latest = eventList[eventList.length - 1]?.time || session?.latest || "";
  const dialoguePreview = dedupeDialoguePreviewEvents(eventList.filter((event) => DIALOGUE_TYPES.has(event.callType))).slice(-6);

  return {
    eventCount: eventList.length || toFiniteNumber(session?.count || session?.events),
    rawSessionCount: Math.max(1, toFiniteNumber(session?.groupedCount || (session?.sessionIds || []).length || 1)),
    tokens,
    typeRows,
    modelRows,
    toolRows,
    userEvents,
    agentEvents,
    dialoguePreview,
    first,
    latest,
    duration: formatDurationText(first, latest),
    recentEvents: eventList.slice(-6).reverse(),
  };
}

function getSessionIds(session) {
  const ids = Array.isArray(session?.sessionIds) && session.sessionIds.length
    ? session.sessionIds
    : [session?.sessionId];
  return [...new Set(ids)].filter(Boolean);
}

function groupedEventText(session) {
  const groupedCount = Number(session?.groupedCount || 0);
  const eventCount = Number(session?.count || 0);
  if (groupedCount > 1) {
    const average = Math.max(1, Math.round(eventCount / groupedCount));
    return `${formatNumber(groupedCount)} 个原始会话 · 每个约 ${formatNumber(average)} 条事件`;
  }
  return `${formatNumber(eventCount)} 条事件`;
}

function formatAgeText(ageMs) {
  const minutes = Math.max(0, Math.round(Number(ageMs || 0) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟前` : `${hours} 小时前`;
}

function ActiveSessionsPanel({ overview, onOpenSessionDetail }) {
  const sessions = overview?.sessions || [];
  const total = Number(overview?.total || 0);
  const hiddenCount = Math.max(0, total - sessions.length);

  return (
    <Paper radius="md" p="md" className="active-sessions-panel">
      <Group justify="space-between" align="flex-start" gap="md" className="active-sessions-panel__head">
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <ThemeIcon radius="lg" size={42} variant="light" color={total ? "teal" : "gray"} className="active-sessions-panel__icon">
            <IconActivity size={21} stroke={2} />
          </ThemeIcon>
          <div className="active-sessions-panel__copy">
            <Text className="eyebrow">当前活跃</Text>
            <Title order={3}>正在写入</Title>
            <Text className="active-sessions-panel__subline">
              {total ? `最近 ${formatNumber(overview?.windowMinutes || 30)} 分钟有新事件，按更新时间排序` : "当前筛选范围内没有持续写入的会话"}
            </Text>
          </div>
        </Group>
        <div className="active-sessions-panel__summary">
          <strong>{formatNumber(total)}</strong>
          <span>活跃会话</span>
        </div>
      </Group>

      {sessions.length ? (
        <div className="active-session-list">
          {sessions.map((session) => (
            <div
              key={session.sessionId}
              className="active-session-row"
            >
              <button
                type="button"
                className="active-session-row__open"
                aria-label={`查看活跃会话详情 ${session.title}`}
                onClick={() => onOpenSessionDetail?.(session)}
              >
                <span className="active-session-row__pulse" aria-hidden="true" />
                <span className="active-session-row__main">
                  <strong>{clipText(session.title, 56)}</strong>
                  <span>{clipText(session.cwd || "unknown", 72)}</span>
                </span>
                <span className="active-session-row__meta">
                  <Badge radius="xl" size="xs" variant="light" color={session.sourceType === "codex" ? "blue" : "orange"}>
                    {platformLabel(session.sourceType)}
                  </Badge>
                  <span>{formatAgeText(session.ageMs)}</span>
                  <span>{formatNumber(session.count || 0)} 事件</span>
                  {session.activity?.projectedHourlyTokens ? (
                    <span>预计 {formatTokenText(session.activity.projectedHourlyTokens)}/h</span>
                  ) : null}
                </span>
                <IconArrowRight size={16} className="active-session-row__arrow" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {hiddenCount ? (
        <Text className="active-sessions-panel__more">还有 {formatNumber(hiddenCount)} 个活跃会话</Text>
      ) : null}
    </Paper>
  );
}

function DetailRankRows({ rows, total, valueFormatter = formatNumber, emptyLabel = "暂无数据" }) {
  const peak = Math.max(1, ...rows.map((row) => toFiniteNumber(row.value)));
  if (!rows.length) return <Text className="session-detail-empty">{emptyLabel}</Text>;

  return (
    <div className="session-detail-rank">
      {rows.map((row) => (
        <div key={row.key} className="session-detail-rank__row">
          <span>{row.key}</span>
          <em>{percentLabel(row.value, total || peak)}</em>
          <b style={{ width: `${Math.max(7, percentValue(row.value, peak))}%` }} />
          <strong>{valueFormatter(row.value)}</strong>
        </div>
      ))}
    </div>
  );
}

function conversationTurnText(turn) {
  return [
    ...(turn?.userMessages || []).map((entry) => entry.content),
    ...(turn?.assistantMessages || []).map((entry) => entry.content),
    ...(turn?.toolEntries || []).map((entry) => `${entry.toolName} ${entry.content || ""}`),
  ].join(" ").toLocaleLowerCase();
}

function groupTurnEntries(turn) {
  const source = turn?.entries?.length
    ? turn.entries
    : [
        ...(turn?.userMessages || []),
        ...(turn?.assistantMessages || []),
        ...(turn?.toolEntries || []),
        ...(turn?.thinkingEntries || []),
      ];
  const groups = [];
  for (const entry of source) {
    const isProcess = entry.kind === "tool" || entry.kind === "thinking";
    const previous = groups.at(-1);
    if (isProcess && previous?.type === "process") {
      previous.entries.push(entry);
      continue;
    }
    groups.push(isProcess
      ? { type: "process", entries: [entry] }
      : { type: "message", entry });
  }
  return groups;
}

function SessionChatProcess({ entries, query }) {
  const [opened, setOpened] = useState(false);
  const toolEntries = entries.filter((entry) => entry.kind === "tool");
  const thinkingEntries = entries.filter((entry) => entry.kind === "thinking");
  const errors = toolEntries.filter((entry) => entry.isError).length;
  const toolNames = [...new Set(toolEntries.map((entry) => entry.toolName).filter(Boolean))];
  const label = [
    toolEntries.length ? `${formatNumber(toolEntries.length)} 项工具活动` : "",
    thinkingEntries.length ? `${formatNumber(thinkingEntries.length)} 条思考` : "",
  ].filter(Boolean).join(" · ");

  useEffect(() => {
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
    if (!normalizedQuery) return;
    const processText = entries.map((entry) => `${entry.toolName || ""} ${entry.content || ""} ${JSON.stringify(entry.display || {})}`)
      .join(" ")
      .toLocaleLowerCase();
    if (processText.includes(normalizedQuery)) setOpened(true);
  }, [entries, query]);

  return (
    <details className={`session-chat-process${errors ? " is-error" : ""}`} open={opened}>
      <summary onClick={(event) => {
        event.preventDefault();
        setOpened((current) => !current);
      }}>
        <span><IconTerminal2 size={14} />运行过程</span>
        <em>{label}{toolNames.length ? ` · ${toolNames.slice(0, 3).join(" / ")}` : ""}{errors ? ` · ${formatNumber(errors)} 错误` : ""}</em>
        <IconChevronRight size={14} aria-hidden="true" />
      </summary>
      {opened ? (
        <div className="session-chat-process__entries">
          {entries.map((entry) => (
            <ConversationEntry key={entry.id} entry={entry} highlightQuery={query} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

function SessionChatTurn({ turn, defaultOpen, query }) {
  const [opened, setOpened] = useState(defaultOpen);
  const prompt = turn.userMessages?.[0]?.content || turn.assistantMessages?.[0]?.content || "无对话摘要";
  const groups = groupTurnEntries(turn);

  useEffect(() => {
    if (String(query || "").trim()) setOpened(true);
  }, [query]);
  return (
    <section className={`session-chat-turn${opened ? " is-open" : ""}`} aria-label={`第 ${turn.index} 轮对话`}>
      <button className="session-chat-turn__toggle" type="button" onClick={() => setOpened((current) => !current)} aria-expanded={opened}>
        <span className="session-chat-turn__number">{String(turn.index).padStart(2, "0")}</span>
        <span className="session-chat-turn__summary">
          <strong>{clipText(prompt, 92)}</strong>
          <em>{formatDateTime(turn.startedAt)}{turn.toolSummary?.total ? ` · ${formatNumber(turn.toolSummary.total)} 项运行步骤` : ""}</em>
        </span>
        <IconChevronRight size={16} aria-hidden="true" />
      </button>
      {opened ? (
        <div className="session-chat-turn__body">
          {groups.map((group, index) => group.type === "message" ? (
            <ConversationEntry key={group.entry.id} entry={group.entry} highlightQuery={query} />
          ) : (
            <SessionChatProcess key={`${turn.id}-process-${index}`} entries={group.entries} query={query} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SessionDetailPanel({
  session,
  selectedSessionId,
  events,
  loading,
  page,
  onFocusStreamSession,
  onClearSessionFocus,
  onLoadMore,
  onCopySessionId,
  onOpenEvent,
}) {
  const [detailTab, setDetailTab] = useState("conversation");
  const [conversationQuery, setConversationQuery] = useState("");
  const [conversationLimit, setConversationLimit] = useState(8);
  const [chatAwayFromLatest, setChatAwayFromLatest] = useState(false);
  const chatScrollRef = useRef(null);
  const chatSessionRef = useRef("");
  const latestConversationTimeRef = useRef("");
  const presentation = useMemo(() => buildSessionPresentation(session, events, page), [events, page, session]);
  const artifacts = useMemo(() => buildSessionArtifacts(session, events), [events, session]);
  const turns = useMemo(() => buildConversationTurns(events), [events]);
  const runs = useMemo(() => buildActivityRuns(events, session ? [session] : []), [events, session]);
  const normalizedQuery = conversationQuery.trim().toLocaleLowerCase();
  const matchingTurns = useMemo(
    () => normalizedQuery ? turns.filter((turn) => conversationTurnText(turn).includes(normalizedQuery)) : turns,
    [normalizedQuery, turns],
  );
  const visibleTurns = matchingTurns.slice(-conversationLimit);
  const latestConversationTime = turns.at(-1)?.endedAt || turns.at(-1)?.startedAt || "";

  function scrollChatToLatest(behavior = "smooth") {
    const viewport = chatScrollRef.current;
    if (!viewport) return;
    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    } else {
      viewport.scrollTop = viewport.scrollHeight;
    }
    setChatAwayFromLatest(false);
  }

  useEffect(() => {
    setDetailTab("conversation");
    setConversationQuery("");
    setConversationLimit(8);
    setChatAwayFromLatest(false);
  }, [selectedSessionId]);

  useEffect(() => {
    if (detailTab !== "conversation") return undefined;
    const sessionChanged = chatSessionRef.current !== selectedSessionId;
    const previousLatestTime = latestConversationTimeRef.current;
    const latestChanged = previousLatestTime !== latestConversationTime;
    const initialConversationLoad = !previousLatestTime && Boolean(latestConversationTime);
    const viewport = chatScrollRef.current;
    const wasNearLatest = !viewport || viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120;
    chatSessionRef.current = selectedSessionId;
    latestConversationTimeRef.current = latestConversationTime;
    if (!sessionChanged && (!latestChanged || (!wasNearLatest && !initialConversationLoad))) return undefined;
    const frame = window.requestAnimationFrame(() => scrollChatToLatest("auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [detailTab, latestConversationTime, selectedSessionId]);

  if (!selectedSessionId) {
    return (
      <Paper className="session-detail-panel session-detail-panel--empty" radius="md" p="lg" data-session-detail-panel>
        <ThemeIcon radius="md" size={40} variant="light" color="teal"><IconZoomScan size={20} /></ThemeIcon>
        <div>
          <Text className="eyebrow">会话工作台</Text>
          <Title order={3}>选择会话查看完整上下文</Title>
          <Text className="session-detail-empty__copy">对话、运行、用量和文件变更会集中在同一个详情面板中。</Text>
        </div>
      </Paper>
    );
  }

  const title = getSessionTitle(session, selectedSessionId);
  const tokenTotal = presentation.tokens.total || toFiniteNumber(session?.totalTokens || session?.tokens);
  const loadedLabel = page?.total
    ? `最近载入 ${formatNumber(presentation.loadedEventCount)} / ${formatNumber(page.total)} 条原始事件`
    : `${formatNumber(presentation.loadedEventCount)} 条原始事件`;
  const interactionTotal = presentation.userEvents + presentation.agentEvents;
  const tokenRows = [
    ["输入", presentation.tokens.input],
    ["缓存命中", presentation.tokens.cacheReadInput],
    ["缓存写入", presentation.tokens.cacheCreationInput],
    ["输出", presentation.tokens.output],
    ["推理输出", presentation.tokens.reasoningOutput],
  ];
  const tokenDenominator = Math.max(tokenTotal, ...tokenRows.map(([, value]) => toFiniteNumber(value)), 1);

  return (
    <Paper className="session-detail-panel session-detail-workbench" radius="md" p="md" data-session-detail-panel>
      <div className="session-detail-head">
        <div className="session-detail-head__copy">
          <Text className="eyebrow">{session?.titleSource === "custom" ? "自定义名称" : "当前主题"}</Text>
          <Title
            order={3}
            className="session-detail-title"
            title={session?.sessionTitle && session.sessionTitle !== title ? `原始名称：${session.sessionTitle}` : title}
          >
            {clipText(title, 92)}
          </Title>
          <Text className="session-detail-subline">
            {platformLabel(session?.sourceType)} · {shortSessionId(selectedSessionId)} · {loadedLabel}
          </Text>
        </div>
        <Group gap={4} wrap="nowrap" className="session-detail-actions">
          <Tooltip label="复制会话 ID" withArrow>
            <ActionIcon variant="subtle" radius="sm" color="gray" onClick={() => onCopySessionId?.(selectedSessionId)} aria-label="复制当前会话 ID">
              <IconCopy size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="在事件流聚焦" withArrow>
            <ActionIcon variant="subtle" radius="sm" color="teal" onClick={() => onFocusStreamSession?.(session || { sessionId: selectedSessionId })} aria-label="在事件流聚焦当前会话">
              <IconRoute size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="关闭详情" withArrow>
            <ActionIcon variant="subtle" radius="sm" color="gray" onClick={onClearSessionFocus} aria-label="取消当前会话聚焦">
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      <div className="session-detail-context">
        <div className="session-detail-context__topic">
          <span>会话目标</span>
          <p title={session?.currentTopic || artifacts.goal || ""}>
            {session?.currentTopic || artifacts.goal || "尚未提取到明确目标"}
          </p>
        </div>
        <div className="session-detail-context__facts">
          <div><span>开始</span><strong>{presentation.first ? formatDateTime(presentation.first) : "-"}</strong></div>
          <div><span>持续</span><strong>{formatDurationText(presentation.first, presentation.latest)}</strong></div>
          <div><span>问答</span><strong>{formatNumber(interactionTotal)}</strong></div>
          <div><span>Token</span><strong>{formatTokenText(tokenTotal, Boolean(tokenTotal || session?.hasTokenData))}</strong></div>
        </div>
      </div>

      <Tabs value={detailTab} onChange={setDetailTab} className="session-detail-tabs" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="conversation" leftSection={<IconMessage2 size={14} />}>对话</Tabs.Tab>
          <Tabs.Tab value="timeline" leftSection={<IconHistory size={14} />}>运行</Tabs.Tab>
          <Tabs.Tab value="usage" leftSection={<IconCoin size={14} />}>用量</Tabs.Tab>
          <Tabs.Tab value="artifacts" leftSection={<IconTools size={14} />}>产物</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="conversation" className="session-detail-tab-panel session-detail-tab-panel--chat">
          <div className="session-detail-tab-toolbar">
            <TextInput
              leftSection={<IconSearch size={14} />}
              placeholder="搜索当前已载入对话"
              value={conversationQuery}
              onChange={(event) => setConversationQuery(event.currentTarget.value)}
              size="xs"
              aria-label="搜索当前已载入对话"
            />
            <span>{formatNumber(matchingTurns.length)} 轮 · {formatNumber(presentation.userEvents)} 次提问</span>
          </div>
          <div
            ref={chatScrollRef}
            className="session-chat-scroll"
            role="log"
            aria-label="会话聊天记录"
            onScroll={(event) => {
              const viewport = event.currentTarget;
              setChatAwayFromLatest(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 180);
            }}
          >
            <div className="session-chat-boundary">
              {conversationLimit < matchingTurns.length ? (
                <Button variant="subtle" size="xs" color="gray" onClick={() => setConversationLimit((current) => current + 8)}>
                  显示更早的 {formatNumber(Math.min(8, matchingTurns.length - conversationLimit))} 轮
                </Button>
              ) : page?.hasMore ? (
                <Button variant="subtle" size="xs" color="gray" loading={loading} onClick={onLoadMore}>
                  从文件读取更早记录
                </Button>
              ) : (
                <span>会话开始 · {presentation.first ? formatDateTime(presentation.first) : "时间未知"}</span>
              )}
            </div>
            {visibleTurns.map((turn, index) => (
              <SessionChatTurn
                key={turn.id}
                turn={turn}
                defaultOpen={index >= visibleTurns.length - 3}
                query={conversationQuery}
              />
            ))}
            {!loading && !visibleTurns.length ? <Text className="session-detail-empty">当前加载范围没有可显示的问答。</Text> : null}
            {loading && !visibleTurns.length ? <Text className="session-detail-empty">正在加载最近对话...</Text> : null}
            {visibleTurns.length ? <div className="session-chat-latest-marker">最近活动 · {formatDateTime(presentation.latest)}</div> : null}
          </div>
          {chatAwayFromLatest ? (
            <Button
              className="session-chat-jump-latest"
              variant="filled"
              size="xs"
              leftSection={<IconArrowDown size={14} />}
              onClick={() => scrollChatToLatest()}
            >
              回到最新
            </Button>
          ) : null}
        </Tabs.Panel>

        <Tabs.Panel value="timeline" className="session-detail-tab-panel">
          <div className="session-detail-run-list">
            {runs.slice(0, 40).map((run) => (
              <button key={run.id} type="button" onClick={() => run.latestEvent && onOpenEvent?.(run.latestEvent)}>
                <time>{formatDateTime(run.endedAt)}</time>
                <span>
                  <strong>{run.userPreview || run.assistantPreview || "工具或系统活动"}</strong>
                  <em>{formatNumber(run.eventCount)} 事件 · {formatNumber(run.toolCalls)} 工具{run.toolErrors ? ` · ${formatNumber(run.toolErrors)} 错误` : ""}</em>
                </span>
                <b>{run.tokenTotal ? `${formatCompactNumber(run.tokenTotal)} Tok` : "-"}</b>
              </button>
            ))}
            {!runs.length ? <Text className="session-detail-empty">当前加载范围没有可归组的活动。</Text> : null}
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="usage" className="session-detail-tab-panel">
          <section className="session-detail-token">
            <div className="session-detail-section-head">
              <Text>完整会话 Token 构成</Text>
              <span>{formatTokenText(tokenTotal, Boolean(tokenTotal))}</span>
            </div>
            <div className="session-detail-token__bars">
              {tokenRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <Progress value={percentValue(value, tokenDenominator)} color="teal" size="xs" radius="xs" />
                  <strong>{formatCompactNumber(value)}</strong>
                </div>
              ))}
            </div>
          </section>
          <div className="session-detail-grid">
            <section>
              <div className="session-detail-section-head"><Text>模型</Text><span>{formatNumber(presentation.modelRows.length)} 个</span></div>
              <DetailRankRows rows={presentation.modelRows} total={presentation.modelRows.reduce((sum, row) => sum + row.value, 0)} />
            </section>
            <section>
              <div className="session-detail-section-head"><Text>模型切换</Text><span>{formatNumber(artifacts.modelTimeline.length)} 次记录</span></div>
              <div className="session-model-timeline">
                {artifacts.modelTimeline.map((item, index) => (
                  <div key={`${item.model}-${item.time}-${index}`}><strong>{item.model}</strong><span>{formatDateTime(item.time)}</span></div>
                ))}
                {!artifacts.modelTimeline.length ? <Text className="session-detail-empty">暂无模型切换记录</Text> : null}
              </div>
            </section>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value="artifacts" className="session-detail-tab-panel">
          <div className="session-detail-health-strip">
            <div><span>工具错误</span><strong>{formatNumber(artifacts.toolErrors)}</strong></div>
            <div><span>上下文压缩</span><strong>{formatNumber(artifacts.compactions)}</strong></div>
            <div><span>文件变更</span><strong>{formatNumber(artifacts.editedFiles.length)}</strong></div>
            <div><span>工具种类</span><strong>{formatNumber(artifacts.tools.length)}</strong></div>
          </div>
          <div className="session-detail-grid">
            <section>
              <div className="session-detail-section-head"><Text>工具调用</Text><span>{formatNumber(artifacts.tools.length)} 类</span></div>
              <DetailRankRows
                rows={artifacts.tools.map((row) => ({ key: row.key, value: row.calls }))}
                total={artifacts.tools.reduce((sum, row) => sum + toFiniteNumber(row.calls), 0)}
                emptyLabel="暂无工具调用"
              />
            </section>
            <section>
              <div className="session-detail-section-head"><Text>编辑文件</Text><span>{formatNumber(artifacts.editedFiles.length)} 个</span></div>
              <div className="session-artifact-list">
                {artifacts.editedFiles.map((file) => <code key={file} title={file}>{file}</code>)}
                {!artifacts.editedFiles.length ? <Text className="session-detail-empty">暂无文件变更摘要</Text> : null}
              </div>
            </section>
          </div>
          {artifacts.commands.length ? (
            <section className="session-command-list">
              <div className="session-detail-section-head"><Text>最近命令</Text><span>{formatNumber(artifacts.commands.length)} 条</span></div>
              {artifacts.commands.map((command, index) => <code key={`${command}-${index}`}>{command}</code>)}
            </section>
          ) : null}
        </Tabs.Panel>

      </Tabs>
    </Paper>
  );
}

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function basename(path) {
  const text = String(path || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  const segments = text.split("/").filter(Boolean);
  return segments[segments.length - 1] || text;
}

function normalizeWorkspaceTreeNode(node, depth = 1) {
  const children = (node.children || []).map((child) => normalizeWorkspaceTreeNode(child, depth + 1));
  const workspace = node.workspace || (!children.length && node.cwd ? node : null);
  const path = workspace?.cwd || node.path || node.cwd || node.label || "";
  const label = node.label && !String(node.label).includes("/") ? node.label : basename(path) || node.label || "工作目录";
  const value = String(node.key || path || label);

  return {
    label,
    value,
    children,
    nodeProps: {
      label,
      path,
      workspace,
      sessions: Number(node.sessions || workspace?.sessions || 0),
      tokens: Number(node.tokens || workspace?.tokens || 0),
      hasTokenData: Boolean(node.hasTokenData ?? workspace?.hasTokenData ?? node.tokens),
      depth,
    },
  };
}

function buildWorkspaceTreeData(workspaceTree, workspaceIndex) {
  const sourceNodes = (workspaceTree?.children || []).length
    ? workspaceTree.children
    : (workspaceIndex || []).map((item) => ({
      key: item.key || item.cwd,
      label: item.cwd,
      path: item.cwd,
      sessions: item.sessions,
      tokens: item.tokens,
      hasTokenData: item.hasTokenData,
      workspace: item,
      children: [],
    }));

  return sourceNodes.map((node) => normalizeWorkspaceTreeNode(node));
}

function getInitialWorkspaceExpandedState(nodes, maxLevel = 2) {
  const state = {};

  function visit(items, level = 1) {
    items.forEach((item) => {
      if ((item.children || []).length) {
        state[item.value] = level <= maxLevel;
        visit(item.children, level + 1);
      }
    });
  }

  visit(nodes);
  return state;
}

function WorkspaceTreeView({ data, onFocusWorkspace }) {
  const treeController = useTree({
    initialExpandedState: getInitialWorkspaceExpandedState(data),
  });

  const renderNode = ({ node, level, expanded, hasChildren, selected, elementProps, tree }) => {
    const meta = node.nodeProps || {};
    const hasWorkspace = Boolean(meta.workspace);
    const isLeaf = hasWorkspace && !hasChildren;
    const isBranch = hasChildren;
    const Icon = hasChildren ? IconFolders : IconFolder;
    const fullPath = meta.path || String(node.label || "");
    const handleClick = (event) => {
      elementProps.onClick?.(event);
      const clickedTwisty = event.target?.closest?.(".workspace-tree-item__twisty");

      if (hasChildren && (!hasWorkspace || clickedTwisty)) {
        tree.toggleExpanded(node.value);
        return;
      }

      if (hasWorkspace) {
        tree.select(node.value);
        onFocusWorkspace?.(meta.workspace.cwd);
      }
    };

    return (
      <button
        {...elementProps}
        type="button"
        title={fullPath}
        aria-label={hasWorkspace ? `定位工作目录 ${fullPath}` : `${expanded ? "折叠" : "展开"}工作目录 ${fullPath}`}
        aria-expanded={hasChildren ? expanded : undefined}
        className={cx(
          elementProps.className,
          "workspace-tree-item",
          isBranch && "workspace-tree-item--branch",
          hasWorkspace && "workspace-tree-item--workspace",
          isLeaf && "workspace-tree-item--leaf",
          expanded && "workspace-tree-item--expanded",
          selected && "workspace-tree-item--selected",
        )}
        style={{ ...elementProps.style, "--workspace-tree-level": level - 1 }}
        onClick={handleClick}
      >
        <span className="workspace-tree-item__twisty" aria-hidden="true">
          {hasChildren ? <IconChevronRight size={14} /> : <IconArrowRight size={14} />}
        </span>
        <ThemeIcon
          radius="md"
          size={hasWorkspace ? 30 : 28}
          variant={hasWorkspace ? "light" : "subtle"}
          color={hasWorkspace ? "blue" : "gray"}
          className="workspace-tree-item__icon"
        >
          <Icon size={15} stroke={1.9} />
        </ThemeIcon>
        <span className="workspace-tree-item__copy">
          <strong>{meta.label || node.label}</strong>
          <span>{formatNumber(meta.sessions)} 会话 · {formatTokenText(meta.tokens, meta.hasTokenData)}</span>
        </span>
        {hasWorkspace ? (
          <Badge radius="xl" variant="filled" color="blue" className="workspace-tree-item__count">
            {formatNumber(meta.sessions)}
          </Badge>
        ) : null}
      </button>
    );
  };

  return (
    <Tree
      data={data}
      tree={treeController}
      renderNode={renderNode}
      expandOnClick={false}
      selectOnClick={false}
      levelOffset="md"
      className="workspace-tree"
      classNames={{
        node: "workspace-tree__node",
        subtree: "workspace-tree__subtree",
        label: "workspace-tree__label",
      }}
    />
  );
}

function SessionRow({
  session,
  selectedSet,
  selectedSessionId,
  onToggleSelect,
  onOpenSessionDetail,
  onRename,
  onDelete,
  onCopySessionId,
}) {
  const sessionIds = getSessionIds(session);
  const selectedCount = sessionIds.filter((id) => selectedSet.has(id)).length;
  const checked = sessionIds.length > 0 && selectedCount === sessionIds.length;
  const indeterminate = selectedCount > 0 && selectedCount < sessionIds.length;
  const active = sessionMatchesId(session, selectedSessionId);

  return (
    <div className={`session-card session-row${active ? " is-active" : ""}`}>
      <div className="session-row__select">
        <Checkbox
          checked={checked}
          indeterminate={indeterminate}
          onChange={() => onToggleSelect(sessionIds)}
          aria-label={`选择 ${session.title}`}
        />
      </div>

      <button
        type="button"
        className="session-row__main"
        onClick={() => onOpenSessionDetail(session)}
      >
        <div className="session-row__title-line">
          <ThemeIcon
            radius="md"
            size={24}
            variant="light"
            color={session.sourceType === "codex" ? "blue" : "orange"}
            aria-label={platformLabel(session.sourceType)}
          >
            <IconTerminal2 size={13} stroke={2.1} />
          </ThemeIcon>
          <Text fw={700} className="session-card__title">{session.title}</Text>
        </div>
        <div className="session-row__meta-line">
          <Badge radius="xl" color={session.sourceType === "codex" ? "blue" : "orange"} variant="light" size="xs">
            {platformLabel(session.sourceType)}
          </Badge>
          <span>{formatDateTime(session.latest)}</span>
          <span>{groupedEventText(session)}</span>
          <span>{formatTokenText(session.totalTokens, session.hasTokenData)}</span>
          {(session.latestAgentMessage || session.latestUserMessage || session.firstUserMessage) ? (
            <span className="session-row__preview" title={session.latestAgentMessage || session.latestUserMessage || session.firstUserMessage}>
              {clipText(session.latestAgentMessage || session.latestUserMessage || session.firstUserMessage, 72)}
            </span>
          ) : null}
        </div>
      </button>

      <div className="session-row__models">
        {(session.models || []).slice(0, 3).map((model) => (
          <Badge key={model} radius="xl" variant="light" color="gray" className="soft-badge">
            {model}
          </Badge>
        ))}
      </div>

      <Text className="session-row__id">{shortSessionId(session.sessionId)}</Text>

      <Group gap={4} className="session-row__quick-actions" wrap="nowrap">
        <Tooltip label="复制会话 ID" withArrow>
          <ActionIcon
            variant="light"
            radius="xl"
            color="gray"
            aria-label={`复制会话 ID · ${shortSessionId(session.sessionId)}`}
            onClick={() => onCopySessionId?.(session.sessionId)}
          >
            <IconCopy size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="重命名" withArrow>
          <ActionIcon
            variant="light"
            radius="xl"
            color="gray"
            aria-label={`重命名 · ${shortSessionId(session.sessionId)}`}
            onClick={() => onRename(session)}
          >
            <IconEdit size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="删除" withArrow>
          <ActionIcon
            variant="light"
            radius="xl"
            color="red"
            aria-label={`删除 · ${shortSessionId(session.sessionId)}`}
            onClick={() => onDelete(session)}
          >
            <IconTrash size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

    </div>
  );
}

function VirtualSessionList({ sessions, renderSession }) {
  const viewportRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(620);
  const shouldVirtualize = (sessions || []).length > SESSION_VIRTUAL_THRESHOLD;

  useEffect(() => {
    if (!shouldVirtualize) return undefined;
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    const syncViewportHeight = () => setViewportHeight(viewport.clientHeight || 620);
    syncViewportHeight();

    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(syncViewportHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [shouldVirtualize]);

  if (!shouldVirtualize) {
    return (
      <div className="session-list">
        {(sessions || []).map((session) => (
          <div key={session.sessionId}>
            {renderSession(session)}
          </div>
        ))}
      </div>
    );
  }

  const sessionList = sessions || [];
  const totalHeight = sessionList.length * SESSION_ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / SESSION_ROW_HEIGHT) - SESSION_ROW_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / SESSION_ROW_HEIGHT) + SESSION_ROW_OVERSCAN * 2;
  const endIndex = Math.min(sessionList.length, startIndex + visibleCount);
  const visibleSessions = sessionList.slice(startIndex, endIndex);

  return (
    <div
      ref={viewportRef}
      className="session-list session-list-virtual-scroll"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{ "--session-row-height": `${SESSION_ROW_HEIGHT}px` }}
    >
      <div className="session-list-virtual-scroll__spacer" style={{ height: totalHeight }}>
        {visibleSessions.map((session, index) => {
          const absoluteIndex = startIndex + index;
          return (
            <div
              key={session.sessionId}
              className="session-list-virtual-scroll__item"
              style={{ transform: `translateY(${absoluteIndex * SESSION_ROW_HEIGHT}px)` }}
            >
              {renderSession(session)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SessionWorkspace({
  activeOverview,
  sections,
  selectedSessionId,
  detailSession,
  detailEvents,
  detailLoading,
  detailPage,
  selectedIds,
  onToggleSelect,
  onOpenSessionDetail,
  onFocusStreamSession,
  onClearSessionFocus,
  onFocusWorkspace,
  onRename,
  onDelete,
  onCopySessionId,
  onOpenEvent,
  onLoadMoreSessionDetail,
  workspaceIndex,
  workspaceTree,
}) {
  const selectedSet = new Set(selectedIds || []);
  const groupLabels = {
    cwd: "工作目录",
    sourceFile: "文件位置",
    platform: "平台",
  };
  const GroupIcon = {
    cwd: IconFolder,
    sourceFile: IconFileText,
    platform: IconLayersIntersect,
  };
  const workspaceTreeData = useMemo(() => buildWorkspaceTreeData(workspaceTree, workspaceIndex), [workspaceTree, workspaceIndex]);
  const workspaceTreeKey = workspaceTreeData.map((node) => node.value).join("|") || "empty";
  const workspaceRootLabel = workspaceTree?.label || "关联会话";
  const [sideView, setSideView] = useState(selectedSessionId ? "detail" : "workspace");

  useEffect(() => {
    setSideView(selectedSessionId ? "detail" : "workspace");
  }, [selectedSessionId]);

  function openSessionDetail(session) {
    setSideView("detail");
    onOpenSessionDetail?.(session);
  }

  return (
    <div
      className="session-workspace-layout"
      role="region"
      aria-label="会话工作台"
      data-layout="session-library"
      data-selected={selectedSessionId ? "true" : "false"}
    >
      <ScrollArea offsetScrollbars className="sessions-page">
        <Stack gap="md">
          {Number(activeOverview?.total || 0) > 0 ? (
            <ActiveSessionsPanel
              overview={activeOverview}
              onOpenSessionDetail={openSessionDetail}
            />
          ) : null}
          {(sections || []).map((section) => {
            const sectionTokenTotal = section.sessions.reduce((sum, session) => sum + Number(session.totalTokens || 0), 0);
            const sectionHasTokenData = section.sessions.some((session) => session.hasTokenData);
            const sectionEventTotal = section.sessions.reduce((sum, session) => sum + Number(session.count || 0), 0);
            const sectionLatest = section.sessions[0]?.latest || "";
            const SectionIcon = GroupIcon[section.groupType] || IconFolder;
            const sectionPath = section.label || section.cwd || "";
            const sectionTitle = section.groupType === "platform" ? sectionPath : basename(sectionPath) || sectionPath;

            return (
              <Paper
                key={section.key || section.cwd}
                radius="md"
                p="md"
                className="session-section"
                data-session-section-key={section.key || section.cwd}
              >
              <Group justify="space-between" align="flex-start" mb="md" className="session-section__head">
                <Group gap="sm" align="flex-start" className="session-section__identity">
                  <ThemeIcon radius="lg" size={42} variant="light" color={section.groupType === "platform" ? "indigo" : "blue"}>
                    <SectionIcon size={21} stroke={1.8} />
                  </ThemeIcon>
                  <div className="session-section__copy">
                    <Text className="eyebrow">{groupLabels[section.groupType] || "工作目录"}</Text>
                    <Title order={3} className="session-section__title" title={sectionPath}>{clipText(sectionTitle, 72)}</Title>
                    <Text className="session-section__subline" title={sectionPath}>
                      {clipText(sectionPath, 92)} · 最近 {formatDateTime(sectionLatest)} · {formatNumber(sectionEventTotal)} 条事件
                    </Text>
                  </div>
                </Group>
                <div className="session-section__metrics">
                  <div>
                    <Text className="session-section__metric-value">{formatNumber(section.total)}</Text>
                    <Text className="session-section__metric-label">会话</Text>
                  </div>
                  <div>
                    <Text className="session-section__metric-value">{sectionHasTokenData ? formatCompactNumber(sectionTokenTotal) : "未记录"}</Text>
                    <Text className="session-section__metric-label">Token</Text>
                  </div>
                </div>
              </Group>

              <VirtualSessionList
                sessions={section.sessions}
                renderSession={(session) => (
                  <SessionRow
                    session={session}
                    selectedSet={selectedSet}
                    selectedSessionId={selectedSessionId}
                    onToggleSelect={onToggleSelect}
                    onOpenSessionDetail={openSessionDetail}
                    onRename={onRename}
                    onDelete={onDelete}
                    onCopySessionId={onCopySessionId}
                  />
                )}
              />
            </Paper>
            );
          })}
        </Stack>
      </ScrollArea>

      <aside className="session-workspace-side">
        <div className="session-side-switch" aria-label="右侧面板">
          <SegmentedControl
            radius="xl"
            value={sideView}
            onChange={setSideView}
            data={[
              { label: selectedSessionId ? `详情 ${shortSessionId(selectedSessionId)}` : "会话详情", value: "detail" },
              { label: "工作目录", value: "workspace" },
            ]}
            fullWidth
          />
        </div>

        <div className="session-side-content" data-side-view={sideView}>
          {sideView === "detail" ? (
            <SessionDetailPanel
              session={detailSession}
              selectedSessionId={selectedSessionId}
              events={detailEvents}
              loading={detailLoading}
              page={detailPage}
              onFocusStreamSession={onFocusStreamSession}
              onClearSessionFocus={onClearSessionFocus}
              onLoadMore={onLoadMoreSessionDetail}
              onCopySessionId={onCopySessionId}
              onOpenEvent={onOpenEvent}
            />
          ) : (
            <Paper className="session-workspace-index" radius="xl" p="md">
              <Group gap="sm" align="flex-start" mb="md" wrap="nowrap">
                <ThemeIcon radius="lg" size={42} variant="gradient" gradient={{ from: "blue", to: "cyan" }}>
                  <IconRoute size={21} stroke={1.9} />
                </ThemeIcon>
                <div className="workspace-index__head-copy">
                  <Text className="eyebrow">工作目录</Text>
                  <Title order={3} className="workspace-index__title" title={workspaceRootLabel}>{workspaceRootLabel}</Title>
                  <Text className="workspace-index__hint">按公共路径折叠，点击叶子定位分组</Text>
                </div>
              </Group>

              <ScrollArea offsetScrollbars className="workspace-index-tree-scroll">
                <WorkspaceTreeView key={workspaceTreeKey} data={workspaceTreeData} onFocusWorkspace={onFocusWorkspace} />
              </ScrollArea>
            </Paper>
          )}
        </div>
      </aside>
    </div>
  );
}
