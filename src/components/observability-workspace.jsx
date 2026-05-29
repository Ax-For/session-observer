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
  IconActivityHeartbeat,
  IconDatabase,
  IconGauge,
  IconRefresh,
  IconTerminal2,
  IconArrowUpRight,
  IconChartBar,
  IconClock,
  IconCpu,
} from "@tabler/icons-react";
import {
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

function finiteToken(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function percentValue(value, total) {
  const denominator = finiteToken(total);
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, (finiteToken(value) / denominator) * 100));
}

function percentLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0%";
  if (number >= 10 || Number.isInteger(number)) return `${Math.round(number)}%`;
  return `${Math.round(number * 10) / 10}%`;
}

function cacheReadToken(value) {
  if (value?.cacheReadInput != null) return finiteToken(value.cacheReadInput);
  return finiteToken(value?.cachedInput);
}

function cacheCreationToken(value) {
  return finiteToken(value?.cacheCreationInput);
}

function inputSideToken(value) {
  if (value?.inputTotal != null) return finiteToken(value.inputTotal);
  return finiteToken(value?.input);
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

function formatAgeText(ageMs) {
  const minutes = Math.max(0, Math.round(Number(ageMs || 0) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟前` : `${hours} 小时前`;
}

function MetricGlyph({ icon: Icon, tone = "default", size = 38, iconSize = 19, className = "" }) {
  return (
    <ThemeIcon
      component="span"
      radius="lg"
      size={size}
      variant="light"
      className={`mc-glyph mc-glyph--${tone}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      <Icon size={iconSize} stroke={1.85} />
    </ThemeIcon>
  );
}

function PanelHeader({ eyebrow, title, icon, tone = "default", action }) {
  return (
    <Group justify="space-between" align="flex-start" mb="md" className="mc-panel-heading">
      <Group gap="sm" align="center" wrap="nowrap">
        {icon ? <MetricGlyph icon={icon} tone={tone} size={36} iconSize={18} /> : null}
        <div>
          <Text className="mc-eyebrow">{eyebrow}</Text>
          <Title order={4}>{title}</Title>
        </div>
      </Group>
      {action}
    </Group>
  );
}

/**
 * Sparkline mini-chart using inline SVG — shows trend direction at a glance.
 */
function Sparkline({ data, width = 64, height = 24, color = "var(--accent)" }) {
  const values = (data || []).map((d) => Number(d) || 0);
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${i * step},${height - (v / max) * (height - 2)}`).join(" ");
  const areaPoints = `0,${height} ${points} ${(values.length - 1) * step},${height}`;
  const isUp = values[values.length - 1] > values[0];

  return (
    <svg width={width} height={height} className="mc-sparkline" aria-hidden="true">
      <defs>
        <linearGradient id={`sg-${color.replace(/[^a-zA-Z0-9]/g, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#sg-${color.replace(/[^a-zA-Z0-9]/g, "")})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={(values.length - 1) * step} cy={height - (values[values.length - 1] / max) * (height - 2)} r="2.5" fill={color} />
    </svg>
  );
}

/**
 * Hero stat card with glow effect and sparkline.
 */
function HeroStat({ label, value, detail, tone = "default", sparkData, icon }) {
  return (
    <div className={`mc-stat mc-stat--${tone}`}>
      <div className="mc-stat__head">
        <Text className="mc-stat__label">{label}</Text>
        {icon ? <MetricGlyph icon={icon} tone={tone} size={34} iconSize={17} /> : null}
      </div>
      <div className="mc-stat__value-line">
        <Text className="mc-stat__value">{value}</Text>
        {sparkData && <Sparkline data={sparkData} />}
      </div>
      <Text className="mc-stat__detail">{detail}</Text>
    </div>
  );
}

function RankedRows({ rows, valueKey = "total", renderLabel, renderMeta, maxValue, valueFormatter = tokenLabel }) {
  const values = (rows || []).map((row) => Number(row[valueKey]) || 0);
  const peak = Math.max(1, Number(maxValue) || 0, ...values);

  return (
    <div className="mc-rank-list">
      {(rows || []).map((row, i) => {
        const value = Number(row[valueKey]) || 0;
        return (
          <div key={row.key || row.cwd || row.sessionId} className="mc-rank-row">
            <span className="mc-rank-row__idx">{i + 1}</span>
            <div className="mc-rank-row__copy">
              <Text className="mc-rank-row__label">{renderLabel ? renderLabel(row) : row.key}</Text>
              {renderMeta ? <Text className="mc-rank-row__meta">{renderMeta(row)}</Text> : null}
            </div>
            <div className="mc-rank-row__meter">
              <span style={{ width: `${Math.max(7, Math.round((value / peak) * 100))}%` }} />
            </div>
            <Text className="mc-rank-row__value">{valueFormatter(value)}</Text>
          </div>
        );
      })}
    </div>
  );
}

function ChartCard({ eyebrow, title, action, icon, tone = "default", className = "", children }) {
  return (
    <Paper className={`mc-chart-card${className ? ` ${className}` : ""}`} radius="xl" p="lg">
      <PanelHeader eyebrow={eyebrow} title={title} icon={icon} tone={tone} action={action} />
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
    <div className="mc-chart-kpis">
      <span>{summary.firstLabel}</span>
      <strong>{formatNumber(summary.activeBuckets)} 活跃点</strong>
      <span>峰值 {metricLabel(summary.peak, metricKind)}</span>
      <span>{summary.lastLabel}</span>
    </div>
  );
}

function EmptyChart({ label }) {
  return (
    <div className="mc-chart-empty">
      <Text>暂无{label}数据</Text>
    </div>
  );
}

function MetricAreaChart({ data, valueKey = "tokens", color = "blue.6", label = "Token", testId, height = 222 }) {
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
      <div className="mc-chart-frame mc-chart-frame--area" data-testid={testId} aria-label={`${label}趋势图`}>
        <AreaChart
          h={height}
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

function MetricBarChart({ data, valueKey = "events", color = "blue.6", label = "事件", testId, height = 222 }) {
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
      <div className="mc-chart-frame mc-chart-frame--bar" data-testid={testId} aria-label={`${label}柱状图`}>
        <BarChart
          h={height}
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
    <div className="mc-donut-wrap" data-testid="platform-donut-chart">
      <div className="mc-donut-chart-shell" aria-label={title}>
        <MantineDonutChart
          data={chartData}
          size={150}
          thickness={22}
          paddingAngle={3}
          strokeWidth={3}
          tooltipDataSource="segment"
          valueFormatter={tokenLabel}
          withTooltip
        />
        <div className="mc-donut__inner">
          <strong>{tokenLabel(total)}</strong>
          <span>总量</span>
        </div>
      </div>
      <div className="mc-donut__legend">
        {chartData.map((row) => (
          <div
            key={row.key}
            className="mc-donut__legend-row"
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

function TokenBreakdownPanel({ tokens }) {
  const input = finiteToken(tokens?.input);
  const cacheReadInput = cacheReadToken(tokens);
  const cacheCreationInput = cacheCreationToken(tokens);
  const output = finiteToken(tokens?.output);
  const reasoningOutput = finiteToken(tokens?.reasoningOutput);
  const rawTotal = finiteToken(tokens?.total) || input + output;
  const effectiveTotal = finiteToken(tokens?.effectiveTotal) || rawTotal;
  const inputSideTotal = inputSideToken(tokens) || input;
  const cacheShare = percentValue(cacheReadInput, inputSideTotal);
  const rows = [
    {
      key: "input",
      label: "输入 Token",
      value: input,
      meta: "Prompt 与上下文输入",
      color: "var(--accent)",
    },
    {
      key: "cached",
      label: "缓存命中 Token",
      value: cacheReadInput,
      meta: `命中率 ${percentLabel(cacheShare)}`,
      color: "#39d98a",
    },
    {
      key: "cacheCreate",
      label: "缓存写入 Token",
      value: cacheCreationInput,
      meta: "cache creation",
      color: "#14b8a6",
    },
    {
      key: "output",
      label: "输出 Token",
      value: output,
      meta: "模型生成输出",
      color: "var(--violet)",
    },
    {
      key: "reasoning",
      label: "推理输出 Token",
      value: reasoningOutput,
      meta: "reasoning output",
      color: "var(--orange)",
    },
  ];

  return (
    <div className="mc-token-breakdown">
      <div className="mc-token-breakdown__summary">
        <div>
          <Text>有效总量</Text>
          <strong>{tokenLabel(effectiveTotal)}</strong>
        </div>
        <div>
          <Text>原始 Total</Text>
          <strong>{tokenLabel(rawTotal)}</strong>
        </div>
        <div>
          <Text>缓存命中率</Text>
          <strong>{percentLabel(cacheShare)}</strong>
        </div>
      </div>
      <div className="mc-token-breakdown__bar" aria-hidden="true">
        {rows.map((row) => {
          const width = percentValue(row.value, effectiveTotal);
          return row.value > 0 ? (
            <span
              key={row.key}
              style={{
                width: `${Math.max(2, width)}%`,
                background: row.color,
              }}
            />
          ) : null;
        })}
      </div>
      <div className="mc-token-breakdown__rows">
        {rows.map((row) => (
          <div key={row.key} className="mc-token-breakdown-row">
            <span className="mc-token-breakdown-row__dot" style={{ background: row.color }} />
            <div>
              <Text className="mc-token-breakdown-row__label">{row.label}</Text>
              <Text className="mc-token-breakdown-row__meta">{row.meta}</Text>
            </div>
            <strong>{tokenLabel(row.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Pulse badge — animated indicator for live/active state.
 */
function PulseBadge({ color = "blue", label }) {
  return (
    <Badge radius="xl" variant="light" color={color} className="mc-pulse-badge">
      <span className="mc-pulse-dot" />
      {label}
    </Badge>
  );
}

function ActiveSessionSnapshot({ overview, tokenSessions, onOpenConversation }) {
  const sessions = overview?.sessions || [];
  const total = Number(overview?.total || 0);
  const hiddenCount = Math.max(0, total - sessions.length);
  const platforms = overview?.platforms || [];
  const costSessions = (tokenSessions || []).slice(0, 3);

  return (
    <>
      <div className="mc-active-summary">
        <div>
          <Text className="mc-active-summary__label">窗口</Text>
          <Text className="mc-active-summary__value">最近 {formatNumber(overview?.windowMinutes || 30)} 分钟</Text>
        </div>
        <div>
          <Text className="mc-active-summary__label">最新写入</Text>
          <Text className="mc-active-summary__value">{overview?.latestAt ? formatDateTime(overview.latestAt) : "-"}</Text>
        </div>
      </div>

      {platforms.length ? (
        <div className="mc-active-platforms">
          {platforms.map((item) => (
            <Badge key={item.key} radius="xl" variant="light" color={item.key === "codex" ? "blue" : "orange"}>
              {platformLabel(item.key)} {formatNumber(item.sessions)}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="mc-active-list">
        {sessions.slice(0, 4).map((session) => {
          const clickable = typeof onOpenConversation === "function";
          const content = (
            <>
              <span className="mc-active-row__pulse" aria-hidden="true" />
              <span className="mc-active-row__main">
                <strong>{clipText(session.title || shortSessionId(session.sessionId), 58)}</strong>
                <span>{clipText(session.cwd || "unknown", 68)}</span>
              </span>
              <span className="mc-active-row__side">
                <Badge radius="xl" size="xs" variant="light" color={session.sourceType === "codex" ? "blue" : "orange"}>
                  {platformLabel(session.sourceType)}
                </Badge>
                <em>{formatAgeText(session.ageMs)}</em>
              </span>
            </>
          );

          return clickable ? (
            <button
              key={session.sessionId}
              type="button"
              className="mc-active-row"
              aria-label={`打开活跃会话 ${session.title || session.sessionId}`}
              onClick={() => onOpenConversation(session)}
            >
              {content}
            </button>
          ) : (
            <div key={session.sessionId} className="mc-active-row">
              {content}
            </div>
          );
        })}
      </div>

      {!sessions.length ? (
        <Text className="mc-empty">当前筛选范围内没有持续写入的会话。</Text>
      ) : null}

      {hiddenCount ? (
        <Text className="mc-active-more">还有 {formatNumber(hiddenCount)} 个活跃会话</Text>
      ) : null}

      {costSessions.length ? (
        <div className="mc-active-cost">
          <div className="mc-active-cost__head">
            <Text>高消耗会话</Text>
            <span>Top {formatNumber(costSessions.length)}</span>
          </div>
          <div className="mc-active-cost__list">
            {costSessions.map((session) => {
              const clickable = typeof onOpenConversation === "function";
              const content = (
                <>
                  <span>
                    <strong>{clipText(session.title || shortSessionId(session.sessionId), 48)}</strong>
                    <em>{platformLabel(session.sourceType)} · {formatNumber(session.events || 0)} 事件</em>
                  </span>
                  <b>{tokenLabel(session.tokens || 0)}</b>
                </>
              );

              return clickable ? (
                <button
                  key={session.sessionId}
                  type="button"
                  className="mc-active-cost-row"
                  aria-label={`打开高消耗会话 ${session.title || session.sessionId}`}
                  onClick={() => onOpenConversation(session)}
                >
                  {content}
                </button>
              ) : (
                <div key={session.sessionId} className="mc-active-cost-row">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ObservabilityWorkspace({
  payload,
  view,
  activeOverview,
  loading,
  onRefresh,
  onOpenConversation,
}) {
  const summary = payload?.summary || {};
  const health = summary.health || {};
  const tokens = summary.tokens || {};
  const tools = summary.tools || {};
  const workspaces = summary.workspaces || {};
  const charts = summary.charts || {};
  const hourlyChart = charts.hourly || [];
  const dailyChart = charts.daily || [];
  const tokenWindows = tokens.windows || { day: { total: 0, platforms: [] }, week: { total: 0, platforms: [] } };
  const index = payload?.index;
  const runtime = payload?.runtime;
  const sources = payload?.sources;
  const activeTotal = Number(activeOverview?.total || 0);
  const activeWindowMinutes = activeOverview?.windowMinutes || 30;
  const newestActiveAge = activeOverview?.sessions?.[0]?.ageMs;
  const tokenInput = finiteToken(tokens.input);
  const tokenCacheReadInput = cacheReadToken(tokens);
  const tokenCacheCreationInput = cacheCreationToken(tokens);
  const tokenOutput = finiteToken(tokens.output);
  const tokenReasoningOutput = finiteToken(tokens.reasoningOutput);
  const tokenEffectiveTotal = finiteToken(tokens.effectiveTotal) || finiteToken(tokens.total);
  const tokenInputSideTotal = inputSideToken(tokens) || tokenInput;
  const tokenCacheShare = percentValue(tokenCacheReadInput, tokenInputSideTotal);
  const hourlyEventsTotal = hourlyChart.reduce((sum, item) => sum + (Number(item.events) || 0), 0);
  const activeHourCount = hourlyChart.filter((item) => Number(item.events) > 0).length;
  const toolResultRate = tools.totalCalls
    ? Math.round((Number(tools.totalResults || 0) / Number(tools.totalCalls || 1)) * 100)
    : 0;
  const topWorkspace = workspaces.topWorkspaces?.[0];

  // Build sparkline data from charts
  const dailyTokenSpark = dailyChart.map((d) => Number(d.tokens) || 0);
  const eventsByPlatform = charts.platformShare || tokens.byPlatform || [];

  return (
    <Stack gap="md" className="workspace-stack mc-workspace">
      {/* Header */}
      <Paper className="mc-hero" radius="xl" p="lg">
        <Group justify="space-between" align="flex-start" gap="lg">
          <Group gap="md" align="flex-start" wrap="nowrap">
            <MetricGlyph
              icon={view === "tokens" ? IconCpu : view === "insights" ? IconGauge : IconActivityHeartbeat}
              tone={view === "tokens" ? "accent" : view === "insights" ? "success" : "primary"}
              size={46}
              iconSize={22}
              className="mc-glyph--hero"
            />
            <div>
              <Text className="mc-eyebrow">Mission Control</Text>
              <Title order={2} className="mc-scope-title">
                {view === "tokens" ? "Token 消耗" : view === "insights" ? "活动洞察" : "运行总览"}
              </Title>
              <Text className="mc-scope-subtitle">
                {view === "tokens"
                  ? "按平台、模型、工作区和会话定位高消耗来源。"
                  : view === "insights"
                    ? "按时段、工具、工作区和活跃会话定位主要工作负载。"
                    : "汇总索引健康、数据源状态、成本信号和当前活跃会话。"}
              </Text>
            </div>
          </Group>

          <Group gap="xs" justify="flex-end">
            <PulseBadge color={index?.lastError ? "red" : "blue"} label={index?.lastError ? "索引异常" : loading ? "刷新中" : "索引正常"} />
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
          {/* Hero stats — asymmetric grid */}
          <div className="mc-stat-grid mc-stat-grid--overview">
            <HeroStat
              label="事件总量"
              value={formatNumber(health.eventsTotal)}
              detail={`最近 ${formatDateTime(health.lastEventAt)}`}
              tone="primary"
              sparkData={dailyTokenSpark.slice(-7)}
              icon={IconArrowUpRight}
            />
            <HeroStat
              label="会话覆盖"
              value={formatNumber(health.sessionsTotal)}
              detail={`${formatNumber(health.platformCount)} 平台 · ${formatNumber(health.modelCount)} 模型`}
              icon={IconChartBar}
            />
            <HeroStat
              label="活跃会话"
              value={formatNumber(activeTotal)}
              detail={activeTotal ? `最近写入 ${formatAgeText(newestActiveAge)} · 窗口 ${formatNumber(activeWindowMinutes)} 分钟` : `最近 ${formatNumber(activeWindowMinutes)} 分钟暂无写入`}
              tone={activeTotal ? "success" : "default"}
              icon={IconActivityHeartbeat}
            />
            <HeroStat
              label="Token 口径"
              value={tokenLabel(tokens.effectiveTotal)}
              detail={`今日 ${tokenLabel(tokenWindows.day?.total || 0)} · 本周 ${tokenLabel(tokenWindows.week?.total || 0)}`}
              tone="accent"
              icon={IconCpu}
            />
          </div>

          <div className="mc-overview-layout">
            <div className="mc-overview-main">
              <ChartCard
                eyebrow="Trend"
                title="按天 Token 趋势"
                icon={IconChartBar}
                tone="primary"
                className="mc-overview-card mc-overview-card--trend"
              >
                <MetricAreaChart data={dailyChart} valueKey="tokens" label="Token" testId="daily-token-chart" />
              </ChartCard>

              <Paper className="mc-panel mc-overview-card mc-overview-card--sources" radius="xl" p="lg">
                <PanelHeader eyebrow="Sources" title="数据源状态" icon={IconDatabase} tone="primary" />
                <div className="mc-source-list">
                  {[
                    ["Codex", sources?.codex],
                    ["Claude Code", sources?.claude],
                  ].map(([label, source]) => (
                    <div key={label} className="mc-source-row">
                      <div>
                        <Text className="mc-source-row__name">{label}</Text>
                        <Text className="mc-source-row__path">{clipText(source?.path || "本地导入数据", 92)}</Text>
                      </div>
                      <div className="mc-source-row__side">
                        <Badge radius="xl" variant="light" color={source?.exists === false ? "gray" : "blue"}>
                          {getSourceState(source)}
                        </Badge>
                        <Text className="mc-source-row__meta">{source?.updatedAt ? formatDateTime(source.updatedAt) : "-"}</Text>
                      </div>
                    </div>
                  ))}
                </div>
              </Paper>

              <Paper className="mc-panel mc-overview-card mc-overview-card--runtime" radius="xl" p="lg">
                <PanelHeader eyebrow="Runtime" title="运行健康" icon={IconGauge} tone="success" />
                <div className="mc-runtime-grid">
                  <div>
                    <Text className="mc-runtime__label">索引更新</Text>
                    <Text className="mc-runtime__value">{formatDateTime(index?.lastBuiltAt || payload?.generatedAt)}</Text>
                  </div>
                  <div>
                    <Text className="mc-runtime__label">服务运行</Text>
                    <Text className="mc-runtime__value">{runtime?.uptimeSeconds ? `${formatNumber(runtime.uptimeSeconds)} 秒` : "浏览器导入"}</Text>
                  </div>
                  <div>
                    <Text className="mc-runtime__label">Node RSS</Text>
                    <Text className="mc-runtime__value">{runtime?.memory?.rss ? formatBytes(runtime.memory.rss) : "-"}</Text>
                  </div>
                  <div>
                    <Text className="mc-runtime__label">CLI 版本</Text>
                    <Text className="mc-runtime__value">{runtime?.versions ? `Codex ${runtime.versions.codex || "-"} / Claude ${runtime.versions.claude || "-"}` : "-"}</Text>
                  </div>
                </div>
              </Paper>

              <Paper className="mc-panel mc-overview-card mc-overview-card--workspaces" radius="xl" p="lg">
                <PanelHeader eyebrow="Workspaces" title="高活跃工作区" icon={IconDatabase} tone="default" />
                <RankedRows
                  rows={(workspaces.topWorkspaces || []).slice(0, 8).map((item) => ({ ...item, key: item.cwd, total: item.tokens || item.events }))}
                  renderLabel={(row) => clipText(row.cwd, 72)}
                  renderMeta={(row) => `${formatNumber(row.events)} 事件 · ${formatNumber(row.sessions)} 会话 · ${tokenLabel(row.tokens || 0)}`}
                />
              </Paper>
            </div>

            <div className="mc-overview-side">
              <ChartCard
                eyebrow="Share"
                title="平台 Token 占比"
                icon={IconCpu}
                tone="accent"
                className="mc-overview-card mc-overview-card--share"
              >
                <PlatformDonutChart rows={eventsByPlatform} title="平台 Token 占比" />
              </ChartCard>

              <Paper className="mc-panel mc-overview-card mc-overview-card--activity" radius="xl" p="lg">
                <PanelHeader
                  eyebrow="Activity"
                  title="最近活跃会话"
                  icon={IconActivityHeartbeat}
                  tone={activeTotal ? "success" : "default"}
                  action={(
                    <Badge radius="xl" variant="light" color={activeTotal ? "teal" : "gray"}>
                      {formatNumber(activeTotal)} 活跃
                    </Badge>
                  )}
                />
                <ActiveSessionSnapshot
                  overview={activeOverview}
                  tokenSessions={tokens.topSessions}
                  onOpenConversation={onOpenConversation}
                />
              </Paper>

              <Paper className="mc-panel mc-overview-card mc-overview-card--tools" radius="xl" p="lg">
                <PanelHeader eyebrow="Tools" title="工具调用画像" icon={IconTerminal2} tone="accent" />
                <Text className="mc-panel__lead">
                  {formatNumber(tools.totalCalls)} 次调用 · {formatNumber(tools.totalResults)} 个结果
                </Text>
                <div className="mc-tool-list">
                  {(tools.topTools || []).slice(0, 6).map((tool) => (
                    <div key={tool.key} className="mc-tool-pill">
                      <span>{tool.key}</span>
                      <strong>{formatNumber(tool.calls + tool.results)}</strong>
                      <em>{formatNumber(tool.calls)} 调用 / {formatNumber(tool.results)} 结果</em>
                    </div>
                  ))}
                </div>
              </Paper>
            </div>
          </div>
        </>
      ) : null}

      {view === "tokens" ? (
        <>
          <div className="mc-stat-grid mc-stat-grid--tokens">
            <HeroStat
              label="有效总量"
              value={tokenLabel(tokenEffectiveTotal)}
              detail={`原始 total ${tokenLabel(tokens.total || tokenInput + tokenOutput)}`}
              tone="primary"
              sparkData={dailyTokenSpark.slice(-7)}
              icon={IconCpu}
            />
            <HeroStat
              label="输入 Token"
              value={tokenLabel(tokenInput)}
              detail="Prompt 与上下文输入"
              icon={IconArrowUpRight}
            />
            <HeroStat
              label="缓存命中"
              value={tokenLabel(tokenCacheReadInput)}
              detail={`命中率 ${percentLabel(tokenCacheShare)}${tokenCacheCreationInput ? ` · 写入 ${tokenLabel(tokenCacheCreationInput)}` : ""}`}
              tone={tokenCacheReadInput ? "success" : "default"}
              icon={IconDatabase}
            />
            <HeroStat
              label="输出 Token"
              value={tokenLabel(tokenOutput)}
              detail="模型生成输出"
              tone="accent"
              icon={IconChartBar}
            />
            <HeroStat
              label="推理输出"
              value={tokenLabel(tokenReasoningOutput)}
              detail="reasoning output"
              tone={tokenReasoningOutput ? "warn" : "default"}
              icon={IconGauge}
            />
          </div>

          <div className="mc-token-layout">
            <div className="mc-token-main">
              <ChartCard
                eyebrow="Trend"
                title="近 14 天 Token 消耗趋势"
                icon={IconChartBar}
                tone="primary"
                className="mc-token-card mc-token-card--trend"
                action={<Badge radius="xl" variant="light" color="blue">含缓存读</Badge>}
              >
                <MetricAreaChart data={dailyChart} valueKey="tokens" label="Token" testId="token-trend-chart" />
              </ChartCard>

              <Paper className="mc-panel mc-panel--token mc-token-card mc-token-card--windows" radius="xl" p="lg">
                <PanelHeader
                  eyebrow="Token Windows"
                  title="时间窗口"
                  icon={IconClock}
                  tone="primary"
                  action={<Badge radius="xl" variant="light" color="blue">含缓存读</Badge>}
                />
                <div className="mc-token-window-grid">
                  {[
                    ["今日", tokenWindows.day],
                    ["本周", tokenWindows.week],
                  ].map(([label, window]) => {
                    const codexTotal = getPlatformTotal(window?.platforms, "codex");
                    const claudeTotal = getPlatformTotal(window?.platforms, "claude");
                    const hasWindowBreakdown = ["input", "cachedInput", "output", "reasoningOutput", "rawTotal"].some((key) => (
                      Object.prototype.hasOwnProperty.call(window || {}, key)
                    ));
                    return (
                      <div key={label} className="mc-token-window">
                        <Text className="mc-token-window__label">{label}</Text>
                        <Text className="mc-token-window__value">{tokenLabel(window?.total || 0)}</Text>
                        <Progress
                          value={window?.total ? (codexTotal / window.total) * 100 : 0}
                          size="sm"
                          radius="xl"
                          className="mc-token-window__progress"
                        />
                        <Text className="mc-token-window__meta">Codex {tokenLabel(codexTotal)} · Claude Code {tokenLabel(claudeTotal)}</Text>
                        {hasWindowBreakdown ? (
                          <div className="mc-token-window__detail">
                            <span>输入 {tokenLabel(window?.input || 0)}</span>
                            <span>命中 {tokenLabel(cacheReadToken(window))}</span>
                            {cacheCreationToken(window) ? <span>写入 {tokenLabel(cacheCreationToken(window))}</span> : null}
                            <span>输出 {tokenLabel(window?.output || 0)}</span>
                            <span>推理 {tokenLabel(window?.reasoningOutput || 0)}</span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Paper>

              <ChartCard eyebrow="Share" title="平台占比" icon={IconCpu} tone="accent" className="mc-token-card mc-token-card--share">
                <PlatformDonutChart rows={eventsByPlatform} title="平台占比" />
              </ChartCard>

              <Paper className="mc-panel mc-token-card mc-token-card--sessions" radius="xl" p="lg">
                <PanelHeader eyebrow="Sessions" title="高消耗会话" icon={IconActivityHeartbeat} tone="success" />
                <div className="mc-session-list">
                  {(tokens.topSessions || []).slice(0, 8).map((session) => (
                    <div key={session.sessionId} className="mc-session-row">
                      <div>
                        <Text className="mc-session-row__title">{session.title}</Text>
                        <Text className="mc-session-row__meta">{platformLabel(session.sourceType)} · {shortSessionId(session.sessionId)} · {formatNumber(session.events)} 事件</Text>
                      </div>
                      <Text className="mc-session-row__value">{tokenLabel(session.tokens)}</Text>
                    </div>
                  ))}
                </div>
              </Paper>
            </div>

            <div className="mc-token-side">
              <Paper className="mc-panel mc-token-card mc-token-card--detail" radius="xl" p="lg">
                <PanelHeader eyebrow="Breakdown" title="Token 明细" icon={IconCpu} tone="accent" />
                <TokenBreakdownPanel tokens={tokens} />
              </Paper>

              <Paper className="mc-panel mc-token-card mc-token-card--models" radius="xl" p="lg">
                <PanelHeader eyebrow="Models" title="模型消耗" icon={IconCpu} tone="accent" />
                <RankedRows rows={(charts.modelTokens || tokens.byModel || []).slice(0, 8)} renderLabel={(row) => row.key} />
              </Paper>
            </div>
          </div>
        </>
      ) : null}

      {view === "insights" ? (
        <>
          <div className="mc-stat-grid mc-stat-grid--insights">
            <HeroStat
              label="24h 事件"
              value={formatNumber(hourlyEventsTotal)}
              detail={`${formatNumber(activeHourCount)} 个小时有活动`}
              tone="primary"
              icon={IconActivityHeartbeat}
            />
            <HeroStat
              label="工具吞吐"
              value={formatNumber((tools.totalCalls || 0) + (tools.totalResults || 0))}
              detail={`${formatNumber(tools.totalCalls)} 调用 · ${formatNumber(tools.totalResults)} 结果`}
              icon={IconTerminal2}
            />
            <HeroStat
              label="结果回收率"
              value={`${formatNumber(toolResultRate)}%`}
              detail="按工具调用与结果事件粗略估算"
              tone={toolResultRate >= 90 ? "success" : "default"}
              icon={IconGauge}
            />
            <HeroStat
              label="最活跃工作区"
              value={formatNumber(topWorkspace?.events || 0)}
              detail={clipText(topWorkspace?.cwd || "暂无工作区数据", 44)}
              tone="accent"
              icon={IconDatabase}
            />
          </div>

          <div className="mc-insight-layout">
            <div className="mc-insight-main">
              <ChartCard
                eyebrow="Activity"
                title="24h 活动热度"
                icon={IconActivityHeartbeat}
                tone="primary"
                className="mc-insight-card mc-insight-card--heat"
              >
                <MetricBarChart data={hourlyChart} valueKey="events" label="事件" testId="activity-heat-chart" height={292} />
              </ChartCard>

              <Paper className="mc-panel mc-insight-card mc-insight-card--workspaces" radius="xl" p="lg">
                <PanelHeader eyebrow="Workspaces" title="工作区活动排行" icon={IconDatabase} tone="default" />
                <RankedRows
                  rows={(workspaces.topWorkspaces || []).slice(0, 8).map((item) => ({ ...item, key: item.cwd, total: item.events }))}
                  renderLabel={(row) => clipText(row.cwd, 72)}
                  renderMeta={(row) => `${formatNumber(row.sessions)} 会话 · ${tokenLabel(row.tokens || 0)}`}
                  valueFormatter={formatNumber}
                />
              </Paper>

              <Paper className="mc-panel mc-insight-card mc-insight-card--activity" radius="xl" p="lg">
                <PanelHeader
                  eyebrow="Live"
                  title="活跃与高消耗会话"
                  icon={IconActivityHeartbeat}
                  tone={activeTotal ? "success" : "default"}
                  action={(
                    <Badge radius="xl" variant="light" color={activeTotal ? "teal" : "gray"}>
                      {formatNumber(activeTotal)} 活跃
                    </Badge>
                  )}
                />
                <ActiveSessionSnapshot
                  overview={activeOverview}
                  tokenSessions={tokens.topSessions}
                  onOpenConversation={onOpenConversation}
                />
              </Paper>
            </div>

            <div className="mc-insight-side">
              <Paper className="mc-panel mc-insight-card mc-insight-card--tools" radius="xl" p="lg">
                <PanelHeader eyebrow="Throughput" title="工具吞吐排行" icon={IconTerminal2} tone="accent" />
                <RankedRows
                  rows={(tools.topTools || []).slice(0, 6).map((tool) => ({
                    ...tool,
                    total: Number(tool.calls || 0) + Number(tool.results || 0),
                  }))}
                  renderLabel={(row) => row.key}
                  renderMeta={(row) => `${formatNumber(row.calls)} 调用 · ${formatNumber(row.results)} 结果`}
                  valueFormatter={formatNumber}
                />
              </Paper>

              <Paper className="mc-panel mc-insight-card mc-insight-card--models" radius="xl" p="lg">
                <PanelHeader eyebrow="Models" title="模型消耗排行" icon={IconCpu} tone="accent" />
                <RankedRows rows={(charts.modelTokens || tokens.byModel || []).slice(0, 8)} renderLabel={(row) => row.key} />
              </Paper>
            </div>
          </div>
        </>
      ) : null}
    </Stack>
  );
}
