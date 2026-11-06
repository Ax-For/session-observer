import { useEffect, useRef, useState } from "react";
import { apiClient } from "../api/client";
import { Badge, Button, Drawer, Group, ScrollArea, Stack, Text, Title } from "@mantine/core";
import { IconCopy, IconRoute } from "@tabler/icons-react";
import {
  callTypeLabel,
  formatFullDateTime,
  platformLabel,
  shortSessionId,
} from "../lib/formatters";
import { readableEventSummary } from "../lib/event-display";
import { JsonCodeBlock } from "./json-code-block";

export function EventDrawer({ event, opened, onClose, onCopy, onCopySessionId, onOpenSessionDetail }) {
  const [showRawJson, setShowRawJson] = useState(false);
  const [rawEvent, setRawEvent] = useState(null);
  const [loadingRaw, setLoadingRaw] = useState(false);
  const [rawError, setRawError] = useState("");
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function toggleRaw() {
    controller.current?.abort();
    if (showRawJson) { setShowRawJson(false); setRawEvent(null); setRawError(""); return; }
    setShowRawJson(true);
    const request = new AbortController();
    controller.current = request;
    setLoadingRaw(true);
    setRawError("");
    try {
      const payload = event.eventId ? await apiClient.fetchEventDetail(event.eventId, { signal: request.signal }) : { event };
      if (!request.signal.aborted) setRawEvent(payload.event);
    } catch (error) {
      if (error.name !== "AbortError") setRawError(String(error.message || error));
    } finally { if (!request.signal.aborted) setLoadingRaw(false); }
  }

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
              onClick={toggleRaw}
            >
              {showRawJson ? "隐藏 JSON" : "查看记录 JSON"}
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
                color="teal"
                leftSection={<IconRoute size={16} />}
                onClick={() => onOpenSessionDetail?.(event, { order: "desc" })}
              >
                打开会话详情
              </Button>
              <Button
                variant="light"
                radius="xl"
                color="blue"
                leftSection={<IconCopy size={16} />}
                onClick={() => onCopy(rawEvent || event)}
              >
                {rawEvent ? "复制记录 JSON" : "复制摘要 JSON"}
              </Button>
            </Group>
          </Group>
          {showRawJson ? (
            <ScrollArea offsetScrollbars className="drawer-json-shell">
              {loadingRaw ? <Text size="xs">正在读取记录...</Text> : null}
              {rawError ? <Text size="xs" c="red" role="alert">{rawError}</Text> : null}
              {rawEvent?.rawTruncated ? <Text size="xs" c="orange">超大字段已精简，原始日志未修改；问答正文可在会话详情分段读取。</Text> : null}
              {rawEvent ? <JsonCodeBlock value={rawEvent} className="drawer-json" /> : null}
            </ScrollArea>
          ) : null}
        </Stack>
      ) : null}
    </Drawer>
  );
}
