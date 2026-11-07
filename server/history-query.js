const { addRecord, emptyRecord, localDay, dayOffset, pooled, timed } = require("./performance-score");
const { estimateResponseCost } = require("./performance-facts");

const PAGE_SIZE = 30;
const FIELDS = ["requests", "input", "cachedInput", "cacheCreation", "output", "reasoning", "unfinalized",
  "measured", "measuredOutput", "measuredMs", "pricedRequests", "estimatedUsd"];
const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toJSON()?.slice(0, 10) === value;
const totals = () => Object.fromEntries(FIELDS.map((key) => [key, 0]));
const rate = (output, ms) => ms > 0 ? output / (ms / 1000) : null;
const summarize = (row) => ({ ...row, outputTokS: rate(row.measuredOutput, row.measuredMs) });
const modeFields = ["requests", "measured", "measuredOutput", "measuredMs"];

function parseHistoryFilters(params) {
  const allowed = new Set(["from", "to", "source", "model", "offset", "format"]);
  for (const key of params.keys()) if (!allowed.has(key) || params.getAll(key).length > 1) throw new RangeError("Invalid history filter");
  const from = params.get("from") || "", to = params.get("to") || "", source = params.get("source") || "", model = params.get("model") || "";
  const rawOffset = params.get("offset") || "0", format = params.get("format") || "";
  const hasControl = Array.from(model).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
  if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && (from > to || Date.parse(to) - Date.parse(from) > 10000 * 86400000))
    || !["", "codex", "claude"].includes(source) || model.length > 240 || hasControl
    || !/^\d{1,6}$/.test(rawOffset) || !["", "csv", "modes-csv"].includes(format)) {
    throw new RangeError("Invalid date range, source, model or page");
  }
  return { from, to, source, model, offset: Number(rawOffset) };
}

function addTotals(target, row, fields = FIELDS) {
  for (const key of fields) target[key] += row[key] || 0;
}

function addModes(target, rows) {
  for (const row of rows) {
    const { kind, value, evidence } = row;
    const key = JSON.stringify([kind, value, evidence]);
    if (!target.has(key)) target.set(key, { kind, value, evidence, requests: 0, measured: 0, measuredOutput: 0, measuredMs: 0 });
    addTotals(target.get(key), row, modeFields);
  }
}

function createUsageRecorder() {
  const rows = new Map();
  function add(response, day) {
    const { input = 0, cachedInput = 0, cacheCreation = 0, output, reasoning = 0 } = response;
    if (output == null && !input) return;
    const model = response.model || "";
    const key = JSON.stringify([day, response.sourceType, model]);
    if (!rows.has(key)) rows.set(key, { day, sourceType: response.sourceType, model, usage: totals(), modes: new Map() });
    const row = rows.get(key), measured = timed(response);
    const estimate = estimateResponseCost(response);
    const counts = { requests: 1, input, cachedInput, cacheCreation, output: output || 0, reasoning,
      unfinalized: response.final ? 0 : 1, measured: measured ? 1 : 0, measuredOutput: measured?.output || 0,
      measuredMs: measured?.durationMs || 0, pricedRequests: estimate.known ? 1 : 0, estimatedUsd: estimate.estimatedUsd };
    addTotals(row.usage, counts);
    addModes(row.modes, ["tier", "effort"].map((kind) => ({ kind, value: response.modes?.[kind]?.value || "unknown",
      evidence: response.modes?.[kind]?.evidence || "unknown", ...counts })));
  }
  return { add, records: () => [...rows.values()].map((row) => ({ ...row, modes: [...row.modes.values()] })) };
}

function readHistory(db, filters = {}, { now = Date.now(), exportAll = false } = {}) {
  const today = localDay(now), to = filters.to || today, from = filters.from || dayOffset(to, -29);
  const source = filters.source || "", model = filters.model || "", offset = filters.offset || 0;
  const range = { from, to, source, model }, days = [], summary = totals(), modes = new Map();
  const exists = db?.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='history_days'").get();
  const available = exists ? db.prepare("SELECT min(day) AS first, max(day) AS last FROM history_days").get() : { first: null, last: null };
  const meta = exists ? db.prepare("SELECT value FROM history_meta WHERE key='scan'").get() : null;
  const scan = meta ? JSON.parse(meta.value) : null;
  const condition = "day BETWEEN ? AND ? AND (?='' OR source=?)";
  const args = [from, to, source, source];
  const models = exists && !exportAll ? db.prepare(`SELECT model FROM history_days WHERE ${condition} AND model<>'' GROUP BY model ORDER BY model LIMIT 120`).all(...args).map((r) => r.model) : [];
  let current, totalDays = 0;
  function flush() {
    if (!current?.usage.requests) return;
    const { day, usage, performance } = current;
    if (exportAll || (totalDays >= offset && days.length < PAGE_SIZE)) {
      days.push({ day, ...summarize(usage), score: source && model ? pooled([performance]).shown : null });
    }
    totalDays++;
  }
  if (exists) for (const item of db.prepare(`SELECT day,value FROM history_days WHERE ${condition} AND (?='' OR model=?) ORDER BY day DESC,file_id,source,model`).iterate(...args, model, model)) {
    const row = JSON.parse(item.value);
    if (item.day !== current?.day) { flush(); current = { day: item.day, usage: totals(), performance: emptyRecord() }; }
    addTotals(current.usage, row.usage || {});
    addTotals(summary, row.usage || {});
    addRecord(current.performance, row);
    addModes(modes, row.modes || []);
  }
  flush();
  return { today, range, available, scan, models, totals: summarize(summary), days, offset, totalDays, pageSize: PAGE_SIZE,
    modes: [...modes.values()].map(({ measuredOutput, measuredMs, ...row }) => ({ ...row, outputTokS: rate(measuredOutput, measuredMs) }))
      .sort((a, b) => a.kind.localeCompare(b.kind) || b.requests - a.requests || a.value.localeCompare(b.value)) };
}

function csvField(value) {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  let text = String(value);
  if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function historyCsv(data, modes = false) {
  const { source, model, from, to } = data.range;
  const head = modes ? "from,to,source,model,kind,value,evidence,requests,measured_requests,avg_output_tok_s"
    : "day,source,model,requests,input_tokens,cache_read_tokens,cache_creation_tokens,output_tokens,reasoning_tokens,unfinished_requests,measured_requests,avg_output_tok_s,priced_requests,estimated_usd,performance_score";
  const rows = modes ? data.modes.map((r) => [from, to, source, model, r.kind, r.value, r.evidence, r.requests, r.measured, r.outputTokS?.toFixed(2)])
    : data.days.map((r) => [r.day, source, model, r.requests, r.input, r.cachedInput, r.cacheCreation, r.output, r.reasoning,
      r.unfinalized, r.measured, r.outputTokS?.toFixed(2), r.pricedRequests, r.pricedRequests ? r.estimatedUsd.toFixed(6) : null, r.score]);
  return `\ufeff${[head, ...rows.map((row) => row.map(csvField).join(","))].join("\r\n")}\r\n`;
}

module.exports = { validDay, parseHistoryFilters, createUsageRecorder, readHistory, historyCsv };
