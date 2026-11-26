(function initResponsePerformance(scope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (scope) scope.ObserverResponsePerformance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createResponsePerformance() {
  "use strict";

  const LIVE_HISTORY_MINUTES = Object.freeze([1, 5, 15, 30]);
  const DEFAULT_HISTORY_MINUTES = 5;
  const qwenCodeApi = typeof require === "function" ? require("./qwen-code") : globalThis.ObserverQwenCode;
  const dshApi = typeof require === "function" ? require("./dsh") : globalThis.ObserverDsh;
  const timestamp = (value) => {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  };
  const tokens = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(1e12, Math.floor(value)) : null;

  // Keep only timing/usage facts, never raw message bodies. One signal per source record.
  function signalForRecord(obj, context, source) {
    if (source === "qwen") return qwenCodeApi?.qwenSignal(obj, context);
    if (source === "dsh") return dshApi?.dshSignal(obj, context);
    const p = obj.payload || {};
    if (source === "codex") {
      if (obj.type === "session_meta") {
        if (!context.performanceMeta) context.performanceMeta = {
          startedAt: timestamp(obj.timestamp),
          ordinal: Number.isSafeInteger(p.subagent_history_start_ordinal) ? p.subagent_history_start_ordinal : null,
        };
        return null;
      }
      const meta = context.performanceMeta;
      const ms = timestamp(obj.timestamp);
      if (meta && ((ms != null && meta.startedAt != null && ms < meta.startedAt - 2000)
        || (meta.ordinal != null && Number.isSafeInteger(obj.ordinal) && obj.ordinal < meta.ordinal))) return null;
      if (obj.type === "token_usage_record") return { kind: "usage", modern: true,
        responseId: String(p.response_id || "").slice(0, 240), output: tokens(p.usage?.output_tokens), final: true };
      if (obj.type === "event_msg" && p.type === "token_count" && p.info) return { kind: "usage", modern: false,
        output: tokens(p.info.last_token_usage?.output_tokens), cumulative: tokens(p.info.total_token_usage?.total_tokens),
        cumulativeOutput: tokens(p.info.total_token_usage?.output_tokens), final: true };
      if (obj.type === "event_msg" && ["task_complete", "turn_aborted"].includes(p.type)) return { kind: "end" };
      if ((obj.type === "event_msg" && ["task_started", "user_message"].includes(p.type))
        || (obj.type === "response_item" && (p.type?.endsWith("_output") || (p.type === "message" && ["user", "developer", "system"].includes(p.role))))) return { kind: "start" };
      if (obj.type === "response_item" && (p.type === "reasoning" || p.type?.endsWith("_call") || (p.type === "message" && p.role === "assistant"))) return { kind: "content" };
      if (obj.type === "event_msg" && ["agent_message", "agent_reasoning"].includes(p.type)) return { kind: "content" };
    } else if (source === "claude") {
      if (obj.type === "api-request") return { kind: "start", explicit: true };
      if (obj.type === "user") {
        const content = obj.message?.content;
        const interrupted = typeof content === "string" ? content.startsWith("[Request interrupted by user")
          : Array.isArray(content) && content.some((part) => part.type === "text" && part.text?.startsWith("[Request interrupted by user"));
        return { kind: obj.toolEndsTurn || interrupted ? "end" : "start" };
      }
      if (obj.type === "assistant" && obj.message?.model !== "<synthetic>") return {
        kind: "snapshot", responseId: String(obj.message?.id || obj.requestId || obj.uuid || "").slice(0, 240),
        output: tokens(obj.message?.usage?.output_tokens), final: obj.message?.stop_reason != null,
        hasContent: Array.isArray(obj.message?.content) ? obj.message.content.length > 0 : Boolean(obj.message?.content),
      };
    }
    return null;
  }

  function buildResponsePerformance(events) {
    const ordered = events.filter((event) => event.performanceSignal).slice().sort((a, b) => (timestamp(a.time) ?? 0) - (timestamp(b.time) ?? 0));
    const sourceKey = (event) => `${event.sourceType}|${event.sessionId}`;
    const states = new Map();
    const records = new Map();
    for (const event of ordered) {
      const ms = timestamp(event.time);
      if (ms == null) continue;
      const signal = event.performanceSignal;
      const source = sourceKey(event);
      const key = `${source}|${event.sourceFile || ""}`;
      if (!states.has(key)) states.set(key, { start: null, first: null, streaming: false, explicit: false, cumulative: null });
      const state = states.get(key);
      if (signal.kind === "end") {
        state.start = state.first = null; state.streaming = state.explicit = false;
      } else if (signal.kind === "start") {
        if (!state.streaming && (!state.explicit || signal.explicit)) {
          state.start = signal.startMs ?? ms; state.first = null; state.explicit = Boolean(signal.explicit);
        }
      } else if (signal.kind === "content") {
        if (!state.streaming) state.first = ms;
        state.streaming = true;
      } else if (signal.kind === "usage" || signal.kind === "snapshot") {
        let output = signal.output;
        if (signal.modern) state.modern = true;
        if (signal.kind === "usage" && !signal.modern) {
          if (state.modern) continue;
          if (signal.cumulative != null && signal.cumulative === state.cumulative) continue;
          if (signal.cumulativeOutput != null && state.cumulativeOutput != null && signal.cumulativeOutput >= state.cumulativeOutput) {
            output = signal.cumulativeOutput - state.cumulativeOutput;
          }
          state.cumulative = signal.cumulative;
          state.cumulativeOutput = signal.cumulativeOutput;
        }
        const id = `${source}|${signal.responseId || `${key}|${event.time}`}`;
        const previous = records.get(id);
        if (previous) {
          if (signal.kind === "snapshot") {
            if (!previous.final) previous.endMs = Math.max(previous.endMs, ms);
            if (signal.output != null) previous.outputTokens = Math.max(previous.outputTokens || 0, signal.output);
            if (signal.hasContent && previous.firstMs == null) previous.firstMs = ms;
            previous.final ||= signal.final;
          }
          continue;
        }
        records.set(id, { id, eventId: event.eventId || event.id || "", time: event.time, model: event.model || "unknown",
          sourceType: event.sourceType, startMs: signal.startMs ?? state.start, endMs: ms,
          firstMs: signal.kind === "snapshot" ? (signal.hasContent ? ms : null) : state.first,
          outputTokens: output, final: signal.final, explicitStart: state.explicit });
        // A usage record alone is not evidence that the next request has started.
        state.start = state.first = null; state.streaming = state.explicit = false;
      }
    }
    const responses = [...records.values()].map((record) => {
      const elapsed = record.startMs == null ? null : record.endMs - record.startMs;
      const reason = !record.final ? "unfinished" : record.outputTokens == null ? "missing-usage"
        : elapsed == null ? "missing-start" : elapsed < 0 || elapsed > 15 * 60 * 1000 ? "invalid-interval" : null;
      const durationMs = reason ? null : Math.max(500, elapsed);
      const latency = record.firstMs == null || record.startMs == null ? null : record.firstMs - record.startMs;
      return { ...record, reason, durationMs, durationAdjusted: durationMs != null && durationMs !== elapsed,
        firstContentMs: !reason && latency >= 0 && latency <= elapsed ? latency : null,
        outputTokensPerSecond: durationMs == null ? null : record.outputTokens / (durationMs / 1000) };
    });
    const measured = responses.filter((row) => !row.reason);
    const durationMs = measured.reduce((sum, row) => sum + row.durationMs, 0);
    const outputTokens = measured.reduce((sum, row) => sum + row.outputTokens, 0);
    const waits = measured.map((row) => row.firstContentMs).filter((value) => value != null).sort((a, b) => a - b);
    const percentile = (p) => waits.length ? waits[Math.ceil(waits.length * p) - 1] : null;
    return { scope: "loaded-event-window", basis: "log-boundaries", responses, measuredResponses: measured.length,
      unmeasuredResponses: responses.length - measured.length, outputTokens, durationMs,
      outputTokensPerSecond: durationMs ? outputTokens / (durationMs / 1000) : null,
      firstContentSamples: waits.length, firstContentP50Ms: percentile(0.5), firstContentP95Ms: percentile(0.95) };
  }

  return { signalForRecord, buildResponsePerformance, LIVE_HISTORY_MINUTES, DEFAULT_HISTORY_MINUTES };
});
