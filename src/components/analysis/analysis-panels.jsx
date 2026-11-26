import { useEffect, useState } from "react";
import { Button, Drawer, Group, NumberInput, Progress, Select, TextInput } from "@mantine/core";
import { apiClient } from "../../api/client";
import { formatBytes, formatFullDateTime, formatNumber } from "../../lib/formatters";
import { useAnalysisRequest } from "../../hooks/use-analysis-request";
import { ResponsePerformancePanel } from "./response-performance-panel";
import styles from "./analysis.module.css";

const money = (value) => `$${Number(value || 0).toFixed(4)}`;

function RequestState({ loading, error, reload }) {
  if (loading) return <p role="status" className={styles.muted}>正在读取分析数据...</p>;
  if (error) return <Group><p role="alert" className={styles.error}>{error}</p><Button size="xs" variant="subtle" onClick={reload}>重试</Button></Group>;
  return null;
}

export function SessionAnalysisPanel({ sessionId, revision, view, onOpenSession, onOpenEvent }) {
  const state = useAnalysisRequest((options) => apiClient.fetchSessionAnalysis(sessionId, options), sessionId, revision);
  const data = state.data;
  return <div className={styles.root}>
    <RequestState {...state} />
    {data && view === "usage" ? <ResponsePerformancePanel key={sessionId} performance={data.performance} onOpenEvent={onOpenEvent} /> : null}
    {data && view === "usage" ? <section className={styles.section}>
      <div className={styles.heading}><h3>轮次成本与工具耗时</h3><Button size="xs" variant="subtle" onClick={state.reload}>更新分析</Button></div>
      <p className={styles.muted}>最近 {formatNumber(data.events)} 条事件{data.hasEarlierEvents ? "，不含更早记录" : ""}。耗时按调用 ID 配对，并行调用累计时间不等于会话时长。</p>
      <div className={styles.scroll}><table className={styles.table}><thead><tr><th>提问 / 轮次</th><th>Token</th><th>金额估算</th><th>已配对 / 调用</th><th>工具累计</th></tr></thead>
        <tbody>{data.turns.slice().reverse().map((turn, i) => <tr key={turn.id || i}>
          <td><button className={styles.link} onClick={() => onOpenEvent?.({ eventId: turn.id })}>{turn.title || "无文本提问"}</button><br /><small>{formatFullDateTime(turn.time)}{turn.partial ? " · 不完整轮次" : ""}</small></td>
          <td>{formatNumber(turn.tokens)}</td><td>{money(turn.cost)}{turn.unpricedTokens > 0 ? <small><br />{formatNumber(turn.unpricedTokens)} 未计价</small> : null}</td>
          <td>{turn.pairedTools} / {turn.tools}</td><td>{turn.pairedTools ? `${(turn.toolTimeMs / 1000).toFixed(1)} s` : "未知"}</td>
        </tr>)}</tbody></table></div>
    </section> : null}
    {data && view === "artifacts" ? <>
      <section className={styles.section}><h3>Agent 归属</h3>
        <div className={styles.metrics}><div><small>本会话 Token</small><strong>{formatNumber(data.relations.ownTokens)}</strong></div>
          <div><small>子 Agent Token</small><strong>{formatNumber(data.relations.childTokens)}</strong></div>
          <div><small>子 Agent 成本估算</small><strong>{money(data.relations.childCost)}</strong></div></div>
        <p className={styles.muted}>子 Agent 单独统计；包含子项的总量不会再次计入全局账本。</p>
        {data.relations.parent ? <Button variant="subtle" size="xs" onClick={() => onOpenSession?.(data.relations.parent)}>打开父会话</Button> : null}
        {data.relations.children.length ? <table className={styles.table}><thead><tr><th>子 Agent</th><th>层级</th><th>Token</th><th>成本估算</th></tr></thead><tbody>
          {data.relations.children.map((child) => <tr key={child.sessionId}><td><button className={styles.link} onClick={() => onOpenSession?.(child)}>{child.displayTitle || child.agentId || child.sessionId}</button></td>
            <td>{child.depth}</td><td>{formatNumber(child.attributedTokens)}</td><td>{money(child.estimatedUsd)}</td></tr>)}
        </tbody></table> : <p className={styles.muted}>未发现关联的子 Agent 日志</p>}
      </section>
      <section className={styles.section}><h3>Git 成果证据</h3><p className={styles.muted}>{data.git.basis || data.git.reason}</p>
        {data.git.available ? <><p><small>{data.git.root}</small></p><table className={styles.table}><thead><tr><th>提交</th><th>时间</th><th>说明</th></tr></thead><tbody>
          {data.git.commits.map((commit) => <tr key={commit.hash}><td><code title={commit.hash}>{commit.hash.slice(0, 10)}</code></td><td>{formatFullDateTime(commit.time)}</td><td>{commit.subject}</td></tr>)}
        </tbody></table>{!data.git.commits.length ? <p className={styles.muted}>该时间窗口没有找到提交，不据此推断会话成功或失败。</p> : null}
        {data.git.truncated ? <p>仅显示最近 50 项</p> : null}</> : null}
      </section>
    </> : null}
  </div>;
}

function PricebookEditor() {
  const state = useAnalysisRequest(apiClient.fetchPricebook, "pricebook");
  const [draft, setDraft] = useState({ model: "", from: "", until: "", serviceTier: "standard", input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(rates) {
    setBusy(true); setError(""); setSaved(false);
    try { await apiClient.savePricebook(rates); state.reload(); setSaved(true); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  return <section className={styles.section}><h4>自定义历史价格</h4><p className={styles.muted}>USD / 百万 Token。精确模型名匹配，结束日期不包含当天。未配置历史价格的金额只是参考估算，不代表实际账单。</p>
    <RequestState {...state} />
    {state.data ? <>
      <Group grow align="end"><TextInput size="xs" label="模型名" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.currentTarget.value })} />
        <TextInput type="date" size="xs" label="生效日期" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.currentTarget.value })} />
        <TextInput type="date" size="xs" label="结束日期" value={draft.until} onChange={(event) => setDraft({ ...draft, until: event.currentTarget.value })} />
        <Select size="xs" label="服务档位" value={draft.serviceTier} data={[{ value: "standard", label: "Standard" }, { value: "fast", label: "Fast / Priority" }]} onChange={(value) => setDraft({ ...draft, serviceTier: value })} />
      </Group>
      <Group grow align="end" mt="xs">{[["input", "非缓存输入"], ["cacheRead", "缓存读取"], ["cacheCreation", "缓存写入"], ["output", "输出"]].map(([key, label]) =>
        <NumberInput key={key} size="xs" label={label} min={0} decimalScale={6} value={draft[key]} onChange={(value) => setDraft({ ...draft, [key]: value })} />)}
        <Button size="xs" loading={busy} disabled={!draft.model.trim()} onClick={() => save([...state.data.rates, { ...draft, model: draft.model.trim() }])}>添加价格</Button></Group>
      {state.data.rates.length ? <table className={styles.table}><thead><tr><th>模型 / 生效范围</th><th>输入 / 读 / 写 / 输出</th><th>操作</th></tr></thead><tbody>
        {state.data.rates.map((rate, i) => <tr key={`${rate.model}-${i}`}><td>{rate.model}<br /><small>{rate.from || "不限"} 至 {rate.until || "不限"} · {rate.serviceTier || "全部档位"}</small></td>
          <td>{[rate.input, rate.cacheRead, rate.cacheCreation, rate.output].join(" / ")}</td><td><Button size="xs" variant="subtle" color="red" disabled={busy} onClick={() => save(state.data.rates.filter((_, index) => index !== i))}>移除</Button></td></tr>)}
      </tbody></table> : null}
    </> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}{saved ? <p role="status">价格已保存。点击页面顶部“重新计算”订正历史账本。</p> : null}
  </section>;
}

function AuditBody({ summary, revision }) {
  const state = useAnalysisRequest(apiClient.fetchAudit, revision);
  const provenance = summary?.provenance;
  return <div className={styles.root}>
    <p className={styles.muted}>解析版本 {provenance?.parserVersion || "未知"} · 价格版本 {provenance?.pricingVersion || "未知"}。重算差异也可能包含新增、删除或修改的日志。</p>
    <RequestState {...state} />
    {(state.data?.runs || []).map((run) => <details key={run.id} className={styles.section}>
      <summary>{formatFullDateTime(run.at)} · {run.changeCount} 个会话发生变化 · {(run.durationMs / 1000).toFixed(1)} s</summary>
      <div className={styles.metrics}><div><small>Token 前 → 后</small><strong>{run.before ? formatNumber(run.before.tokens) : "无基线"} → {formatNumber(run.after.tokens)}</strong></div>
        <div><small>估算金额 前 → 后</small><strong>{run.before ? money(run.before.cost) : "无基线"} → {money(run.after.cost)}</strong></div><div><small>源文件</small><strong>{run.sourceCount}</strong></div></div>
      <table className={styles.table}><thead><tr><th>会话</th><th>Token 变化</th><th>金额变化</th></tr></thead><tbody>{run.changes.map((change) =>
        <tr key={change.id}><td>{change.id}</td><td>{formatNumber(change.after.tokens - change.before.tokens)}</td><td>{money(change.after.cost - change.before.cost)}</td></tr>)}</tbody></table>
      {run.changesTruncated ? <small>仅展示前 200 条差异</small> : null}
    </details>)}
    {!state.loading && !state.data?.runs.length ? <p className={styles.muted}>尚无重算记录，首次重算将建立审计基线。</p> : null}
    <details className={styles.section}><summary>计价依据</summary><p className={styles.muted}>日志金额优先，其次使用本地历史价格；其余仅按内置参考价格估算。assumed 表示日志未提供服务档位。</p>
      <table className={styles.table}><thead><tr><th>模型</th><th>价格来源</th><th>档位依据</th></tr></thead><tbody>{(summary?.tokens?.cost?.byModel || []).map((row) =>
        <tr key={row.model}><td>{row.model}</td><td>{row.pricingSources?.join(" / ") || "未知"}</td><td>{row.tierSources?.join(" / ") || "未知"}</td></tr>)}</tbody></table>
    </details>
    <details className={styles.section}><summary>源文件与解析覆盖</summary><p className={styles.muted}>{provenance?.sourceCount || 0} 个源文件 · {provenance?.oversizedLines || 0} 条超限记录 · {provenance?.invalidLines || 0} 条无效记录</p>
      <div className={styles.scroll}>{(provenance?.files || []).map((file) => <div key={file.file} className={styles.source}>
        <span title={`${file.file}\n${file.signature}`}>{file.file}</span><code>{formatBytes(file.bytes)}</code></div>)}</div>{provenance?.filesTruncated ? <small>仅展示前 200 个文件</small> : null}</details>
    <PricebookEditor />
  </div>;
}

export function StatisticsAudit({ summary, revision }) {
  const [opened, setOpened] = useState(false);
  return <details className={styles.disclosure} onToggle={(event) => setOpened(event.currentTarget.open)}>
    <summary>统计审计与历史价格</summary>{opened ? <AuditBody summary={summary} revision={revision} /> : null}
  </details>;
}

export function DiagnosticsDrawer({ opened, onClose, onCapabilities }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!opened) return undefined;
    const controller = new AbortController();
    let timer;
    const read = async () => {
      try { const next = await apiClient.fetchDiagnostics({ signal: controller.signal }); if (!controller.signal.aborted) { setData(next); setError(""); onCapabilities?.(next); } }
      catch (reason) { if (!controller.signal.aborted) setError(reason.message); }
      if (!controller.signal.aborted) timer = setTimeout(read, 2000);
    };
    read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [opened, onCapabilities]);
  async function action(kind) {
    setBusy(true);
    try { if (kind === "cancel") await apiClient.cancelQuery(data.active.id); else await apiClient.recoverDiagnostics(); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  }
  return <Drawer opened={opened} onClose={onClose} position="right" title="服务诊断" size="lg"><div className={styles.root}>
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {!data ? <p role="status">正在读取运行状态...</p> : <>
      <div className={styles.metrics}><div><small>合计 RSS</small><strong>{formatBytes(data.combinedRss)}</strong></div><div><small>主进程</small><strong>{formatBytes(data.mainRss)}</strong></div><div><small>查询进程</small><strong>{formatBytes(data.workerRss)}</strong></div></div>
      <Progress value={Math.min(100, data.combinedRss / data.budget * 100)} color={data.combinedRss > data.budget * 0.85 ? "orange" : "teal"} size="sm" />
      <p className={styles.muted}>采样峰值 {formatBytes(data.peakRss)} · 查询保护阈值 {formatBytes(data.budget)}</p>
      <section className={styles.section}><h3>当前任务</h3><p>{data.active?.operation || "空闲"} · 排队 {data.queued}</p>
        {data.active?.progress ? <p>{data.active.progress.phase} · {data.active.progress.completed} / {data.active.progress.total}</p> : null}
        {data.active ? <Button size="xs" variant="light" color="orange" loading={busy} onClick={() => action("cancel")}>取消当前查询</Button> : null}
      </section>
      <section className={styles.section}><h3>文件监听</h3><p>最近检查 {formatFullDateTime(data.watchers?.lastCheckedAt)}</p><p>最近变化 {formatFullDateTime(data.watchers?.lastChangeAt)}</p>
        <p className={styles.muted}>原始会话 {data.allowSourceMutations ? "允许手动修改" : "只读"} · {data.watchers?.watchedPaths?.length || 0} 个监听目录</p>
        {data.watchers?.lastError ? <p className={styles.error}>{data.watchers.lastError}</p> : null}
        <Button variant="light" size="xs" loading={busy} onClick={() => action("recover")}>重建监听与查询进程</Button>
      </section>
      <section className={styles.section}><h3>最近任务</h3>{data.history.map((job) => <div className={styles.job} key={job.id}>
        <span>{job.operation} · {job.status} · {(job.durationMs / 1000).toFixed(1)} s</span><small>{formatFullDateTime(job.endedAt)}</small>{job.error ? <small className={styles.error}>{job.error}</small> : null}
      </div>)}</section>
    </>}
  </div></Drawer>;
}
