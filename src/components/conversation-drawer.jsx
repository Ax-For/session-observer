import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Drawer, Group, Paper, Progress, ScrollArea, Select, Slider, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatFullDateTime, formatNumber, platformLabel, shortSessionId } from "../lib/formatters";
import { buildConversationTurns, looksLikeMarkdownContent } from "../lib/conversation-models";
import { JsonCodeBlock } from "./json-code-block";

const INITIAL_VISIBLE_TURNS = 8;
const TURN_BATCH_SIZE = 8;
const LONG_MESSAGE_PREVIEW_LENGTH = 900;

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
  const turnRefs = useRef(new Map());
  const pendingScrollTurnId = useRef("");
  const [visibleTurnStart, setVisibleTurnStart] = useState(0);
  const [visibleTurnCount, setVisibleTurnCount] = useState(INITIAL_VISIBLE_TURNS);
  const [selectedTurnId, setSelectedTurnId] = useState("");
  const [scrubberValue, setScrubberValue] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSearchIndex, setSelectedSearchIndex] = useState(0);
  const turns = useMemo(() => buildConversationTurns(events), [events]);
  const visibleTurnEnd = Math.min(visibleTurnStart + visibleTurnCount, turns.length);
  const visibleTurns = useMemo(
    () => turns.slice(visibleTurnStart, visibleTurnEnd),
    [turns, visibleTurnStart, visibleTurnEnd],
  );
  const selectedTurnIndex = turns.findIndex((turn) => turn.id === selectedTurnId);
  const currentTurnIndex = selectedTurnIndex >= 0 ? selectedTurnIndex : Math.max(0, turns.length - 1);
  const selectedTurnValue = selectedTurnId || turns.at(-1)?.id || null;
  const turnOptions = useMemo(
    () => turns.map((turn) => ({
      value: turn.id,
      label: `#${turn.index} ${turnLabel(turn)}`,
    })),
    [turns],
  );
  const searchMatches = useMemo(
    () => buildConversationSearchMatches(turns, searchQuery),
    [turns, searchQuery],
  );
  const activeSearchMatch = searchMatches[selectedSearchIndex] || null;
  const hasProgress = Number(page.total) > 0 || Number(page.loaded) > 0 || loading || loadingMore;
  const progressValue = Number(page.total) > 0
    ? Math.min(100, Math.round((Number(page.loaded) / Number(page.total)) * 100))
    : 0;
  const headerProgressText = Number(page.total) > 0
    ? `${hasMore ? "已载入最近" : "已载入"} ${formatNumber(page.loaded)} / 共 ${formatNumber(page.total)} 条事件`
    : loading
      ? "正在准备会话内容…"
      : "尚未加载事件";
  const progressText = loadingMore
    ? `正在加载更早内容 · 当前 ${formatNumber(page.loaded)} / ${formatNumber(page.total)}`
    : hasMore
      ? `当前仅载入最近 ${formatNumber(page.loaded)} / ${formatNumber(page.total)} 条事件`
      : page.loaded > 0
        ? `已加载全部 ${formatNumber(page.loaded)} 条`
        : "";

  useEffect(() => {
    if (!opened) return;
    turnRefs.current.clear();
    setVisibleTurnStart(0);
    setVisibleTurnCount(INITIAL_VISIBLE_TURNS);
    setSelectedTurnId("");
    setSearchQuery("");
    setSelectedSearchIndex(0);
  }, [opened, session?.sessionId]);

  useEffect(() => {
    if (selectedTurnId || !turns.at(-1)) return;
    const latestTurn = turns.at(-1);
    const nextStart = Math.max(0, turns.length - INITIAL_VISIBLE_TURNS);
    pendingScrollTurnId.current = latestTurn.id;
    setVisibleTurnStart(nextStart);
    setVisibleTurnCount(Math.min(INITIAL_VISIBLE_TURNS, turns.length));
    setSelectedTurnId(latestTurn.id);
  }, [selectedTurnId, turns]);

  useEffect(() => {
    if (!selectedTurnId || selectedTurnIndex < 0) return;
    if (selectedTurnIndex >= visibleTurnStart && selectedTurnIndex < visibleTurnEnd) return;
    const nextStart = Math.max(0, Math.min(selectedTurnIndex - 2, turns.length - INITIAL_VISIBLE_TURNS));
    setVisibleTurnStart(nextStart);
    setVisibleTurnCount(Math.min(INITIAL_VISIBLE_TURNS, turns.length));
  }, [selectedTurnId, selectedTurnIndex, turns.length, visibleTurnEnd, visibleTurnStart]);

  useEffect(() => {
    setScrubberValue(Math.min(turns.length || 1, currentTurnIndex + 1));
  }, [currentTurnIndex, turns.length]);

  useEffect(() => {
    setSelectedSearchIndex(0);
    if (!searchQuery.trim() || !searchMatches[0]) return;
    jumpToTurn(searchMatches[0].turnId);
  }, [searchQuery, searchMatches]);

  useEffect(() => {
    if (!pendingScrollTurnId.current) return;
    const turnId = pendingScrollTurnId.current;
    window.requestAnimationFrame(() => {
      scrollToTurn(turnId);
      pendingScrollTurnId.current = "";
    });
  }, [visibleTurnCount, visibleTurnStart, selectedTurnId]);

  function scrollToTurn(turnId) {
    const element = turnRefs.current.get(turnId);
    const viewport = viewportRef.current;
    if (!element || !viewport) return;

    const elementRect = element.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const offsetWithinViewport = elementRect.top - viewportRect.top;
    const targetTop = Math.max(0, viewport.scrollTop + offsetWithinViewport - 12);

    if (typeof viewport.scrollTo === "function") {
      viewport.scrollTo({ top: targetTop, behavior: "smooth" });
      return;
    }

    viewport.scrollTop = targetTop;
  }

  function revealMoreTurns() {
    const nextStart = Math.max(0, visibleTurnStart - TURN_BATCH_SIZE);
    setVisibleTurnCount((current) => Math.min(turns.length - nextStart, current + visibleTurnStart - nextStart));
    setVisibleTurnStart(nextStart);
  }

  function jumpToTurn(turnId) {
    const nextIndex = turns.findIndex((turn) => turn.id === turnId);
    if (nextIndex < 0) return;
    const nextCount = Math.min(INITIAL_VISIBLE_TURNS, turns.length);
    const nextStart = Math.max(0, Math.min(nextIndex - 2, turns.length - nextCount));
    pendingScrollTurnId.current = turnId;
    setSelectedTurnId(turnId);
    setVisibleTurnStart(nextStart);
    setVisibleTurnCount(nextCount);
  }

  function jumpByTurn(offset) {
    const nextIndex = Math.max(0, Math.min(turns.length - 1, currentTurnIndex + offset));
    const nextTurn = turns[nextIndex];
    if (nextTurn) jumpToTurn(nextTurn.id);
  }

  function jumpToTurnNumber(turnNumber) {
    const normalized = Math.max(1, Math.min(turns.length, Number(turnNumber) || 1));
    const nextTurn = turns[normalized - 1];
    if (nextTurn) jumpToTurn(nextTurn.id);
  }

  function jumpToSearchMatch(offset) {
    if (searchMatches.length === 0) return;
    const nextIndex = (selectedSearchIndex + offset + searchMatches.length) % searchMatches.length;
    setSelectedSearchIndex(nextIndex);
    jumpToTurn(searchMatches[nextIndex].turnId);
  }

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
            {turns.length > 0 ? (
              <div className="conversation-search" aria-label="对话搜索">
                <TextInput
                  label="搜索对话内容或回合"
                  placeholder="输入关键词、工具名或回合号"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  size="xs"
                  radius="xl"
                  className="conversation-search__input"
                />
                <Group justify="space-between" align="center" gap="xs" wrap="wrap" className="conversation-search__meta-row">
                  <Text className="conversation-search__meta">
                    {searchQuery.trim()
                      ? activeSearchMatch
                        ? `命中 ${formatNumber(selectedSearchIndex + 1)} / ${formatNumber(searchMatches.length)} · 第 ${formatNumber(activeSearchMatch.turnIndex)} 轮 · ${activeSearchMatch.label}`
                        : "无匹配结果"
                      : "可搜索用户消息、助手回复、工具名、工具参数和回合号"}
                  </Text>
                  <Group gap={6} wrap="nowrap">
                    <Button
                      variant="light"
                      size="xs"
                      radius="xl"
                      color="gray"
                      disabled={searchMatches.length <= 1}
                      onClick={() => jumpToSearchMatch(-1)}
                    >
                      上一处
                    </Button>
                    <Button
                      variant="light"
                      size="xs"
                      radius="xl"
                      color="gray"
                      disabled={searchMatches.length <= 1}
                      onClick={() => jumpToSearchMatch(1)}
                    >
                      下一处
                    </Button>
                    {searchQuery ? (
                      <Button
                        variant="subtle"
                        size="xs"
                        radius="xl"
                        color="gray"
                        onClick={() => setSearchQuery("")}
                      >
                        清除
                      </Button>
                    ) : null}
                  </Group>
                </Group>
                {activeSearchMatch ? (
                  <Text className="conversation-search__snippet">{activeSearchMatch.snippet}</Text>
                ) : null}
              </div>
            ) : null}
            {turns.length > 1 ? (
              <div className="conversation-turn-nav" aria-label="回合导航">
                <Group className="conversation-turn-nav__controls" align="flex-end" justify="space-between" gap="sm">
                  <Select
                    label="回合导航"
                    value={selectedTurnValue}
                    onChange={(value) => {
                      if (value) jumpToTurn(value);
                    }}
                    data={turnOptions}
                    searchable
                    size="xs"
                    radius="xl"
                    className="conversation-turn-select"
                  />
                  <Group gap="xs" wrap="nowrap">
                    <Button
                      variant="light"
                      size="xs"
                      radius="xl"
                      color="gray"
                      disabled={currentTurnIndex <= 0}
                      onClick={() => jumpByTurn(-1)}
                    >
                      上一轮
                    </Button>
                    <Button
                      variant="light"
                      size="xs"
                      radius="xl"
                      color="gray"
                      disabled={currentTurnIndex >= turns.length - 1}
                      onClick={() => jumpByTurn(1)}
                    >
                      下一轮
                    </Button>
                  </Group>
                </Group>
                <Text className="conversation-turn-nav__meta">
                  已渲染 {formatNumber(visibleTurns.length)} / {formatNumber(turns.length)} 轮
                  {turns.length > visibleTurns.length
                    ? ` · 当前范围 ${formatNumber(visibleTurnStart + 1)}-${formatNumber(visibleTurnEnd)}`
                    : ""}
                  {loadingMore ? " · 正在补齐更早回合" : ""}
                </Text>
                <div className="conversation-turn-scrubber">
                  <Group justify="space-between" align="center" gap="xs">
                    <Text className="conversation-turn-scrubber__label">拖动定位回合</Text>
                    <Text className="conversation-turn-scrubber__value">
                      第 {formatNumber(currentTurnIndex + 1)} / {formatNumber(turns.length)} 轮
                    </Text>
                  </Group>
                  <Slider
                    aria-label="拖动定位回合"
                    thumbLabel="拖动定位回合"
                    min={1}
                    max={Math.max(1, turns.length)}
                    step={1}
                    value={scrubberValue}
                    onChange={setScrubberValue}
                    onChangeEnd={jumpToTurnNumber}
                    disabled={turns.length <= 1}
                    label={(value) => `第 ${formatNumber(value)} 轮`}
                    size="sm"
                    color="blue"
                    className="conversation-turn-scrubber__control"
                  />
                </div>
              </div>
            ) : null}
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

                {!loading && turns.length === 0 ? (
                  <Paper radius="xl" p="lg" className="conversation-state">
                    <Text>当前会话没有可显示的对话内容。</Text>
                  </Paper>
                ) : null}

                {!loading && progressText && hasMore ? (
                  <Paper radius="xl" p="sm" className="conversation-more">
                    <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                      <Text className="conversation-more__status">{progressText}</Text>
                      <Button
                        variant="subtle"
                        size="xs"
                        radius="xl"
                        color="blue"
                        loading={loadingMore}
                        onClick={onLoadMore}
                      >
                        加载更早内容
                      </Button>
                    </Group>
                  </Paper>
                ) : null}

                {!loading && visibleTurnStart > 0 ? (
                  <Paper radius="xl" p="sm" className="conversation-more conversation-window-more">
                    <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                      <Text className="conversation-more__status">
                        当前显示第 {formatNumber(visibleTurnStart + 1)}-{formatNumber(visibleTurnEnd)} 轮
                      </Text>
                      <Button
                        variant="subtle"
                        size="xs"
                        radius="xl"
                        color="blue"
                        onClick={revealMoreTurns}
                      >
                        显示更早回合
                      </Button>
                    </Group>
                  </Paper>
                ) : null}

                {visibleTurns.map((turn) => (
                  <ConversationTurn
                    key={turn.id}
                    turn={turn}
                    searchMatch={activeSearchMatch?.turnId === turn.id ? activeSearchMatch : null}
                    setTurnRef={(element) => {
                      if (element) turnRefs.current.set(turn.id, element);
                      else turnRefs.current.delete(turn.id);
                    }}
                  />
                ))}

                {!loading && progressText && !hasMore ? (
                  <Paper radius="xl" p="sm" className="conversation-more">
                    <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                      <Text className="conversation-more__status">{progressText}</Text>
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

function buildConversationSearchMatches(turns, query) {
  const rawQuery = String(query || "").trim();
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const matches = [];
  turns.forEach((turn) => {
    const turnNumberText = String(turn.index);
    if (turnNumberText === normalizedQuery || `第${turn.index}轮`.includes(normalizedQuery)) {
      matches.push({
        id: `${turn.id}-turn-number`,
        turnId: turn.id,
        turnIndex: turn.index,
        label: "回合",
        query: rawQuery,
        snippet: `第 ${turn.index} 轮`,
      });
      return;
    }

    for (const entry of collectSearchableEntries(turn)) {
      const text = normalizeSearchText(entry.text);
      if (!text.includes(normalizedQuery)) continue;
      matches.push({
        id: `${turn.id}-${entry.id}`,
        entryId: entry.id,
        turnId: turn.id,
        turnIndex: turn.index,
        label: entry.label,
        query: rawQuery,
        snippet: buildSearchSnippet(entry.text, normalizedQuery),
      });
      break;
    }
  });

  return matches;
}

function collectSearchableEntries(turn) {
  return [
    ...turn.userMessages.map((entry) => ({
      id: entry.id,
      label: "用户",
      text: entry.content,
    })),
    ...turn.assistantMessages.map((entry) => ({
      id: entry.id,
      label: "助手",
      text: entry.content,
    })),
    ...turn.toolEntries.map((entry) => ({
      id: entry.id,
      label: entry.phase === "input" ? "工具调用" : "工具结果",
      text: `${entry.toolName}\n${stringifySearchableDisplay(entry.display)}`,
    })),
    ...turn.thinkingEntries.map((entry) => ({
      id: entry.id,
      label: "思考",
      text: entry.content,
    })),
  ];
}

function stringifySearchableDisplay(display) {
  if (!display) return "";
  if (display.command) return `${display.command}\n${display.description || ""}`;
  if (display.value) return `${display.label || ""}\n${display.value}\n${display.secondary || ""}`;
  if (display.content) return display.content;
  return JSON.stringify(display);
}

function normalizeSearchText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function buildSearchSnippet(value, normalizedQuery) {
  const source = String(value || "").replace(/\s+/g, " ").trim();
  const sourceLower = source.toLowerCase();
  const index = sourceLower.indexOf(normalizedQuery);
  if (index < 0) return source.slice(0, 96);
  const start = Math.max(0, index - 36);
  const end = Math.min(source.length, index + normalizedQuery.length + 56);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < source.length ? "..." : "";
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

export function ConversationTurn({ turn, searchMatch, setTurnRef, hideHeader = false }) {
  const hasTools = turn.toolEntries.length > 0;
  const hasThinking = turn.thinkingEntries.length > 0;
  const [toolsOpen, setToolsOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const highlightedEntryId = searchMatch?.entryId || "";
  const highlightQuery = searchMatch?.query || "";

  useEffect(() => {
    if (!highlightedEntryId) return;
    if (turn.toolEntries.some((entry) => entry.id === highlightedEntryId)) {
      setToolsOpen(true);
    }
    if (turn.thinkingEntries.some((entry) => entry.id === highlightedEntryId)) {
      setThinkingOpen(true);
    }
  }, [highlightedEntryId, turn.thinkingEntries, turn.toolEntries]);

  return (
    <section ref={setTurnRef} className={`conversation-turn ${searchMatch ? "is-search-match" : ""}`}>
      {!hideHeader ? <div className="conversation-turn__head">
        <Group gap="xs" wrap="wrap">
          <Badge radius="xl" variant="light" color="blue">第 {turn.index} 轮</Badge>
          {searchMatch ? <Badge radius="xl" variant="light" color="yellow">当前搜索命中</Badge> : null}
          <Text className="conv-meta">{formatFullDateTime(turn.startedAt)}</Text>
        </Group>
        {hasTools ? (
          <Text className={`conversation-turn__tool-count ${turn.toolSummary.errors ? "is-error" : ""}`}>
            工具 {turn.toolSummary.total}
            {turn.toolSummary.errors ? ` · 错误 ${turn.toolSummary.errors}` : ""}
          </Text>
        ) : null}
      </div> : null}

      <Stack gap="sm">
        {turn.userMessages.map((entry) => (
          <ConversationEntry
            key={entry.id}
            entry={entry}
            highlightQuery={entry.id === highlightedEntryId ? highlightQuery : ""}
          />
        ))}

        {turn.assistantMessages.map((entry) => (
          <ConversationEntry
            key={entry.id}
            entry={entry}
            highlightQuery={entry.id === highlightedEntryId ? highlightQuery : ""}
          />
        ))}

        {hasTools ? (
          <details className="conversation-turn__tools" open={toolsOpen}>
            <summary onClick={(event) => {
              event.preventDefault();
              setToolsOpen((current) => !current);
            }}>
              <span>工具活动</span>
              <small>
                {toolSummaryText(turn)}
              </small>
            </summary>
            {toolsOpen ? (
              <div className="conversation-turn__tool-list">
                {turn.toolEntries.map((entry) => (
                  <ConversationEntry
                    key={entry.id}
                    entry={entry}
                    highlightQuery={entry.id === highlightedEntryId ? highlightQuery : ""}
                  />
                ))}
              </div>
            ) : null}
          </details>
        ) : null}

        {hasThinking ? (
          <details className="conversation-turn__thinking" open={thinkingOpen}>
            <summary onClick={(event) => {
              event.preventDefault();
              setThinkingOpen((current) => !current);
            }}>
              思考过程 · {turn.thinkingEntries.length} 条
            </summary>
            {thinkingOpen ? (
              <Stack gap="sm" mt="sm">
                {turn.thinkingEntries.map((entry) => (
                  <ConversationEntry
                    key={entry.id}
                    entry={entry}
                    highlightQuery={entry.id === highlightedEntryId ? highlightQuery : ""}
                  />
                ))}
              </Stack>
            ) : null}
          </details>
        ) : null}
      </Stack>
    </section>
  );
}

export function ConversationEntry({ entry, highlightQuery = "" }) {
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
          <ToolDisplay entry={entry} highlightQuery={highlightQuery} />
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
            <pre className="conv-code conv-code--thinking">
              <HighlightedText value={entry.content} query={highlightQuery} />
            </pre>
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
        <div className="conv-message-head">
          <Text className="conv-role-label">{entry.role === "user" ? "你" : "Agent"}</Text>
          <Text className="conv-meta">{formatFullDateTime(entry.time)}</Text>
        </div>
        {entry.agentPrefix ? (
          <Text className="conv-agent-prefix">[agent={entry.agentPrefix}]</Text>
        ) : null}
        <div className="conv-message-body">
          <MarkdownOrPlainText content={entry.content} highlightQuery={highlightQuery} />
        </div>
      </div>
    </div>
  );
}

function turnLabel(turn) {
  const source = turn.userMessages[0]?.content
    || turn.assistantMessages[0]?.content
    || "会话片段";
  return String(source).trim().replace(/\s+/g, " ").slice(0, 32);
}

function toolSummaryText(turn) {
  const labels = turn.toolSummary.labels.length > 0
    ? turn.toolSummary.labels.slice(0, 4).join(" / ")
    : "无工具名称";
  const suffix = turn.toolSummary.errors > 0 ? ` · ${turn.toolSummary.errors} 个错误` : "";
  return `${turn.toolSummary.total} 项 · ${labels}${suffix}`;
}

function ToolDisplay({ entry, highlightQuery = "" }) {
  const { display } = entry;

  if (display.type === "terminal") {
    return (
      <div className="conv-terminal">
        <code>
          <HighlightedText value={display.command || "-"} query={highlightQuery} />
        </code>
        {display.description ? <Text className="conv-meta">{display.description}</Text> : null}
      </div>
    );
  }

  if (display.type === "one-line") {
    return (
      <div className="conv-inline-chip">
        <span className="conv-inline-chip__label">
          <HighlightedText value={display.label || display.value || "-"} query={highlightQuery} />
        </span>
        {display.secondary ? (
          <span className="conv-inline-chip__meta">
            <HighlightedText value={display.secondary} query={highlightQuery} />
          </span>
        ) : null}
        {display.action === "open-file" && display.value ? (
          <span className="conv-inline-chip__path" title={display.value}>
            <HighlightedText value={display.value} query={highlightQuery} />
          </span>
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
          {display.oldContent ? (
            <pre className="conv-code conv-code--muted">
              <HighlightedText value={display.oldContent} query={highlightQuery} />
            </pre>
          ) : null}
          {display.newContent ? (
            <pre className="conv-code">
              <HighlightedText value={display.newContent} query={highlightQuery} />
            </pre>
          ) : null}
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
            <Text key={item} className="conv-file-item">
              <HighlightedText value={item} query={highlightQuery} />
            </Text>
          ))}
        </Stack>
      </details>
    );
  }

  if (display.type === "json") {
    return (
      <details className="conv-disclosure">
        <summary>{display.title || "工具参数"}</summary>
        {highlightQuery ? (
          <pre className="conv-code">
            <HighlightedText value={display.content || "-"} query={highlightQuery} />
          </pre>
        ) : (
          <JsonBlock content={display.content} />
        )}
      </details>
    );
  }

  if (display.type === "markdown") {
    return (
      <details className="conv-disclosure">
        <summary>{display.title || "展开内容"}</summary>
        <div className="conv-disclosure__body">
          <MarkdownOrPlainText content={display.content} highlightQuery={highlightQuery} />
        </div>
      </details>
    );
  }

  if (display.type === "error") {
    return (
      <pre className="conv-code conv-code--error">
        <HighlightedText value={display.content} query={highlightQuery} />
      </pre>
    );
  }

  return (
    <details className="conv-disclosure">
      <summary>{display.title || "展开内容"}</summary>
      <pre className="conv-code">
        <HighlightedText value={display.content || "-"} query={highlightQuery} />
      </pre>
    </details>
  );
}

function MarkdownOrPlainText({ content, highlightQuery = "" }) {
  const value = String(content || "");
  const [expanded, setExpanded] = useState(false);
  const shouldPreview = value.length > LONG_MESSAGE_PREVIEW_LENGTH && !expanded;
  const hasHighlight = hasHighlightMatch(value, highlightQuery);

  if (shouldPreview) {
    const preview = `${value.slice(0, LONG_MESSAGE_PREVIEW_LENGTH).trim()}...`;
    return (
      <div className="conv-message-preview">
        <Text component="div" className="conv-message-plain">
          <HighlightedText value={preview} query={highlightQuery} />
        </Text>
        <Group justify="space-between" gap="xs" mt="sm">
          <Text className="conv-message-preview__meta">
            内容较长，已显示预览 · {formatNumber(value.length)} 字符
          </Text>
          <Button variant="subtle" size="xs" radius="xl" color="blue" onClick={() => setExpanded(true)}>
            展开完整内容
          </Button>
        </Group>
      </div>
    );
  }

  if (hasHighlight) {
    return (
      <Text component="div" className="conv-message-plain">
        <HighlightedText value={value} query={highlightQuery} />
      </Text>
    );
  }

  if (looksLikeMarkdownContent(value)) {
    return <MarkdownContent content={value} />;
  }
  return <Text component="div" className="conv-message-plain">{value}</Text>;
}

function hasHighlightMatch(value, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return false;
  return String(value || "").toLowerCase().includes(normalizedQuery);
}

function HighlightedText({ value, query }) {
  const text = String(value || "");
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return text;

  const lowerText = text.toLowerCase();
  const parts = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedQuery);

  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + normalizedQuery.length;
    parts.push(
      <mark className="conversation-highlight" key={`${matchIndex}-${matchEnd}`}>
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedQuery, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts;
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
