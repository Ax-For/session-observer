const path = require("path");
const { signalForRecord } = require("../shared/response-performance");
const { usageFor, toolEvents } = require("./performance-facts");
const { evaluateAgent, highest } = require("./performance-score");
const { executionModes } = require("./execution-modes");

const RETENTION_MS = 30 * 60_000;
const STALE_MS = 5 * 60_000;
const WINDOW_MS = 3000;
const bounded = (value) => String(value || "").slice(0, 240);
const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));

// Independent, bounded implementation of agent-speed's log-boundary live rate.
// No transcript text is retained; all rates are exclusive to the owning agent.
function createLiveSpeedEngine({ clock = Date.now, maxAgents = 128, maxResponses = 4096, retentionMs = RETENTION_MS,
  responseStore, actionStore, maxActions = 64, baselineLookup = () => null } = {}) {
  const agents = new Map();
  const responses = responseStore || new Map();
  const actions = actionStore || new Map();
  let completionOrder = 0;
  let evictedResponses = 0;

  function ingest(obj, context, source) {
    const p = obj.payload || {};
    if (source === "codex" && obj.type === "session_meta") {
      if (context.codexMetadataSeen) return;
      context.codexMetadataSeen = true;
      context.sessionId = bounded(p.id);
      context.title = bounded(p.title);
      context.project = bounded(path.basename(p.cwd || ""));
      context.parentSessionId = bounded(p.parent_thread_id || p.source?.subagent?.thread_spawn?.parent_thread_id);
    }
    if (source === "claude" && !context.sessionId && obj.sessionId) context.sessionId = bounded(obj.sessionId);
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
    const model = bounded(p.model || obj.message?.model);
    if (model && model !== "<synthetic>") agent.model = model;
    if (ms < agent.lastLineMs) return;
    agent.lastLineMs = ms;
    const modes = executionModes(obj, context, source, context.configuredTier);
    agent.modes = modes.current;
    for (const event of toolEvents(obj, source)) {
      if (typeof event.id !== "string" || !event.id) continue;
      const id = `${key}|${bounded(event.id)}`;
      const previous = actions.get(id);
      if (event.kind === "call" && !previous && typeof event.tool === "string" && event.tool) {
        actions.set(id, { id, callId: bounded(event.id), agentId: key, sourceType: source, model: agent.model || "", tool: bounded(event.tool), callMs: ms, resultMs: null, failed: null });
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
        agent.start = ms; agent.first = null; agent.explicit = Boolean(signal.explicit);
      }
      agent.phase = "generating";
    } else if (signal.kind === "content") {
      if (!agent.streaming) agent.first = ms;
      agent.streaming = true; agent.phase = "generating";
    } else {
      let output = signal.output;
      let usage = usageFor(obj, source);
      if (signal.modern) agent.modern = true;
      if (signal.kind === "usage" && !signal.modern) {
        if (agent.modern || (signal.cumulative != null && signal.cumulative === agent.cumulative)) return;
        if (signal.cumulativeOutput != null && agent.cumulativeOutput != null && signal.cumulativeOutput >= agent.cumulativeOutput) output = signal.cumulativeOutput - agent.cumulativeOutput;
        if (obj.payload?.info?.total_token_usage) {
          const total = usageFor(obj, source, true);
          if (agent.previousUsage && Object.keys(total).every((field) => total[field] >= agent.previousUsage[field])
            && signal.cumulativeOutput >= (agent.cumulativeOutput ?? 0)) usage = Object.fromEntries(Object.keys(total).map((field) => [field, total[field] - agent.previousUsage[field]]));
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
          for (const field of Object.keys(usage)) record[field] = Math.max(record[field] || 0, usage[field]);
          if (output != null) record.output = Math.max(record.output || 0, output);
          if (recordedUsd != null) record.recordedUsd = Math.max(record.recordedUsd || 0, recordedUsd);
          record.modes = { ...record.modes, ...modes.response };
          responses.set(responseId, record);
        }
        return;
      }
      if (!record) {
        record = { id: responseId, nativeId: signal.responseId || null, agentId: key, sourceType: source, model: agent.model || "", startMs: agent.start, endMs: ms,
          firstMs: signal.kind === "snapshot" ? signal.hasContent ? ms : null : agent.first ?? null, output: null, final: false };
      }
      record.endMs = Math.max(record.endMs, ms);
      if (output != null) record.output = Math.max(record.output || 0, output);
      for (const field of Object.keys(usage)) record[field] = Math.max(record[field] || 0, usage[field]);
      if (recordedUsd != null) record.recordedUsd = Math.max(record.recordedUsd || 0, recordedUsd);
      record.modes = { ...record.modes, ...modes.response };
      if (signal.hasContent && record.firstMs == null) record.firstMs = ms;
      record.final = Boolean(signal.final);
      if (record.final) record.completionOrder = ++completionOrder;
      responses.set(responseId, record);
      agent.latestEnd = Math.max(agent.latestEnd || 0, ms);
      const stop = obj.message?.stop_reason;
      const tool = stop === "tool_use" || (!stop && obj.message?.content?.some?.((part) => part.type === "tool_use"));
      agent.phase = source === "codex" || tool ? "tools" : !stop || stop === "pause_turn" ? "generating" : "idle";
      if (record.final) { agent.start = agent.first = null; agent.streaming = agent.explicit = false; }
      else agent.streaming = true;
    }
    while (responses.size > maxResponses) { responses.delete(responses.keys().next().value); evictedResponses++; }
  }

  function snapshot(now = clock()) {
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
    const reference = (agent) => {
      let rows = measured.filter((r) => r.agentId === agent.id && r.endMs >= now - 10 * 60_000).slice(0, 3);
      if (!rows.length && agent.model) rows = measured.filter((r) => r.model === agent.model && r.sourceType === agent.sourceType).slice(0, 10);
      if (!rows.length) rows = measured.filter((r) => r.sourceType === agent.sourceType).slice(0, 10);
      return rows.length ? rows.reduce((n, r) => n + r.output, 0) / (rows.reduce((n, r) => n + r.durationMs, 0) / 1000) : null;
    };
    const intervals = measured.map((r) => ({ ...r, rate: r.output / (r.durationMs / 1000), estimated: false }));
    const currentAgents = [...agents.values()].map((a) => ({ ...a, phase: now - a.lastLineMs > STALE_MS ? "idle" : a.phase, referenceRate: reference(a) }));
    for (const record of records) {
      if (record.final || record.durationMs == null) continue;
      const agent = currentAgents.find((a) => a.id === record.agentId);
      const rate = agent && reference({ ...agent, model: record.model });
      if (rate != null) intervals.push({ ...record, rate, estimated: true });
    }
    for (const agent of currentAgents) {
      if (agent.phase !== "generating" || agent.start == null || agent.referenceRate == null) continue;
      intervals.push({ agentId: agent.id, sourceType: agent.sourceType, startMs: Math.max(agent.start, agent.latestEnd || 0), endMs: now, rate: agent.referenceRate, estimated: true });
    }
    const end = Math.ceil(now / 1000) * 1000;
    const history = Array.from({ length: 300 }, (_, i) => ({ time: end - (299 - i) * 1000, measured: 0, estimated: 0 }));
    const totals = { measured: 0, estimated: 0 };
    const sources = ["codex", "claude"].map((sourceType) => ({ sourceType, measured: 0, estimated: 0, generating: 0, tools: 0, unknown: 0 }));
    const agentRates = new Map();
    for (const interval of intervals) {
      const field = interval.estimated ? "estimated" : "measured";
      const rate = interval.rate * overlap(now - WINDOW_MS, now, interval.startMs, interval.endMs) / WINDOW_MS;
      totals[field] += rate;
      sources.find((s) => s.sourceType === interval.sourceType)[field] += rate;
      if (!agentRates.has(interval.agentId)) agentRates.set(interval.agentId, { measured: 0, estimated: 0 });
      agentRates.get(interval.agentId)[field] += rate;
      const first = Math.max(0, Math.floor((interval.startMs - (end - 300_000)) / 1000));
      const last = Math.min(299, Math.ceil((interval.endMs - (end - 300_000)) / 1000));
      for (let i = first; i <= last; i++) history[i][field] += interval.rate * overlap(history[i].time - 1000, Math.min(history[i].time, now), interval.startMs, interval.endMs) / 1000;
    }
    const rows = currentAgents.map((agent) => {
      const source = sources.find((s) => s.sourceType === agent.sourceType);
      if (agent.phase !== "idle") source[agent.phase]++;
      const rates = agentRates.get(agent.id) || { measured: 0, estimated: 0 };
      const unknown = agent.phase === "generating" && (agent.referenceRate == null || agent.start == null);
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
        ...rates, unknown, recentRate: agent.referenceRate, performance };
    }).sort((a, b) => Number(b.phase !== "idle") - Number(a.phase !== "idle") || b.lastLineMs - a.lastLineMs);
    const best = highest(rows);
    return { generatedAt: now, windowMs: WINDOW_MS, ...totals, sources, history, agents: rows,
      performance: best ? { ...best.performance, agentId: best.id, title: best.title, sourceType: best.sourceType } : null,
      measuredResponses: measured.length, unmeasuredResponses: records.length - measured.length, evictedResponses,
      generating: sources.reduce((n, s) => n + s.generating, 0), tools: sources.reduce((n, s) => n + s.tools, 0), unknown: sources.reduce((n, s) => n + s.unknown, 0) };
  }
  function stop(context) {
    const agent = agents.get(context.agentKey);
    if (agent && agent.file === context.file) { agent.phase = "idle"; agent.start = null; agent.streaming = agent.explicit = false; }
  }
  return { ingest, snapshot, stop };
}

module.exports = { createLiveSpeedEngine };
