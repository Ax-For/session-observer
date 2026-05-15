import {
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  AreaChart,
  BarChart,
  DonutChart as MantineDonutChart,
} from "@mantine/charts";
import {
  IconAlertTriangle,
  IconActivityHeartbeat,
  IconDatabase,
  IconGauge,
  IconRefresh,
  IconTerminal2,
} from "@tabler/icons-react";
import {
  callTypeLabel,
  clipText,
  formatBytes,
  formatDateTime,
  formatHumanNumber,
  formatNumber,
  platformLabel,
  shortSessionId,
} from "../lib/formatters";

function tokenLabel(value) {
  return formatHumanNumber(value);
}

const FALLBACK_CHART_COLORS = ["teal.6", "grape.6", "indigo.6", "pink.6"];

function metricLabel(value, valueKey) {
  return valueKey === "tokens" ? tokenLabel(value) : formatNumber(value);
}

function getPlatformChartColor(key, index = 0) {
  const normalized = String(key || "").toLowerCase();
  if (normalized.includes("codex")) return "blue.6";
  if (normalized.includes("claude")) return "orange.6";
  return FALLBACK_CHART_COLORS[index % FALLBACK_CHART_COLORS.length];
}

function getPlatformMarkerColor(key, index = 0) {
  const normalized = String(key || "").toLowerCase();
  if (normalized.includes("codex")) return "var(--platform-codex)";
  if (normalized.includes("claude")) return "var(--platform-claude)";
  const fallback = ["#10b981", "#8b5cf6", "#4f46e5", "#db2777"];
  return fallback[index % fallback.length];
}

function getPlatformTotal(items, platform) {
  return Number((items || []).find((item) => item.key === platform)?.total) || 0;
}

function getSourceState(source) {
  if (!source) return "未连接";
  if (source.error) return "读取失败";
  if (!source.exists) return "未发现";
  return `${formatNumber(source.files)} 文件`;
}

function StatCard({ label, value, detail, tone = "default" }) {
  return (
    <Paper className={`obs-stat obs-stat--${tone}`} radius="lg" p="md">
      <Text className="obs-stat__label">{label}</Text>
      <Text className="obs-stat__value">{value}</Text>
      <Text className="obs-stat__detail">{detail}</Text>
    </Paper>
  );
}

function RankedRows({ rows, valueKey = "total", renderLabel, renderMeta, maxValue }) {
  const values = (rows || []).map((row) => Number(row[valueKey]) || 0);
  const peak = Math.max(1, Number(maxValue) || 0, ...values);

  return (
    <div className="obs-rank-list">
      {(rows || []).map((row) => {
        const value = Number(row[valueKey]) || 0;
        return (
          <div key={row.key || row.cwd || row.sessionId} className="obs-rank-row">
            <div className="obs-rank-row__copy">
              <Text className="obs-rank-row__label">{renderLabel ? renderLabel(row) : row.key}</Text>
              {renderMeta ? <Text className="obs-rank-row__meta">{renderMeta(row)}</Text> : null}
            </div>
            <div className="obs-rank-row__meter">
              <span style={{ width: `${Math.max(7, Math.round((value / peak) * 100))}%` }} />
            </div>
            <Text className="obs-rank-row__value">{tokenLabel(value)}</Text>
          </div>
        );
      })}
    </div>
  );
}

function ChartCard({ eyebrow, title, action, children }) {
  return (
    <Paper className="obs-panel obs-chart-card" radius="xl" p="lg">
      <Group justify="space-between" align="flex-start" mb="md">
        <div>
          <Text className="eyebrow">{eyebrow}</Text>
          <Title order={4}>{title}</Title>
        </div>
        {action}
      </Group>
      {children}
    </Paper>
  );
}

function chartSummary(data, valueKey) {
  const values = (data || []).map((item) => Number(item[valueKey]) || 0);
  const activeBuckets = values.filter((value) => value > 0).length;
  const total = values.reduce((sum, value) => sum + value, 0);
  const peak = Math.max(0, ...values);

  return {
    activeBuckets,
    total,
    peak,
    firstLabel: data?.[0]?.label || "-",
    lastLabel: data?.[(data?.length || 0) - 1]?.label || "-",
  };
}

function ChartSummary({ data, valueKey, metricKind = valueKey }) {
  const summary = chartSummary(data, valueKey);

  return (
    <div className="obs-chart-kpis">
      <span>{summary.firstLabel}</span>
      <strong>{formatNumber(summary.activeBuckets)} 活跃点</strong>
      <span>峰值 {metricLabel(summary.peak, metricKind)}</span>
      <span>{summary.lastLabel}</span>
    </div>
  );
}

function EmptyChart({ label }) {
  return (
    <div className="obs-chart-empty">
      <Text>暂无{label}数据</Text>
    </div>
  );
}

function MetricAreaChart({ data, valueKey = "tokens", color = "blue.6", label = "Token", testId }) {
  const chartData = (data || []).map((item) => ({
    ...item,
    label: item.label || "-",
    value: Number(item[valueKey]) || 0,
  }));

  if (!chartData.length) {
    return <EmptyChart label={label} />;
  }

  return (
    <>
      <div className="obs-chart-frame obs-chart-frame--area" data-testid={testId} aria-label={`${label}趋势图`}>
        <AreaChart
          h={222}
          data={chartData}
          dataKey="label"
          series={[{ name: "value", label, color }]}
          curveType="natural"
          fillOpacity={0.18}
          gridAxis="xy"
          strokeWidth={2.8}
          textColor="dimmed"
          tickLine="none"
          tooltipAnimationDuration={120}
          valueFormatter={(value) => metricLabel(value, valueKey)}
          withDots={false}
          withGradient
          xAxisProps={{ tickMargin: 10 }}
          yAxisProps={{ width: 72, tickMargin: 8 }}
          areaProps={{ isAnimationActive: true }}
        />
      </div>
      <ChartSummary data={chartData} valueKey="value" metricKind={valueKey} />
    </>
  );
}

function MetricBarChart({ data, valueKey = "alerts", color = "orange.6", label = "异常", testId }) {
  const chartData = (data || []).map((item) => ({
    ...item,
    label: item.label || "-",
    value: Number(item[valueKey]) || 0,
  }));

  if (!chartData.length) {
    return <EmptyChart label={label} />;
  }

  return (
    <>
      <div className="obs-chart-frame obs-chart-frame--bar" data-testid={testId} aria-label={`${label}柱状图`}>
        <BarChart
          h={222}
          data={chartData}
          dataKey="label"
          series={[{ name: "value", label, color }]}
          barProps={{ radius: [8, 8, 3, 3], isAnimationActive: true }}
          cursorFill="gray.1"
          gridAxis="y"
          maxBarWidth={18}
          minBarSize={2}
          textColor="dimmed"
          tickLine="none"
          tooltipAnimationDuration={120}
          valueFormatter={(value) => metricLabel(value, valueKey)}
          xAxisProps={{ tickMargin: 10, interval: "preserveStartEnd" }}
          yAxisProps={{ width: 54, tickMargin: 8 }}
        />
      </div>
      <ChartSummary data={chartData} valueKey="value" metricKind={valueKey} />
    </>
  );
}

function PlatformDonutChart({ rows, title }) {
  const total = (rows || []).reduce((sum, item) => sum + Number(item.total || item.count || 0), 0);
  const chartData = (rows || [])
    .map((row, index) => ({
      name: platformLabel(row.key),
      value: Number(row.total || row.count || 0),
      color: getPlatformChartColor(row.key, index),
      key: row.key,
      markerColor: getPlatformMarkerColor(row.key, index),
    }))
    .filter((row) => row.value > 0);

  if (!chartData.length) {
    return <EmptyChart label={title} />;
  }

  return (
    <div className="obs-donut-wrap" data-testid="platform-donut-chart">
      <div className="obs-donut-chart-shell" aria-label={title}>
        <MantineDonutChart
          data={chartData}
          size={164}
          thickness={24}
          paddingAngle={3}
          strokeWidth={3}
          tooltipDataSource="segment"
          valueFormatter={tokenLabel}
          withTooltip
        />
        <div className="obs-donut__inner">
          <strong>{tokenLabel(total)}</strong>
          <span>总量</span>
        </div>
      </div>
      <div className="obs-donut__legend">
        {chartData.map((row) => (
          <div
            key={row.key}
            className="obs-donut__legend-row"
            title={`${row.name} · ${tokenLabel(row.value)}`}
          >
            <span style={{ background: row.markerColor }} />
            <Text>{row.name}</Text>
            <strong>{tokenLabel(row.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ObservabilityWorkspace({
  payload,
  view,
  loading,
  onRefresh,
  onOpenAlertStream,
}) {
  const summary = payload?.summary || {};
  const health = summary.health || {};
  const tokens = summary.tokens || {};
  const alerts = summary.alerts || {};
  const tools = summary.tools || {};
  const workspaces = summary.workspaces || {};
  const charts = summary.charts || {};
  const hourlyChart = charts.hourly || [];
  const dailyChart = charts.daily || [];
  const tokenWindows = tokens.windows || { day: { total: 0, platforms: [] }, week: { total: 0, platforms: [] } };
  const index = payload?.index;
  const runtime = payload?.runtime;
  const sources = payload?.sources;
  const alertRate = health.eventsTotal ? Math.round((Number(health.alertEvents || 0) / Number(health.eventsTotal)) * 1000) / 10 : 0;

  return (
    <Stack gap="lg" className="workspace-stack obs-workspace">
      <Paper className="obs-hero" radius="xl" p="lg">
        <Group justify="space-between" align="flex-start" gap="lg">
          <Group gap="md" align="flex-start" wrap="nowrap">
            <ThemeIcon size={44} radius="xl" variant="light" color={view === "alerts" ? "orange" : "blue"}>
              {view === "alerts" ? <IconAlertTriangle size={22} /> : <IconActivityHeartbeat size={22} />}
            </ThemeIcon>
            <div>
              <Text className="eyebrow">Observability</Text>
              <Title order={2} className="scope-title">
                {view === "tokens" ? "Token 消耗" : view === "alerts" ? "异常队列" : "运行总览"}
              </Title>
              <Text className="scope-subtitle">
                {view === "tokens"
                  ? "按平台、模型、工作区和会话定位高消耗来源。"
                  : view === "alerts"
                    ? "聚合失败、拒绝、超时和异常输出，方便回到事件上下文。"
                    : "汇总索引健康、数据源状态、成本信号和最近风险。"}
              </Text>
            </div>
          </Group>

          <Group gap="xs" justify="flex-end">
            <Badge radius="xl" variant="light" color={index?.lastError ? "red" : "blue"}>
              {index?.lastError ? "索引异常" : loading ? "刷新中" : "索引正常"}
            </Badge>
            <Button
              variant="light"
              radius="xl"
              leftSection={<IconRefresh size={16} />}
              onClick={onRefresh}
              loading={loading}
            >
              刷新观测
            </Button>
          </Group>
        </Group>
      </Paper>

      {view === "overview" ? (
        <>
          <div className="obs-stat-grid">
            <StatCard label="事件总量" value={formatNumber(health.eventsTotal)} detail={`最近 ${formatDateTime(health.lastEventAt)}`} tone="primary" />
            <StatCard label="会话覆盖" value={formatNumber(health.sessionsTotal)} detail={`${formatNumber(health.platformCount)} 平台 · ${formatNumber(health.modelCount)} 模型`} />
            <StatCard label="异常信号" value={formatNumber(health.alertEvents)} detail={`异常率 ${alertRate}%`} tone={health.alertEvents ? "warn" : "default"} />
            <StatCard label="Token 口径" value={tokenLabel(tokens.effectiveTotal)} detail={`今日 ${tokenLabel(tokenWindows.day?.total || 0)} · 本周 ${tokenLabel(tokenWindows.week?.total || 0)}`} />
          </div>

          <div className="obs-chart-grid obs-chart-grid--overview">
            <ChartCard eyebrow="Trend" title="按天 Token 趋势">
              <MetricAreaChart data={dailyChart} valueKey="tokens" label="Token" testId="daily-token-chart" />
            </ChartCard>
            <ChartCard eyebrow="Share" title="平台 Token 占比">
              <PlatformDonutChart rows={charts.platformShare || tokens.byPlatform || []} title="平台 Token 占比" />
            </ChartCard>
            <ChartCard eyebrow="Heat" title="24h 异常热度">
              <MetricBarChart data={hourlyChart} valueKey="alerts" label="异常" testId="hourly-alert-chart" />
              <Text className="obs-chart-caption">
                Hover 柱状条查看小时级异常密度。
              </Text>
            </ChartCard>
          </div>

          <div className="obs-dashboard-grid">
            <Paper className="obs-panel" radius="xl" p="lg">
              <Group justify="space-between" mb="md">
                <div>
                  <Text className="eyebrow">Sources</Text>
                  <Title order={4}>数据源状态</Title>
                </div>
                <IconDatabase size={20} />
              </Group>
              <div className="obs-source-list">
                {[
                  ["Codex", sources?.codex],
                  ["Claude Code", sources?.claude],
                ].map(([label, source]) => (
                  <div key={label} className="obs-source-row">
                    <div>
                      <Text className="obs-source-row__name">{label}</Text>
                      <Text className="obs-source-row__path">{clipText(source?.path || "本地导入数据", 92)}</Text>
                    </div>
                    <div className="obs-source-row__side">
                      <Badge radius="xl" variant="light" color={source?.exists === false ? "gray" : "blue"}>
                        {getSourceState(source)}
                      </Badge>
                      <Text className="obs-source-row__meta">{source?.updatedAt ? formatDateTime(source.updatedAt) : "-"}</Text>
                    </div>
                  </div>
                ))}
              </div>
            </Paper>

            <Paper className="obs-panel" radius="xl" p="lg">
              <Group justify="space-between" mb="md">
                <div>
                  <Text className="eyebrow">Runtime</Text>
                  <Title order={4}>运行健康</Title>
                </div>
                <IconGauge size={20} />
              </Group>
              <div className="obs-runtime-grid">
                <div>
                  <Text className="obs-runtime__label">索引更新时间</Text>
                  <Text className="obs-runtime__value">{formatDateTime(index?.lastBuiltAt || payload?.generatedAt)}</Text>
                </div>
                <div>
                  <Text className="obs-runtime__label">服务运行</Text>
                  <Text className="obs-runtime__value">{runtime?.uptimeSeconds ? `${formatNumber(runtime.uptimeSeconds)} 秒` : "浏览器导入"}</Text>
                </div>
                <div>
                  <Text className="obs-runtime__label">Node RSS</Text>
                  <Text className="obs-runtime__value">{runtime?.memory?.rss ? formatBytes(runtime.memory.rss) : "-"}</Text>
                </div>
                <div>
                  <Text className="obs-runtime__label">CLI 版本</Text>
                  <Text className="obs-runtime__value">{runtime?.versions ? `Codex ${runtime.versions.codex || "-"} / Claude ${runtime.versions.claude || "-"}` : "-"}</Text>
                </div>
              </div>
            </Paper>
          </div>

          <div className="obs-dashboard-grid obs-dashboard-grid--wide-left">
            <Paper className="obs-panel" radius="xl" p="lg">
              <Group justify="space-between" mb="md">
                <div>
                  <Text className="eyebrow">Workspaces</Text>
                  <Title order={4}>高活跃工作区</Title>
                </div>
              </Group>
              <RankedRows
                rows={(workspaces.topWorkspaces || []).slice(0, 8).map((item) => ({ ...item, key: item.cwd, total: item.tokens || item.events }))}
                renderLabel={(row) => clipText(row.cwd, 72)}
                renderMeta={(row) => `${formatNumber(row.events)} 事件 · ${formatNumber(row.sessions)} 会话 · ${formatNumber(row.alerts)} 异常`}
              />
            </Paper>

            <Paper className="obs-panel" radius="xl" p="lg">
              <Group justify="space-between" mb="md">
                <div>
                  <Text className="eyebrow">Tools</Text>
                  <Title order={4}>工具调用画像</Title>
                </div>
                <IconTerminal2 size={20} />
              </Group>
              <Text className="obs-panel__lead">
                {formatNumber(tools.totalCalls)} 次调用 · {formatNumber(tools.totalResults)} 个结果
              </Text>
              <div className="obs-tool-list">
                {(tools.topTools || []).slice(0, 6).map((tool) => (
                  <div key={tool.key} className="obs-tool-pill">
                    <span>{tool.key}</span>
                    <strong>{formatNumber(tool.calls + tool.results)}</strong>
                    {tool.alerts ? <em>{formatNumber(tool.alerts)} 异常</em> : null}
                  </div>
                ))}
              </div>
            </Paper>
          </div>
        </>
      ) : null}

      {view === "tokens" ? (
        <>
          <div className="obs-chart-grid obs-chart-grid--token">
            <ChartCard
              eyebrow="Trend"
              title="近 14 天 Token 消耗趋势"
              action={<Badge radius="xl" variant="light" color="blue">含缓存读</Badge>}
            >
              <MetricAreaChart data={dailyChart} valueKey="tokens" label="Token" testId="token-trend-chart" />
            </ChartCard>
            <ChartCard eyebrow="Share" title="平台占比">
              <PlatformDonutChart rows={charts.platformShare || tokens.byPlatform || []} title="平台占比" />
            </ChartCard>
          </div>

          <div className="obs-dashboard-grid obs-dashboard-grid--wide-left">
            <Paper className="obs-panel obs-panel--token" radius="xl" p="lg">
            <Group justify="space-between" mb="md">
              <div>
                <Text className="eyebrow">Token Windows</Text>
                <Title order={4}>时间窗口</Title>
              </div>
              <Badge radius="xl" variant="light" color="blue">含缓存读</Badge>
            </Group>
            <div className="obs-token-window-grid">
              {[
                ["今日", tokenWindows.day],
                ["本周", tokenWindows.week],
              ].map(([label, window]) => {
                const codexTotal = getPlatformTotal(window?.platforms, "codex");
                const claudeTotal = getPlatformTotal(window?.platforms, "claude");
                return (
                  <div key={label} className="obs-token-window">
                    <Text className="obs-token-window__label">{label}</Text>
                    <Text className="obs-token-window__value">{tokenLabel(window?.total || 0)}</Text>
                    <Progress
                      value={window?.total ? (codexTotal / window.total) * 100 : 0}
                      size="sm"
                      radius="xl"
                      className="obs-token-window__progress"
                    />
                    <Text className="obs-token-window__meta">Codex {tokenLabel(codexTotal)} · Claude Code {tokenLabel(claudeTotal)}</Text>
                  </div>
                );
              })}
            </div>
            <div className="obs-token-total-row">
              <Badge radius="xl" variant="light" color="gray">输入 {tokenLabel(tokens.input)}</Badge>
              <Badge radius="xl" variant="light" color="gray">输出 {tokenLabel(tokens.output)}</Badge>
              <Badge radius="xl" variant="light" color="gray">缓存 {tokenLabel(tokens.cachedInput)}</Badge>
              <Badge radius="xl" variant="light" color="gray">推理 {tokenLabel(tokens.reasoningOutput)}</Badge>
            </div>
            </Paper>

            <Paper className="obs-panel" radius="xl" p="lg">
            <Text className="eyebrow">Models</Text>
            <Title order={4} mb="md">模型消耗</Title>
            <RankedRows rows={(charts.modelTokens || tokens.byModel || []).slice(0, 8)} renderLabel={(row) => row.key} />
            </Paper>

            <Paper className="obs-panel" radius="xl" p="lg">
            <Text className="eyebrow">Sessions</Text>
            <Title order={4} mb="md">高消耗会话</Title>
            <div className="obs-session-list">
              {(tokens.topSessions || []).slice(0, 8).map((session) => (
                <div key={session.sessionId} className="obs-session-row">
                  <div>
                    <Text className="obs-session-row__title">{session.title}</Text>
                    <Text className="obs-session-row__meta">{platformLabel(session.sourceType)} · {shortSessionId(session.sessionId)} · {formatNumber(session.events)} 事件</Text>
                  </div>
                  <Text className="obs-session-row__value">{tokenLabel(session.tokens)}</Text>
                </div>
              ))}
            </div>
            </Paper>
          </div>
        </>
      ) : null}

      {view === "alerts" ? (
        <>
          <div className="obs-chart-grid obs-chart-grid--alerts">
            <ChartCard eyebrow="Heat" title="24h 异常热度">
              <MetricBarChart data={hourlyChart} valueKey="alerts" label="异常" testId="alert-heat-chart" />
            </ChartCard>
            <ChartCard eyebrow="Distribution" title="异常类型分布">
              <RankedRows
                rows={(charts.alertTypes || alerts.byType || []).map((item) => ({ ...item, total: item.count }))}
                renderLabel={(row) => callTypeLabel(row.key)}
              />
            </ChartCard>
          </div>

          <div className="obs-dashboard-grid obs-dashboard-grid--wide-left">
          <Paper className="obs-panel obs-panel--alerts" radius="xl" p="lg">
            <Group justify="space-between" mb="md">
              <div>
                <Text className="eyebrow">Alert Queue</Text>
                <Title order={4}>最近异常</Title>
              </div>
              <Badge radius="xl" variant="light" color={alerts.total ? "orange" : "gray"}>
                {formatNumber(alerts.total)} 条
              </Badge>
            </Group>
            <div className="obs-alert-list">
              {(alerts.recent || []).map((alert) => (
                <button
                  key={`${alert.time}-${alert.sessionId}-${alert.summary}`}
                  type="button"
                  className="obs-alert-row"
                  onClick={() => onOpenAlertStream?.(alert)}
                >
                  <span className="obs-alert-row__mark" />
                  <span className="obs-alert-row__body">
                    <span className="obs-alert-row__title">{clipText(alert.summary, 150)}</span>
                    <span className="obs-alert-row__meta">
                      {formatDateTime(alert.time)} · {platformLabel(alert.sourceType)} · {callTypeLabel(alert.callType)} · {alert.toolName || shortSessionId(alert.sessionId)}
                    </span>
                  </span>
                  <span className="obs-alert-row__session">{shortSessionId(alert.sessionId)}</span>
                </button>
              ))}
              {!(alerts.recent || []).length ? (
                <Text className="obs-empty">当前筛选范围内没有异常信号。</Text>
              ) : null}
            </div>
          </Paper>

          <Paper className="obs-panel" radius="xl" p="lg">
            <Text className="eyebrow">Distribution</Text>
            <Title order={4} mb="md">异常分布</Title>
            <RankedRows
              rows={(alerts.byType || []).map((item) => ({ ...item, total: item.count }))}
              renderLabel={(row) => callTypeLabel(row.key)}
            />
            <div className="obs-platform-alerts">
              {(alerts.byPlatform || []).map((item) => (
                <Badge key={item.key} radius="xl" variant="light" color="orange">
                  {platformLabel(item.key)} {formatNumber(item.count)}
                </Badge>
              ))}
            </div>
          </Paper>
          </div>
        </>
      ) : null}
    </Stack>
  );
}
