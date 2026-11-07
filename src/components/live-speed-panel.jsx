import { useId, useMemo, useState } from "react";
import { useComputedColorScheme } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import responsePerformance from "../../shared/response-performance.js";
import { useLiveSpeed } from "../hooks/use-live-speed";
import { ChartPlot } from "./data-chart";
import { PerformanceScorePanel } from "./performance-score-panel";
import { usePerformanceBaseline } from "../hooks/use-performance-baseline";
import { modeEvidence, modeLabel } from "../lib/execution-mode-labels";
import { PLATFORM_OPTIONS, platformLabel } from "../lib/formatters";
import "../styles/live-speed.css";

const { DEFAULT_HISTORY_MINUTES, LIVE_HISTORY_MINUTES } = responsePerformance;
const EMPTY_HISTORY = [];
const rate = (value) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const formatRate = (metric, value) => metric !== "cost" ? rate(value)
  : value > 0 && value < 0.000001 ? "<0.000001" : usd.format(value);
const metrics = {
  output: { label: "当前输出", name: "输出速度", unit: "tok/s", detail: "输出 Token", id: "live-speed-total" },
  total: { label: "总吞吐", name: "总吞吐", unit: "tok/s", detail: "输入＋输出", id: "live-speed-throughput" },
  reasoning: { label: "推理速度", name: "推理速度", unit: "tok/s", detail: "输出中的推理 Token", id: "live-speed-reasoning" },
  cost: { label: "每秒费用", name: "每秒费用", unit: "USD/s", detail: "按日志金额与本地价格估算", id: "live-speed-cost" },
};
const phaseNames = { generating: "生成中", tools: "工具执行", idle: "空闲" };
const statusNames = { connecting: "正在连接", connected: "实时连接", reconnecting: "连接中断 · 重连中", paused: "已暂停显示" };

const metricRates = (data, metric) => metric === "output" ? data : data?.rates?.[metric];
const sum = (values) => (values?.measured || 0) + (values?.estimated || 0);

function currentRate(row, metric, fresh) {
  const values = metricRates(row, metric);
  if (!fresh || !values || values.available === false) return null;
  const value = sum(values);
  return row.unknown > 0 && value === 0 ? null : value;
}

function readoutDetail(data, metric, fresh) {
  const { detail } = metrics[metric];
  if (!fresh) return detail;
  const values = metricRates(data, metric);
  if (values?.available === false) return metric === "cost" ? "缺少模型价格" : "缺少推理 Token 记录";
  if (values?.partial) {
    if (metric === "reasoning") return "部分响应缺少推理 Token";
    const percent = Math.floor(values.knownShare * 100);
    return percent < 100 ? `已计价 ${percent}% 输出` : "部分请求缺价";
  }
  if (data.unknown) {
    if (currentRate(data, metric, fresh) == null) return metric === "output" ? "等待可测量的响应" : "等待测速样本";
    return `${Number(data.unknown)} 个会话待测速 · 仅已知部分`;
  }
  if (metric === "output") return `实测 ${rate(values?.measured)} · 估算 ${rate(values?.estimated)}`;
  if (metric === "cost" && values?.estimated > 0) return "含进行中估算";
  return values?.estimated > 0 ? `${detail} · 含进行中估算` : detail;
}

function seriesNames(metric) {
  return metric === "cost" ? ["已完成", "进行中"] : ["实测", "估算"];
}

export function liveSpeedOptions(history, dark = false, metric = "output") {
  const text = dark ? "#b0b7c4" : "#737d8c";
  const [measured, estimated] = seriesNames(metric);
  const seriesData = (key) => history.map((bucket) => {
    const values = metricRates(bucket, metric);
    return values?.available === false ? null : values?.[key] ?? null;
  });
  return {
    animation: false,
    textStyle: { fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", fontSize: 11, color: text },
    grid: { left: metric === "cost" ? 70 : 49, right: 12, top: 20, bottom: 26 },
    tooltip: { trigger: "axis", renderMode: "richText", confine: true,
      valueFormatter: (v) => typeof v === "number" ? `${formatRate(metric, v)} ${metrics[metric].unit}` : "—" },
    xAxis: { type: "category", boundaryGap: false, data: history.map((r) => new Date(r.time).toLocaleTimeString("zh-CN", { hour12: false })),
      axisLabel: { color: text, interval: Math.max(0, Math.floor(history.length / 5) - 1), hideOverlap: true },
      axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "value", min: 0, minInterval: metric === "cost" ? 0.000001 : 1, splitNumber: 2,
      axisLabel: { color: text, ...(metric === "cost" ? { formatter: (v) => formatRate(metric, v) } : {}) },
      splitLine: { lineStyle: { color: dark ? "#303743" : "#e8ecf1", type: "dashed" } } },
    series: [
      { id: "measured", name: measured, type: "line", stack: "speed", symbol: "none", lineStyle: { width: 1.5 }, itemStyle: { color: "#4774ce" }, areaStyle: { opacity: 0.12 }, data: seriesData("measured") },
      { id: "estimated", name: estimated, type: "line", stack: "speed", symbol: "none", lineStyle: { width: 1.5, type: "dashed" }, itemStyle: { color: dark ? "#a8b8dd" : "#8b9bbd" }, areaStyle: { opacity: 0.08 }, data: seriesData("estimated") },
    ],
  };
}

export function LiveSpeedView({ data, status, historyMinutes = DEFAULT_HISTORY_MINUTES, onHistoryChange,
  onOpenSessionDetail, baseline, onRefreshBaseline, baselineError }) {
  const [showIdle, setShowIdle] = useState(false);
  const [metric, setMetric] = useState("output");
  const metricGroup = useId();
  const dark = useComputedColorScheme("light") === "dark";
  const receivedMinutes = (data?.historyWindowMs ?? DEFAULT_HISTORY_MINUTES * 60_000) / 60_000;
  const changingRange = receivedMinutes !== historyMinutes;
  const history = changingRange ? EMPTY_HISTORY : data?.history || EMPTY_HISTORY;
  const option = useMemo(() => liveSpeedOptions(history, dark, metric), [history, dark, metric]);
  const fresh = status === "connected" && Boolean(data) && !data.monitor?.warming;
  const selected = metrics[metric];
  const [measuredLabel, estimatedLabel] = seriesNames(metric);
  const sessionMetric = metric === "cost" ? "output" : metric;
  const rows = (data?.agents || []).filter((a) => showIdle || a.phase !== "idle");
  const peak = metric === "output" || metric === "total" ? Math.max(0, ...history.map((r) => sum(metricRates(r, metric)))) : null;
  const limited = data?.monitor && (data.monitor.skippedLines || data.monitor.omittedFiles || data.monitor.readErrors || data.evictedResponses);
  return <section className="live-speed" aria-label="实时速度监测" data-testid="live-speed-panel">
    <header className="live-speed__header">
      <div><h2>实时速度</h2><p>全部本地会话 · 3 秒窗口 · 每秒更新</p></div>
      <span className={`live-speed__connection ${fresh ? "is-live" : ""}`} role="status"><i />{data?.monitor?.warming ? "正在读取近期日志" : statusNames[status]}</span>
    </header>
    <div className="live-speed__readouts" role="radiogroup" aria-label="实时指标">
      {Object.entries(metrics).map(([key, item]) => {
        const value = currentRate(data, key, fresh);
        return <label key={key} className={`live-speed__readout${metric === key ? " is-selected" : ""}`}>
          <input type="radio" name={metricGroup} value={key} checked={metric === key} aria-label={item.label} onChange={() => setMetric(key)} />
          <span className="live-speed__readout-label">{item.label}</span>
          <span className="live-speed__readout-value"><strong data-testid={item.id}>{value == null ? "—" : formatRate(key, value)}</strong><small>{item.unit}</small></span>
          <span className="live-speed__readout-detail">{readoutDetail(data, key, fresh)}</span>
        </label>;
      })}
    </div>
    <div className="live-speed__body">
      <div className="live-speed__throughput">
        <dl className="live-speed__sources" aria-label={`按来源的${selected.name}`}>{PLATFORM_OPTIONS.map(({ value: key, label }) => {
          const source = data?.sources?.find((s) => s.sourceType === key);
          const value = currentRate(source, metric, fresh);
          return <div key={key}><dt><i className={`is-${key}`} />{label}</dt>
            <dd title={source && readoutDetail(source, metric, fresh)}>{value == null ? "—" : formatRate(metric, value)}<small> {selected.unit}</small></dd></div>;
        })}</dl>
        <div className="live-speed__chart-head">
          <div className="live-speed__chart-title">
            <span>{selected.name}趋势</span>
            <select aria-label="趋势时间范围" value={historyMinutes} onChange={(event) => onHistoryChange?.(Number(event.currentTarget.value))}>
              {LIVE_HISTORY_MINUTES.map((minutes) => <option key={minutes} value={minutes}>近 {minutes} 分钟</option>)}
            </select>
          </div>
          <div className="live-speed__chart-legend">
            {changingRange ? <span>正在加载趋势</span> : <>
              {data?.historyBucketMs && <span title="每个数据点按所在区间取平均">每点 {data.historyBucketMs / 1000} 秒</span>}
              <span><i />{measuredLabel}</span><span><i className="is-estimated" />{estimatedLabel}</span>
              {peak != null && <span title="所选范围内单个数据点的最高值">峰值 {rate(peak)}</span>}
            </>}
          </div>
        </div>
        <ChartPlot option={option} height={142} label={`近 ${historyMinutes} 分钟${selected.name}趋势`} />
      </div>
      <div className="live-speed__sessions">
        <div className="live-speed__session-head"><div><h3>会话状态 <span>{data?.generating || 0} 生成 · {data?.tools || 0} 工具</span></h3>
          <p>{metrics[sessionMetric].name} · tok/s</p></div>
          <label><input type="checkbox" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} />显示空闲</label></div>
        <div className="live-speed__list">
          {rows.length ? rows.map((row) => {
            const value = currentRate(row, sessionMetric, fresh);
            const estimated = metricRates(row, sessionMetric)?.estimated > 0;
            return <button key={row.id} className="live-speed__session" onClick={() => onOpenSessionDetail?.(row)} aria-label={`查看会话 ${row.title}`}>
              <span className="live-speed__identity">
                <strong title={row.title}>{row.parentSessionId ? "↳ " : ""}{row.title === row.sessionId ? row.project : row.title}</strong>
                <span title={`${row.project} · ${row.model}`}>{platformLabel(row.sourceType)} · {row.project} · {row.model}{row.parentSessionId ? " · 子 Agent" : ""}</span>
                {fresh && (row.modes?.tier || row.modes?.effort) && <span className="live-speed__modes" title={[["档位", row.modes.tier], ["推理强度", row.modes.effort]].map(([kind, mode]) => `${kind}：${mode ? `${modeLabel(mode.value)} · ${modeEvidence(mode.evidence)}` : "未知"}`).join("；")}>
                  {[row.modes.tier, row.modes.effort].filter(Boolean).map((mode) => `${modeLabel(mode.value)}（${modeEvidence(mode.evidence)}）`).join(" · ")}
                </span>}
              </span>
              <span className={`live-speed__phase is-${row.phase}`}>{phaseNames[row.phase]}</span>
              <span className="live-speed__row-rate" title={readoutDetail(row, sessionMetric, fresh)}>
                {value == null ? "—" : `${estimated ? "≈ " : ""}${rate(value)}`}<small>{value == null ? "" : "tok/s"}</small>
              </span>
            </button>;
          }) : <div className="live-speed__empty">{fresh ? "当前没有正在生成或执行工具的会话" : "等待实时日志连接"}<span>{fresh ? "会话日志写入后，这里会自动更新。" : "连接恢复后自动继续监测。"}</span></div>}
        </div>
      </div>
    </div>
    <PerformanceScorePanel live={data} baseline={baseline} fresh={fresh} onRefresh={onRefreshBaseline} error={baselineError} />
    <footer className="live-speed__footer">
      <span>日志间隔测速，包含首段等待。子 Agent 独立计数。</span>
      <details>
        <summary>测速口径{limited ? " · 部分日志未覆盖" : ""}</summary>
        <p>实测将已完成响应的用量分摊到请求区间。进行中的请求参考该会话最近 3 次响应，再回退到同模型或同平台样本。响应完成后用实测替换估算。超过 5 分钟无新事件视为空闲。</p>
        <p>总吞吐合计输入与输出，推理 Token 已计入输出。费用优先使用日志金额，再按本地价格表估算。缺少推理用量或价格时显示有记录的部分。</p>
        <p>读取最近 30 分钟内写入的最多 {data?.monitor?.maxFiles || 64} 个日志，每个从末尾 1 MiB 开始恢复。当前跟踪 {data?.monitor?.trackedFiles || 0} 个文件，可测响应 {data?.measuredResponses || 0}，未测响应 {data?.unmeasuredResponses || 0}。{limited ? `跳过记录 ${data.monitor.skippedLines}，未跟踪文件 ${data.monitor.omittedFiles}，读取错误 ${data.monitor.readErrors}。` : ""}</p>
      </details>
    </footer>
  </section>;
}

export function LiveSpeedPanel({ onOpenSessionDetail }) {
  const [preferredMinutes, setPreferredMinutes] = useLocalStorage({
    key: "observer-live-history-minutes", defaultValue: DEFAULT_HISTORY_MINUTES, getInitialValueInEffect: false,
  });
  const historyMinutes = LIVE_HISTORY_MINUTES.includes(preferredMinutes) ? preferredMinutes : DEFAULT_HISTORY_MINUTES;
  const state = useLiveSpeed(true, historyMinutes);
  const baseline = usePerformanceBaseline(state.data?.performanceBaseline?.generatedAt, state.data?.performanceBaseline?.status);
  return <LiveSpeedView {...state} historyMinutes={historyMinutes} onHistoryChange={setPreferredMinutes}
    onOpenSessionDetail={onOpenSessionDetail} baseline={baseline.data} onRefreshBaseline={baseline.refresh} baselineError={baseline.requestError} />;
}
