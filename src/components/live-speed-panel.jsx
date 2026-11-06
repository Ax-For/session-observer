import { useMemo, useState } from "react";
import { useComputedColorScheme } from "@mantine/core";
import { useLiveSpeed } from "../hooks/use-live-speed";
import { ChartPlot } from "./data-chart";
import { PerformanceScorePanel } from "./performance-score-panel";
import { usePerformanceBaseline } from "../hooks/use-performance-baseline";
import "../styles/live-speed.css";

const rate = (value) => Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const phaseNames = { generating: "生成中", tools: "工具执行", idle: "空闲" };
const statusNames = { connecting: "正在连接", connected: "实时连接", reconnecting: "连接中断 · 重连中", paused: "已暂停显示" };

export function liveSpeedOptions(history, dark = false) {
  const text = dark ? "#b0b7c4" : "#737d8c";
  return {
    animation: false,
    textStyle: { fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", fontSize: 11, color: text },
    grid: { left: 42, right: 12, top: 20, bottom: 26 },
    tooltip: { trigger: "axis", renderMode: "richText", confine: true, valueFormatter: (v) => `${rate(v)} tok/s` },
    xAxis: { type: "category", boundaryGap: false, data: history.map((r) => new Date(r.time).toLocaleTimeString("zh-CN", { hour12: false })),
      axisLabel: { color: text, interval: 59, hideOverlap: true }, axisLine: { show: false }, axisTick: { show: false } },
    yAxis: { type: "value", min: 0, minInterval: 1, splitNumber: 2, axisLabel: { color: text },
      splitLine: { lineStyle: { color: dark ? "#303743" : "#e8ecf1", type: "dashed" } } },
    series: [
      { id: "measured", name: "实测", type: "line", stack: "speed", symbol: "none", lineStyle: { width: 1.5 }, itemStyle: { color: "#4774ce" }, areaStyle: { opacity: 0.12 }, data: history.map((r) => r.measured) },
      { id: "estimated", name: "估算", type: "line", stack: "speed", symbol: "none", lineStyle: { width: 1.5, type: "dashed" }, itemStyle: { color: dark ? "#a8b8dd" : "#8b9bbd" }, areaStyle: { opacity: 0.08 }, data: history.map((r) => r.estimated) },
    ],
  };
}

export function LiveSpeedView({ data, status, onOpenSessionDetail, baseline, onRefreshBaseline, baselineError }) {
  const [showIdle, setShowIdle] = useState(false);
  const dark = useComputedColorScheme("light") === "dark";
  const history = data?.history || [];
  const option = useMemo(() => liveSpeedOptions(data?.history || [], dark), [data?.history, dark]);
  const fresh = status === "connected" && !data?.monitor?.warming;
  const total = (data?.measured || 0) + (data?.estimated || 0);
  const unknownOnly = data?.unknown > 0 && total === 0;
  const rows = (data?.agents || []).filter((a) => showIdle || a.phase !== "idle");
  const peak = Math.max(0, ...history.map((r) => r.measured + r.estimated));
  const limited = data?.monitor && (data.monitor.skippedLines || data.monitor.omittedFiles || data.monitor.readErrors || data.evictedResponses);
  return <section className="live-speed" aria-label="实时速度监测" data-testid="live-speed-panel">
    <header className="live-speed__header">
      <div><h2>实时速度</h2><p>全部本地会话 · 3 秒窗口 · 每秒更新</p></div>
      <span className={`live-speed__connection ${fresh ? "is-live" : ""}`} role="status"><i />{data?.monitor?.warming ? "正在读取近期日志" : statusNames[status]}</span>
    </header>
    <div className="live-speed__body">
      <div className="live-speed__throughput">
        <div className="live-speed__metrics">
          <div className="live-speed__current"><span>当前输出</span><div><strong data-testid="live-speed-total">{!fresh || unknownOnly ? "—" : rate(total)}</strong><em>tok/s</em></div>
            <p>{unknownOnly ? "等待可测量的响应" : data?.unknown ? `${data.unknown} 个会话待测速 · 当前为已知部分` : `实测 ${rate(data?.measured)} · 估算 ${rate(data?.estimated)}`}</p></div>
          <dl className="live-speed__sources">{["codex", "claude"].map((key) => {
            const source = data?.sources?.find((s) => s.sourceType === key);
            const value = (source?.measured || 0) + (source?.estimated || 0);
            return <div key={key}><dt><i className={`is-${key}`} />{key === "codex" ? "Codex" : "Claude Code"}</dt>
              <dd>{fresh && !(source?.unknown && value === 0) ? rate(value) : "—"}<small> tok/s</small></dd></div>;
          })}</dl>
        </div>
        <div className="live-speed__chart-head"><span>近 5 分钟</span><div><span><i />实测</span><span><i className="is-estimated" />估算</span><span>峰值 {rate(peak)} tok/s</span></div></div>
        <ChartPlot option={option} height={142} label="近五分钟输出速度，实测与估算分开显示" />
      </div>
      <div className="live-speed__sessions">
        <div className="live-speed__session-head"><h3>会话状态 <span>{data?.generating || 0} 生成 · {data?.tools || 0} 工具</span></h3>
          <label><input type="checkbox" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} />显示空闲</label></div>
        <div className="live-speed__list">
          {rows.length ? rows.map((row) => <button key={row.id} className="live-speed__session" onClick={() => onOpenSessionDetail?.(row)} aria-label={`查看会话 ${row.title}`}>
            <span className="live-speed__identity"><strong title={row.title}>{row.parentSessionId ? "↳ " : ""}{row.title === row.sessionId ? row.project : row.title}</strong><span title={`${row.project} · ${row.model}`}>{row.sourceType === "codex" ? "Codex" : "Claude"} · {row.project} · {row.model}{row.parentSessionId ? " · 子 Agent" : ""}</span></span>
            <span className={`live-speed__phase is-${row.phase}`}>{phaseNames[row.phase]}</span>
            <span className="live-speed__row-rate">{!fresh || row.unknown ? "待测速" : `${row.estimated > 0 ? "≈ " : ""}${rate(row.measured + row.estimated)}`}<small>{fresh && !row.unknown ? "tok/s" : ""}</small></span>
          </button>) : <div className="live-speed__empty">{fresh ? "当前没有正在生成或执行工具的会话" : "等待实时日志连接"}<span>{fresh ? "启动 Codex 或 Claude Code 后，这里会自动更新。" : "连接恢复后自动继续监测。"}</span></div>}
        </div>
      </div>
    </div>
    <PerformanceScorePanel live={data} baseline={baseline} fresh={fresh} onRefresh={onRefreshBaseline} error={baselineError} />
    <footer className="live-speed__footer"><span>日志间隔测速，包含首段等待；子 Agent 独立计数。</span><details><summary>测速口径{limited ? " · 部分日志未覆盖" : ""}</summary><p>实测将已完成响应的输出 Token 分摊到请求区间；估算使用该会话最近 3 次响应，其次参考同模型、同平台样本。响应完成后用实测替换估算。没有样本时显示待测速。超过 5 分钟无新事件视为空闲。</p><p>读取最近 30 分钟内写入的最多 {data?.monitor?.maxFiles || 64} 个日志，每个从末尾 1 MiB 开始恢复；因此曲线可能不完整。当前跟踪 {data?.monitor?.trackedFiles || 0} 个文件，可测响应 {data?.measuredResponses || 0}，未测响应 {data?.unmeasuredResponses || 0}。{limited ? `跳过记录 ${data.monitor.skippedLines}，未跟踪文件 ${data.monitor.omittedFiles}，读取错误 ${data.monitor.readErrors}。` : ""}</p></details></footer>
  </section>;
}

export function LiveSpeedPanel({ onOpenSessionDetail }) {
  const state = useLiveSpeed();
  const baseline = usePerformanceBaseline(state.data?.performanceBaseline?.generatedAt, state.data?.performanceBaseline?.status);
  return <LiveSpeedView {...state} onOpenSessionDetail={onOpenSessionDetail} baseline={baseline.data} onRefreshBaseline={baseline.refresh} baselineError={baseline.requestError} />;
}
