import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  Tree,
  useTree,
} from "@mantine/core";
import { useMemo } from "react";
import {
  IconArrowRight,
  IconActivity,
  IconChevronRight,
  IconCopy,
  IconEdit,
  IconFileText,
  IconFolder,
  IconFolders,
  IconLayersIntersect,
  IconMessage2,
  IconRoute,
  IconTerminal2,
  IconTrash,
} from "@tabler/icons-react";
import {
  clipText,
  formatCompactNumber,
  formatDateTime,
  formatNumber,
  platformLabel,
  shortSessionId,
} from "../lib/formatters";

function formatTokenText(value, hasTokenData = true) {
  return hasTokenData ? `${formatCompactNumber(value)} Tok` : "Token 未记录";
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

function ActiveSessionsPanel({ overview, onOpenConversation }) {
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
            <button
              key={session.sessionId}
              type="button"
              className="active-session-row"
              aria-label={`打开活跃会话 ${session.title}`}
              onClick={() => onOpenConversation(session)}
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
              </span>
              <IconArrowRight size={16} className="active-session-row__arrow" />
            </button>
          ))}
        </div>
      ) : null}

      {hiddenCount ? (
        <Text className="active-sessions-panel__more">还有 {formatNumber(hiddenCount)} 个活跃会话</Text>
      ) : null}
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

export function SessionWorkspace({
  activeOverview,
  sections,
  selectedIds,
  onToggleSelect,
  onOpenConversation,
  onFocusWorkspace,
  onRename,
  onDelete,
  onCopySessionId,
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

  return (
    <div className="session-workspace-layout">
      <ScrollArea offsetScrollbars className="sessions-page">
        <Stack gap="md">
          <ActiveSessionsPanel overview={activeOverview} onOpenConversation={onOpenConversation} />
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

              <div className="session-list">
                {section.sessions.map((session) => {
                  const sessionIds = getSessionIds(session);
                  const selectedCount = sessionIds.filter((id) => selectedSet.has(id)).length;
                  const checked = sessionIds.length > 0 && selectedCount === sessionIds.length;
                  const indeterminate = selectedCount > 0 && selectedCount < sessionIds.length;

                  return (
                  <div key={session.sessionId} className="session-card session-row">
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
                      onClick={() => onOpenConversation(session)}
                    >
                      <div className="session-row__title-line">
                        <ThemeIcon
                          radius="xl"
                          size={28}
                          variant="gradient"
                          gradient={session.sourceType === "codex"
                            ? { from: "blue", to: "cyan" }
                            : { from: "orange", to: "yellow" }}
                          aria-label={platformLabel(session.sourceType)}
                        >
                          <IconTerminal2 size={15} stroke={2.2} />
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

                    <Group gap="xs" className="session-row__actions" wrap="nowrap">
                      <Button
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        size="xs"
                        onClick={() => onOpenConversation(session)}
                      >
                        查看对话 · {shortSessionId(session.sessionId)}
                      </Button>
                    </Group>
                  </div>
                  );
                })}
              </div>
            </Paper>
            );
          })}
        </Stack>
      </ScrollArea>

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

        <ScrollArea.Autosize mah="min(66vh, 620px)" offsetScrollbars className="workspace-index-tree-scroll">
          <WorkspaceTreeView key={workspaceTreeKey} data={workspaceTreeData} onFocusWorkspace={onFocusWorkspace} />
        </ScrollArea.Autosize>
      </Paper>
    </div>
  );
}
