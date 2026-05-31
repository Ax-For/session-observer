(function initTraceModel(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverTraceModel = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createTraceModel() {
  "use strict";

  function toMs(value) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }

  function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function stablePart(value, fallback) {
    const text = String(value || "").trim();
    return text || fallback;
  }

  function eventSpanKind(event) {
    if (event?.callType === "Tool_Call" || event?.callType === "Tool_Result") return "tool";
    if (event?.callType === "Token_Usage") return "token";
    if (event?.callType === "Thinking") return "thinking";
    return "llm";
  }

  function tokenMetrics(tokenUsage) {
    return {
      input: toNumber(tokenUsage?.input),
      output: toNumber(tokenUsage?.output),
      total: toNumber(tokenUsage?.total),
      cacheReadInput: toNumber(tokenUsage?.cacheReadInput ?? tokenUsage?.cachedInput),
      cacheCreationInput: toNumber(tokenUsage?.cacheCreationInput),
      reasoningOutput: toNumber(tokenUsage?.reasoningOutput),
    };
  }

  function updateSpanBounds(span, event) {
    const ms = toMs(event?.time);
    if (ms == null) return;
    if (span.startMs == null || ms < span.startMs) {
      span.startMs = ms;
      span.startTime = event.time || span.startTime;
    }
    if (span.endMs == null || ms > span.endMs) {
      span.endMs = ms;
      span.endTime = event.time || span.endTime;
    }
    span.durationMs = Math.max(0, (span.endMs || ms) - (span.startMs || ms));
  }

  function buildTraceModel(events) {
    const sortedEvents = [...(events || [])].sort((left, right) => {
      const leftMs = toMs(left?.time) ?? 0;
      const rightMs = toMs(right?.time) ?? 0;
      return leftMs - rightMs;
    });
    const traceMap = new Map();
    const spanMap = new Map();

    function ensureSpan(span) {
      const existing = spanMap.get(span.spanId);
      if (existing) return existing;
      spanMap.set(span.spanId, {
        ...span,
        eventIds: [],
        startMs: null,
        endMs: null,
        durationMs: 0,
      });
      return spanMap.get(span.spanId);
    }

    for (const event of sortedEvents) {
      const sessionId = stablePart(event?.sessionId, "unknown");
      if (sessionId === "unknown") continue;

      const trace = traceMap.get(sessionId) || {
        traceId: sessionId,
        title: event?.sessionTitle || "",
        sourceType: event?.sourceType || "unknown",
        cwd: event?.cwd || "",
        spanIds: [],
      };
      if (!trace.title && event?.sessionTitle) trace.title = event.sessionTitle;
      if (!trace.cwd && event?.cwd) trace.cwd = event.cwd;
      traceMap.set(sessionId, trace);

      const sessionSpan = ensureSpan({
        traceId: sessionId,
        spanId: `session:${sessionId}`,
        parentSpanId: "",
        kind: "session",
        name: trace.title || sessionId,
        sourceType: event?.sourceType || "unknown",
        model: event?.model || "unknown",
        toolName: "",
        cwd: event?.cwd || "",
        depth: 1,
        metrics: {},
      });
      updateSpanBounds(sessionSpan, event);
      sessionSpan.eventIds.push(event.eventId || `${sessionId}:${sessionSpan.eventIds.length}`);

      const turnId = stablePart(event?.turnId, "turnless");
      const turnSpan = ensureSpan({
        traceId: sessionId,
        spanId: `turn:${sessionId}:${turnId}`,
        parentSpanId: sessionSpan.spanId,
        kind: "turn",
        name: turnId,
        sourceType: event?.sourceType || "unknown",
        model: event?.model || "unknown",
        toolName: "",
        cwd: event?.cwd || "",
        depth: 2,
        metrics: {},
      });
      updateSpanBounds(turnSpan, event);
      turnSpan.eventIds.push(event.eventId || `${sessionId}:${turnId}:${turnSpan.eventIds.length}`);

      const leafKind = eventSpanKind(event);
      const leafSpan = ensureSpan({
        traceId: sessionId,
        spanId: `event:${event?.eventId || `${sessionId}:${turnId}:${spanMap.size}`}`,
        parentSpanId: turnSpan.spanId,
        kind: leafKind,
        name: event?.toolName || event?.callType || "event",
        sourceType: event?.sourceType || "unknown",
        model: event?.model || "unknown",
        toolName: event?.toolName || "",
        cwd: event?.cwd || "",
        depth: 3,
        metrics: leafKind === "token" ? tokenMetrics(event?.tokenUsage) : {},
      });
      updateSpanBounds(leafSpan, event);
      leafSpan.eventIds.push(event.eventId || leafSpan.spanId);
    }

    const spans = [...spanMap.values()].map((span) => {
      const { startMs, endMs, ...publicSpan } = span;
      return publicSpan;
    });
    for (const trace of traceMap.values()) {
      trace.spanIds = spans.filter((span) => span.traceId === trace.traceId).map((span) => span.spanId);
    }

    return {
      traces: [...traceMap.values()].sort((left, right) => String(right.traceId).localeCompare(String(left.traceId))),
      spans,
    };
  }

  function summarizeTraceModel(model) {
    const spans = model?.spans || [];
    return {
      traces: (model?.traces || []).length,
      spans: spans.length,
      llmSpans: spans.filter((span) => span.kind === "llm").length,
      toolSpans: spans.filter((span) => span.kind === "tool").length,
      tokenSpans: spans.filter((span) => span.kind === "token").length,
      thinkingSpans: spans.filter((span) => span.kind === "thinking").length,
      maxDepth: spans.reduce((max, span) => Math.max(max, Number(span.depth || 0)), 0),
    };
  }

  return {
    buildTraceModel,
    summarizeTraceModel,
  };
});
