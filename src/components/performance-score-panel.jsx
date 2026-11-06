import { useMemo, useState } from "react";
import { useComputedColorScheme } from "@mantine/core";
import { ChartPlot } from "./data-chart";

const LABELS = { T: "输出吞吐", L: "首段延迟", N: "工具节奏", R: "推理吞吐", H: "缓存命中", U: "工具耗时", S: "工具成功率" };
const WEIGHTS = { T: "30%", L: "20%", N: "15%", R: "10%", H: "10%", U: "10%", S: "5%" };
const number = (v, digits = 0) => Number(v).toLocaleString("zh-CN", { maximumFractionDigits: digits });
const platform = (v) => v === "codex" ? "Codex" : "Claude Code";
const measure = (row) => row.id === "H" || row.id === "S" ? `${number(row.measure * 100, 1)}%`
  : row.id === "L" || row.id === "U" ? `${number(row.measure)} ms`
    : `${number(row.measure, 1)} ${row.id === "N" ? "次/分" : "tok/s"}`;

export function PerformanceScorePanel({ live, baseline, fresh, onRefresh, error }) {
  const [selected, setSelected] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const dark = useComputedColorScheme("light") === "dark";
  const agents = live?.agents || [];
  const agent = agents.find((a) => a.id === selected) || agents.find((a) => a.id === live?.performance?.agentId) || agents[0];
  const perf = agent?.performance;
  const comparable = baseline?.today === live?.performanceBaseline?.today && baseline?.generatedAt != null;
  const ownBaseline = comparable ? baseline.models?.find((row) => row.sourceType === agent?.sourceType && row.model === (perf?.model || "")) : null;
  const baseScore = ownBaseline?.score;
  const delta = fresh && perf?.score != null && baseScore != null ? perf.score / baseScore - 1 : null;
  const baselineRows = baseline?.models || [];
  const historyRow = baselineRows.find((r) => `${r.sourceType}|${r.model}` === selectedModel) || ownBaseline || baselineRows[0];
  const option = useMemo(() => ({
    animation: false, grid: { left: 45, right: 15, top: 14, bottom: 26 },
    tooltip: { trigger: "axis", renderMode: "richText", confine: true, valueFormatter: (v) => v == null ? "样本不足" : number(v) },
    xAxis: { type: "category", data: (historyRow?.trend || []).map((r) => r.day.slice(5)), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: dark ? "#b0b7c4" : "#737d8c", fontSize: 10 } },
    yAxis: { type: "value", min: 0, splitNumber: 2, axisLabel: { color: dark ? "#b0b7c4" : "#737d8c", fontSize: 10 }, splitLine: { lineStyle: { color: dark ? "#303743" : "#e8ecf1", type: "dashed" } } },
    series: [{ id: "baseline", type: "line", name: "每日综合分", connectNulls: false, symbolSize: 5, lineStyle: { width: 1.5 }, itemStyle: { color: "#4774ce" }, data: (historyRow?.trend || []).map((r) => r.score) }],
  }), [historyRow, dark]);
  const coverage = baseline?.coverage;
  const partial = coverage && (coverage.skippedLines || coverage.failedFiles || coverage.partialFiles);
  return <section className="performance-score" aria-label="综合性能评分" data-testid="performance-score-panel">
    <div className="performance-score__head"><div><h3>综合性能 <span>1000 为固定参考 · 衡量执行效率</span></h3>
      {baseline?.status === "error" || error ? <p className="performance-score__error">基线更新失败{baseline?.generatedAt ? " · 当前显示缓存值" : ""}</p>
        : baseline?.status === "loading" ? <p>历史基线更新中{baseline.generatedAt ? " · 当前显示缓存值" : ""}</p>
          : partial ? <p>部分历史记录未计入，详见指标与历史基线。</p> : null}</div>
      <select aria-label="评分会话" value={agent?.id || ""} onChange={(e) => setSelected(e.target.value)} disabled={!agents.length}>
        {!agents.length ? <option value="">暂无会话</option> : agents.map((a) => <option key={a.id} value={a.id}>{a.id === live?.performance?.agentId ? "最高分 · " : ""}{platform(a.sourceType)} · {a.title === a.sessionId ? a.project : a.title}</option>)}
      </select></div>
    <div className="performance-score__summary">
      <div><span>当前综合分{perf?.form === "resting" ? " · 空闲" : ""}</span><strong data-testid="performance-current">{fresh && perf?.shown != null ? number(perf.shown) : "—"}</strong><small>{perf?.n >= 3 ? `${perf.n} 次有效响应${perf.provisional ? " · 暂定评分" : ""}` : `样本不足 · ${perf?.n || 0} / 3 次有效响应`}</small></div>
      <div><span>同平台 / 模型的 14 天基线</span><strong data-testid="performance-baseline">{baseScore != null ? number(Math.round(baseScore)) : "—"}</strong><small>{baseline?.status === "loading" && !baseline.generatedAt ? "正在扫描历史日志" : baseScore == null ? `样本不足 · ${ownBaseline?.n || 0} / 20 次有效响应` : `${number(ownBaseline.n)} 次响应 · ${ownBaseline.days} 天有样本`}</small></div>
      <div><span>相比平常</span><strong className={delta > 0 ? "is-above" : delta < 0 ? "is-below" : ""} data-testid="performance-comparison">{delta == null ? "—" : `${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.floor(Math.abs(delta * 100) + 0.5)}%`}</strong><small>{perf?.model || "等待模型样本"}</small></div>
    </div>
    <details className="performance-score__details"><summary>查看 7 项指标与历史基线</summary>
      <div className="performance-score__detail-grid">
        <div><h4>当前评分组成</h4><table><thead><tr><th>指标</th><th>权重</th><th>测量值</th><th>分项分</th><th>样本</th></tr></thead><tbody>
          {(perf?.components || Object.keys(LABELS).map((id) => ({ id, present: false, samples: 0 }))).map((row) => <tr key={row.id}><td>{LABELS[row.id]}</td><td>{WEIGHTS[row.id]}</td><td>{row.present ? measure(row) : "样本不足"}</td><td>{row.present ? number(row.subScore) : "—"}</td><td>{row.samples}</td></tr>)}
        </tbody></table><p>最近 30 分钟内最新 20 次有效响应；缺少的指标不参与加权。3–9 次样本标记为暂定评分。</p></div>
        <div><div className="performance-score__history-head"><h4>14 天模型基线</h4><button type="button" onClick={onRefresh} disabled={!onRefresh || baseline?.status === "loading"}>{baseline?.status === "loading" ? "更新中…" : baseline?.status === "error" || error ? "重试更新" : "更新基线"}</button></div>
          <p>{baseline?.firstDay ? `${baseline.firstDay} — ${baseline.lastDay} · ${baseline.timezone}` : "前 14 个完整自然日，不包含今天"}</p>
          {error || baseline?.error ? <p className="performance-score__error" role="alert">{error || baseline.error}</p> : null}
          <select aria-label="历史基线模型" value={historyRow ? `${historyRow.sourceType}|${historyRow.model}` : ""} onChange={(e) => setSelectedModel(e.target.value)} disabled={!baselineRows.length}>
            {!baselineRows.length ? <option value="">暂无历史模型样本</option> : baselineRows.map((r) => <option key={`${r.sourceType}|${r.model}`} value={`${r.sourceType}|${r.model}`}>{platform(r.sourceType)} · {r.model || "未知模型"} · {r.score == null ? "样本不足" : `${number(Math.round(r.score))} 分`} · {r.n} 次</option>)}
          </select>
          {historyRow ? <ChartPlot option={option} height={122} label="14 天每日综合性能，少于 20 次响应的日期留空" /> : <div className="performance-score__history-empty">历史有效响应达到 20 次后建立基线。</div>}
          <p>每日少于 20 次响应时曲线留空；14 天基线由全部样本合并计算，非每日分数平均。</p>
          <p>{coverage ? `${coverage.scanned + coverage.cached} / ${coverage.files} 个日志已处理${partial ? ` · 跳过 ${coverage.skippedLines} 行，${coverage.failedFiles} 个文件失败，${coverage.partialFiles} 个文件末行未完成` : ""}` : "首次扫描后自动缓存，每 10 分钟及跨日更新。"}</p>
        </div>
      </div><p className="performance-score__calibration">采用 agent-speed 的固定权重与参考值，源自其作者的个人日志校准，不是行业标准或回答质量评分。总览默认选择最高的非空闲会话分数，未对多个 Agent 求和。</p>
    </details>
  </section>;
}
