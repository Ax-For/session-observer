import {
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconBolt,
  IconChartBar,
  IconClockHour4,
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

function formatHeroNumber(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";

  const compactUnits = [
    { value: 1_0000_0000_0000, suffix: "万亿" },
    { value: 1_0000_0000, suffix: "亿" },
    { value: 1_0000, suffix: "万" },
  ];

  for (const unit of compactUnits) {
    if (Math.abs(amount) < unit.value) continue;
    return `${(amount / unit.value).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}${unit.suffix}`;
  }

  return formatNumber(amount);
}

export function StreamWorkspace({
  scope,
  summary,
  sessions,
  events,
  selectedSessionId,
  onSelectSession,
  onOpenFilters,
  onOpenEvent,
  onLoadMore,
  hasMore,
  loading,
}) {
  const matchingCount = Number(summary?.counts?.totalMatching) || 0;
  const loadedCount = Number(summary?.counts?.totalLoaded) || 0;
  const visibleCount = Number(summary?.counts?.totalVisible) || 0;
  const sessionsCount = Number(summary?.counts?.sessions) || 0;
  const selectedScope = selectedSessionId ? `已聚焦会话 ${shortSessionId(selectedSessionId)}` : "当前为跨会话观测";
  const loadProgress = matchingCount > 0
    ? Math.min(100, Math.round((loadedCount / matchingCount) * 100))
    : 100;
  const scopeFacts = [
    `匹配 ${formatNumber(matchingCount)}`,
    `已加载 ${formatNumber(loadedCount)} / ${formatNumber(matchingCount || loadedCount)}`,
    `会话 ${formatNumber(sessionsCount)}`,
  ];
  const tokenInput = Number(summary?.totals?.input) || 0;
  const tokenOutput = Number(summary?.totals?.output) || 0;
  const tokenCached = Number(summary?.totals?.cachedInput) || 0;
  const tokenReasoning = Number(summary?.totals?.reasoningOutput) || 0;
  const topTypes = (summary.topTypes || []).slice(0, 3);
  const topModels = (summary.topModels || []).slice(0, 3);
  const topPlatforms = (summary.platforms || []).slice(0, 3);
  const typePeak = Math.max(1, ...topTypes.map((item) => Number(item.value) || 0));
  const modelPeak = Math.max(1, ...topModels.map((item) => Number(item.value) || 0));
  const platformPeak = Math.max(1, ...topPlatforms.map((item) => Number(item.events) || 0));
  const tokenHeadline = formatHeroNumber(summary?.totals?.total);
  const coverageLabel = `${formatNumber(sessionsCount)} 会话`;
  const loadLabel = `已加载 ${formatNumber(loadedCount)} / ${formatNumber(matchingCount || loadedCount)}`;
  const signalChips = [
    `输入 ${formatHeroNumber(tokenInput)}`,
    `输出 ${formatHeroNumber(tokenOutput)}`,
    `缓存 ${formatHeroNumber(tokenCached)}`,
    `推理 ${formatHeroNumber(tokenReasoning)}`,
  ];

  return (
    <Stack gap="lg" className="workspace-stack">
      <Paper className="overview-shell" radius="xl" p="lg">
        <Group justify="space-between" align="flex-start" className="overview-shell__top">
          <div className="overview-shell__scope">
            <Group gap="sm" mb={8} wrap="nowrap">
              <ThemeIcon size={40} radius="xl" variant="light" color="blue">
                <IconBolt size={20} />
              </ThemeIcon>
              <div>
                <Text className="eyebrow">当前观测范围</Text>
                <Title order={2} className="scope-title">{scope.title}</Title>
                <Text className="scope-subtitle">{scope.subtitle}</Text>
              </div>
            </Group>
          </div>
          <Button
            leftSection={<IconAdjustmentsHorizontal size={16} />}
            variant="light"
            color="blue"
            radius="xl"
            onClick={onOpenFilters}
          >
            筛选器
          </Button>
        </Group>

        <div className="overview-ribbon">
          <Group gap="xs" className="overview-ribbon__facts">
            {scopeFacts.map((fact) => (
              <Badge key={fact} radius="xl" variant="light" color="blue" className="scope-fact">{fact}</Badge>
            ))}
          </Group>
          {(scope.tags || []).length ? (
            <Group gap="xs" className="overview-ribbon__tags">
              {(scope.tags || []).map((tag) => (
                <Badge key={tag} radius="xl" variant="light" color="gray" className="soft-badge scope-tag">{tag}</Badge>
              ))}
            </Group>
          ) : null}
        </div>

        <div className="overview-board">
          <section className="overview-panel overview-panel--primary">
            <div className="overview-panel__head">
              <Text className="overview-section-label">观测总览</Text>
              <Text className="overview-panel__value">{`匹配 ${formatNumber(matchingCount)}`}</Text>
            </div>

            <div className="overview-primary-grid">
              <div className="overview-stat overview-stat--hero">
                <Text className="overview-stat__label">Token 总量</Text>
                <Text className="overview-stat__value">{tokenHeadline}</Text>
                <Text className="overview-stat__meta">{`总计 ${formatNumber(summary.totals.total)} Tok`}</Text>
              </div>

              <div className="overview-stat">
                <Text className="overview-stat__label">加载进度</Text>
                <Text className="overview-stat__value">{loadLabel}</Text>
                <Progress
                  value={loadProgress}
                  radius="xl"
                  size="xs"
                  className="overview-stat__progress"
                  aria-label="加载进度"
                />
                <Text className="overview-stat__meta">{`总事件 ${formatNumber(visibleCount)} · 已覆盖 ${formatNumber(loadProgress)}%`}</Text>
              </div>

              <div className="overview-stat">
                <Text className="overview-stat__label">范围覆盖</Text>
                <Text className="overview-stat__value">{coverageLabel}</Text>
                <Text className="overview-stat__meta">{selectedScope}</Text>
              </div>
            </div>

            <Group gap="xs" className="overview-chip-row">
              {signalChips.map((chip) => (
                <Badge key={chip} radius="xl" variant="light" color="gray" className="overview-chip">{chip}</Badge>
              ))}
            </Group>
          </section>

          <section className="overview-panel overview-panel--platform">
            <div className="overview-panel__head">
              <Text className="overview-section-label">平台分布</Text>
              <Text className="overview-panel__value">{`${formatNumber(topPlatforms.length)} 平台`}</Text>
            </div>
            <Stack gap="sm">
              {topPlatforms.map((item) => (
                <div key={item.key} className="overview-rank-row overview-rank-row--platform">
                  <div className="overview-rank-row__title">
                    <Text className="overview-rank-row__label">{platformLabel(item.key)}</Text>
                    <Text className="overview-rank-row__meta">{`${formatNumber(item.sessions)} 会话`}</Text>
                  </div>
                  <div className="overview-meter">
                    <span style={{ width: `${Math.max(12, Math.round((Number(item.events) / platformPeak) * 100))}%` }} />
                  </div>
                  <Text className="overview-rank-row__value">{`${formatNumber(item.events)} 事件`}</Text>
                </div>
              ))}
            </Stack>
          </section>

          <section className="overview-panel overview-panel--types">
            <div className="overview-panel__head">
              <Text className="overview-section-label">事件构成</Text>
              <Text className="overview-panel__value">
                {topTypes[0] ? callTypeLabel(topTypes[0].key) : "-"}
              </Text>
            </div>
            <Stack gap="sm">
              {topTypes.map((item) => (
                <div key={item.key} className="overview-rank-row">
                  <Text className="overview-rank-row__label">{callTypeLabel(item.key)}</Text>
                  <div className="overview-meter">
                    <span style={{ width: `${Math.max(12, Math.round((Number(item.value) / typePeak) * 100))}%` }} />
                  </div>
                  <Text className="overview-rank-row__value">{formatNumber(item.value)}</Text>
                </div>
              ))}
            </Stack>
          </section>

          <section className="overview-panel overview-panel--models">
            <div className="overview-panel__head">
              <Text className="overview-section-label">模型焦点</Text>
              <Text className="overview-panel__value">{topModels[0]?.key || "-"}</Text>
            </div>
            <Stack gap="sm">
              {topModels.map((item) => (
                <div key={item.key} className="overview-rank-row">
                  <Text className="overview-rank-row__label">{item.key}</Text>
                  <div className="overview-meter">
                    <span style={{ width: `${Math.max(12, Math.round((Number(item.value) / modelPeak) * 100))}%` }} />
                  </div>
                  <Text className="overview-rank-row__value">{formatNumber(item.value)}</Text>
                </div>
              ))}
            </Stack>
          </section>
        </div>
      </Paper>

      <div className="stream-layout">
        <Paper className="session-rail" radius="xl" p="md">
          <Group justify="space-between" mb="sm">
            <div>
              <Text className="eyebrow">会话侧栏</Text>
              <Title order={4}>最近活跃会话</Title>
            </div>
            <Badge radius="xl" variant="light" color="gray">
              {formatNumber((sessions || []).length)}
            </Badge>
          </Group>
          <ScrollArea offsetScrollbars className="session-rail__scroll">
            <Stack gap="xs">
              {(sessions || []).map((session) => {
                const active = session.sessionId === selectedSessionId;
                return (
                  <button
                    key={session.sessionId}
                    type="button"
                    className={`session-rail__item${active ? " is-active" : ""}`}
                    onClick={() => onSelectSession(session.sessionId)}
                  >
                    <Group justify="space-between" align="flex-start" wrap="nowrap">
                      <div>
                        <Group gap={6} mb={6}>
                          <Badge radius="xl" color={session.sourceType === "codex" ? "blue" : "violet"} variant={active ? "filled" : "light"}>
                            {session.sourceType === "codex" ? "CX" : "CC"}
                          </Badge>
                          <Text fw={600} className="session-rail__title">{session.title || "未命名会话"}</Text>
                        </Group>
                        <Text className="session-rail__meta">
                          {formatCompactNumber(session.totalTokens)} Tok · {formatDateTime(session.latest)}
                        </Text>
                        <Text className="session-rail__path">{clipText(session.cwd, 42)}</Text>
                      </div>
                      <Text className="session-rail__id">{shortSessionId(session.sessionId)}</Text>
                    </Group>
                  </button>
                );
              })}
            </Stack>
          </ScrollArea>
        </Paper>

        <Paper className="feed-panel" radius="xl" p="md">
          <Group justify="space-between" mb="md">
            <div>
              <Text className="eyebrow">事件时间线</Text>
              <Title order={4}>按观测顺序展开</Title>
            </div>
            <Group gap="xs">
              {(summary.topTypes || []).slice(0, 3).map((item) => (
                <Badge key={item.key} radius="xl" variant="light" color="gray" className="soft-badge">
                  {callTypeLabel(item.key)} {item.value}
                </Badge>
              ))}
            </Group>
          </Group>
          <ScrollArea offsetScrollbars className="feed-panel__scroll">
            <Stack gap="sm">
              {(events || []).map((event) => (
                <button
                  key={`${event.time}-${event.sessionId}-${event.callType}-${event.extra || ""}`}
                  type="button"
                  className="event-row"
                  onClick={() => onOpenEvent(event)}
                >
                  <Group justify="space-between" align="flex-start" wrap="nowrap" className="event-row__top">
                    <Group gap="xs">
                      <Badge radius="xl" color={event.sourceType === "codex" ? "blue" : "violet"} variant="light">
                        {event.sourceType === "codex" ? "CX" : "CC"}
                      </Badge>
                      <Badge radius="xl" color="gray" variant="outline">
                        {callTypeLabel(event.callType)}
                      </Badge>
                      <Badge radius="xl" color="gray" variant="light">
                        {event.model || "unknown"}
                      </Badge>
                    </Group>
                    <Group gap="xs" className="event-row__right">
                      <Text className="event-row__timestamp">{formatDateTime(event.time)}</Text>
                      <span className="event-row__arrow" aria-hidden="true">
                        <IconArrowRight size={14} />
                      </span>
                    </Group>
                  </Group>
                  <Text className="event-row__summary">{event.summary || event.content || "-"}</Text>
                  <Group justify="space-between" mt="sm">
                    <Group gap="xs">
                      <ThemeIcon size={22} radius="xl" variant="light" color="gray">
                        <IconClockHour4 size={12} />
                      </ThemeIcon>
                      <Text className="event-row__meta">{shortSessionId(event.sessionId)} · {event.extra || "事件详情"}</Text>
                    </Group>
                    <Text className="event-row__meta">{clipText(event.cwd || "", 36)}</Text>
                  </Group>
                </button>
              ))}
            </Stack>
          </ScrollArea>
          <Group justify="space-between" mt="md">
            <Text className="feed-footer">
              <IconChartBar size={14} stroke={1.8} />
              <span>{loading ? "正在刷新数据…" : `当前显示 ${formatNumber((events || []).length)} 条事件`}</span>
            </Text>
            {hasMore ? (
              <Button variant="light" radius="xl" onClick={onLoadMore}>
                加载更多
              </Button>
            ) : null}
          </Group>
        </Paper>
      </div>
    </Stack>
  );
}
