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
        {(sections || []).map((section) => (
          <Paper key={section.cwd} radius="xl" p="lg" className="session-section">
            <Group justify="space-between" mb="md">
              <div>
                <Text className="eyebrow">工作目录</Text>
                <Title order={4}>{clipText(section.cwd, 72)}</Title>
              </div>
              <Badge radius="xl" variant="light" color="gray">
                {formatNumber(section.total)} 个会话
              </Badge>
            </Group>
            <Stack gap="sm">
              {section.sessions.map((session) => (
                <div key={session.sessionId} className="session-card">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Group align="flex-start" wrap="nowrap">
                      <Checkbox
                        mt={3}
                        checked={selectedSet.has(session.sessionId)}
                        onChange={() => onToggleSelect(session.sessionId)}
                        aria-label={`选择 ${session.title}`}
                      />
                      <div>
                        <Group gap="xs" mb={6}>
                          <Badge radius="xl" color={session.sourceType === "codex" ? "blue" : "violet"} variant="light">
                            {platformLabel(session.sourceType)}
                          </Badge>
                          <Text fw={600} className="session-card__title">{session.title}</Text>
                        </Group>
                        <Text className="session-card__meta">
                          {formatDateTime(session.latest)} · {formatNumber(session.count)} 条事件 · {formatCompactNumber(session.totalTokens)} Tok
                        </Text>
                        <Text className="session-card__path">{session.cwd}</Text>
                      </div>
                    </Group>
                    <Group gap={6}>
                      <ActionIcon variant="subtle" radius="xl" color="gray" onClick={() => onOpenConversation(session)}>
                        <IconMessage2 size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" radius="xl" color="gray" onClick={() => onRename(session)}>
                        <IconEdit size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" radius="xl" color="red" onClick={() => onDelete(session)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Group>
                  <Group justify="space-between" mt="md">
                    <Group gap="xs">
                      {(session.models || []).slice(0, 3).map((model) => (
                        <Badge key={model} radius="xl" variant="light" color="gray" className="soft-badge">
                          {model}
                        </Badge>
                      ))}
                    </Group>
                    <Group gap="xs">
                      <Button
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        leftSection={<IconCopy size={14} />}
                        onClick={() => onCopySessionId?.(session.sessionId)}
                      >
                        复制会话 ID · {shortSessionId(session.sessionId)}
                      </Button>
                      <Button
                        variant="subtle"
                        color="gray"
                        radius="xl"
                        onClick={() => onOpenConversation(session)}
                      >
                        查看对话 · {shortSessionId(session.sessionId)}
                      </Button>
                    </Group>
                  </Group>
                </div>
              ))}
            </Stack>
          </Paper>
        ))}
      </Stack>
    </ScrollArea>
  );
}
