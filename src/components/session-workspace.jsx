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
} from "@mantine/core";
import {
  IconArrowRight,
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

function WorkspaceTreeNode({ node, onFocusWorkspace }) {
  const hasChildren = (node.children || []).length > 0;
  const isLeaf = Boolean(node.workspace);
  const content = (
    <>
      <ThemeIcon
        radius="md"
        size={isLeaf ? 30 : 26}
        variant={isLeaf ? "light" : "subtle"}
        color={isLeaf ? "blue" : "gray"}
        className="workspace-index-item__icon"
      >
        {hasChildren ? <IconFolders size={16} /> : <IconFolder size={15} />}
      </ThemeIcon>
      <span className="workspace-index-item__copy">
        <strong>{clipText(node.label, isLeaf ? 42 : 34)}</strong>
        <span>
          {formatNumber(node.sessions)} 会话 · {formatTokenText(node.tokens, node.hasTokenData)}
        </span>
      </span>
      {isLeaf ? (
        <>
          <Badge radius="xl" variant="filled" color="blue" className="workspace-index-item__count">
            {formatNumber(node.sessions)}
          </Badge>
          <IconArrowRight size={15} className="workspace-index-item__arrow" />
        </>
      ) : (
        <IconChevronRight size={15} className="workspace-index-item__branch-arrow" />
      )}
    </>
  );

  return (
    <div className="workspace-index-tree-node" style={{ "--workspace-depth": node.depth || 0 }}>
      {isLeaf ? (
        <button
          type="button"
          className="workspace-index-item"
          aria-label={`定位工作目录 ${node.workspace.cwd}`}
          onClick={() => onFocusWorkspace?.(node.workspace.cwd)}
        >
          {content}
        </button>
      ) : (
        <div className="workspace-index-branch">
          {content}
        </div>
      )}
      {hasChildren ? (
        <div className="workspace-index-children">
          {node.children.map((child) => (
            <WorkspaceTreeNode key={child.key} node={child} onFocusWorkspace={onFocusWorkspace} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SessionWorkspace({
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

  return (
    <div className="session-workspace-layout">
      <ScrollArea offsetScrollbars className="sessions-page">
        <Stack gap="md">
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
          <div>
            <Text className="eyebrow">工作目录</Text>
            <Title order={5}>{workspaceTree?.label || "关联会话"}</Title>
            <Text className="workspace-index__hint">按公共路径折叠，点击叶子定位分组</Text>
          </div>
        </Group>

        <div className="workspace-index-tree">
          {(workspaceTree?.children || workspaceIndex || []).map((item) => (
            item.children
              ? <WorkspaceTreeNode key={item.key} node={item} onFocusWorkspace={onFocusWorkspace} />
              : (
                <WorkspaceTreeNode
                  key={item.key}
                  node={{
                    key: item.key,
        label: item.cwd,
        depth: 1,
        sessions: item.sessions,
        rawSessions: item.rawSessions,
        tokens: item.tokens,
        workspace: item,
        children: [],
                  }}
                  onFocusWorkspace={onFocusWorkspace}
                />
              )
          ))}
        </div>
      </Paper>
    </div>
  );
}
