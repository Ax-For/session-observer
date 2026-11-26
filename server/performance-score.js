// agent-speed METRICS 6.9 / 6.11. Constants are a personal benchmark calibration,
// not an industry standard. See docs/agent-speed-reference.md for provenance.
const IDS = ["T", "L", "N", "R", "H", "U", "S"];
const WEIGHTS = [0.30, 0.20, 0.15, 0.10, 0.10, 0.10, 0.05];
const RATIOS = [(v) => v / 50, (v) => 5000 / Math.max(v, 250), (v) => v / 3, (v) => v / 20,
  (v) => v / 0.95, (v) => 400 / v, (v) => v / 0.95];
const FIELDS = ["n", "outputSum", "durationMsSum", "reasonN", "reasonOutput", "reasonDurationMsSum", "cacheN", "cacheInput", "cacheCached", "toolN", "toolLnSum", "toolFailed", "activeMs"];
const EDGES = Array.from({ length: 64 }, (_, k) => Math.ceil(100 * 2 ** (k / 4)));
const sum = (rows, fn) => rows.reduce((n, row) => n + fn(row), 0);
const round = (v) => v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5);
const ordinal = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const median = (values) => {
  const rows = values.slice().sort((a, b) => a - b), mid = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2;
};
function localDay(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayOffset(day, offset) {
  const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + offset); return localDay(d.getTime());
}
function timed(row) {
  if (!row.final || row.output == null || row.startMs == null || row.endMs < row.startMs || row.endMs - row.startMs > 900000) return null;
  const durationMs = Math.max(500, row.endMs - row.startMs);
  return { ...row, rawStartMs: row.startMs, startMs: row.endMs - durationMs, durationMs };
}
function validCall(row) {
  return row.resultMs != null && row.resultMs >= row.callMs && row.resultMs - row.callMs <= 900000;
}
function unionLength(intervals) {
  let total = 0, end = -Infinity;
  for (const [s, e] of intervals.sort((a, b) => a[0] - b[0])) { total += Math.max(0, e - Math.max(s, end)); end = Math.max(end, e); }
  return total;
}
function combine(measures) {
  let logs = 0, weight = 0;
  const components = IDS.map((id, i) => {
    const [measure, samples] = measures[id] || [null, 0];
    if (measure == null || !Number.isFinite(measure)) return { id, present: false, reason: "fewSamples", samples, measure: null, ratio: null, subScore: null };
    const raw = RATIOS[i](measure), ratio = id === "T" ? Math.max(0.01, raw) : Math.min(20, Math.max(0.05, raw));
    logs += WEIGHTS[i] * Math.log(ratio); weight += WEIGHTS[i];
    return { id, present: true, reason: null, samples, measure, ratio, subScore: 1000 * ratio };
  });
  const score = weight ? 1000 * Math.exp(logs / weight) : null;
  return { components, score, shown: score == null ? null : round(score) };
}
function evaluateAgent(agent, responses, actions, now = Date.now(), baseline = null) {
  const sample = responses.map(timed).filter((r) => r && r.agentId === agent.id && r.endMs >= now - 1800000 && r.endMs <= now)
    .sort((a, b) => b.endMs - a.endMs || ordinal(a.id || a.key, b.id || b.key)).slice(0, 20);
  const n = sample.length;
  const spanStartMs = n ? Math.min(...sample.map((r) => r.startMs)) : null;
  const calls = n < 3 ? [] : actions.filter((a) => a.agentId === agent.id).slice(-64).filter((a) => validCall(a) && a.callMs >= spanStartMs && a.resultMs <= now);
  const activeMs = unionLength([...sample.map((r) => [r.startMs, r.endMs]), ...calls.map((a) => [a.callMs, a.resultMs])]);
  const measures = { T: [null, n] };
  if (n >= 3) {
    const latency = sample.filter((r) => r.firstMs != null && r.firstMs >= r.rawStartMs).map((r) => r.firstMs - r.rawStartMs);
    const reasoning = sample.filter((r) => Math.min(r.reasoning || 0, r.output) > 0);
    const cache = sample.filter((r) => r.input > 0);
    const count = calls.length;
    Object.assign(measures, {
      T: [sum(sample, (r) => r.output) / (sum(sample, (r) => r.durationMs) / 1000), n],
      L: [latency.length >= 3 ? median(latency) : null, latency.length],
      R: [reasoning.length >= 3 ? sum(reasoning, (r) => Math.min(r.reasoning, r.output)) / (sum(reasoning, (r) => r.durationMs) / 1000) : null, reasoning.length],
      H: [cache.length >= 3 ? sum(cache, (r) => r.cachedInput || 0) / sum(cache, (r) => r.input) : null, cache.length],
      N: [count >= 3 && activeMs > 0 ? count / (activeMs / 60000) : null, count],
      U: [count >= 3 ? Math.exp(sum(calls, (a) => Math.log(Math.max(a.resultMs - a.callMs, 50))) / count) : null, count],
      S: [count >= 3 ? 1 - calls.filter((a) => a.failed === true).length / count : null, count],
    });
  }
  const result = combine(measures);
  const phase = now - agent.lastLineMs > 300000 ? "idle" : agent.phase;
  const comparison = result.score != null && baseline?.score != null ? result.score / baseline.score - 1 : null;
  return { ...result, form: result.score == null ? "none" : phase === "idle" ? "resting" : "live", n, tools: calls.length, activeMs, spanStartMs,
    model: sample[0]?.model || null, provisional: result.score != null && n < 10,
    baseline: result.score != null ? baseline?.score ?? null : null, baselineSamples: baseline?.n || 0,
    vsUsual: comparison, vsUsualPercent: comparison == null ? null : round(comparison * 100) };
}
function highest(agents) {
  const eligible = agents.filter((a) => a.performance?.score != null);
  const live = eligible.filter((a) => a.performance.form === "live");
  return (live.length ? live : eligible).sort((a, b) => b.performance.score - a.performance.score || b.lastLineMs - a.lastLineMs || ordinal(a.id, b.id))[0] || null;
}
function emptyRecord() { return { ...Object.fromEntries(FIELDS.map((key) => [key, 0])), latencyBins: Array(64).fill(0) }; }
function addRecord(target, row) {
  for (const field of FIELDS) target[field] += row[field] || 0;
  for (let k = 0; k < 64; k++) target.latencyBins[k] += row.latencyBins?.[k] || 0;
  return target;
}
function pooled(records) {
  const row = records.reduce(addRecord, emptyRecord());
  const latencyN = sum(row.latencyBins, (v) => v);
  let latency = null, seen = 0;
  for (let k = 0; k < 64; k++) {
    seen += row.latencyBins[k];
    if (latencyN >= 3 && seen >= Math.ceil(latencyN / 2)) { latency = 100 * 2 ** ((k + 0.5) / 4); break; }
  }
  const k = row.toolN;
  const result = combine({
    T: [row.n >= 3 && row.durationMsSum > 0 ? row.outputSum / (row.durationMsSum / 1000) : null, row.n],
    L: [latency, latencyN], N: [k >= 3 && row.activeMs > 0 ? k / (row.activeMs / 60000) : null, k],
    R: [row.reasonN >= 3 ? row.reasonOutput / (row.reasonDurationMsSum / 1000) : null, row.reasonN],
    H: [row.cacheN >= 3 ? row.cacheCached / row.cacheInput : null, row.cacheN],
    U: [k >= 3 ? Math.exp(row.toolLnSum / k) : null, k], S: [k >= 3 ? 1 - row.toolFailed / k : null, k],
  });
  return { ...result, n: row.n, tools: k, activeMs: row.activeMs, score: row.n >= 20 ? result.score : null, shown: row.n >= 20 ? result.shown : null };
}
function baselineFor(records, sourceType, model, today = localDay()) {
  return pooled(records.filter((r) => r.sourceType === sourceType && r.model === (model || "") && r.day >= dayOffset(today, -14) && r.day < today));
}
function createDayRecorder({ firstDay = "0000-00-00", lastDay = "9999-99-99", dayFor = localDay } = {}) {
  const records = new Map(), covered = new Map();
  function add(kind, value) {
    const r = kind === "response" ? timed(value) : validCall(value) ? value : null;
    if (!r) return;
    const end = kind === "response" ? r.endMs : r.resultMs;
    const start = kind === "response" ? r.startMs : r.callMs;
    const day = dayFor(end), model = r.model || "";
    const identity = JSON.stringify([r.agentId, model]);
    const active = Math.max(0, end - Math.max(start, covered.get(identity) ?? start));
    covered.set(identity, Math.max(covered.get(identity) ?? end, end));
    if (day < firstDay || day > lastDay) return;
    const key = JSON.stringify([day, r.sourceType, model]);
    if (!records.has(key)) records.set(key, { day, sourceType: r.sourceType, model, ...emptyRecord() });
    const row = records.get(key); row.activeMs += active;
    if (kind === "response") {
      row.n++; row.outputSum += r.output; row.durationMsSum += r.durationMs;
      if (r.firstMs != null && r.firstMs >= r.rawStartMs) row.latencyBins[EDGES.slice(1).filter((edge) => r.firstMs - r.rawStartMs >= edge).length]++;
      const reasoning = Math.min(r.reasoning || 0, r.output);
      if (reasoning > 0) { row.reasonN++; row.reasonOutput += reasoning; row.reasonDurationMsSum += r.durationMs; }
      if (r.input > 0) { row.cacheN++; row.cacheInput += r.input; row.cacheCached += r.cachedInput || 0; }
    } else { row.toolN++; row.toolLnSum += Math.log(Math.max(end - start, 50)); row.toolFailed += r.failed === true ? 1 : 0; }
  }
  return { add, records: () => [...records.values()] };
}

module.exports = { evaluateAgent, highest, pooled, baselineFor, localDay, dayOffset, timed, createDayRecorder, emptyRecord, addRecord };
