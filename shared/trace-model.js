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
      const trace = traceMap.get(span.traceId);
      if (trace) trace.spanIds.push(span.spanId);
      return spanMap.get(span.spanId);
    }

    for (const event of events || []) {
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

    return {
      traces: [...traceMap.values()].sort((left, right) => String(right.traceId).localeCompare(String(left.traceId))),
      spans,
    };
  }

  function summarizeTraceModel(model) {
    const spans = model?.spans || [];
    const summary = {
      traces: (model?.traces || []).length,
      spans: spans.length,
      llmSpans: 0,
      toolSpans: 0,
      tokenSpans: 0,
      thinkingSpans: 0,
      maxDepth: 0,
    };
    for (const span of spans) {
      if (span.kind === "llm") summary.llmSpans += 1;
      if (span.kind === "tool") summary.toolSpans += 1;
      if (span.kind === "token") summary.tokenSpans += 1;
      if (span.kind === "thinking") summary.thinkingSpans += 1;
      summary.maxDepth = Math.max(summary.maxDepth, Number(span.depth || 0));
    }
    return summary;
  }

  function summarizeEvents(events) {
    const traceIds = new Set();
    const turnIds = new Set();
    const summary = {
      traces: 0,
      spans: 0,
      llmSpans: 0,
      toolSpans: 0,
      tokenSpans: 0,
      thinkingSpans: 0,
      maxDepth: 0,
    };

    for (const event of events || []) {
      const sessionId = stablePart(event?.sessionId, "unknown");
      if (sessionId === "unknown") continue;
      const turnId = stablePart(event?.turnId, "turnless");
      traceIds.add(sessionId);
      turnIds.add(`${sessionId}:${turnId}`);

      const kind = eventSpanKind(event);
      if (kind === "llm") summary.llmSpans += 1;
      if (kind === "tool") summary.toolSpans += 1;
      if (kind === "token") summary.tokenSpans += 1;
      if (kind === "thinking") summary.thinkingSpans += 1;
      summary.spans += 1;
    }

    summary.traces = traceIds.size;
    summary.spans += traceIds.size + turnIds.size;
    summary.maxDepth = summary.spans ? 3 : 0;
    return {
      traces: summary.traces,
      spans: summary.spans,
      llmSpans: summary.llmSpans,
      toolSpans: summary.toolSpans,
      tokenSpans: summary.tokenSpans,
      thinkingSpans: summary.thinkingSpans,
      maxDepth: summary.maxDepth,
    };
  }

  return {
    buildTraceModel,
    summarizeEvents,
    summarizeTraceModel,
  };
});
