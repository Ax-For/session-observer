import { useState } from "react";
import { formatFullDateTime, formatNumber } from "../../lib/formatters";
import styles from "./analysis.module.css";

const seconds = (value) => value == null ? "—" : `${(value / 1000).toFixed(2)} s`;
const unavailable = { "missing-start": "起点缺失", "invalid-interval": "时间区间无效", "missing-usage": "用量缺失", unfinished: "尚未完成" };

export function ResponsePerformancePanel({ performance, onOpenEvent }) {
  const [expanded, setExpanded] = useState(false);
  if (!performance) return null;
  const rows = performance.responses || [];
  const measured = performance.measuredResponses || 0;
  const visible = rows.slice(expanded ? -100 : -20).reverse();
  return <section className={styles.performance} aria-label="响应性能">
    <div className={styles.heading}><h3>响应性能</h3><span className={styles.basis}>日志间隔估算</span></div>
    <p className={styles.muted}>输出速度包含首段内容等待；按日志边界计时，工具执行单独统计。</p>
    <div className={styles.performanceMetrics}>
      <div><small>响应输出速度</small><strong>{performance.outputTokensPerSecond == null ? "—" : performance.outputTokensPerSecond.toFixed(1)}<span>tok/s</span></strong><small>有效输出 ÷ 有效响应累计耗时</small></div>
      <div><small>首段内容等待 · 中位数</small><strong>{seconds(performance.firstContentP50Ms)}</strong><small>{formatNumber(performance.firstContentSamples || 0)} 个内容时间样本</small></div>
      <div><small>有效响应 / 已识别</small><strong>{measured} / {rows.length}</strong><small>仅当前加载窗口，最多 1,000 条事件</small></div>
    </div>
    {!measured ? <p className={styles.muted}>暂无可测量的响应</p> : null}
    {rows.length ? <details className={styles.responseDetails}>
      <summary>响应明细</summary>
      <p className={styles.muted}>首段内容是日志首次落盘时间，不等同于服务端首 Token 延迟；小于 0.5 s 的区间按 0.5 s 计算。</p>
      <div className={styles.scroll}><table className={`${styles.table} ${styles.responseTable}`}>
        <thead><tr><th>响应 / 模型</th><th>输出 Token</th><th>响应耗时</th><th>首段等待</th><th>输出速度</th></tr></thead>
        <tbody>{visible.map((row, i) => <tr key={row.id || row.eventId || i}>
          <td><button className={styles.link} disabled={!row.eventId} aria-label={`查看响应记录 ${rows.indexOf(row) + 1}`} onClick={() => onOpenEvent?.({ eventId: row.eventId })}>{formatFullDateTime(row.time)}</button><br /><small>{row.model}</small></td>
          <td>{row.outputTokens == null ? "—" : formatNumber(row.outputTokens)}</td>
          <td title={row.durationAdjusted ? "已按最小 0.5 s 区间计算" : undefined}>{seconds(row.durationMs)}{row.durationAdjusted ? " *" : ""}</td>
          <td>{seconds(row.firstContentMs)}</td>
          <td>{row.outputTokensPerSecond == null ? <small>{unavailable[row.reason] || "未知"}</small> : `${row.outputTokensPerSecond.toFixed(1)} tok/s`}</td>
        </tr>)}</tbody>
      </table></div>
      {rows.length > 20 ? <button className={`${styles.link} ${styles.moreResponses}`} onClick={() => setExpanded((value) => !value)}>
        {expanded ? "收起为最近 20 条" : `查看最近 ${Math.min(100, rows.length)} 条响应`}
      </button> : null}
    </details> : null}
  </section>;
}
