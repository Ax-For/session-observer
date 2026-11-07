const path = require("path");
const { DEFAULT_HISTORY_MINUTES, signalForRecord } = require("../shared/response-performance");
const { usageFor, toolEvents } = require("./performance-facts");
const { evaluateAgent, highest } = require("./performance-score");
const { executionModes } = require("./execution-modes");
const { createResponseRates, emptyRates, addRates, publicRates } = require("./live-speed-rates");
const { NATIVE_SOURCE_TYPES } = require("../shared/source-adapters");
const { toolDigest, toolSignal } = require("./tool-signals");

const RETENTION_MS = 30 * 60_000;
const STALE_MS = 5 * 60_000;
const WINDOW_MS = 3000;
const MAX_HISTORY_POINTS = 300;
const bounded = (value) => String(value || "").slice(0, 240);
const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));

function buildHistory(intervals, now, end, minutes) {
  const historyWindowMs = minutes * 60_000;
  const count = Math.min(minutes * 60, MAX_HISTORY_POINTS);
  const historyBucketMs = historyWindowMs / count;
  const start = end - historyWindowMs;
  const buckets = Array.from({ length: count }, (_, index) => ({
    time: start + (index + 1) * historyBucketMs, ...emptyRates(),
  }));
  for (const interval of intervals) {
    const first = Math.max(0, Math.floor((interval.startMs - start) / historyBucketMs));
    const last = Math.min(count - 1, Math.ceil((interval.endMs - start) / historyBucketMs) - 1);
    const field = interval.estimated ? "estimated" : "measured";
    for (let index = first; index <= last; index++) {
      const bucket = buckets[index];
      const fraction = overlap(bucket.time - historyBucketMs, Math.min(bucket.time, now), interval.startMs, interval.endMs) / historyBucketMs;
      if (fraction > 0) addRates(bucket, interval.rates, fraction, field);
    }
  }
  return { historyWindowMs, historyBucketMs, history: buckets.map((bucket) => ({ time: bucket.time, ...publicRates(bucket, false) })) };
}

function mergeUsage(record, usage, output, recordedUsd, modes) {
  for (const [field, count] of Object.entries(usage)) {
    if (count != null) record[field] = Math.max(record[field] || 0, count);
  }
  if (output != null) record.output = Math.max(record.output || 0, output);
  if (recordedUsd != null) record.recordedUsd = Math.max(record.recordedUsd || 0, recordedUsd);
  record.modes = { ...record.modes, ...modes };
}

// Independent, bounded implementation of agent-speed's log-boundary live rate.
// No transcript text is retained; all rates are exclusive to the owning agent.
function createLiveSpeedEngine({ clock = Date.now, maxAgents = 128, maxResponses = 4096, retentionMs = RETENTION_MS,
  responseStore, actionStore, maxActions = 64, baselineLookup = () => null } = {}) {
  const agents = new Map();
  const responses = responseStore || new Map();
  const actions = actionStore || new Map();
  let completionOrder = 0;
  let evictedResponses = 0;

  function ingest(obj, context, source, { seeded = false } = {}) {
    const p = obj.payload || {};
    if (source === "codex" && obj.type === "session_meta") {
      if (context.codexMetadataSeen) return;
      context.codexMetadataSeen = true;
      context.sessionId = bounded(p.id);
      context.title = bounded(p.title);
      context.project = bounded(path.basename(p.cwd || ""));
      context.parentSessionId = bounded(p.parent_thread_id || p.source?.subagent?.thread_spawn?.parent_thread_id);
    }
    if ((source === "claude" || source === "qwen") && !context.sessionId && obj.sessionId) context.sessionId = bounded(obj.sessionId);
    const signal = signalForRecord(obj, context, source);
    const ms = Date.parse(obj.timestamp);
    if (!Number.isFinite(ms) || ms > clock() + 5000 || ms < clock() - retentionMs) return;
    if (context.performanceMeta && (ms < context.performanceMeta.startedAt - 2000
      || (context.performanceMeta.ordinal != null && Number.isSafeInteger(obj.ordinal) && obj.ordinal < context.performanceMeta.ordinal))) return;
    const child = source === "claude" && String(context.file).match(/[/\\]([^/\\]+)[/\\]subagents[/\\]agent-([^/\\]+)\.jsonl$/);
    const sessionId = child ? `${child[1]}:agent:${child[2]}` : bounded(context.sessionId || obj.sessionId || path.basename(context.file, ".jsonl"));
    const key = `${source}|${sessionId}`;
    context.agentKey = key;
    if (!agents.has(key)) {
      if (agents.size >= maxAgents) agents.delete([...agents.values()].sort((a, b) => a.lastLineMs - b.lastLineMs)[0].id);
      agents.set(key, { id: key, sessionId, sourceType: source, phase: "idle", lastLineMs: ms, start: null, streaming: false, explicit: false });
    }
    const agent = agents.get(key);
    agent.file = context.file;
    agent.project = bounded(context.project || path.basename(obj.cwd || p.cwd || "")) || agent.project || "本地工作区";
    agent.title = context.title || agent.title || sessionId;
    agent.parentSessionId = child ? child[1] : context.parentSessionId || "";
    const model = bounded(p.model || obj.model || obj.message?.model || signal?.model);
    if (model && model !== "<synthetic>") agent.model = model;
    if (ms < agent.lastLineMs) return;
    agent.lastLineMs = ms;
    if (agent.toolAvailableSince === Infinity) agent.toolAvailableSince = ms;
    const modes = executionModes(obj, context, source, context.configuredTier);
    agent.modes = modes.current;
    for (const event of toolEvents(obj, source)) {
      if (typeof event.id !== "string" || !event.id) continue;
      const id = `${key}|${bounded(event.id)}`;
      const previous = actions.get(id);
      if (event.kind === "call" && !previous && typeof event.tool === "string" && event.tool) {
        const diagnostic = actionStore ? {} : { digest: toolDigest(event.args), seeded };
        actions.set(id, { id, callId: bounded(event.id), agentId: key, sourceType: source, model: agent.model || "", tool: bounded(event.tool), callMs: ms, resultMs: null, failed: null, ...diagnostic });
        if (Number.isFinite(maxActions)) {
          const own = [...actions.values()].filter((a) => a.agentId === key);
          for (const old of own.slice(0, Math.max(0, own.length - maxActions))) actions.delete(old.id);
        }
      } else if (event.kind === "result" && previous && previous.resultMs == null) {
        actions.set(id, { ...previous, resultMs: ms, failed: event.failed, completionOrder: ++completionOrder });
      }
    }
    if (!signal) return;
    if (signal.kind === "end") {
      agent.phase = "idle"; agent.start = agent.first = null; agent.streaming = agent.explicit = false;
    } else if (signal.kind === "start") {
      if (!agent.streaming && (!agent.explicit || signal.explicit)) {
        agent.start = signal.startMs ?? ms; agent.first = null; agent.explicit = Boolean(signal.explicit);
      }
      agent.phase = "generating";
    } else if (signal.kind === "content") {
      if (!agent.streaming) agent.first = ms;
      agent.streaming = true; agent.phase = "generating";
    } else {
      let output = signal.output;
      const usage = usageFor(obj, source);
      if (signal.modern) agent.modern = true;
      if (signal.kind === "usage" && !signal.modern) {
        if (agent.modern || (signal.cumulative != null && signal.cumulative === agent.cumulative)) return;
        if (signal.cumulativeOutput != null && agent.cumulativeOutput != null && signal.cumulativeOutput >= agent.cumulativeOutput) output = signal.cumulativeOutput - agent.cumulativeOutput;
        if (obj.payload?.info?.total_token_usage) {
          const total = usageFor(obj, source, true);
          const previous = agent.previousUsage;
          const counters = Object.entries(total).filter(([field, count]) => count != null && previous?.[field] != null);
          if (previous && signal.cumulativeOutput >= (agent.cumulativeOutput ?? 0) && counters.every(([field, count]) => count >= previous[field])) {
            for (const [field, count] of counters) usage[field] = count - previous[field];
          }
          agent.previousUsage = total;
        }
        agent.cumulative = signal.cumulative; agent.cumulativeOutput = signal.cumulativeOutput;
      }
      const responseId = signal.responseId ? JSON.stringify([source, signal.responseId]) : `${key}|${ms}`;
      const recordedUsd = source === "claude" && obj.message?.id && typeof obj.costUSD === "number" && Number.isFinite(obj.costUSD) && obj.costUSD >= 0 ? obj.costUSD : null;
      let record = responses.get(responseId);
      if (record && record.agentId !== key) {
        if ((signal.final || record.final) && (agent.start == null || agent.start <= record.endMs)) {
          agent.phase = "idle"; agent.start = agent.first = null; agent.streaming = agent.explicit = false;
        }
        return;
      }
      // A duplicate final snapshot cannot terminate a newer request.
      if (record?.final) {
        if (signal.kind === "snapshot") {
          mergeUsage(record, usage, output, recordedUsd, modes.response);
          responses.set(responseId, record);
        }
        return;
      }
      if (!record) {
        record = { id: responseId, nativeId: signal.responseId || null, agentId: key, sourceType: source, model: agent.model || "", startMs: signal.startMs ?? agent.start, endMs: ms,
          firstMs: signal.kind === "snapshot" ? signal.hasContent ? ms : null : agent.first ?? null, output: null, final: false };
      }
      record.endMs = Math.max(record.endMs, ms);
      mergeUsage(record, usage, output, recordedUsd, modes.response);
      if (signal.hasContent && record.firstMs == null) record.firstMs = ms;
      record.final = Boolean(signal.final);
      if (record.final) record.completionOrder = ++completionOrder;
      responses.set(responseId, record);
      agent.latestEnd = Math.max(agent.latestEnd || 0, ms);
      const stop = obj.message?.stop_reason;
      const tool = stop === "tool_use" || (!stop && obj.message?.content?.some?.((part) => part.type === "tool_use"));
      agent.phase = signal.phase || (source === "codex" || tool ? "tools" : !stop || stop === "pause_turn" ? "generating" : "idle");
      if (record.final) { agent.start = agent.first = null; agent.streaming = agent.explicit = false; }
      else agent.streaming = true;
    }
    while (responses.size > maxResponses) { responses.delete(responses.keys().next().value); evictedResponses++; }
  }

  function snapshotRanges(windows, now = clock()) {
    for (const [key, row] of responses) if (row.endMs < now - RETENTION_MS) responses.delete(key);
    for (const [key, agent] of agents) if (agent.lastLineMs < now - RETENTION_MS) agents.delete(key);
    for (const [key, action] of actions) if (!agents.has(action.agentId)) actions.delete(key);
    const scoreResponses = new Map(), scoreActions = new Map();
    for (const row of responses.values()) {
      if (!scoreResponses.has(row.agentId)) scoreResponses.set(row.agentId, []);
      scoreResponses.get(row.agentId).push(row);
    }
    for (const row of actions.values()) {
      if (!scoreActions.has(row.agentId)) scoreActions.set(row.agentId, []);
      scoreActions.get(row.agentId).push(row);
    }
    const records = [...responses.values()].map((row) => {
      const elapsed = row.startMs == null ? -1 : row.endMs - row.startMs;
      const durationMs = elapsed >= 0 && elapsed <= 15 * 60_000 ? Math.max(500, elapsed) : null;
      return { ...row, durationMs, startMs: durationMs == null ? row.startMs : row.endMs - durationMs };
    });
    const measured = records.filter((r) => r.final && r.output != null && r.durationMs != null).sort((a, b) => b.endMs - a.endMs);
    const responseRates = createResponseRates();
    const references = new Map();
    const reference = (agent, model = agent.model) => {
      const key = JSON.stringify([agent.id, model]);
      if (references.has(key)) return references.get(key);
      let rows = measured.filter((r) => r.agentId === agent.id && r.endMs >= now - 10 * 60_000).slice(0, 3);
      if (!rows.length && model) rows = measured.filter((r) => r.model === model && r.sourceType === agent.sourceType).slice(0, 10);
      if (!rows.length) rows = measured.filter((r) => r.sourceType === agent.sourceType).slice(0, 10);
      const rates = responseRates(rows);
      references.set(key, rates);
      return rates;
    };
    const end = Math.ceil(now / 1000) * 1000;
    const historyStart = end - Math.max(...windows) * 60_000;
    const intervals = measured.filter((r) => r.endMs > historyStart).map((r) => ({ ...r, rates: responseRates([r]), estimated: false }));
    const currentAgents = [...agents.values()].map((a) => ({ ...a, phase: now - a.lastLineMs > STALE_MS ? "idle" : a.phase, referenceRates: reference(a) }));
    for (const record of records) {
      if (record.final || record.durationMs == null || record.endMs <= historyStart) continue;
      const agent = agents.get(record.agentId);
      const rates = agent && reference(agent, record.model);
      if (rates) intervals.push({ ...record, rates, estimated: true });
    }
    for (const agent of currentAgents) {
      if (agent.phase !== "generating" || agent.start == null || !agent.referenceRates) continue;
      intervals.push({ agentId: agent.id, sourceType: agent.sourceType, startMs: Math.max(agent.start, agent.latestEnd || 0), endMs: now,
        rates: agent.referenceRates, estimated: true });
    }
    const totals = emptyRates();
    const sources = NATIVE_SOURCE_TYPES.map((sourceType) => ({ sourceType, sums: emptyRates(), generating: 0, tools: 0, unknown: 0 }));
    const agentRates = new Map();
    for (const interval of intervals) {
      const field = interval.estimated ? "estimated" : "measured";
      const fraction = overlap(now - WINDOW_MS, now, interval.startMs, interval.endMs) / WINDOW_MS;
      if (fraction > 0) {
        const source = sources.find((s) => s.sourceType === interval.sourceType);
        if (!agentRates.has(interval.agentId)) agentRates.set(interval.agentId, emptyRates());
        addRates(totals, interval.rates, fraction, field);
        addRates(source.sums, interval.rates, fraction, field);
        addRates(agentRates.get(interval.agentId), interval.rates, fraction, field);
      }
    }
    const rows = currentAgents.map((agent) => {
      const source = sources.find((s) => s.sourceType === agent.sourceType);
      if (agent.phase !== "idle") source[agent.phase]++;
      const { measured, estimated, rates } = publicRates(agentRates.get(agent.id) || emptyRates());
      const unknown = agent.phase === "generating" && (!agent.referenceRates || agent.start == null);
      if (unknown) source.unknown++;
      const performance = evaluateAgent(agent, scoreResponses.get(agent.id) || [], scoreActions.get(agent.id) || [], now);
      const baseline = baselineLookup(agent.sourceType, performance.model || "");
      if (baseline) {
        performance.baselineSamples = baseline.n;
        if (performance.score != null && baseline.score != null) {
          performance.baseline = baseline.score;
          performance.vsUsual = performance.score / baseline.score - 1;
          performance.vsUsualPercent = Math.sign(performance.vsUsual) * Math.floor(Math.abs(performance.vsUsual * 100) + 0.5);
        }
      }
      return { id: agent.id, sessionId: agent.sessionId, sourceType: agent.sourceType, title: agent.title, project: agent.project,
        model: agent.model || "未知模型", modes: agent.modes, parentSessionId: agent.parentSessionId, phase: agent.phase, lastLineMs: agent.lastLineMs,
        measured, estimated, rates: { total: rates.total, reasoning: rates.reasoning }, unknown,
        recentRate: agent.referenceRates?.output ?? null, performance,
        toolSignal: toolSignal(scoreActions.get(agent.id) || [], now, agent.toolAvailableSince) };
    }).sort((a, b) => Number(b.phase !== "idle") - Number(a.phase !== "idle") || b.lastLineMs - a.lastLineMs);
    const best = highest(rows);
    const common = { generatedAt: now, windowMs: WINDOW_MS, ...publicRates(totals),
      sources: sources.map(({ sums, ...source }) => ({ ...source, ...publicRates(sums) })),
      agents: rows,
      performance: best ? { ...best.performance, agentId: best.id, title: best.title, sourceType: best.sourceType } : null,
      measuredResponses: measured.length, unmeasuredResponses: records.length - measured.length, evictedResponses,
      generating: sources.reduce((n, s) => n + s.generating, 0), tools: sources.reduce((n, s) => n + s.tools, 0), unknown: sources.reduce((n, s) => n + s.unknown, 0) };
    return new Map(windows.map((minutes) => [minutes, { ...common, ...buildHistory(intervals, now, end, minutes) }]));
  }
  function snapshot(now = clock(), historyMinutes = DEFAULT_HISTORY_MINUTES) {
    return snapshotRanges([historyMinutes], now).get(historyMinutes);
  }
  function stop(context) {
    const agent = agents.get(context.agentKey);
    if (agent && agent.file === context.file) {
      agent.phase = "idle"; agent.start = null; agent.streaming = agent.explicit = false;
      agent.toolAvailableSince = Infinity;
    }
  }
  return { ingest, snapshot, snapshotRanges, stop };
}

module.exports = { createLiveSpeedEngine };
