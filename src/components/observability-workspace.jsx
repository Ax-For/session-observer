import { useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconActivityHeartbeat,
  IconAlertTriangle,
  IconDatabase,
  IconGauge,
  IconRefresh,
  IconTerminal2,
  IconChartBar,
  IconClock,
  IconCpu,
  IconRoute,
} from "@tabler/icons-react";
import {
  Area,
  AreaChart as RechartsAreaChart,
  Bar,
  CartesianGrid,
  ComposedChart as RechartsComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
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

function workspacePathParts(value) {
  const path = String(value || "").replace(/\/$/, "");
  const parts = path.split("/").filter(Boolean);
  return {
    name: parts.at(-1) || path || "未知工作区",
    parent: parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : "/",
  };
}

function usdLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "$0";
  if (number < 1) return `$${number.toFixed(4)}`;
  return `$${number.toFixed(2)}`;
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

function decimalLabel(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function durationLabel(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 1) return "< 1 分钟";
  if (minutes < 60) return `${formatNumber(minutes)} 分钟`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} 小时 ${restMinutes} 分钟` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} 天 ${restHours} 小时` : `${days} 天`;
}

function shortDateLabel(value, includeTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const datePart = `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  if (!includeTime) return datePart;
  return `${datePart} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function compactChangeLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "暂无基期";
  const rounded = Math.round(Number(value));
  if (!rounded) return "持平";
  return `${rounded > 0 ? "+" : ""}${formatNumber(rounded)}%`;
}

function changeLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return "暂无基期";
  const rounded = Math.round(Number(value));
  if (!rounded) return "与前 7 天持平";
  return `${rounded > 0 ? "+" : ""}${formatNumber(rounded)}% 较前 7 天`;
}

function changeTone(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) === 0) return "neutral";
  return Number(value) > 0 ? "up" : "down";
}

function perMillionUsdLabel(cost, tokens) {
  const total = finiteToken(tokens);
  if (!total) return "$0";
  return `${usdLabel((Number(cost) || 0) / (total / 1_000_000))}/M`;
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

function sumBy(rows, selector) {
  return (rows || []).reduce((sum, row) => sum + finiteToken(selector(row)), 0);
}

function topBy(rows, selector) {
  return (rows || []).slice().sort((left, right) => finiteToken(selector(right)) - finiteToken(selector(left)))[0];
}

function ratioLabel(value, denominator) {
  const base = finiteToken(denominator);
  if (!base) return "0x";
  const ratio = finiteToken(value) / base;
  if (ratio >= 10) return `${Math.round(ratio)}x`;
  return `${decimalLabel(ratio, 1)}x`;
}

function metricLabel(value, valueKey) {
  if (valueKey === "estimatedUsd" || valueKey === "cost" || valueKey === "usd" || valueKey === "金额") {
    return usdLabel(value);
  }
  return valueKey === "tokens" ? tokenLabel(value) : formatNumber(value);
}

function orderedToolRows(topTools = [], limit = 6) {
  const normalized = (topTools || []).map((tool) => ({
    ...tool,
    calls: Number(tool.calls || 0),
    results: Number(tool.results || 0),
  }));
  const meaningful = normalized
    .filter((tool) => tool.calls > 0 && !String(tool.key || "").toLowerCase().includes("result"))
    .sort((a, b) => b.calls - a.calls || b.results - a.results);
  const supplemental = normalized
    .filter((tool) => !meaningful.some((item) => item.key === tool.key))
    .sort((a, b) => (b.calls + b.results) - (a.calls + a.results));
  return [...meaningful, ...supplemental].slice(0, limit);
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

function timestampAgeMs(value, anchor) {
  const timestamp = Date.parse(value || "");
  const anchorTimestamp = Date.parse(anchor || "") || Date.now();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, anchorTimestamp - timestamp);
}

function sourceIsHealthy(source) {
  return Boolean(source && source.exists !== false && !source.error);
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
          <Title order={3}>{title}</Title>
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

function chartValueFormatter(metricKind, fallbackLabel) {
  return (value) => metricLabel(value, metricKind || fallbackLabel);
}

function ChartMountGate({ height, fillHeight = false, children }) {
  const rootRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;

    const markReady = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 1) setReady(true);
    };

    const frame = requestAnimationFrame(markReady);
    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(markReady);
    observer.observe(node);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={rootRef} className={`mc-chart-gate${fillHeight ? " is-fill" : ""}`}>
      {ready ? children : <div className="mc-chart-placeholder" style={{ height: fillHeight ? "100%" : height }} />}
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

function MetricChartTooltip({ active, payload, label, valueFormatter, seriesLabel }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="mc-chart-tooltip mc-chart-tooltip--direct">
      <strong>{label || "-"}</strong>
      <span>{seriesLabel} {valueFormatter(payload[0]?.value || 0)}</span>
    </div>
  );
}

function chartStroke(color) {
  return String(color || "").startsWith("teal") ? "var(--success)" : "var(--accent)";
}

function MetricAreaChart({ data, valueKey = "tokens", color = "blue.6", label = "Token", testId, height = 222 }) {
  const chartData = (data || []).map((item) => ({
    ...item,
    label: item.label || "-",
    value: Number(item[valueKey]) || 0,
  }));
  const valueFormatter = chartValueFormatter(valueKey, label);
  const stroke = chartStroke(color);

  if (!chartData.length) {
    return <EmptyChart label={label} />;
  }

  return (
    <>
      <div className="mc-chart-frame mc-chart-frame--area mc-chart-frame--mantine" data-testid={testId} aria-label={`${label}趋势图`}>
        <ChartMountGate height={height}>
          <ResponsiveContainer
            width="100%"
            height={height}
            initialDimension={{ width: 800, height }}
            className="mc-chart-container"
          >
            <RechartsAreaChart data={chartData} margin={{ top: 12, right: 10, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="4 6" vertical />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                tickMargin={10}
              />
              <YAxis
                width={72}
                domain={[0, "auto"]}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                tickFormatter={valueFormatter}
                tickMargin={8}
              />
              <RechartsTooltip
                cursor={{ stroke: "var(--line-strong)", strokeDasharray: "4 5" }}
                content={(props) => (
                  <MetricChartTooltip {...props} valueFormatter={valueFormatter} seriesLabel={label} />
                )}
              />
              <Area
                dataKey="value"
                type="monotone"
                stroke={stroke}
                strokeWidth={2.8}
                fill={stroke}
                fillOpacity={0.16}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--panel)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </RechartsAreaChart>
          </ResponsiveContainer>
        </ChartMountGate>
      </div>
      <ChartSummary data={chartData} valueKey="value" metricKind={valueKey} />
    </>
  );
}

function ActivityChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const eventPoint = payload.find((item) => item.dataKey === "events");
  const tokenPoint = payload.find((item) => item.dataKey === "tokens");

  return (
    <div className="mc-chart-tooltip mc-chart-tooltip--direct v3-activity-tooltip">
      <strong>{label || "-"}</strong>
      <span><i className="is-events" />事件 {formatNumber(eventPoint?.value || 0)}</span>
      <span><i className="is-tokens" />Token {tokenLabel(tokenPoint?.value || 0)}</span>
    </div>
  );
}

function ActivityPulseChart({ data, testId, height = 260, fillHeight = false }) {
  const chartData = (data || []).map((item) => ({
    ...item,
    label: item.label || "-",
    events: finiteToken(item.events),
    tokens: finiteToken(item.tokens),
  }));
  const totalEvents = sumBy(chartData, (row) => row.events);
  const totalTokens = sumBy(chartData, (row) => row.tokens);
  const peak = topBy(chartData, (row) => row.events);

  if (!chartData.length) return <EmptyChart label="活动" />;

  return (
    <>
      <div
        className={`mc-chart-frame mc-chart-frame--mantine v3-activity-chart${fillHeight ? " is-fill" : ""}`}
        data-testid={testId}
        aria-label="24 小时事件与 Token 负载图"
      >
        <ChartMountGate height={height} fillHeight={fillHeight}>
          <ResponsiveContainer
            width="100%"
            height={fillHeight ? "100%" : height}
            initialDimension={{ width: 800, height }}
            className="mc-chart-container"
          >
            <RechartsComposedChart data={chartData} margin={{ top: 12, right: 6, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="4 6" vertical={false} />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                tickMargin={10}
              />
              <YAxis
                yAxisId="events"
                width={52}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                tickFormatter={formatHumanNumber}
                tickMargin={8}
              />
              <YAxis
                yAxisId="tokens"
                orientation="right"
                width={58}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "var(--text-faint)", fontSize: 11 }}
                tickFormatter={tokenLabel}
                tickMargin={8}
              />
              <RechartsTooltip
                cursor={{ fill: "color-mix(in srgb, var(--accent) 10%, transparent)" }}
                content={(props) => <ActivityChartTooltip {...props} />}
              />
              <Bar
                yAxisId="events"
                dataKey="events"
                fill="var(--accent)"
                fillOpacity={0.78}
                radius={[4, 4, 1, 1]}
                minPointSize={2}
                maxBarSize={18}
                isAnimationActive={false}
              />
              <Line
                yAxisId="tokens"
                dataKey="tokens"
                type="monotone"
                stroke="var(--violet)"
                strokeWidth={2.2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--panel)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </RechartsComposedChart>
          </ResponsiveContainer>
        </ChartMountGate>
      </div>
      <div className="v3-activity-chart__summary">
        <span><i className="is-events" />24h 事件 <strong>{formatNumber(totalEvents)}</strong></span>
        <span><i className="is-tokens" />24h Token <strong>{tokenLabel(totalTokens)}</strong></span>
        <span>峰值时段 <strong>{peak?.label || "-"}</strong></span>
      </div>
    </>
  );
}

const HEATMAP_METRICS = {
  sessions: {
    shortLabel: "会话",
    peakLabel: "会话峰值",
    scaleLabel: "每日会话数",
    summaryLabel: "次会话",
    valueKey: "sessions",
  },
  events: {
    shortLabel: "事件",
    peakLabel: "事件峰值",
    scaleLabel: "每日事件数",
    summaryLabel: "个事件",
    valueKey: "events",
  },
  interactions: {
    shortLabel: "对话",
    peakLabel: "对话峰值",
    scaleLabel: "每日提问与 Agent 消息数",
    summaryLabel: "条消息",
    valueKey: "interactions",
  },
  tokens: {
    shortLabel: "Token",
    peakLabel: "Token 峰值",
    scaleLabel: "每日 Token 量",
    summaryLabel: "Token",
    valueKey: "tokens",
  },
  pressure: {
    shortLabel: "综合",
    peakLabel: "综合峰值",
    scaleLabel: "会话优先的综合热度",
    summaryLabel: "次会话",
    valueKey: "pressure",
  },
};

const HEATMAP_METRIC_OPTIONS = [
  { label: "会话", value: "sessions" },
  { label: "对话", value: "interactions" },
  { label: "事件", value: "events" },
  { label: "Token", value: "tokens" },
  { label: "综合", value: "pressure" },
];

function heatmapMetricConfig(metric) {
  return HEATMAP_METRICS[metric] || HEATMAP_METRICS.sessions;
}

function heatmapMetricRawValue(day, metric) {
  const config = heatmapMetricConfig(metric);
  if (config.valueKey === "pressure") {
    return Math.max(
      finiteToken(day?.sessions),
      finiteToken(day?.events),
      finiteToken(day?.tokens),
    );
  }
  return finiteToken(day?.[config.valueKey]);
}

function compositeHeatmapPressure(day, peaks) {
  const sessions = finiteToken(day?.sessions);
  const events = finiteToken(day?.events);
  const tokens = finiteToken(day?.tokens);
  if (!sessions && !events && !tokens) return 0;

  const sessionScore = sessions / Math.max(1, peaks.sessions);
  const eventScore = events / Math.max(1, peaks.events);
  const tokenScore = tokens / Math.max(1, peaks.tokens);
  return Math.max(sessionScore, eventScore * 0.78, tokenScore * 0.6);
}

function heatmapMetricScore(day, metric, peaks) {
  if (metric === "pressure") return compositeHeatmapPressure(day, peaks);
  const value = heatmapMetricRawValue(day, metric);
  if (!value) return 0;
  return value / Math.max(1, finiteToken(peaks?.[heatmapMetricConfig(metric).valueKey]));
}

function heatmapLevel(day, metric, peaks) {
  const pressure = heatmapMetricScore(day, metric, peaks);
  if (!pressure) return 0;
  return Math.max(1, Math.min(5, Math.ceil(pressure * 5)));
}

function heatmapValueLabel(day, metric, peaks) {
  const value = heatmapMetricRawValue(day, metric);
  if (metric === "tokens") return `${tokenLabel(value)} Token`;
  if (metric === "pressure") return `${percentLabel(heatmapMetricScore(day, metric, peaks) * 100)} 综合热度`;
  return `${formatNumber(value)} ${heatmapMetricConfig(metric).summaryLabel}`;
}

function heatmapSummaryLabel(value, metric) {
  if (metric === "tokens") return `${tokenLabel(value)} Token`;
  return `${formatNumber(value)} ${heatmapMetricConfig(metric).summaryLabel}`;
}

function heatmapTopDayDetail(day, metric, peaks) {
  const value = heatmapValueLabel(day, metric, peaks);
  if (metric === "sessions") return value;
  return `${value} · ${formatNumber(day?.sessions || 0)} 会话`;
}

function DailySessionHeatmapTooltip({ day, metric, peaks }) {
  const workspace = day?.topWorkspace;
  const config = heatmapMetricConfig(metric);

  return (
    <div className="mc-session-heatmap-tooltip">
      <strong>{day?.label || "-"}</strong>
      <span>颜色依据：{config.shortLabel} · {heatmapValueLabel(day, metric, peaks)}</span>
      <span>{formatNumber(day?.sessions || 0)} 会话 · {formatNumber(day?.events || 0)} 事件</span>
      <span>{formatNumber(day?.prompts || 0)} 提问 · {formatNumber(day?.agentMessages || 0)} 回复 · {formatNumber(day?.toolCalls || 0)} 工具调用</span>
      <span>{tokenLabel(day?.tokens || 0)} Token</span>
      <em>{workspace?.cwd ? `主要工作区 ${clipText(workspace.cwd, 56)}` : "当天没有会话活动"}</em>
    </div>
  );
}

function heatmapWeekdayIndex(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return (date.getDay() + 6) % 7;
}

function buildHeatmapCalendar(days) {
  const normalizedDays = days.map((day) => ({
    ...day,
    weekdayIndex: heatmapWeekdayIndex(day?.time),
  }));
  const firstWeekday = normalizedDays[0]?.weekdayIndex || 0;
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...normalizedDays,
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  const monthLabels = weeks.map((week, index) => {
    const firstDay = week.find(Boolean);
    if (!firstDay?.label) return "";
    const month = `${Number(firstDay.label.slice(0, 2))}月`;
    const previousMonth = weeks[index - 1]?.find(Boolean)?.label?.slice(0, 2);
    return index === 0 || previousMonth !== firstDay.label.slice(0, 2) ? month : "";
  });

  return { weeks, monthLabels };
}

function sortedHeatmapDays(days, metric = "sessions", peaks = {}) {
  return days.slice().sort((left, right) => {
    const metricDelta = heatmapMetricScore(right, metric, peaks) - heatmapMetricScore(left, metric, peaks);
    if (metricDelta) return metricDelta;
    const sessionDelta = finiteToken(right?.sessions) - finiteToken(left?.sessions);
    if (sessionDelta) return sessionDelta;
    const eventDelta = finiteToken(right?.events) - finiteToken(left?.events);
    if (eventDelta) return eventDelta;
    return finiteToken(right?.tokens) - finiteToken(left?.tokens);
  });
}

function aggregateHeatmapWorkspaces(days) {
  const workspaces = new Map();
  for (const day of days) {
    const workspace = day?.topWorkspace;
    if (!workspace?.cwd) continue;
    const current = workspaces.get(workspace.cwd) || {
      cwd: workspace.cwd,
      sessions: 0,
      events: 0,
      tokens: 0,
      days: 0,
    };
    current.sessions += finiteToken(workspace.sessions);
    current.events += finiteToken(workspace.events);
    current.tokens += finiteToken(workspace.tokens);
    current.days += 1;
    workspaces.set(workspace.cwd, current);
  }

  return [...workspaces.values()].sort((left, right) => {
    if (right.sessions !== left.sessions) return right.sessions - left.sessions;
    if (right.events !== left.events) return right.events - left.events;
    return right.tokens - left.tokens;
  })[0] || null;
}

const HEATMAP_WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function heatmapDayTime(day) {
  const time = new Date(day?.time || day?.date || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function heatmapWeekdayRows(days, metric) {
  const totals = HEATMAP_WEEKDAYS.map((label) => ({ label, value: 0, activeDays: 0 }));
  for (const day of days) {
    const time = heatmapDayTime(day);
    if (!time) continue;
    const weekdayIndex = (new Date(time).getDay() + 6) % 7;
    const value = heatmapMetricRawValue(day, metric);
    totals[weekdayIndex].value += value;
    if (value > 0) totals[weekdayIndex].activeDays += 1;
  }
  return totals;
}

function heatmapStreaks(days) {
  const ordered = [...days].sort((left, right) => heatmapDayTime(left) - heatmapDayTime(right));
  let running = 0;
  let longest = 0;
  for (const day of ordered) {
    if (finiteToken(day?.sessions) > 0) {
      running += 1;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }
  return { current: running, longest };
}

function DailySessionHeatmap({ data }) {
  const [metric, setMetric] = useState("sessions");
  const days = Array.isArray(data) ? data : [];
  const calendar = buildHeatmapCalendar(days);
  const peaks = {
    sessions: Math.max(0, ...days.map((day) => finiteToken(day?.sessions))),
    interactions: Math.max(0, ...days.map((day) => finiteToken(day?.interactions))),
    events: Math.max(0, ...days.map((day) => finiteToken(day?.events))),
    tokens: Math.max(0, ...days.map((day) => finiteToken(day?.tokens))),
  };
  const config = heatmapMetricConfig(metric);
  const activeDayRows = days.filter((day) => finiteToken(day?.sessions) > 0);
  const selectedDayRows = days.filter((day) => heatmapMetricRawValue(day, metric) > 0);
  const activeDays = activeDayRows.length;
  const totalDaySessions = sumBy(days, (day) => day?.sessions);
  const selectedTotal = metric === "pressure"
    ? totalDaySessions
    : sumBy(days, (day) => heatmapMetricRawValue(day, metric));
  const topDays = sortedHeatmapDays(selectedDayRows, metric, peaks).slice(0, 3);
  const peakDay = topDays[0] || sortedHeatmapDays(days, metric, peaks)[0];
  const recentActiveDay = activeDayRows.at(-1);
  const topWorkspace = aggregateHeatmapWorkspaces(activeDayRows);
  const activeRate = days.length ? (activeDays / days.length) * 100 : 0;
  const topDayLabel = topDays.length
    ? topDays.map((day) => `${day.label} ${heatmapValueLabel(day, metric, peaks)}`).join(" / ")
    : "-";
  const topDayRows = topDays.length ? topDays : activeDayRows.slice(-3).reverse();
  const weekdayRows = heatmapWeekdayRows(days, metric);
  const peakWeekdayValue = Math.max(1, ...weekdayRows.map((row) => row.value));
  const peakWeekday = weekdayRows.slice().sort((left, right) => right.value - left.value)[0];
  const streaks = heatmapStreaks(days);

  if (!days.length) {
    return <EmptyChart label="会话热力" />;
  }

  const weekdayLabels = ["", "一", "", "三", "", "五", ""];
  const contributionGridColumns = `34px repeat(${Math.max(1, calendar.weeks.length)}, var(--heatmap-cell-size))`;

  return (
    <div className="mc-session-heatmap" data-testid="daily-session-heatmap">
      <div className="mc-session-heatmap__shell">
        <div className="mc-session-heatmap__main">
          <div className="mc-session-heatmap__lead">
            <div className="mc-session-heatmap__lead-copy">
              <span className="mc-session-heatmap__metric-label">颜色依据：{config.scaleLabel}</span>
              <strong>{heatmapSummaryLabel(selectedTotal, metric)}</strong>
              <em>{formatNumber(activeDays)} 天有活动 · 最近 {recentActiveDay?.label || "-"}</em>
            </div>
            <div className="mc-session-heatmap__controls">
              <SegmentedControl
                aria-label="切换热度图指标"
                className="mc-session-heatmap__metric-control"
                data={HEATMAP_METRIC_OPTIONS}
                size="xs"
                value={metric}
                onChange={setMetric}
              />
              <div className="mc-session-heatmap__legend" aria-hidden="true">
                <span>低</span>
                {[0, 1, 2, 3, 4, 5].map((level) => (
                  <i key={level} className={`is-level-${level}`} />
                ))}
                <span>高</span>
              </div>
            </div>
          </div>

          <div className="mc-session-heatmap__board">
            <div
              className="mc-session-heatmap__months"
              style={{ gridTemplateColumns: contributionGridColumns }}
              aria-hidden="true"
            >
              <span />
              {calendar.monthLabels.map((label, index) => (
                <span key={`${label}-${index}`}>{label}</span>
              ))}
            </div>
            <div
              className="mc-session-heatmap__matrix"
              style={{ gridTemplateColumns: contributionGridColumns }}
              role="grid"
              aria-label="每日会话使用热力图"
            >
              {weekdayLabels.map((label, index) => (
                <span
                  key={`weekday-${index}`}
                  className="mc-session-heatmap__weekday"
                  style={{ gridColumn: 1, gridRow: index + 1 }}
                  aria-hidden="true"
                >
                  {label}
                </span>
              ))}
              {calendar.weeks.flatMap((week, weekIndex) => week.map((day, dayIndex) => {
                if (!day) {
                  return (
                    <span
                      key={`empty-${weekIndex}-${dayIndex}`}
                      className="mc-session-heatmap__spacer"
                      style={{ gridColumn: weekIndex + 2, gridRow: dayIndex + 1 }}
                      aria-hidden="true"
                    />
                  );
                }

                const level = heatmapLevel(day, metric, peaks);
                const metricValue = heatmapMetricRawValue(day, metric);
                const ariaLabel = `${day.label}，颜色依据 ${config.shortLabel} ${heatmapValueLabel(day, metric, peaks)}，${formatNumber(day?.sessions || 0)} 会话，${formatNumber(day?.events || 0)} 事件，${tokenLabel(day?.tokens || 0)} Token`;

                return (
                  <Tooltip
                    key={day.time || day.label}
                    label={<DailySessionHeatmapTooltip day={day} metric={metric} peaks={peaks} />}
                    withArrow
                    color="dark"
                    position="top"
                    openDelay={120}
                    multiline
                  >
                    <button
                      type="button"
                      className={`mc-session-heatmap__cell is-level-${level}${metricValue ? "" : " is-empty"}`}
                      aria-label={ariaLabel}
                      style={{ gridColumn: weekIndex + 2, gridRow: dayIndex + 1 }}
                      role="gridcell"
                    />
                  </Tooltip>
                );
              }))}
            </div>
          </div>

          <div className="mc-session-heatmap__top-days">
            <span>高值日期</span>
            {topDayRows.map((day) => (
              <div key={day.time || day.label} className="mc-session-heatmap__top-day">
                <strong>{day.label}</strong>
                <em>{heatmapTopDayDetail(day, metric, peaks)}</em>
              </div>
            ))}
          </div>

        </div>

        <aside className="mc-session-heatmap__profile" aria-label="会话活跃节奏">
          <div className="mc-session-heatmap__profile-head">
            <span>活跃节奏</span>
            <strong>{peakWeekday?.value ? peakWeekday.label : "-"}</strong>
            <em>{peakWeekday?.value ? `${heatmapSummaryLabel(peakWeekday.value, metric)} · ${formatNumber(peakWeekday.activeDays)} 天` : "暂无活跃分布"}</em>
          </div>
          <div className="mc-session-heatmap__weekdays">
            {weekdayRows.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>
                <i aria-hidden="true"><b style={{ width: `${Math.max(row.value ? 6 : 0, (row.value / peakWeekdayValue) * 100)}%` }} /></i>
                <em>{row.activeDays} 天</em>
              </div>
            ))}
          </div>
          <div className="mc-session-heatmap__streaks">
            <div><span>当前连续</span><strong>{formatNumber(streaks.current)} 天</strong></div>
            <div><span>最长连续</span><strong>{formatNumber(streaks.longest)} 天</strong></div>
          </div>
        </aside>

        <aside className="mc-session-heatmap__rail" aria-label="会话热度摘要">
          <div className="mc-session-heatmap__rail-hero">
            <span>活跃率</span>
            <strong>{percentLabel(activeRate)}</strong>
            <em>{formatNumber(activeDays)} / {formatNumber(days.length)} 天</em>
          </div>
          <div className="mc-session-heatmap__rail-grid">
            <div>
              <span>最近活跃</span>
              <strong>{recentActiveDay?.label || "-"}</strong>
              <em>{formatNumber(recentActiveDay?.sessions || 0)} 会话</em>
            </div>
            <div>
              <span className="mc-session-heatmap__metric-label">{config.peakLabel}</span>
              <strong>{peakDay?.label || "-"}</strong>
              <em>{heatmapValueLabel(peakDay, metric, peaks)}</em>
            </div>
          </div>
          <div className="mc-session-heatmap__workspace">
            <span>主要工作区</span>
            <strong title={topWorkspace?.cwd || ""}>{clipText(topWorkspace?.cwd || "暂无活跃工作区", 42)}</strong>
            <em>{topWorkspace ? `${formatNumber(topWorkspace.sessions)} 会话 · ${formatNumber(topWorkspace.days)} 天` : topDayLabel}</em>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TokenLedgerPanel({ tokens, tokenCost }) {
  const input = finiteToken(tokens?.input);
  const cacheReadInput = cacheReadToken(tokens);
  const cacheCreationInput = cacheCreationToken(tokens);
  const output = finiteToken(tokens?.output);
  const reasoningOutput = finiteToken(tokens?.reasoningOutput);
  const rawTotal = finiteToken(tokens?.total) || input + output;
  const effectiveTotal = finiteToken(tokens?.effectiveTotal) || rawTotal;
  const inputSideTotal = inputSideToken(tokens) || input;
  const rows = [
    {
      key: "input",
      label: "非缓存输入",
      value: input,
      meta: "Prompt 与上下文未命中输入",
      color: "var(--accent)",
      chartColor: "blue.6",
    },
    {
      key: "cacheRead",
      label: "缓存命中",
      value: cacheReadInput,
      meta: `${percentLabel(percentValue(cacheReadInput, inputSideTotal))} 输入侧覆盖`,
      color: "#2fa66a",
      chartColor: "green.6",
    },
    {
      key: "cacheWrite",
      label: "缓存写入",
      value: cacheCreationInput,
      meta: `读写杠杆 ${ratioLabel(cacheReadInput, cacheCreationInput)}`,
      color: "#14b8a6",
      chartColor: "teal.6",
    },
    {
      key: "output",
      label: "输出",
      value: output,
      meta: `${percentLabel(percentValue(output, effectiveTotal))} 有效总量`,
      color: "var(--violet)",
      chartColor: "violet.6",
    },
    {
      key: "reasoning",
      label: "推理输出",
      value: reasoningOutput,
      meta: `${percentLabel(percentValue(reasoningOutput, output))} 输出侧`,
      color: "var(--orange)",
      chartColor: "orange.6",
      detailOnly: true,
    },
  ];
  const compositionRows = rows.filter((row) => !row.detailOnly);
  const cacheCoverage = percentValue(cacheReadInput, inputSideTotal);

  return (
    <Paper className="mc-panel mc-token-ledger v2-token-ledger" radius="md" p="lg">
      <div className="mc-token-ledger__head">
        <div>
          <Text className="mc-eyebrow">USAGE BALANCE</Text>
          <Title order={2}>Token 构成</Title>
          <Text className="mc-muted-line">一次读清输入、缓存和输出，不再用占比失真的环形图。</Text>
        </div>
        <div className="v2-token-ledger__headline">
          <div>
            <span>有效 Token</span>
            <strong>{tokenLabel(effectiveTotal)}</strong>
          </div>
          <div>
            <span>成本估算</span>
            <strong>{usdLabel(tokenCost?.estimatedUsd)}</strong>
          </div>
          <div>
            <span>缓存覆盖</span>
            <strong>{percentLabel(cacheCoverage)}</strong>
          </div>
        </div>
      </div>
      <div className="mc-token-ledger__bar v2-token-ledger__bar" aria-label="Token 构成比例">
        {compositionRows.map((row) => row.value > 0 ? (
          <span
            key={row.key}
            title={`${row.label} ${tokenLabel(row.value)}`}
            style={{
              width: `${Math.max(2, percentValue(row.value, effectiveTotal))}%`,
              background: row.color,
            }}
          />
        ) : null)}
      </div>
      <div className="mc-token-ledger__rows v2-token-ledger__rows">
        {rows.map((row) => (
          <div key={row.key} className="mc-token-ledger-row">
            <i style={{ background: row.color }} />
            <span>{row.label}</span>
            <strong>{tokenLabel(row.value)}</strong>
            <em>{row.meta}</em>
          </div>
        ))}
      </div>
    </Paper>
  );
}

function MetricTiles({ rows, className = "" }) {
  return (
    <div className={`mc-metric-tiles${className ? ` ${className}` : ""}`}>
      {rows.map((row) => (
        <div key={row.label} className={`mc-metric-tile${row.tone ? ` mc-metric-tile--${row.tone}` : ""}`}>
          <Text>{row.label}</Text>
          <strong>{row.value}</strong>
          <span>{row.meta}</span>
        </div>
      ))}
    </div>
  );
}

function OperationalKpiStrip({ rows }) {
  return (
    <div className="mc-operational-strip">
      {rows.map((row) => (
        <div key={row.label} className={`mc-operational-strip__item${row.tone ? ` is-${row.tone}` : ""}`}>
          <span className="mc-operational-strip__label">{row.label}</span>
          <div className="mc-operational-strip__value">
            <strong>{row.value}</strong>
            {row.sparkData ? <Sparkline data={row.sparkData} width={54} height={22} color={row.sparkColor} /> : null}
          </div>
          <em>{row.meta}</em>
        </div>
      ))}
    </div>
  );
}

function OverviewHealthBand({ runtime, sources, index, generatedAt, health }) {
  const memory = runtime?.memory || {};
  const sourceRows = [
    { label: "Codex 数据", source: sources?.codex },
    { label: "Claude 数据", source: sources?.claude },
  ];
  const cachedFiles = finiteToken(index?.cachedFiles);
  const reusedFiles = finiteToken(index?.reusedFiles);
  const cacheReuse = percentValue(reusedFiles, cachedFiles);
  const dataDelay = timestampAgeMs(health?.lastEventAt, generatedAt);

  return (
    <Paper className="v3-health-band" radius="md" p={0} aria-label="运行健康">
      <div className="v3-health-band__lead">
        <span>HEALTH</span>
        <strong>运行健康</strong>
        <em>采集与缓存状态</em>
      </div>
      <div className="v3-health-band__item is-online">
        <span><i />Observer</span>
        <strong>正常</strong>
        <em>RSS {formatBytes(memory.rss)} · 数据延迟 {dataDelay == null ? "-" : formatAgeText(dataDelay)}</em>
      </div>
      {sourceRows.map(({ label, source }) => {
        const healthy = sourceIsHealthy(source);
        const sourceAge = timestampAgeMs(source?.updatedAt, generatedAt);
        return (
          <div key={label} className={`v3-health-band__item ${healthy ? "is-online" : "is-offline"}`}>
            <span><i />{label}</span>
            <strong>{healthy ? "正常" : getSourceState(source)}</strong>
            <em>{formatNumber(source?.files || 0)} 文件 · {sourceAge == null ? "未上报" : formatAgeText(sourceAge)}</em>
          </div>
        );
      })}
      <div className={`v3-health-band__item ${index?.lastError ? "is-offline" : "is-online"}`}>
        <span><i />摘要缓存</span>
        <strong>{index?.lastError ? "构建失败" : `${percentLabel(cacheReuse)} 复用`}</strong>
        <em>{formatNumber(cachedFiles)} 文件 · {index?.lastError || "增量读取正常"}</em>
      </div>
    </Paper>
  );
}

const CODEX_PLAN_LABELS = {
  free: "FREE",
  go: "GO",
  plus: "PLUS",
  pro: "PRO",
  prolite: "PRO LITE",
  team: "TEAM",
  self_serve_business_usage_based: "BUSINESS",
  business: "BUSINESS",
  enterprise_cbp_usage_based: "ENTERPRISE",
  enterprise: "ENTERPRISE",
  edu: "EDU",
};

function codexPlanLabel(value) {
  return CODEX_PLAN_LABELS[String(value || "").toLowerCase()] || "CODEX";
}

function codexWindowLabel(window, fallback) {
  const minutes = Number(window?.windowDurationMinutes);
  if (minutes === 300) return "5 小时额度";
  if (minutes === 10_080) return "每周额度";
  if (Number.isFinite(minutes) && minutes > 0 && minutes % 60 === 0) {
    return `${formatNumber(minutes / 60)} 小时额度`;
  }
  return fallback;
}

function codexQuotaTone(remainingPercent) {
  const remaining = Number(remainingPercent);
  if (!Number.isFinite(remaining)) return "neutral";
  if (remaining <= 20) return "danger";
  if (remaining <= 50) return "warning";
  return "healthy";
}

const CODEX_RESET_EXPIRY_WARNING_MS = 3 * 24 * 60 * 60 * 1000;

function codexResetExpiryWarning(expiresAt, now = Date.now()) {
  const expiresAtMs = new Date(expiresAt || "").getTime();
  if (!Number.isFinite(expiresAtMs)) return null;
  const remainingMs = expiresAtMs - now;
  if (remainingMs > CODEX_RESET_EXPIRY_WARNING_MS) return null;
  if (remainingMs <= 0) {
    return {
      label: "缓存中的重置机会已到期",
      detail: "请重新查询额度",
    };
  }
  const remainingHours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)));
  return {
    label: remainingHours <= 24
      ? `${formatNumber(remainingHours)} 小时内到期`
      : `${formatNumber(Math.ceil(remainingHours / 24))} 天内到期`,
    detail: formatDateTime(expiresAt),
  };
}

function CodexQuotaWindow({ window, fallbackLabel }) {
  if (!window) return null;
  const remaining = Math.max(0, Math.min(100, Number(window.remainingPercent) || 0));
  const tone = codexQuotaTone(remaining);

  return (
    <div className={`v5-codex-usage__window is-${tone}`}>
      <div className="v5-codex-usage__window-head">
        <span>{codexWindowLabel(window, fallbackLabel)}</span>
        <strong>剩余 {percentLabel(remaining)}</strong>
      </div>
      <div
        className="v5-codex-usage__meter"
        role="progressbar"
        aria-label={`${codexWindowLabel(window, fallbackLabel)}剩余额度`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(remaining)}
      >
        <i style={{ width: `${remaining}%` }} />
      </div>
      <div className="v5-codex-usage__window-foot">
        <em>已用 {percentLabel(window.usedPercent)}</em>
        <span>{window.resetsAt ? `重置 ${formatDateTime(window.resetsAt)}` : "重置时间未提供"}</span>
      </div>
    </div>
  );
}

function CodexUsageBand({ usage, codexVersion, onQuery }) {
  const versionInstalled = Boolean(codexVersion && codexVersion !== "unknown");
  if (usage?.installed === false || (!versionInstalled && usage?.installed !== true)) return null;

  const status = usage?.status || "idle";
  const loading = status === "loading";
  const ready = status === "ready";
  const unavailable = status === "unavailable";
  const limits = Array.isArray(usage?.limits) ? usage.limits : [];
  const primaryLimit = limits.find((limit) => limit.id === usage?.defaultLimitId) || limits[0] || null;
  const extraLimits = limits.filter((limit) => limit.id !== primaryLimit?.id);
  const resetCount = Number(usage?.resetCredits?.availableCount);
  const hasResetCount = Number.isFinite(resetCount);
  const upcomingResets = Array.isArray(usage?.resetCredits?.upcoming)
    ? usage.resetCredits.upcoming.slice(0, 3)
    : [];
  const expiryWarning = codexResetExpiryWarning(upcomingResets[0]?.expiresAt);
  const actionLabel = ready ? "重新查询 Codex 使用额度" : "查询 Codex 使用额度";
  const displayVersion = usage?.version && usage.version !== "unknown"
    ? usage.version
    : codexVersion;

  return (
    <Paper className={`v5-codex-usage is-${status}`} radius="md" p={0} aria-label="Codex 使用额度">
      <div className="v5-codex-usage__header">
        <div className="v5-codex-usage__lead">
          <div className="v5-codex-usage__identity">
            <ThemeIcon size={28} radius="sm" variant="light" color="teal">
              <IconGauge size={16} stroke={1.8} />
            </ThemeIcon>
            <div>
              <span>ACCOUNT LIMITS</span>
              <strong>Codex 使用额度</strong>
            </div>
          </div>
          <div className="v5-codex-usage__lead-meta">
            <Badge radius="sm" variant="light" color="teal">{codexPlanLabel(usage?.planType)}</Badge>
            <span title={displayVersion}>{displayVersion}</span>
          </div>
        </div>
        <div className="v5-codex-usage__action">
          <div className="v5-codex-usage__action-meta">
            <span>{usage?.updatedAt ? `上次刷新 ${formatDateTime(usage.updatedAt)}` : "使用本机时区显示"}</span>
            {extraLimits.length ? <em>{formatNumber(extraLimits.length)} 个模型额度</em> : null}
          </div>
          <Button
            size="xs"
            radius="sm"
            color="teal"
            loading={loading}
            disabled={!onQuery}
            leftSection={<IconRefresh size={14} />}
            aria-label={actionLabel}
            onClick={onQuery}
          >
            {ready || unavailable ? "重新查询" : "查询额度"}
          </Button>
        </div>
      </div>

      <div className="v5-codex-usage__body">
        <div className="v5-codex-usage__content" aria-live="polite">
          {ready && primaryLimit ? (
            <div className="v5-codex-usage__windows">
              <CodexQuotaWindow window={primaryLimit.primary} fallbackLabel="短周期额度" />
              <CodexQuotaWindow window={primaryLimit.secondary} fallbackLabel="长周期额度" />
            </div>
          ) : (
            <div className={`v5-codex-usage__state is-${status}`}>
              <strong>{loading ? "正在查询账户额度" : unavailable ? "账户额度读取失败" : "尚未查询账户额度"}</strong>
              <span>{loading
                ? "正在连接本机 Codex"
                : unavailable
                  ? usage?.error || "请稍后重新查询"
                  : "额度数据仅在手动查询时读取"}</span>
            </div>
          )}
        </div>

        <div className="v5-codex-usage__aside">
          <div className="v5-codex-usage__credit">
            <div className="v5-codex-usage__credit-head">
              <span>额度重置</span>
              <strong>{hasResetCount ? `可用 ${formatNumber(resetCount)} 次` : ready ? "未提供" : "待查询"}</strong>
            </div>
            {ready && expiryWarning ? (
              <div className="v5-codex-usage__expiry-alert" role="alert">
                <IconAlertTriangle size={14} stroke={2} />
                <strong>{expiryWarning.label}</strong>
                <span>{expiryWarning.detail}</span>
              </div>
            ) : null}
            {ready ? (
              <div className="v5-codex-usage__expirations">
                <span>最近三次到期</span>
                {upcomingResets.length ? (
                  <ol>
                    {upcomingResets.map((credit, index) => (
                      <li key={`${credit.expiresAt}-${index}`}>
                        <em>{String(index + 1).padStart(2, "0")}</em>
                        <time dateTime={credit.expiresAt}>{formatDateTime(credit.expiresAt)}</time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p>到期时间暂未提供</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Paper>
  );
}

function TokenEfficiencyStrip({ tokens, tokenCost, sessionsTotal }) {
  const sessionCount = Math.max(1, finiteToken(sessionsTotal));
  const effectiveTotal = finiteToken(tokens?.effectiveTotal) || finiteToken(tokens?.total);
  const estimatedUsd = finiteToken(tokenCost?.estimatedUsd);
  const rows = [
    {
      label: "每会话 Token",
      value: tokenLabel(effectiveTotal / sessionCount),
      meta: `${formatNumber(sessionsTotal || 0)} 个会话均摊`,
    },
    {
      label: "每会话成本",
      value: usdLabel(estimatedUsd / sessionCount),
      meta: "按已计价模型估算",
    },
    {
      label: "百万 Token 成本",
      value: perMillionUsdLabel(estimatedUsd, tokenCost?.knownTokenTotal || effectiveTotal),
      meta: `${tokenLabel(tokenCost?.knownTokenTotal || 0)} 已覆盖`,
    },
    {
      label: "缓存读写杠杆",
      value: ratioLabel(cacheReadToken(tokens), cacheCreationToken(tokens)),
      meta: `${tokenLabel(cacheReadToken(tokens))} 读取 / ${tokenLabel(cacheCreationToken(tokens))} 写入`,
    },
  ];

  return (
    <section className="v3-token-efficiency" aria-label="Token 效率指标">
      <div className="v3-token-efficiency__lead">
        <span>EFFICIENCY</span>
        <strong>效率指标</strong>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="v3-token-efficiency__item">
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          <em>{row.meta}</em>
        </div>
      ))}
    </section>
  );
}

function TokenRangeToolbar({ range, value, onChange, onRecalculate, recalculating = false }) {
  const cachedHistoricalDays = finiteToken(range?.history?.cachedHistoricalDays);
  const cacheText = cachedHistoricalDays > 0
    ? `历史 ${formatNumber(cachedHistoricalDays)} 天直接读取缓存，今天增量更新`
    : "今天数据按追加内容增量更新";
  const lastRecalculatedAt = range?.cache?.lastRecalculatedAt || "";
  const dateRange = range?.days === 1
    ? `${shortDateLabel(range?.startAt)} 00:00 - ${shortDateLabel(range?.endAt, true)}`
    : `${shortDateLabel(range?.startAt)} - ${shortDateLabel(range?.endAt)}`;

  return (
    <section className="v5-token-range" aria-label="Token 数据范围">
      <div className="v5-token-range__lead">
        <span>TIME RANGE</span>
        <strong>数据范围</strong>
        <em>整页统计统一切换</em>
      </div>
      <SegmentedControl
        className="v5-token-range__control"
        size="sm"
        radius="sm"
        value={value}
        onChange={onChange}
        aria-label="Token 数据范围"
        data={[
          { label: "当天", value: "today" },
          { label: "近 7 天", value: "week" },
          { label: "近 30 天", value: "month" },
        ]}
      />
      <div className="v5-token-range__scope">
        <span>{dateRange}</span>
        <strong>{formatNumber(range?.health?.sessionsTotal || 0)} 会话 · {formatNumber(range?.health?.activeDays || 0)} 个活跃日</strong>
      </div>
      <div className="v5-token-range__cache">
        <div>
          <Badge radius="sm" variant="light" color="teal">持久化日汇总</Badge>
          <span>{cacheText}</span>
          <em>{lastRecalculatedAt ? `上次完整重算 ${formatDateTime(lastRecalculatedAt)}` : "尚未手动完整重算"}</em>
        </div>
        <Tooltip label="清空历史汇总缓存，并使用当前解析逻辑重新扫描全部会话文件" position="bottom-end">
          <Button
            size="xs"
            radius="sm"
            variant="light"
            color="teal"
            leftSection={<IconRefresh size={14} />}
            loading={recalculating}
            disabled={!onRecalculate}
            onClick={onRecalculate}
          >
            {recalculating ? "重新计算中" : "重新计算"}
          </Button>
        </Tooltip>
      </div>
    </section>
  );
}

function UsageStatisticsBoard({ stats, onOpenSessionDetail }) {
  if (!stats) return null;
  const interactions = stats.interactions || {};
  const sessions = stats.sessions || {};
  const cadence = stats.cadence || {};
  const today = stats.today || {};
  const recent7 = cadence.recent7 || {};
  const fiveHours = cadence.recentFiveHours || {};
  const longest = sessions.longest;

  return (
    <Paper className="mc-panel v4-usage-board" radius="md" p={0}>
      <div className="v4-usage-board__header">
        <div>
          <Text className="mc-eyebrow">USAGE PROFILE</Text>
          <Title order={3}>使用统计</Title>
        </div>
        <Text>提问、Agent 消息、工具调用与会话节奏</Text>
      </div>
      <div className="v4-usage-board__grid">
        <section className="v4-usage-section v4-usage-section--interactions">
          <span className="v4-usage-section__label">交互结构</span>
          <div className="v4-usage-section__hero">
            <strong>{formatNumber(interactions.prompts || 0)}</strong>
            <span>累计提问</span>
            <em>今日 {formatNumber(today.prompts || 0)}</em>
          </div>
          <dl>
            <div><dt>Agent 消息</dt><dd>{formatNumber(interactions.agentMessages || 0)}</dd></div>
            <div><dt>工具调用</dt><dd>{formatNumber(interactions.toolCalls || 0)}</dd></div>
            <div><dt>消息 / 提问</dt><dd>{decimalLabel(interactions.repliesPerPrompt || 0, 1)}</dd></div>
            <div><dt>工具 / 提问</dt><dd>{decimalLabel(interactions.toolCallsPerPrompt || 0, 1)}</dd></div>
          </dl>
        </section>

        <section className="v4-usage-section v4-usage-section--sessions">
          <span className="v4-usage-section__label">会话效率</span>
          <div className="v4-usage-section__hero">
            <strong>{durationLabel(sessions.medianDurationMs)}</strong>
            <span>中位会话跨度</span>
            <em>{formatNumber(sessions.measuredDurationSessions || 0)} 个可测会话</em>
          </div>
          <dl>
            <div><dt>平均跨度</dt><dd>{durationLabel(sessions.averageDurationMs)}</dd></div>
            <div><dt>提问 / 会话</dt><dd>{decimalLabel(sessions.averagePrompts || 0, 1)}</dd></div>
            <div><dt>工具 / 会话</dt><dd>{decimalLabel(sessions.averageToolCalls || 0, 1)}</dd></div>
            <div><dt>Token / 提问</dt><dd>{tokenLabel(interactions.tokensPerPrompt || 0)}</dd></div>
          </dl>
          {longest ? (
            <button
              type="button"
              className="v4-usage-section__link"
              onClick={() => onOpenSessionDetail?.(longest)}
              disabled={!onOpenSessionDetail}
            >
              <span>最长会话</span>
              <strong>{clipText(longest.title || longest.sessionId, 42)}</strong>
              <em>{durationLabel(longest.durationMs)}</em>
            </button>
          ) : null}
        </section>

        <section className="v4-usage-section v4-usage-section--cadence">
          <span className="v4-usage-section__label">近 7 天节奏</span>
          <div className="v4-usage-section__hero">
            <strong>{formatNumber(recent7.sessions || 0)}</strong>
            <span>使用会话</span>
            <em>{formatNumber(cadence.activeDays7 || 0)} / 7 天有活动</em>
          </div>
          <div className="v4-change-list">
            <div className={`is-${changeTone(cadence.sessionChangePercent)}`}>
              <span>会话</span><strong>{changeLabel(cadence.sessionChangePercent)}</strong>
            </div>
            <div className={`is-${changeTone(cadence.interactionChangePercent)}`}>
              <span>对话</span><strong>{changeLabel(cadence.interactionChangePercent)}</strong>
            </div>
            <div className={`is-${changeTone(cadence.tokenChangePercent)}`}>
              <span>Token</span><strong>{changeLabel(cadence.tokenChangePercent)}</strong>
            </div>
          </div>
          <div className="v4-usage-section__foot">
            <span>高峰时段</span>
            <strong>{cadence.busiestHour?.label || "-"}</strong>
            <em>{formatNumber(cadence.busiestHour?.interactions || 0)} 条对话消息</em>
          </div>
        </section>

        <section className="v4-usage-section v4-usage-section--window">
          <span className="v4-usage-section__label">最近 5 小时</span>
          <div className="v4-usage-section__hero">
            <strong>{tokenLabel(fiveHours.tokens || 0)}</strong>
            <span>Token 消耗</span>
            <em>{formatNumber(fiveHours.sessions || 0)} 个会话</em>
          </div>
          <dl>
            <div><dt>对话消息</dt><dd>{formatNumber(fiveHours.interactions || 0)}</dd></div>
            <div><dt>提问</dt><dd>{formatNumber(fiveHours.prompts || 0)}</dd></div>
            <div><dt>工具调用</dt><dd>{formatNumber(fiveHours.toolCalls || 0)}</dd></div>
            <div><dt>事件</dt><dd>{formatNumber(fiveHours.events || 0)}</dd></div>
          </dl>
          <div className="v4-usage-section__foot">
            <span>30 天活跃</span>
            <strong>{formatNumber(cadence.activeDays30 || 0)} 天</strong>
            <em>{formatNumber(recent7.interactions || 0)} 条近 7 天消息</em>
          </div>
        </section>
      </div>
    </Paper>
  );
}

function TokenWorkspacePanel({ tokens }) {
  const rows = (tokens?.byWorkspace || []).slice(0, 6);
  const total = sumBy(tokens?.byWorkspace, (row) => row.total) || finiteToken(tokens?.effectiveTotal);
  const top = rows[0];
  const topRowsTotal = sumBy(rows, (row) => row.total);
  const peak = Math.max(1, ...rows.map((row) => finiteToken(row.total)));

  if (!rows.length) {
    return <Text className="mc-muted-line">暂无工作区 Token 数据。</Text>;
  }

  return (
    <div className="mc-token-workspaces">
      <MetricTiles
        rows={[
          {
            label: "Top 工作区",
            value: percentLabel(percentValue(top?.total, total)),
            meta: `${clipText(top?.cwd || "-", 36)} · ${usdLabel(top?.estimatedUsd || 0)}`,
            tone: "primary",
          },
          {
            label: "Top 6 覆盖",
            value: percentLabel(percentValue(topRowsTotal, total)),
            meta: `${formatNumber(rows.length)} 个工作区`,
            tone: "success",
          },
        ]}
      />
      <div className="mc-attribution-table">
        <div className="mc-attribution-table__head" aria-hidden="true">
          <span>#</span>
          <span>工作区</span>
          <span>Token 规模</span>
        </div>
        {rows.map((row, index) => {
          const path = workspacePathParts(row.cwd);
          return (
            <div key={row.cwd} className="mc-attribution-table__row">
              <span className="mc-attribution-table__rank">{String(index + 1).padStart(2, "0")}</span>
              <div className="mc-attribution-table__identity" title={row.cwd}>
                <Text>{path.name}</Text>
                <span>{clipText(path.parent, 34)} · {percentLabel(percentValue(row.total, total))} · {usdLabel(row.estimatedUsd || 0)}</span>
              </div>
              <div className="mc-attribution-table__metric">
                <strong>{tokenLabel(row.total)}</strong>
                <i aria-hidden="true"><b style={{ width: `${Math.max(4, percentValue(row.total, peak))}%` }} /></i>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ModelCostMatrixPanel({ tokens, tokenCost }) {
  const costMap = new Map((tokenCost?.byModel || []).map((row) => [row.model, row]));
  const tokenRows = (tokens?.byModel || []).slice(0, 6);
  const rows = tokenRows.map((row) => {
    const cost = costMap.get(row.key);
    return {
      key: row.key,
      tokens: finiteToken(row.total),
      estimatedUsd: finiteToken(cost?.estimatedUsd),
      costPerMillion: cost ? finiteToken(cost.estimatedUsd) / Math.max(1, finiteToken(cost.knownTokenTotal) / 1_000_000) : 0,
    };
  });
  const peak = Math.max(1, ...rows.map((row) => row.tokens));

  return (
    <div className="mc-model-cost-matrix">
      <div className="mc-model-cost-matrix__head" aria-hidden="true">
        <span>模型</span>
        <span>Token / 成本</span>
        <span>单位成本</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="mc-model-cost-row">
          <div className="mc-model-cost-row__identity">
            <Text>{row.key}</Text>
          </div>
          <div className="mc-model-cost-row__usage">
            <span>{tokenLabel(row.tokens)} · {row.estimatedUsd ? usdLabel(row.estimatedUsd) : "未计价"}</span>
            <i aria-hidden="true"><b style={{ width: `${Math.max(4, Math.round((row.tokens / peak) * 100))}%` }} /></i>
          </div>
          <em>{row.costPerMillion ? `${usdLabel(row.costPerMillion)}/M` : "-"}</em>
        </div>
      ))}
    </div>
  );
}

function ToolReliabilityPanel({ tools, sessionsTotal }) {
  const rows = orderedToolRows(tools?.topTools, 4);
  const categories = tools?.categories || [];
  const categoryTotal = sumBy(categories, (row) => row.calls);
  const categoryColors = {
    terminal: "var(--success)",
    browser: "var(--accent)",
    code: "var(--violet)",
    search: "var(--orange)",
    files: "#47b5a8",
    other: "var(--text-faint)",
  };
  const orphanResults = (tools?.topTools || []).filter((tool) => !Number(tool.calls || 0) && Number(tool.results || 0));
  const namedCallTotal = sumBy(rows, (row) => row.calls);
  const topToolShare = percentValue(rows[0]?.calls, namedCallTotal || tools?.totalCalls);
  const callsPerSession = finiteToken(tools?.totalCalls) / Math.max(1, finiteToken(sessionsTotal));

  return (
    <div className="mc-tool-reliability">
      <MetricTiles
        rows={[
          {
            label: "工具调用",
            value: formatNumber(tools?.totalCalls || 0),
            meta: `${formatNumber(rows.length)} 类主要工具`,
            tone: "success",
          },
          {
            label: "每会话调用",
            value: decimalLabel(callsPerSession, 1),
            meta: `${formatNumber(sessionsTotal || 0)} 个会话均摊`,
            tone: "primary",
          },
          {
            label: "主要工具",
            value: rows[0]?.key || "-",
            meta: rows[0] ? `${formatNumber(rows[0].calls)} 调用 · ${percentLabel(topToolShare)} 占比` : "暂无工具调用",
          },
        ]}
      />
      {categories.length ? (
        <div className="v4-tool-categories">
          <div className="v4-tool-categories__head">
            <span>工作方式</span>
            <strong>{formatNumber(categoryTotal)} 次调用</strong>
          </div>
          <div className="v4-tool-categories__bar" aria-label="工具调用类别构成">
            {categories.map((category) => (
              <i
                key={category.key}
                title={`${category.label} ${formatNumber(category.calls)}`}
                style={{
                  width: `${percentValue(category.calls, categoryTotal)}%`,
                  background: categoryColors[category.key] || categoryColors.other,
                }}
              />
            ))}
          </div>
          <div className="v4-tool-categories__legend">
            {categories.slice(0, 5).map((category) => (
              <span key={category.key}>
                <i style={{ background: categoryColors[category.key] || categoryColors.other }} />
                {category.label}
                <strong>{percentLabel(percentValue(category.calls, categoryTotal))}</strong>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="mc-tool-reliability__rows">
        {rows.map((tool) => (
          <div key={tool.key}>
            <span>{tool.key}</span>
            <em>{formatNumber(tool.calls)} call · 调用占比</em>
            <strong>{percentLabel(percentValue(tool.calls, namedCallTotal || tools?.totalCalls))}</strong>
          </div>
        ))}
      </div>
      {orphanResults.length ? (
        <Text className="mc-tool-reliability__note">另有 {formatNumber(orphanResults.length)} 类结果事件未关联到命名调用</Text>
      ) : null}
    </div>
  );
}

function WorkspaceLoadPanel({ workspaces }) {
  const rows = (workspaces?.topWorkspaces || []).slice(0, 5);
  const peakEvents = Math.max(1, ...rows.map((row) => finiteToken(row.events)));
  const peakTokens = Math.max(1, ...rows.map((row) => finiteToken(row.tokens)));

  return (
    <div className="mc-workspace-load">
      <div className="mc-workspace-load__head" aria-hidden="true">
        <span>工作区</span>
        <span>会话</span>
        <span>事件</span>
        <span>Token</span>
      </div>
      {rows.map((workspace, index) => {
        const path = workspacePathParts(workspace.cwd);
        return (
          <div key={workspace.cwd} className="mc-workspace-load-row">
            <div className="mc-workspace-load-row__identity" title={workspace.cwd}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <Text>{path.name}</Text>
                <span>{clipText(path.parent, 30)}</span>
              </div>
            </div>
            <strong className="mc-workspace-load-row__sessions">{formatNumber(workspace.sessions || 0)}</strong>
            <div className="mc-workspace-load-row__metric is-events">
              <span>{formatNumber(workspace.events || 0)}</span>
              <i aria-hidden="true"><b style={{ width: `${Math.max(4, percentValue(workspace.events, peakEvents))}%` }} /></i>
            </div>
            <div className="mc-workspace-load-row__metric is-tokens">
              <span>{tokenLabel(workspace.tokens || 0)}</span>
              <i aria-hidden="true"><b style={{ width: `${Math.max(4, percentValue(workspace.tokens, peakTokens))}%` }} /></i>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActivityShapePanel({ hourly, today, tokenWindow }) {
  const totalHourlyEvents = sumBy(hourly, (row) => row.events);
  const peakHour = topBy(hourly, (row) => row.events);
  const sessions = finiteToken(today?.sessions);
  const todayEvents = finiteToken(today?.events) || totalHourlyEvents;
  const todayTokens = finiteToken(tokenWindow?.total) || finiteToken(today?.tokens);
  const rows = [
    {
      label: "事件 / 会话",
      value: decimalLabel(todayEvents / Math.max(1, sessions), 1),
      meta: `${formatNumber(todayEvents)} 事件 · ${formatNumber(sessions)} 会话`,
      tone: "primary",
    },
    {
      label: "Token / 会话",
      value: tokenLabel(todayTokens / Math.max(1, sessions)),
      meta: `${tokenLabel(todayTokens)} 今日消耗`,
      tone: "accent",
    },
    {
      label: "峰值小时",
      value: peakHour?.label || "-",
      meta: peakHour ? `${formatNumber(peakHour.events)} 事件` : "暂无活动",
    },
    {
      label: "峰值占比",
      value: percentLabel(percentValue(peakHour?.events, totalHourlyEvents)),
      meta: `${formatNumber(totalHourlyEvents)} 个 24h 事件`,
      tone: "success",
    },
  ];

  return <MetricTiles rows={rows} className="mc-metric-tiles--activity" />;
}

function ActiveSessionSnapshot({ overview, hourly, onOpenSessionDetail }) {
  const sessions = overview?.sessions || [];
  const total = Number(overview?.total || 0);
  const hiddenCount = Math.max(0, total - sessions.length);
  const platforms = overview?.platforms || [];
  const projectedHourlyTokens = sumBy(sessions, (session) => session.activity?.projectedHourlyTokens);
  const eventsPerMinute = sumBy(sessions, (session) => session.activity?.eventsPerMinute);
  const tokensPerMinute = sumBy(sessions, (session) => session.activity?.tokensPerMinute);
  const platformTotals = new Map();
  (hourly || []).forEach((bucket) => {
    (bucket.platforms || []).forEach((platform) => {
      platformTotals.set(platform.key, finiteToken(platformTotals.get(platform.key)) + finiteToken(platform.total));
    });
  });
  const platformTokenRows = [...platformTotals.entries()]
    .map(([key, total]) => ({ key, total }))
    .sort((left, right) => right.total - left.total);
  const platformTokenTotal = sumBy(platformTokenRows, (row) => row.total);
  const hottest = sessions.slice().sort((left, right) => (
    finiteToken(right.activity?.projectedHourlyTokens) - finiteToken(left.activity?.projectedHourlyTokens)
  ))[0];

  return (
    <>
      <div className="v3-active-throughput">
        <div>
          <span>事件 / 分钟</span>
          <strong>{decimalLabel(eventsPerMinute, 1)}</strong>
        </div>
        <div>
          <span>Token / 分钟</span>
          <strong>{tokenLabel(tokensPerMinute)}</strong>
        </div>
        <div>
          <span>预计小时 Token</span>
          <strong>{tokenLabel(projectedHourlyTokens)}</strong>
        </div>
      </div>

      <div className="v3-active-context">
        <span>最近 {formatNumber(overview?.windowMinutes || 30)} 分钟</span>
        <span>最新写入 {overview?.latestAt ? formatDateTime(overview.latestAt) : "-"}</span>
        {platforms.map((item) => (
          <Badge key={item.key} radius="sm" size="xs" variant="light" color={item.key === "codex" ? "blue" : "orange"}>
            {platformLabel(item.key)} {formatNumber(item.sessions)}
          </Badge>
        ))}
      </div>

      <div className="mc-active-list">
        {sessions.slice(0, 4).map((session) => {
          const clickable = typeof onOpenSessionDetail === "function";
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
                {session.activity?.projectedHourlyTokens ? (
                  <em>预计 {tokenLabel(session.activity.projectedHourlyTokens)}/h</em>
                ) : null}
                <em>{formatAgeText(session.ageMs)}</em>
              </span>
            </>
          );

          return clickable ? (
            <button
              key={session.sessionId}
              type="button"
              className="mc-active-row"
              aria-label={`查看活跃会话详情 ${session.title || session.sessionId}`}
              onClick={() => onOpenSessionDetail(session)}
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

      {platformTokenRows.length || hottest ? (
        <div className="v3-active-foot">
          <div className="v3-active-platform-share">
            <div className="v3-active-foot__head">
              <span>24h Token 来源</span>
              <strong>{tokenLabel(platformTokenTotal)}</strong>
            </div>
            {platformTokenRows.slice(0, 3).map((row) => (
              <div key={row.key} className="v3-active-platform-share__row">
                <span>{platformLabel(row.key)}</span>
                <i><b style={{ width: `${percentValue(row.total, platformTokenTotal)}%` }} /></i>
                <em>{percentLabel(percentValue(row.total, platformTokenTotal))}</em>
              </div>
            ))}
          </div>
          {hottest ? (
            <div className="v3-active-hottest">
              <span>当前最高速率</span>
              <strong>{clipText(hottest.title || hottest.sessionId, 38)}</strong>
              <em>{tokenLabel(hottest.activity?.projectedHourlyTokens || 0)} Token / 小时</em>
            </div>
          ) : null}
        </div>
      ) : null}

    </>
  );
}

function SystemReadinessPanel({ runtime, sources, index, generatedAt, health }) {
  const memory = runtime?.memory || {};
  const heapUsed = finiteToken(memory.heapUsed);
  const heapTotal = finiteToken(memory.heapTotal);
  const heapShare = percentValue(heapUsed, heapTotal);
  const cachedFiles = finiteToken(index?.cachedFiles);
  const reusedFiles = finiteToken(index?.reusedFiles);
  const sourceFileCount = finiteToken(sources?.codex?.files) + finiteToken(sources?.claude?.files);
  const dataDelay = timestampAgeMs(health?.lastEventAt, generatedAt);
  const sourceRows = [
    ["Codex", sources?.codex],
    ["Claude Code", sources?.claude],
  ];

  return (
    <div className="v2-system-readiness">
      <div className="v2-system-readiness__memory">
        <span>进程 RSS</span>
        <strong>{formatBytes(memory.rss)}</strong>
        <Progress value={heapShare} size="xs" radius="xl" color={heapShare > 70 ? "orange" : "teal"} />
        <em>Heap {formatBytes(heapUsed)} / {formatBytes(heapTotal)}</em>
      </div>
      <dl className="v2-system-readiness__facts">
        <div>
          <dt>数据延迟</dt>
          <dd>{dataDelay == null ? "未上报" : formatAgeText(dataDelay)}</dd>
        </div>
        <div>
          <dt>缓存复用</dt>
          <dd>{percentLabel(percentValue(reusedFiles, cachedFiles))} · {formatNumber(reusedFiles)} / {formatNumber(cachedFiles)}</dd>
        </div>
        <div>
          <dt>监控文件</dt>
          <dd>{formatNumber(sourceFileCount)} 个会话文件</dd>
        </div>
      </dl>
      <div className="v2-system-readiness__sources">
        {sourceRows.map(([label, source]) => {
          const healthy = sourceIsHealthy(source);
          const sourceAge = timestampAgeMs(source?.updatedAt, generatedAt);
          return (
            <div key={label}>
              <span className={healthy ? "is-online" : "is-offline"} aria-hidden="true" />
              <strong>{label}</strong>
              <em>{sourceAge == null ? "未上报更新时间" : `更新于 ${formatAgeText(sourceAge)}`}</em>
              <b>{healthy ? `${formatNumber(source?.files || 0)} 文件` : getSourceState(source)}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TokenRangeSummary({ range }) {
  const tokens = range?.tokens || {};
  const cost = tokens.cost || {};
  const platforms = tokens.byPlatform || [];
  const effectiveTotal = finiteToken(tokens.effectiveTotal) || finiteToken(tokens.total);
  const activeDays = Math.max(1, finiteToken(range?.health?.activeDays));
  const comparison = range?.comparison || {};
  const changes = [
    ["Token", comparison.tokenChangePercent],
    ["成本", comparison.costChangePercent],
    ["会话", comparison.sessionChangePercent],
  ];
  const topModel = tokens.byModel?.[0];
  const topWorkspace = tokens.byWorkspace?.[0];
  const topWorkspacePath = workspacePathParts(topWorkspace?.cwd);

  return (
    <div className="v5-token-range-summary">
      <div className="v5-token-range-summary__hero">
        <span>{range?.label || "当前范围"}</span>
        <strong>{tokenLabel(effectiveTotal)}</strong>
        <em>{usdLabel(cost.estimatedUsd || 0)} 估算成本</em>
      </div>
      <dl className="v5-token-range-summary__facts">
        <div><dt>会话</dt><dd>{formatNumber(range?.health?.sessionsTotal || 0)}</dd></div>
        <div><dt>活跃日均</dt><dd>{tokenLabel(effectiveTotal / activeDays)}</dd></div>
        <div><dt>峰值</dt><dd>{range?.peak?.label || "-"}</dd></div>
        <div><dt>峰值 Token</dt><dd>{tokenLabel(range?.peak?.tokens || 0)}</dd></div>
      </dl>
      <div className="v5-token-range-summary__changes">
        <span>较上一周期</span>
        {changes.map(([label, value]) => (
          <div key={label} className={value == null ? "is-neutral" : Number(value) > 0 ? "is-up" : Number(value) < 0 ? "is-down" : "is-neutral"}>
            <em>{label}</em>
            <strong>{compactChangeLabel(value)}</strong>
          </div>
        ))}
      </div>
      <div className="v5-token-range-summary__platforms">
        <span>平台构成</span>
        <div aria-label="范围内 Token 平台构成">
          {platforms.map((platform) => (
            <i
              key={platform.key}
              title={`${platformLabel(platform.key)} ${tokenLabel(platform.total)}`}
              style={{
                width: `${percentValue(platform.total, effectiveTotal)}%`,
                background: platform.key === "claude" ? "var(--platform-claude)" : "var(--platform-codex)",
              }}
            />
          ))}
        </div>
        <ul>
          {platforms.slice(0, 3).map((platform) => (
            <li key={platform.key}>
              <span>{platformLabel(platform.key)}</span>
              <strong>{percentLabel(percentValue(platform.total, effectiveTotal))}</strong>
            </li>
          ))}
        </ul>
      </div>
      <div className="v5-token-range-summary__leaders">
        <div>
          <span>主模型</span>
          <strong>{topModel?.key || "-"}</strong>
          <em>{percentLabel(percentValue(topModel?.total, effectiveTotal))}</em>
        </div>
        <div title={topWorkspace?.cwd || ""}>
          <span>主工作区</span>
          <strong>{topWorkspacePath.name}</strong>
          <em>{percentLabel(percentValue(topWorkspace?.total, effectiveTotal))}</em>
        </div>
      </div>
    </div>
  );
}

function TokenSessionTable({ sessions, onOpenSessionDetail }) {
  const rows = (sessions || []).slice(0, 8);
  const peak = Math.max(1, ...rows.map((row) => finiteToken(row.tokens)));

  if (!rows.length) return <Text className="mc-empty">暂无高消耗会话。</Text>;

  return (
    <div className="v2-token-session-table">
      <div className="v2-token-session-table__head" aria-hidden="true">
        <span>会话</span><span>事件</span><span>Token</span><span>估算成本</span>
      </div>
      {rows.map((session) => (
        <button
          key={session.sessionId}
          type="button"
          onClick={() => onOpenSessionDetail?.(session)}
          aria-label={`查看高消耗会话详情 ${session.title || session.sessionId}`}
        >
          <span>
            <strong>{clipText(session.title || shortSessionId(session.sessionId), 58)}</strong>
            <em>{platformLabel(session.sourceType)} · {shortSessionId(session.sessionId)}</em>
          </span>
          <span>{formatNumber(session.events || 0)}</span>
          <span className="v2-token-session-table__usage">
            <i style={{ width: `${Math.max(5, percentValue(session.tokens, peak))}%` }} />
            <strong>{tokenLabel(session.tokens || 0)}</strong>
          </span>
          <span>{usdLabel(session.estimatedUsd || 0)}</span>
        </button>
      ))}
    </div>
  );
}

function DataQualityBudgetPanel({ quality, guardrails }) {
  const budgetLabels = {
    dailyTokens: "当天 Token",
    weeklyTokens: "近 7 天 Token",
    dailyCostUsd: "当天成本",
    weeklyCostUsd: "近 7 天成本",
  };
  const budgetRows = guardrails?.rows || [];
  return (
    <Paper className="mc-panel v2-panel token-assurance" radius="md" p={0}>
      <section className="token-assurance__quality">
        <PanelHeader
          eyebrow="CONFIDENCE"
          title="统计可信度"
          icon={IconGauge}
          tone={quality?.level === "high" ? "success" : quality?.level === "medium" ? "primary" : "accent"}
          action={<strong className={`token-assurance__score is-${quality?.level || "low"}`}>{formatNumber(quality?.score || 0)}</strong>}
        />
        <div className="token-assurance__metrics">
          <div><span>成本覆盖</span><strong>{percentLabel(quality?.costCoverage || 0)}</strong><i style={{ width: `${quality?.costCoverage || 0}%` }} /></div>
          <div><span>会话 Token 覆盖</span><strong>{percentLabel(quality?.sessionCoverage || 0)}</strong><i style={{ width: `${quality?.sessionCoverage || 0}%` }} /></div>
          <div><span>摘要复用率</span><strong>{percentLabel(quality?.cacheReuse || 0)}</strong><i style={{ width: `${quality?.cacheReuse || 0}%` }} /></div>
        </div>
        <div className="token-assurance__foot">
          <span>价格表 {quality?.pricingVersion || "builtin"}</span>
          <span>{quality?.unknownModels?.length ? `${quality.unknownModels.length} 个模型缺少价格` : "所有活跃模型均可估价"}</span>
        </div>
      </section>
      <section className="token-assurance__budgets">
        <PanelHeader
          eyebrow="GUARDRAILS"
          title="预算与效率提醒"
          icon={IconAlertTriangle}
          tone={guardrails?.alerts?.length ? "accent" : "success"}
          action={<span className="v2-panel-note">环境变量配置预算</span>}
        />
        <div className="token-budget-list">
          {budgetRows.map((row) => (
            <div key={row.key} className={`token-budget-row is-${row.state}`}>
              <span>{budgetLabels[row.key] || row.key}</span>
              <strong>{row.configured ? `${Math.round(row.percent)}%` : "未配置"}</strong>
              <i><b style={{ width: `${Math.min(100, row.percent || 0)}%` }} /></i>
            </div>
          ))}
          <div className={`token-budget-row is-${guardrails?.cacheState || "unconfigured"}`}>
            <span>缓存覆盖下限</span>
            <strong>{percentLabel(guardrails?.cacheCoverage || 0)} / {percentLabel(guardrails?.minimumCacheCoverage || 0)}</strong>
            <i><b style={{ width: `${Math.min(100, guardrails?.cacheCoverage || 0)}%` }} /></i>
          </div>
        </div>
      </section>
    </Paper>
  );
}

export function ObservabilityWorkspace({
  payload,
  view,
  activeOverview,
  codexUsagePayload,
  loading,
  onQueryCodexUsage,
  onRecalculate,
  onOpenConversation,
  onOpenSessionDetail,
  recalculating,
}) {
  const [usageMetric, setUsageMetric] = useState("tokens");
  const [tokenRangeKey, setTokenRangeKey] = useState("week");
  const summary = payload?.summary || {};
  const health = summary.health || {};
  const tokens = summary.tokens || {};
  const tools = summary.tools || {};
  const workspaces = summary.workspaces || {};
  const usageStats = summary.usageStats || null;
  const charts = summary.charts || {};
  const hourlyChart = charts.hourly || [];
  const dailyChart = charts.daily || [];
  const dailySessionHeatmap = charts.dailySessions || [];
  const tokenWindows = tokens.windows || { day: { total: 0, platforms: [] }, week: { total: 0, platforms: [] } };
  const activeTotal = Number(activeOverview?.total || 0);
  const activeWindowMinutes = activeOverview?.windowMinutes || 30;
  const newestActiveAge = activeOverview?.sessions?.[0]?.ageMs;
  const lastEventLabel = health.lastEventAt ? formatDateTime(health.lastEventAt) : "-";
  const todayActivity = dailySessionHeatmap.at(-1) || {};
  const inputSideTotal = inputSideToken(tokens) || finiteToken(tokens.input);
  const cacheCoverage = percentValue(cacheReadToken(tokens), inputSideTotal);
  const dailyTokenSpark = dailyChart.slice(-7).map((row) => row.tokens);
  const dailySessionSpark = dailySessionHeatmap.slice(-7).map((row) => row.sessions);
  const tokenRangeDays = tokenRangeKey === "today" ? 1 : tokenRangeKey === "month" ? 30 : 7;
  const fallbackTimeline = tokenRangeKey === "today"
    ? hourlyChart
    : dailyChart.slice(-tokenRangeDays);
  const fallbackRange = {
    key: tokenRangeKey,
    label: tokenRangeKey === "today" ? "当天" : tokenRangeKey === "month" ? "近 30 天" : "近 7 天",
    days: tokenRangeDays,
    startAt: fallbackTimeline[0]?.time,
    endAt: fallbackTimeline.at(-1)?.time,
    timelineGranularity: tokenRangeKey === "today" ? "hour" : "day",
    timeline: fallbackTimeline,
    history: { cachedHistoricalDays: Math.max(0, tokenRangeDays - 1) },
    health: { sessionsTotal: health.sessionsTotal || 0, activeDays: tokenRangeDays },
    tokens,
    peak: topBy(fallbackTimeline, (row) => row.tokens),
  };
  const selectedTokenRange = summary.tokenRanges?.[tokenRangeKey] || fallbackRange;
  const scopedTokens = selectedTokenRange.tokens || tokens;
  const scopedTokenCost = scopedTokens.cost || {};
  const scopedHealth = selectedTokenRange.health || health;
  const scopedTimeline = selectedTokenRange.timeline || fallbackTimeline;
  const overviewKpis = [
    {
      label: "今日会话",
      value: formatNumber(todayActivity.sessions || 0),
      meta: `${formatNumber(todayActivity.events || 0)} 事件 · ${todayActivity.label || "今日"}`,
      tone: "primary",
      sparkData: dailySessionSpark,
      sparkColor: "var(--accent)",
    },
    {
      label: "当前活跃",
      value: formatNumber(activeTotal),
      meta: activeTotal ? `最近写入 ${formatAgeText(newestActiveAge)}` : `窗口 ${formatNumber(activeWindowMinutes)} 分钟`,
      tone: activeTotal ? "success" : "default",
    },
    {
      label: "今日对话",
      value: formatNumber(usageStats?.today?.interactions || 0),
      meta: `${formatNumber(usageStats?.today?.prompts || 0)} 提问 · ${formatNumber(usageStats?.today?.agentMessages || 0)} Agent 消息`,
      tone: "primary",
      sparkData: dailyChart.slice(-7).map((row) => row.interactions),
      sparkColor: "var(--accent)",
    },
    {
      label: "今日 Token",
      value: tokenLabel(tokenWindows.day?.total || 0),
      meta: `输入 ${tokenLabel(inputSideToken(tokenWindows.day))} · 输出 ${tokenLabel(tokenWindows.day?.output || 0)}`,
      tone: "accent",
      sparkData: dailyTokenSpark,
      sparkColor: "var(--violet)",
    },
    {
      label: "今日成本",
      value: usdLabel(tokenWindows.day?.estimatedUsd || 0),
      meta: "按已识别模型价格估算",
      tone: "success",
      sparkData: dailyChart.slice(-7).map((row) => row.estimatedUsd),
      sparkColor: "var(--success)",
    },
    {
      label: "缓存覆盖",
      value: percentLabel(cacheCoverage),
      meta: `${tokenLabel(cacheReadToken(tokens))} 命中输入`,
    },
  ];
  const workspaceLabel = view === "tokens" ? "Token 账本工作台" : "运行总览工作台";
  const layout = view === "tokens" ? "token-ledger-v2" : "overview-pulse-v2";
  const trendIsCost = usageMetric === "cost";

  return (
    <Stack
      gap="md"
      className={`workspace-stack mc-workspace mc-workspace--${view} v2-workspace v2-workspace--${view}`}
      role="region"
      aria-label={workspaceLabel}
      aria-busy={loading || undefined}
      data-layout={layout}
    >
      {view === "overview" ? (
        <>
          <OverviewHealthBand
            runtime={payload?.runtime}
            sources={payload?.sources}
            index={payload?.index}
            generatedAt={payload?.generatedAt}
            health={health}
          />

          <CodexUsageBand
            usage={codexUsagePayload}
            codexVersion={payload?.runtime?.versions?.codex}
            onQuery={onQueryCodexUsage}
          />

          <div className="v3-section-caption">
            <span>TODAY</span>
            <strong>今日概览</strong>
            <em>会话、负载、Token 与缓存效率</em>
          </div>
          <section className="v2-overview-strip" aria-label="当前运行摘要">
            <OperationalKpiStrip rows={overviewKpis} />
          </section>

          <div className="v2-overview-primary">
            <ChartCard
              eyebrow="ACTIVITY"
              title="24 小时负载走势"
              icon={IconActivityHeartbeat}
              tone="primary"
              className="v2-panel v2-overview-activity"
              action={(
                <div className="v3-chart-legend">
                  <span><i className="is-events" />事件</span>
                  <span><i className="is-tokens" />Token</span>
                  <em>更新 {lastEventLabel}</em>
                </div>
              )}
            >
              <ActivityPulseChart
                data={hourlyChart}
                testId="overview-activity-chart"
                height={320}
                fillHeight
              />
            </ChartCard>

            <Paper className="mc-panel v2-panel v2-overview-live" radius="md" p="lg">
              <PanelHeader
                eyebrow="LIVE"
                title="正在写入的会话"
                icon={IconActivityHeartbeat}
                tone={activeTotal ? "success" : "default"}
                action={<Badge radius="sm" variant="light" color={activeTotal ? "teal" : "gray"}>{formatNumber(activeTotal)} 活跃</Badge>}
              />
              <ActiveSessionSnapshot
                overview={activeOverview}
                hourly={hourlyChart}
                onOpenSessionDetail={onOpenSessionDetail || onOpenConversation}
              />
            </Paper>
          </div>

          <UsageStatisticsBoard
            stats={usageStats}
            onOpenSessionDetail={onOpenSessionDetail || onOpenConversation}
          />

          <Paper className="mc-panel v2-panel v2-overview-heatmap" radius="md" p="lg">
            <PanelHeader
              eyebrow="HISTORY"
              title="一年会话活跃度"
              icon={IconClock}
              tone="success"
              action={<span className="v2-panel-note">可切换会话、对话、事件和 Token 指标</span>}
            />
            <DailySessionHeatmap data={dailySessionHeatmap} />
          </Paper>

          <Paper className="mc-panel v2-panel v2-overview-operations" radius="md" p={0}>
            <section className="v2-overview-operation v2-overview-operation--system">
              <PanelHeader eyebrow="SYSTEM" title="服务与数据源" icon={IconGauge} tone="success" />
              <SystemReadinessPanel
                runtime={payload?.runtime}
                sources={payload?.sources}
                index={payload?.index}
                generatedAt={payload?.generatedAt}
                health={health}
              />
              <div className="v2-overview-operation__density">
                <span>今日负载</span>
                <ActivityShapePanel hourly={hourlyChart} today={todayActivity} tokenWindow={tokenWindows.day} />
              </div>
            </section>

            <section className="v2-overview-operation v2-overview-operation--workspaces">
              <PanelHeader eyebrow="WORKSPACES" title="工作区负载" icon={IconDatabase} tone="primary" />
              <WorkspaceLoadPanel workspaces={workspaces} />
            </section>

            <section className="v2-overview-operation v2-overview-operation--tools">
              <PanelHeader eyebrow="TOOLS" title="工具调用结构" icon={IconTerminal2} tone="accent" />
              <ToolReliabilityPanel tools={tools} sessionsTotal={health.sessionsTotal} />
            </section>
          </Paper>
        </>
      ) : null}

      {view === "tokens" ? (
        <>
          <TokenRangeToolbar
            range={{ ...selectedTokenRange, cache: summary.cache }}
            value={tokenRangeKey}
            onChange={setTokenRangeKey}
            onRecalculate={onRecalculate}
            recalculating={recalculating}
          />

          <TokenLedgerPanel tokens={scopedTokens} tokenCost={scopedTokenCost} />

          <TokenEfficiencyStrip tokens={scopedTokens} tokenCost={scopedTokenCost} sessionsTotal={scopedHealth.sessionsTotal} />

          <DataQualityBudgetPanel quality={summary.dataQuality} guardrails={summary.guardrails} />

          <div className="v2-token-primary">
            <ChartCard
              eyebrow="TREND"
              title={`${selectedTokenRange.label}消耗趋势`}
              icon={IconChartBar}
              tone={trendIsCost ? "success" : "primary"}
              className="v2-panel v2-token-trend"
              action={(
                <div className="v3-token-trend-controls">
                  <SegmentedControl
                    size="xs"
                    radius="sm"
                    value={usageMetric}
                    onChange={setUsageMetric}
                    data={[
                      { label: "Token", value: "tokens" },
                      { label: "金额", value: "cost" },
                    ]}
                  />
                </div>
              )}
            >
              <MetricAreaChart
                data={scopedTimeline}
                valueKey={trendIsCost ? "estimatedUsd" : "tokens"}
                color={trendIsCost ? "teal.6" : "blue.6"}
                label={trendIsCost ? "金额" : "Token"}
                testId="token-trend-chart"
                height={260}
              />
            </ChartCard>

            <Paper className="mc-panel v2-panel v2-token-window-panel" radius="md" p="lg">
              <PanelHeader eyebrow="SCOPE" title="范围摘要" icon={IconClock} tone="primary" />
              <TokenRangeSummary range={selectedTokenRange} />
            </Paper>
          </div>

          <div className="v2-token-attribution">
            <Paper className="mc-panel v2-panel" radius="md" p="lg">
              <PanelHeader
                eyebrow="MODELS"
                title="模型成本归因"
                icon={IconCpu}
                tone="accent"
                action={<span className="v2-panel-note">{usdLabel(scopedTokenCost.estimatedUsd)} 范围估算</span>}
              />
              <ModelCostMatrixPanel tokens={scopedTokens} tokenCost={scopedTokenCost} />
            </Paper>

            <Paper className="mc-panel v2-panel" radius="md" p="lg">
              <PanelHeader eyebrow="WORKSPACES" title="工作区消耗归因" icon={IconRoute} tone="primary" />
              <TokenWorkspacePanel tokens={scopedTokens} />
            </Paper>
          </div>

          <Paper className="mc-panel v2-panel v2-token-sessions" radius="md" p="lg">
            <PanelHeader
              eyebrow="SESSIONS"
              title="高消耗会话"
              icon={IconActivityHeartbeat}
              tone="success"
              action={<span className="v2-panel-note">点击进入完整会话详情</span>}
            />
            <TokenSessionTable sessions={scopedTokens.topSessions} onOpenSessionDetail={onOpenSessionDetail || onOpenConversation} />
          </Paper>
        </>
      ) : null}
    </Stack>
  );
}
