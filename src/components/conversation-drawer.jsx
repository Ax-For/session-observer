import { useEffect, useRef } from "react";
import { Badge, Button, Drawer, Group, Paper, Progress, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatFullDateTime, formatNumber, platformLabel, shortSessionId } from "../lib/formatters";
import { buildConversationEntries, looksLikeMarkdownContent } from "../lib/conversation-models";
import { JsonCodeBlock } from "./json-code-block";

export function ConversationDrawer({
  opened,
  onClose,
  session,
  events,
  loading,
  loadingMore = false,
  hasMore = false,
  page = { loaded: 0, total: 0 },
  onLoadMore,
  onCopySessionId,
}) {
  const viewportRef = useRef(null);
  const entries = buildConversationEntries(events);
  const hasProgress = Number(page.total) > 0 || Number(page.loaded) > 0 || loading || loadingMore;
  const progressValue = Number(page.total) > 0
    ? Math.min(100, Math.round((Number(page.loaded) / Number(page.total)) * 100))
    : 0;
  const headerProgressText = Number(page.total) > 0
    ? `已加载 ${formatNumber(page.loaded)} / 共 ${formatNumber(page.total)} 条事件`
    : loading
      ? "正在准备会话内容…"
      : "尚未加载事件";
  const progressText = loadingMore
    ? `正在加载 ${formatNumber(page.loaded)} / ${formatNumber(page.total)}…`
    : hasMore
      ? `已加载 ${formatNumber(page.loaded)} / 共 ${formatNumber(page.total)} · 向下滚动加载更多`
      : page.loaded > 0
        ? `已加载全部 ${formatNumber(page.loaded)} 条`
        : "";

  useEffect(() => {
    if (!opened) return undefined;
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    function handleScroll() {
      if (!hasMore || loading || loadingMore || typeof onLoadMore !== "function") return;
      const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      if (remaining < 240) onLoadMore();
    }

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [opened, entries.length, hasMore, loading, loadingMore, onLoadMore]);

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="48rem"
      title="会话对话"
      padding="lg"
      classNames={{ body: "drawer-body" }}
    >
      {session ? (
        <Stack gap="lg">
          <div>
            <Group gap="xs" mb={6}>
              <Badge radius="xl" variant="light" color={session.sourceType === "codex" ? "blue" : "violet"}>
                {platformLabel(session.sourceType)}
              </Badge>
              <Badge radius="xl" variant="light" color="gray">
                {session.models?.[0] || "unknown"}
              </Badge>
            </Group>
            <Title order={3}>{session.title || "未命名会话"}</Title>
            <Text className="drawer-subtitle">{session.cwd}</Text>
            {hasProgress ? (
              <div className="conversation-progress" aria-label="会话进度">
                <Group justify="space-between" align="center" gap="xs" wrap="wrap">
                  <Text className="conversation-progress__label">会话进度</Text>
                  <Text className="conversation-progress__meta">{headerProgressText}</Text>
                </Group>
                <Progress
                  value={progressValue}
                  size="xs"
                  radius="xl"
                  className="conversation-progress__bar"
                />
              </div>
            ) : null}
            <Group gap="xs" mt="sm">
              <Button
                variant="subtle"
                radius="xl"
                size="xs"
                color="gray"
                leftSection={<IconCopy size={14} />}
                onClick={() => onCopySessionId?.(session.sessionId)}
              >
                复制会话 ID · {shortSessionId(session.sessionId)}
              </Button>
            </Group>
          </div>

          <div className="conversation-scroll-shell">
            <ScrollArea
              h="100%"
              offsetScrollbars
              className="conversation-scroll"
              viewportRef={viewportRef}
            >
              <Stack gap="sm">
                {loading ? (
                  <Paper radius="xl" p="lg" className="conversation-state">
                    <Text>正在加载会话事件…</Text>
                  </Paper>
                ) : null}

                {!loading && entries.length === 0 ? (
                  <Paper radius="xl" p="lg" className="conversation-state">
                    <Text>当前会话没有可显示的对话内容。</Text>
                  </Paper>
                ) : null}

                {entries.map((entry) => (
                  <ConversationEntry key={entry.id} entry={entry} />
                ))}

                {!loading && progressText ? (
                  <Paper radius="xl" p="sm" className="conversation-more">
                    <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                      <Text className="conversation-more__status">{progressText}</Text>
                      {hasMore ? (
                        <Button
                          variant="subtle"
                          size="xs"
                          radius="xl"
                          color="blue"
                          loading={loadingMore}
                          onClick={onLoadMore}
                        >
                          继续加载
                        </Button>
                      ) : null}
                    </Group>
                  </Paper>
                ) : null}
              </Stack>
            </ScrollArea>
          </div>
        </Stack>
      ) : null}
    </Drawer>
  );
}

function ConversationEntry({ entry }) {
  if (entry.kind === "tool") {
    return (
      <div className={`conv-row conv-row--tool conv-row--${entry.category} ${entry.isError ? "is-error" : ""}`}>
        <div className="conv-avatar conv-avatar--tool">{entry.phase === "input" ? "⌘" : "↳"}</div>
        <div className="conv-surface conv-surface--tool">
          <div className="conv-tool-head">
            <Group gap="xs">
              <Badge radius="xl" variant="light" color="gray">{entry.toolName}</Badge>
              <Text className="conv-meta">{entry.phase === "input" ? "工具调用" : "工具结果"}</Text>
            </Group>
            <Text className="conv-meta">{formatFullDateTime(entry.time)}</Text>
          </div>
          <ToolDisplay entry={entry} />
        </div>
      </div>
    );
  }

  if (entry.kind === "thinking") {
    return (
      <div className="conv-row conv-row--thinking">
        <div className="conv-avatar conv-avatar--thinking">💭</div>
        <div className="conv-surface conv-surface--thinking">
          <details className="conv-disclosure">
            <summary>思考过程</summary>
            <pre className="conv-code conv-code--thinking">{entry.content}</pre>
          </details>
          <Text className="conv-meta">{formatFullDateTime(entry.time)}</Text>
        </div>
      </div>
    );
  }

  return (
    <div className={`conv-row conv-row--message conv-row--${entry.role} ${entry.grouped ? "is-grouped" : ""}`}>
      <div className={`conv-avatar conv-avatar--${entry.role}`}>{entry.role === "user" ? "U" : "A"}</div>
      <div className={`conv-surface conv-surface--${entry.role}`}>
        {entry.agentPrefix ? (
          <Text className="conv-agent-prefix">[agent={entry.agentPrefix}]</Text>
        ) : null}
        <div className="conv-message-body">
          <MarkdownOrPlainText content={entry.content} />
        </div>
        <Text className="conv-meta">{formatFullDateTime(entry.time)}</Text>
      </div>
    </div>
  );
}

function ToolDisplay({ entry }) {
  const { display } = entry;

  if (display.type === "terminal") {
    return (
      <div className="conv-terminal">
        <code>{display.command || "-"}</code>
        {display.description ? <Text className="conv-meta">{display.description}</Text> : null}
      </div>
    );
  }

  if (display.type === "one-line") {
    return (
      <div className="conv-inline-chip">
        <span className="conv-inline-chip__label">{display.label || display.value || "-"}</span>
        {display.secondary ? <span className="conv-inline-chip__meta">{display.secondary}</span> : null}
        {display.action === "open-file" && display.value ? (
          <span className="conv-inline-chip__path" title={display.value}>{display.value}</span>
        ) : null}
      </div>
    );
  }

  if (display.type === "diff") {
    return (
      <details className="conv-disclosure">
        <summary>{display.title || "文件变更"}</summary>
        <div className="conv-diff-shell">
          <div className={`conv-diff-badge conv-diff-badge--${display.badgeTone || "warning"}`}>{display.badge}</div>
          {display.filePath ? <Text className="conv-meta">{display.filePath}</Text> : null}
          {display.oldContent ? <pre className="conv-code conv-code--muted">{display.oldContent}</pre> : null}
          {display.newContent ? <pre className="conv-code">{display.newContent}</pre> : null}
        </div>
      </details>
    );
  }

  if (display.type === "file-list") {
    return (
      <details className="conv-disclosure">
        <summary>{display.title || "匹配结果"}</summary>
        <Stack gap={4} mt="sm">
          {(display.items || []).map((item) => (
            <Text key={item} className="conv-file-item">{item}</Text>
          ))}
        </Stack>
      </details>
    );
  }

  if (display.type === "json") {
    return (
      <details className="conv-disclosure">
        <summary>{display.title || "工具参数"}</summary>
        <JsonBlock content={display.content} />
      </details>
    );
  }

  if (display.type === "markdown") {
    return (
      <details className="conv-disclosure">
        <summary>{display.title || "展开内容"}</summary>
        <div className="conv-disclosure__body">
          <MarkdownContent content={display.content} />
        </div>
      </details>
    );
  }

  if (display.type === "error") {
    return <pre className="conv-code conv-code--error">{display.content}</pre>;
  }

  return (
    <details className="conv-disclosure">
      <summary>{display.title || "展开内容"}</summary>
      <pre className="conv-code">{display.content || "-"}</pre>
    </details>
  );
}

function MarkdownOrPlainText({ content }) {
  if (looksLikeMarkdownContent(content)) {
    return <MarkdownContent content={content} />;
  }
  return <Text component="div" className="conv-message-plain">{content}</Text>;
}

function MarkdownContent({ content }) {
  const value = String(content || "").trim();
  if (!value) return null;

  return (
    <div className="conv-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <pre className="conv-code conv-code--markdown">{children}</pre>,
          code: ({ className, children, ...props }) => (
            <code className={className ? `conv-code-inline ${className}` : "conv-code-inline"} {...props}>
              {children}
            </code>
          ),
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          ),
        }}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}

function JsonBlock({ content }) {
  return <JsonCodeBlock value={content || "-"} className="conv-json" />;
}
