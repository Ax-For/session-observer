import { useMemo, useState } from "react";
import { Button, SegmentedControl, useComputedColorScheme } from "@mantine/core";
import { IconDownload, IconRefresh } from "@tabler/icons-react";
import { ChartPlot } from "./data-chart";
import { apiClient } from "../api/client";
import { useDailyHistory } from "../hooks/use-daily-history";
import { downloadBlob, formatDateTime, formatHumanNumber, formatNumber, PLATFORM_OPTIONS } from "../lib/formatters";
import { modeEvidence, modeLabel } from "../lib/execution-mode-labels";
import "../styles/daily-history.css";

const fmt = (value) => formatNumber(value || 0);
const speed = (value) => value == null ? "—" : Number(value).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const cost = (row) => row.pricedRequests ? `$${Number(row.estimatedUsd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : "—";
const metricTitle = { tokens: "总 Token", speed: "平均输出速度", score: "综合分" };

function dateShift(day, offset) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function HistoryPlot({ days, metric }) {
  const dark = useComputedColorScheme("light") === "dark";
  const option = useMemo(() => {
    const values = days.slice().reverse().map((row) => ({ day: row.day, value: metric === "tokens" ? row.input + row.output : metric === "speed" ? row.outputTokS : row.score }));
    const rows = values.flatMap((row, i) => i && dateShift(values[i - 1].day, 1) < row.day ? [{ day: "", value: null }, row] : [row]);
    const color = dark ? "#8ca8ff" : "#315ad8", muted = dark ? "#b0b7c4" : "#606979";
    return { animation: false, grid: { left: 52, right: 18, top: 14, bottom: 25 },
      tooltip: { trigger: "axis", renderMode: "richText", confine: true, valueFormatter: (value) => value == null ? "—" : metric === "speed" ? `${speed(value)} tok/s` : fmt(value) },
      xAxis: { type: "category", data: rows.map((row) => row.day), axisLabel: { color: muted, hideOverlap: true, formatter: (day) => day.slice(5) }, axisTick: { show: false }, axisLine: { show: false } },
      yAxis: { type: "value", min: 0, splitNumber: 3, axisLabel: { color: muted, formatter: formatHumanNumber }, splitLine: { lineStyle: { color: dark ? "#32363f" : "#e6e8ed", type: "dashed" } } },
      series: [{ id: "history", name: metricTitle[metric], type: metric === "tokens" ? "bar" : "line", data: rows.map((row) => row.value),
        itemStyle: { color }, barMaxWidth: 28, symbolSize: 5, connectNulls: false, lineStyle: { width: 1.5 } }],
    };
  }, [days, metric, dark]);
  return <ChartPlot option={option} height={176} label={`本页${metricTitle[metric]}趋势`} />;
}

function DailyTable({ days, hasScore }) {
  return <table className="usage-history__table" aria-label="每日用量明细">
    <thead><tr><th scope="col">日期</th><th scope="col">请求</th><th scope="col">输入</th><th scope="col">缓存读取</th>
      <th scope="col">输出</th><th scope="col">平均输出 tok/s</th><th scope="col">费用估算</th>{hasScore && <th scope="col">综合分</th>}</tr></thead>
    <tbody>{days.map((row) => <tr key={row.day}>
      <th scope="row"><time dateTime={row.day}>{row.day}</time></th>
      <td title={row.unfinalized ? `${row.unfinalized} 次响应尚未结束` : undefined}>{fmt(row.requests)}{row.unfinalized > 0 && <sup>*</sup>}</td>
      <td>{fmt(row.input)}</td><td>{fmt(row.cachedInput)}</td><td>{fmt(row.output)}</td>
      <td title={`${fmt(row.measured)} 次可测速响应`}>{speed(row.outputTokS)}</td>
      <td title={`${fmt(row.pricedRequests)} / ${fmt(row.requests)} 次请求可计价`}>{cost(row)}</td>
      {hasScore && <td data-testid="history-day-score">{row.score == null ? "—" : fmt(row.score)}</td>}
    </tr>)}</tbody>
  </table>;
}

function ModeTable({ modes, exportModes, disabled }) {
  return <details className="usage-history__modes">
    <summary>执行档位与推理强度</summary>
    <div className="usage-history__mode-head"><p>按所选范围汇总。每个请求分别计入档位和推理强度。</p>
      <Button size="xs" variant="default" onClick={exportModes} disabled={disabled}>导出模式 CSV</Button></div>
    <div className="usage-history__mode-grid">{[["tier", "执行档位"], ["effort", "推理强度"]].map(([kind, label]) => <div key={kind}>
      <h3>{label}</h3><table className="usage-history__table" aria-label={label}><thead><tr><th scope="col">模式</th><th scope="col">依据</th>
        <th scope="col">请求</th><th scope="col">平均 tok/s</th></tr></thead><tbody>{modes.filter((row) => row.kind === kind).map((row) => (
        <tr key={`${row.value}:${row.evidence}`}><th scope="row">{modeLabel(row.value)}</th><td>{modeEvidence(row.evidence)}</td><td>{fmt(row.requests)}</td><td>{speed(row.outputTokS)}</td></tr>
      ))}</tbody></table></div>)}</div>
  </details>;
}

export function DailyHistoryPanel() {
  const [filters, setFilters] = useState({});
  const [draft, setDraft] = useState({});
  const [metric, setMetric] = useState("tokens");
  const [filterError, setFilterError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const { data, status, loading, refreshing, refresh, retry, requestError, refreshError } = useDailyHistory(filters);
  const range = data?.range || filters;
  const values = { from: range.from || "", to: range.to || "", source: range.source || "", model: range.model || "", ...draft };
  const hasScore = Boolean(range.source && range.model);
  const shownMetric = hasScore || metric !== "score" ? metric : "tokens";
  const scan = data?.scan;
  const totals = data?.totals;
  const stats = scan?.coverage;
  const pendingFilters = Object.keys(draft).some((key) => draft[key] !== range[key]);
  const exportDisabled = exporting || !totals?.requests || loading || pendingFilters;
  const models = [...new Set([values.model, ...(data?.models || [])].filter(Boolean))];
  const error = filterError || exportError || refreshError;

  function updateDraft(patch) {
    setDraft((value) => ({ ...value, ...patch }));
    setFilterError("");
  }
  function apply(next) {
    if (!next.from || !next.to || next.from > next.to) { setFilterError("请选择有效的开始日期和结束日期。"); return; }
    setFilterError(""); setExportError("");
    setFilters({ from: next.from, to: next.to, source: next.source, model: next.model, offset: 0 });
    setDraft({});
  }
  async function download(format) {
    setExporting(true); setExportError("");
    try {
      const { filename, blob } = await apiClient.downloadUsageHistory(range, format);
      downloadBlob(filename, blob);
    } catch { setExportError("CSV 下载失败，请重试。"); }
    finally { setExporting(false); }
  }
  const today = data?.today || range.to;
  return <section className="usage-history" aria-labelledby="daily-history-title" aria-busy={loading || undefined}>
    <header className="usage-history__head">
      <div><h2 id="daily-history-title">每日使用历史</h2><p>查看每日用量和速度。原始日志清理后，已收录的汇总仍可查看。</p></div>
      <div className="usage-history__actions">
        <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} loading={refreshing} onClick={refresh}>更新历史</Button>
        <Button size="xs" leftSection={<IconDownload size={14} />} disabled={exportDisabled} onClick={() => download("csv")}>导出 CSV</Button>
      </div>
    </header>
    <div className="usage-history__filters">
      <form onSubmit={(event) => { event.preventDefault(); apply(values); }}>
        <label>开始日期<input type="date" value={values.from} onChange={(e) => updateDraft({ from: e.target.value })} /></label>
        <label>结束日期<input type="date" value={values.to} onChange={(e) => updateDraft({ to: e.target.value })} /></label>
        <label>来源<select value={values.source} onChange={(e) => updateDraft({ source: e.target.value, model: "" })}>
          <option value="">全部来源</option>{PLATFORM_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>模型<select value={values.model} onChange={(e) => updateDraft({ model: e.target.value })}>
          <option value="">全部模型</option>{models.map((model) => <option value={model} key={model}>{model}</option>)}</select></label>
        <Button size="xs" variant="default" type="submit" disabled={loading}>应用筛选</Button>
      </form>
      <div className="usage-history__shortcuts">
        <div>{[7, 30, 90].map((days) => <button key={days} type="button" disabled={!today || loading}
          onClick={() => apply({ ...values, from: dateShift(today, 1 - days), to: today })}>近 {days} 天</button>)}
          <button type="button" disabled={!data?.available?.first || loading}
            onClick={() => apply({ ...values, from: data.available.first, to: today })}>全部日期</button></div>
        <span>{scan?.timezone || status?.timezone || "服务器本地日期"}{scan?.generatedAt ? ` · 更新 ${formatDateTime(scan.generatedAt)}` : ""}</span>
      </div>
    </div>
    {error && <p className="usage-history__notice is-error" role="alert">{error}</p>}
    {status?.status === "error" && <p className="usage-history__notice is-error" role="status">历史更新失败{scan ? "，仍可查看上次汇总" : ""}。</p>}
    {status?.status === "loading" && <p className="usage-history__notice" role="status">正在整理日志{status.progress ? ` · ${fmt(status.progress.completed)} / ${fmt(status.progress.total)} 个文件` : ""}{scan ? "，当前显示已保存的汇总" : ""}。</p>}
    {scan?.status === "partial" && <p className="usage-history__notice" role="status">部分日志尚未计入：读取失败 {fmt(stats?.failedFiles)} 个文件，跳过 {fmt(stats?.skippedLines)} 行，未写完 {fmt(stats?.partialFiles)} 个文件。</p>}
    {requestError ? <div className="usage-history__empty" role="alert"><strong>无法读取历史</strong><Button size="xs" variant="default" onClick={retry}>重试</Button></div>
      : !data || (!scan && status?.status === "loading") ? <div className="usage-history__empty" role="status"><strong>正在读取每日汇总</strong></div>
        : !totals.requests ? <div className="usage-history__empty"><strong>此范围暂无记录</strong><p>扩大日期范围或切换来源、模型后再查看。</p></div>
          : <>
            <dl className="usage-history__totals">
              <div><dt>请求</dt><dd>{fmt(totals.requests)}</dd><small>{totals.unfinalized ? `${fmt(totals.unfinalized)} 次未结束` : "所选范围"}</small></div>
              <div><dt>输入＋输出 Token</dt><dd>{fmt(totals.input + totals.output)}</dd><small>含缓存输入</small></div>
              <div><dt>平均输出速度</dt><dd>{speed(totals.outputTokS)}<span> tok/s</span></dd><small>{fmt(totals.measured)} 次可测速</small></div>
              <div><dt>费用估算</dt><dd>{cost(totals)}</dd><small>{fmt(totals.pricedRequests)} / {fmt(totals.requests)} 次已计价</small></div>
            </dl>
            <div className="usage-history__plot">
              <div className="usage-history__plot-head"><div><h3>本页趋势</h3><p>{hasScore ? "每日综合分需要至少 20 次可测速响应" : "选择一个来源和模型后可查看综合分"}</p></div>
                <SegmentedControl size="xs" aria-label="历史图表指标" value={shownMetric} onChange={setMetric}
                  data={[{ value: "tokens", label: "Token" }, { value: "speed", label: "速度" }, { value: "score", label: "综合分", disabled: !hasScore }]} /></div>
              <HistoryPlot days={data.days} metric={shownMetric} />
            </div>
            <DailyTable days={data.days} hasScore={hasScore} />
            <div className="usage-history__pagination"><span>{fmt(data.totalDays)} 个有记录的日期{totals.unfinalized ? " · * 含未结束请求" : ""}</span>
              {data.totalDays > data.pageSize && <div><Button size="xs" variant="default" disabled={loading || data.offset === 0}
                onClick={() => setFilters({ ...range, offset: Math.max(0, data.offset - data.pageSize) })}>上一页</Button>
              <span>{fmt(data.offset + 1)}–{fmt(data.offset + data.days.length)}</span>
              <Button size="xs" variant="default" disabled={loading || data.offset + data.pageSize >= data.totalDays}
                onClick={() => setFilters({ ...range, offset: data.offset + data.pageSize })}>下一页</Button></div>}
            </div>
            <ModeTable modes={data.modes} disabled={exportDisabled} exportModes={() => download("modes-csv")} />
          </>}
  </section>;
}
