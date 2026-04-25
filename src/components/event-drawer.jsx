import { useState } from "react";
import { Badge, Button, Drawer, Group, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { IconCopy } from "@tabler/icons-react";
import {
  callTypeLabel,
  formatFullDateTime,
  platformLabel,
  shortSessionId,
} from "../lib/formatters";
import { readableEventSummary } from "../lib/event-display";
import { JsonCodeBlock } from "./json-code-block";

export function EventDrawer({ event, opened, onClose, onCopy, onCopySessionId }) {
  const [showRawJson, setShowRawJson] = useState(false);

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
          <div className="event-detail-hero">
            <Group gap="xs" className="event-detail-hero__badges">
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
            <Title order={4}>{event.sessionTitle || "未命名会话"}</Title>
            <Text className="event-detail-summary">{readableEventSummary(event, 280)}</Text>
          </div>

          <div className="event-detail-grid">
            <div>
              <Text className="event-detail-label">时间</Text>
              <Text className="event-detail-value">{formatFullDateTime(event.time)}</Text>
            </div>
            <div>
              <Text className="event-detail-label">会话</Text>
              <Text className="event-detail-value">{shortSessionId(event.sessionId)}</Text>
            </div>
            <div>
              <Text className="event-detail-label">事件键</Text>
              <Text className="event-detail-value">{event.extra || "事件详情"}</Text>
            </div>
            <div>
              <Text className="event-detail-label">工作目录</Text>
              <Text className="event-detail-value event-detail-value--path">{event.cwd || "无目录信息"}</Text>
            </div>
          </div>

          <Group justify="space-between" className="event-detail-actions">
            <Button
              variant="subtle"
              radius="xl"
              color="gray"
              onClick={() => setShowRawJson((current) => !current)}
            >
              {showRawJson ? "隐藏原始 JSON" : "查看原始 JSON"}
            </Button>
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
          {showRawJson ? (
            <ScrollArea offsetScrollbars className="drawer-json-shell">
              <JsonCodeBlock value={event} className="drawer-json" />
            </ScrollArea>
          ) : null}
        </Stack>
      ) : null}
    </Drawer>
  );
}
