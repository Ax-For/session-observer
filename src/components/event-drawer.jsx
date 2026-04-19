import { Badge, Button, Drawer, Group, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import {
  callTypeLabel,
  formatFullDateTime,
  platformLabel,
  shortSessionId,
} from "../lib/formatters";
import { JsonCodeBlock } from "./json-code-block";

export function EventDrawer({ event, opened, onClose, onCopy, onCopySessionId }) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="42rem"
      title="事件详情"
      padding="lg"
      classNames={{ body: "drawer-body" }}
    >
      {event ? (
        <Stack gap="md">
          <Group gap="xs">
            <Badge radius="xl" variant="light" color={event.sourceType === "codex" ? "blue" : "violet"}>
              {platformLabel(event.sourceType)}
            </Badge>
            <Badge radius="xl" variant="outline" color="gray">
              {callTypeLabel(event.callType)}
            </Badge>
            <Badge radius="xl" variant="light" color="gray">
              {event.model || "unknown"}
            </Badge>
          </Group>
          <div>
            <Title order={4}>{event.sessionTitle || "未命名会话"}</Title>
            <Text className="drawer-subtitle">
              {formatFullDateTime(event.time)} · {shortSessionId(event.sessionId)} · {event.extra || "事件"}
            </Text>
          </div>
          <Group justify="space-between">
            <Text className="drawer-path">{event.cwd || "无目录信息"}</Text>
            <Group gap="xs">
              <Button
                variant="subtle"
                radius="xl"
                color="gray"
                leftSection={<IconCopy size={16} />}
                onClick={() => onCopySessionId?.(event.sessionId)}
              >
                复制会话 ID
              </Button>
              <Button
                variant="light"
                radius="xl"
                color="blue"
                leftSection={<IconCopy size={16} />}
                onClick={() => onCopy(event)}
              >
                复制 JSON
              </Button>
            </Group>
          </Group>
          <ScrollArea offsetScrollbars className="drawer-json-shell">
            <JsonCodeBlock value={event} className="drawer-json" />
          </ScrollArea>
        </Stack>
      ) : null}
    </Drawer>
  );
}
