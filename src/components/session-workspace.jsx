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
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  Tree,
  useTree,
} from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconArrowRight,
  IconActivity,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconEdit,
  IconFileText,
  IconFolder,
  IconFolders,
  IconLayersIntersect,
  IconMessage2,
  IconRoute,
  IconTerminal2,
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

const SESSION_VIRTUAL_THRESHOLD = 24;
const SESSION_ROW_HEIGHT = 112;
const SESSION_ROW_OVERSCAN = 4;

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

function sessionMatchesId(session, selectedSessionId) {
  if (!selectedSessionId || !session) return false;
  return session.sessionId === selectedSessionId || (session.sessionIds || []).includes(selectedSessionId);
}

function getSessionTitle(session, selectedSessionId) {
  return session?.title || session?.sessionTitle || session?.fallbackTitle || shortSessionId(selectedSessionId) || "未选择会话";
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

  return {
    eventCount: eventList.length || toFiniteNumber(session?.count || session?.events),
    rawSessionCount: Math.max(1, toFiniteNumber(session?.groupedCount || (session?.sessionIds || []).length || 1)),
    tokens,
    typeRows,
    modelRows,
    toolRows,
    userEvents,
    agentEvents,
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

function ActiveSessionsPanel({ overview, onOpenConversation, onOpenSessionDetail }) {
  const sessions = overview?.sessions || [];
  const total = Number(overview?.total || 0);
  const hiddenCount = Math.max(0, total - sessions.length);

  return (
    <Paper radius="xl" p="lg" className="active-sessions-panel">
      <Group justify="space-between" align="flex-start" gap="md" className="active-sessions-panel__head">
        <Group gap="sm" align="flex-start" wrap="nowrap">
          <ThemeIcon radius="lg" size={42} variant="light" color={total ? "teal" : "gray"} className="active-sessions-panel__icon">
            <IconActivity size={21} stroke={2} />
          </ThemeIcon>
          <div className="active-sessions-panel__copy">
            <Text className="eyebrow">当前活跃</Text>
            <Title order={4}>最近 {formatNumber(overview?.windowMinutes || 30)} 分钟仍在写入的会话</Title>
            <Text className="active-sessions-panel__subline">
              {total ? `按最新事件排序，可直接进入对话查看上下文` : "当前筛选范围内没有持续写入的会话"}
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
              <Tooltip label="查看对话" withArrow>
                <ActionIcon
                  variant="light"
                  radius="xl"
                  color="blue"
                  aria-label={`查看活跃会话对话 ${session.title}`}
                  onClick={() => onOpenConversation?.(session)}
                >
                  <IconMessage2 size={16} />
                </ActionIcon>
              </Tooltip>
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

function DetailMetric({ label, value, meta }) {
  return (
    <div className="session-detail-metric">
      <Text>{label}</Text>
      <strong>{value}</strong>
      <span>{meta}</span>
    </div>
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

function SessionDetailPanel({
  session,
  selectedSessionId,
  events,
  loading,
  page,
  onOpenConversation,
  onFocusStreamSession,
  onClearSessionFocus,
  onLoadMore,
  onCopySessionId,
  onExportSession,
  onOpenEvent,
}) {
  if (!selectedSessionId) {
    return (
      <Paper className="session-detail-panel session-detail-panel--empty" radius="xl" p="lg" data-session-detail-panel>
        <ThemeIcon radius="lg" size={42} variant="light" color="blue">
          <IconZoomScan size={21} stroke={1.9} />
        </ThemeIcon>
        <div>
          <Text className="eyebrow">会话详情</Text>
          <Title order={5}>选择一个会话查看完整画像</Title>
          <Text className="session-detail-empty__copy">从活跃会话、事件流或列表进入后，这里会展示 Token、模型、工具、事件和文件信息。</Text>
        </div>
      </Paper>
    );
  }

  const stats = buildSessionDetailStats(session, events);
  const title = getSessionTitle(session, selectedSessionId);
  const tokenTotal = stats.tokens.total || toFiniteNumber(session?.totalTokens || session?.tokens);
  const inputSideTotal = stats.tokens.input + stats.tokens.cacheReadInput;
  const sourceFiles = session?.sourceFiles || [];
  const rawIds = getSessionIds({ ...session, sessionId: selectedSessionId });
  const eventTotalLabel = page?.total ? `${formatNumber((events || []).length)} / ${formatNumber(page.total)} 已载入` : `${formatNumber(stats.eventCount)} 事件`;

  return (
    <Paper className="session-detail-panel" radius="xl" p="lg" data-session-detail-panel>
      <div className="session-detail-head">
        <Group gap="sm" align="flex-start" wrap="nowrap" className="session-detail-head__identity">
          <ThemeIcon radius="lg" size={42} variant="light" color={session?.sourceType === "claude" ? "orange" : "blue"}>
            <IconZoomScan size={21} stroke={1.9} />
          </ThemeIcon>
          <div className="session-detail-head__copy">
            <Text className="eyebrow">会话详情</Text>
            <Title order={5} className="session-detail-title">{clipText(title, 74)}</Title>
            <Text className="session-detail-subline">
              {platformLabel(session?.sourceType)} · {shortSessionId(selectedSessionId)} · {eventTotalLabel}
            </Text>
          </div>
        </Group>
        <Group gap={6} wrap="nowrap" className="session-detail-actions">
          <Tooltip label="复制会话 ID" withArrow>
            <ActionIcon variant="light" radius="xl" color="gray" onClick={() => onCopySessionId?.(selectedSessionId)} aria-label="复制当前会话 ID">
              <IconCopy size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="在事件流聚焦" withArrow>
            <ActionIcon variant="light" radius="xl" color="teal" onClick={() => onFocusStreamSession?.(session || { sessionId: selectedSessionId })} aria-label="在事件流聚焦当前会话">
              <IconRoute size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="查看对话" withArrow>
            <ActionIcon variant="light" radius="xl" color="blue" onClick={() => onOpenConversation?.(session || { sessionId: selectedSessionId, title })} aria-label="查看当前会话对话">
              <IconMessage2 size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="导出脱敏会话" withArrow>
            <ActionIcon variant="light" radius="xl" color="gray" onClick={() => onExportSession?.(session || { sessionId: selectedSessionId })} aria-label="导出当前会话">
              <IconDownload size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="取消聚焦" withArrow>
            <ActionIcon variant="light" radius="xl" color="gray" onClick={onClearSessionFocus} aria-label="取消当前会话聚焦">
              <IconX size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </div>

      <div className="session-detail-metrics">
        <DetailMetric label="事件" value={formatNumber(stats.eventCount)} meta={stats.duration === "-" ? "持续时间未知" : `持续 ${stats.duration}`} />
        <DetailMetric label="Token" value={formatTokenText(tokenTotal, Boolean(tokenTotal || session?.hasTokenData))} meta={`输入侧 ${formatCompactNumber(inputSideTotal)}`} />
        <DetailMetric label="模型" value={formatNumber(stats.modelRows.length)} meta={stats.modelRows[0]?.key || "暂无模型"} />
        <DetailMetric label="原始会话" value={formatNumber(stats.rawSessionCount)} meta={`${formatNumber(rawIds.length)} 个 ID 可操作`} />
      </div>

      <div className="session-detail-token">
        <div className="session-detail-section-head">
          <Text>Token 构成</Text>
          <span>{formatTokenText(tokenTotal, Boolean(tokenTotal))}</span>
        </div>
        <div className="session-detail-token__bars">
          {[
            ["非缓存输入", stats.tokens.input, "var(--accent)"],
            ["缓存命中", stats.tokens.cacheReadInput, "#39d98a"],
            ["缓存写入", stats.tokens.cacheCreationInput, "#14b8a6"],
            ["输出", stats.tokens.output, "var(--violet)"],
            ["推理", stats.tokens.reasoningOutput, "var(--orange)"],
          ].map(([label, value, color]) => (
            <div key={label}>
              <span>{label}</span>
              <Progress value={percentValue(value, inputSideTotal + stats.tokens.output + stats.tokens.reasoningOutput)} color="blue" size="xs" radius="xl" style={{ "--progress-section-color": color }} />
              <strong>{formatCompactNumber(value)}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="session-detail-grid">
        <section>
          <div className="session-detail-section-head">
            <Text>事件类型</Text>
            <span>{formatNumber(stats.typeRows.length)} 类</span>
          </div>
          <DetailRankRows rows={stats.typeRows.map((row) => ({ ...row, key: callTypeLabel(row.key) }))} total={stats.eventCount} />
        </section>
        <section>
          <div className="session-detail-section-head">
            <Text>工具调用</Text>
            <span>{formatNumber(stats.toolRows.length)} 类</span>
          </div>
          <DetailRankRows rows={stats.toolRows} total={stats.toolRows.reduce((sum, row) => sum + row.value, 0)} emptyLabel="暂无工具调用" />
        </section>
      </div>

      <div className="session-detail-grid">
        <section>
          <div className="session-detail-section-head">
            <Text>模型分布</Text>
            <span>{stats.modelRows[0]?.key || "-"}</span>
          </div>
          <DetailRankRows rows={stats.modelRows} total={stats.modelRows.reduce((sum, row) => sum + row.value, 0)} />
        </section>
        <section>
          <div className="session-detail-section-head">
            <Text>对话结构</Text>
            <span>{formatNumber(stats.userEvents + stats.agentEvents)} 条</span>
          </div>
          <div className="session-detail-dialogue">
            <div><span>用户输入</span><strong>{formatNumber(stats.userEvents)}</strong></div>
            <div><span>Agent 输出</span><strong>{formatNumber(stats.agentEvents)}</strong></div>
            <div><span>开始时间</span><strong>{stats.first ? formatDateTime(stats.first) : "-"}</strong></div>
            <div><span>最新事件</span><strong>{stats.latest ? formatDateTime(stats.latest) : "-"}</strong></div>
          </div>
        </section>
      </div>

      <section className="session-detail-events">
        <div className="session-detail-section-head">
          <Text>最近事件</Text>
          <span>{loading ? "加载中" : eventTotalLabel}</span>
        </div>
        {stats.recentEvents.length ? (
          <div className="session-detail-event-list">
            {stats.recentEvents.map((event) => (
              <button
                key={`${event.time}-${event.callType}-${event.extra || ""}`}
                type="button"
                className="session-detail-event"
                onClick={() => onOpenEvent?.(event)}
              >
                <span>{callTypeLabel(event.callType)}</span>
                <strong>{readableEventSummary(event, 96)}</strong>
                <em>{formatDateTime(event.time)}</em>
              </button>
            ))}
          </div>
        ) : (
          <Text className="session-detail-empty">{loading ? "正在加载事件…" : "暂无可展示事件"}</Text>
        )}
        {page?.hasMore ? (
          <Button variant="light" radius="xl" color="blue" size="xs" onClick={onLoadMore} loading={loading} mt="sm">
            加载更多事件
          </Button>
        ) : null}
      </section>

      <section className="session-detail-meta">
        <div>
          <Text>工作目录</Text>
          <strong title={session?.cwd || ""}>{session?.cwd || "无目录信息"}</strong>
        </div>
        <div>
          <Text>来源文件</Text>
          <strong title={sourceFiles.join("\n")}>{sourceFiles.length ? clipText(sourceFiles[0], 76) : "无来源文件"}</strong>
        </div>
        <div>
          <Text>会话 ID</Text>
          <strong title={rawIds.join("\n")}>{rawIds.map(shortSessionId).join(" · ") || shortSessionId(selectedSessionId)}</strong>
        </div>
      </section>
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
  onOpenConversation,
  onOpenSessionDetail,
  onRename,
  onDelete,
  onCopySessionId,
  onExportSession,
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
        </div>
        {session.sourceFiles?.[0] ? (
          <div className="session-row__file-line">
            <ThemeIcon radius="xl" size={20} variant="light" color="gray">
              <IconFileText size={12} />
            </ThemeIcon>
            <span>{clipText(session.sourceFiles[0], 84)}</span>
          </div>
        ) : null}
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
        <Tooltip label="查看对话" withArrow>
          <ActionIcon
            variant="light"
            radius="xl"
            color="blue"
            aria-label={`查看对话 · ${shortSessionId(session.sessionId)}`}
            onClick={() => onOpenConversation(session)}
          >
            <IconMessage2 size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="导出脱敏会话" withArrow>
          <ActionIcon
            variant="light"
            radius="xl"
            color="teal"
            aria-label={`导出脱敏会话 · ${shortSessionId(session.sessionId)}`}
            onClick={() => onExportSession?.(session)}
          >
            <IconDownload size={16} />
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
  onOpenConversation,
  onOpenSessionDetail,
  onFocusStreamSession,
  onClearSessionFocus,
  onFocusWorkspace,
  onRename,
  onDelete,
  onCopySessionId,
  onExportSession,
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
    <div className="session-workspace-layout">
      <ScrollArea offsetScrollbars className="sessions-page">
        <Stack gap="md">
          <ActiveSessionsPanel
            overview={activeOverview}
            onOpenConversation={onOpenConversation}
            onOpenSessionDetail={openSessionDetail}
          />
          {(sections || []).map((section) => {
            const sectionTokenTotal = section.sessions.reduce((sum, session) => sum + Number(session.totalTokens || 0), 0);
            const sectionHasTokenData = section.sessions.some((session) => session.hasTokenData);
            const sectionEventTotal = section.sessions.reduce((sum, session) => sum + Number(session.count || 0), 0);
            const sectionLatest = section.sessions[0]?.latest || "";
            const SectionIcon = GroupIcon[section.groupType] || IconFolder;

            return (
              <Paper
                key={section.key || section.cwd}
                radius="xl"
                p="lg"
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
                    <Title order={4} className="session-section__title">{clipText(section.label || section.cwd, 96)}</Title>
                    <Text className="session-section__subline">
                      最近更新 {formatDateTime(sectionLatest)} · {formatNumber(sectionEventTotal)} 条事件
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
                    onOpenConversation={onOpenConversation}
                    onOpenSessionDetail={openSessionDetail}
                    onRename={onRename}
                    onDelete={onDelete}
                    onCopySessionId={onCopySessionId}
                    onExportSession={onExportSession}
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
              onOpenConversation={onOpenConversation}
              onFocusStreamSession={onFocusStreamSession}
              onClearSessionFocus={onClearSessionFocus}
              onLoadMore={onLoadMoreSessionDetail}
              onCopySessionId={onCopySessionId}
              onExportSession={onExportSession}
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
                  <Title order={5} className="workspace-index__title" title={workspaceRootLabel}>{workspaceRootLabel}</Title>
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
