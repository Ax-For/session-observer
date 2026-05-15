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
  Title,
} from "@mantine/core";
import {
  IconCopy,
  IconEdit,
  IconMessage2,
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

export function SessionWorkspace({
  sections,
  selectedIds,
  onToggleSelect,
  onOpenConversation,
  onRename,
  onDelete,
  onCopySessionId,
}) {
  const selectedSet = new Set(selectedIds || []);

  return (
    <ScrollArea offsetScrollbars className="sessions-page">
      <Stack gap="md">
        {(sections || []).map((section) => {
          const sectionTokenTotal = section.sessions.reduce((sum, session) => sum + Number(session.totalTokens || 0), 0);
          const sectionEventTotal = section.sessions.reduce((sum, session) => sum + Number(session.count || 0), 0);
          const sectionLatest = section.sessions[0]?.latest || "";

          return (
            <Paper key={section.cwd} radius="xl" p="lg" className="session-section">
              <Group justify="space-between" align="flex-start" mb="md" className="session-section__head">
                <div className="session-section__identity">
                  <Text className="eyebrow">工作目录</Text>
                  <Title order={4} className="session-section__title">{clipText(section.cwd, 82)}</Title>
                  <Text className="session-section__subline">
                    最近更新 {formatDateTime(sectionLatest)} · {formatNumber(sectionEventTotal)} 条事件
                  </Text>
                </div>
                <div className="session-section__metrics">
                  <div>
                    <Text className="session-section__metric-value">{formatNumber(section.total)}</Text>
                    <Text className="session-section__metric-label">会话</Text>
                  </div>
                  <div>
                    <Text className="session-section__metric-value">{formatCompactNumber(sectionTokenTotal)}</Text>
                    <Text className="session-section__metric-label">Tok</Text>
                  </div>
                </div>
              </Group>

              <div className="session-list">
                {section.sessions.map((session) => (
                  <div key={session.sessionId} className="session-card session-row">
                    <div className="session-row__select">
                      <Checkbox
                        checked={selectedSet.has(session.sessionId)}
                        onChange={() => onToggleSelect(session.sessionId)}
                        aria-label={`选择 ${session.title}`}
                      />
                    </div>

                    <button
                      type="button"
                      className="session-row__main"
                      onClick={() => onOpenConversation(session)}
                    >
                      <div className="session-row__title-line">
                        <Badge radius="xl" color={session.sourceType === "codex" ? "blue" : "violet"} variant="light">
                          {platformLabel(session.sourceType)}
                        </Badge>
                        <Text fw={700} className="session-card__title">{session.title}</Text>
                      </div>
                      <div className="session-row__meta-line">
                        <span>{formatDateTime(session.latest)}</span>
                        <span>{formatNumber(session.count)} 条事件</span>
                        {session.groupedCount > 1 ? <span>{formatNumber(session.groupedCount)} 会话</span> : null}
                        <span>{formatCompactNumber(session.totalTokens)} Tok</span>
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
                      <ActionIcon
                        variant="subtle"
                        radius="xl"
                        color="gray"
                        aria-label={`复制会话 ID · ${shortSessionId(session.sessionId)}`}
                        onClick={() => onCopySessionId?.(session.sessionId)}
                      >
                        <IconCopy size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        radius="xl"
                        color="gray"
                        aria-label={`查看对话 · ${shortSessionId(session.sessionId)}`}
                        onClick={() => onOpenConversation(session)}
                      >
                        <IconMessage2 size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        radius="xl"
                        color="gray"
                        aria-label={`重命名 · ${shortSessionId(session.sessionId)}`}
                        onClick={() => onRename(session)}
                      >
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        radius="xl"
                        color="red"
                        aria-label={`删除 · ${shortSessionId(session.sessionId)}`}
                        onClick={() => onDelete(session)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
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
                ))}
              </div>
            </Paper>
          );
        })}
      </Stack>
    </ScrollArea>
  );
}
