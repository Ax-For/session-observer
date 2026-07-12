(function initSessionInsights(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (globalScope) globalScope.ObserverSessionInsights = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSessionInsights() {
  "use strict";

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function toMs(value) {
    const number = Date.parse(value);
    return Number.isFinite(number) ? number : null;
  }

  function eventKind(event) {
    const type = `${event?.callType || ""} ${event?.rawType || ""} ${event?.rawSubType || ""}`.toLowerCase();
    const detail = `${type} ${eventText(event).slice(0, 180)}`.toLowerCase();
    if (type === "prompt" || type === "user" || /\b(prompt|user)\b/.test(type)) return "user";
    if (type === "agent" || /\b(assistant|agent)\b/.test(type)) return "agent";
    if (/tool[_ -]?(result|output)|custom_tool_call_output/.test(detail)) return "tool-result";
    if (event?.toolName || /tool[_ -]?(call|use)|custom_tool_call/.test(detail)) return "tool-call";
    if (/token[_ -]?usage/.test(type)) return "usage";
    if (/thinking|reasoning/.test(type)) return "thinking";
    return "system";
  }

  function eventText(event) {
    return String(event?.content || event?.summary || "").trim();
  }

  function eventTokenTotal(event) {
    const usage = event?.tokenUsage || {};
    return finite(usage.effectiveTotal || usage.total || (
      finite(usage.input) + finite(usage.cacheReadInput || usage.cachedInput) + finite(usage.output)
    ));
  }

  function isErrorEvent(event) {
    if (event?.isError || event?.level === "error") return true;
    return eventKind(event) === "tool-result" && /\b(error|failed|failure|exception|fatal)\b/i.test(eventText(event));
  }

  function buildExecutionReplay(events, options = {}) {
    const limit = Math.max(1, finite(options.limit) || 500);
    const sorted = [...(events || [])]
      .filter(Boolean)
      .sort((left, right) => (toMs(left?.time) || 0) - (toMs(right?.time) || 0));
    const ordered = [];
    for (const event of sorted) {
      const kind = eventKind(event);
      const signature = `${kind}|${event?.toolName || ""}|${eventText(event).replace(/\s+/g, " ").trim()}|${eventTokenTotal(event)}`;
      const previous = ordered.at(-1);
      const previousMs = toMs(previous?.event?.time);
      const currentMs = toMs(event?.time);
      if (previous?.signature === signature && previousMs != null && currentMs != null && currentMs - previousMs <= 2000) continue;
      ordered.push({ event, signature });
    }
    const replayEvents = ordered.slice(-limit).map((item) => item.event);
    const steps = replayEvents.map((event, index) => {
      const currentMs = toMs(event?.time);
      const nextMs = toMs(replayEvents[index + 1]?.time);
      const gapMs = currentMs != null && nextMs != null ? Math.max(0, nextMs - currentMs) : 0;
      const kind = eventKind(event);
      const kindTitle = kind === "tool-call" ? "工具调用" : kind === "tool-result" ? "工具结果" : event.callType || "事件";
      return {
        id: event.eventId || event.id || `${event?.sessionId || "session"}-${index}`,
        eventId: event.eventId || event.id || "",
        kind,
        time: event.time || "",
        model: event.model || "",
        toolName: event.toolName || "",
        title: event.toolName || kindTitle,
        preview: eventText(event).replace(/\s+/g, " ").slice(0, 280),
        tokenTotal: eventTokenTotal(event),
        gapMs,
        status: isErrorEvent(event) ? "error" : "ok",
      };
    });
    const slowest = [...steps]
      .filter((step) => step.gapMs > 0)
      .sort((left, right) => right.gapMs - left.gapMs)
      .slice(0, 5)
      .map((step) => step.id);
    return {
      steps,
      total: steps.length,
      startedAt: steps[0]?.time || "",
      endedAt: steps.at(-1)?.time || "",
      durationMs: Math.max(0, (toMs(steps.at(-1)?.time) || 0) - (toMs(steps[0]?.time) || 0)),
      errors: steps.filter((step) => step.status === "error").length,
      toolSteps: steps.filter((step) => step.kind === "tool-call").length,
      tokenTotal: steps.reduce((sum, step) => sum + step.tokenTotal, 0),
      slowestStepIds: slowest,
      truncated: replayEvents.length < (events || []).length,
    };
  }

  function deriveSessionOutcome(session, annotation = null) {
    const explicit = annotation?.outcome && annotation.outcome !== "unreviewed" ? annotation.outcome : "";
    const toolErrors = finite(session?.toolErrors);
    const agentMessages = finite(session?.agent);
    const editedFiles = session?.editedFiles?.length || 0;
    const status = explicit || (toolErrors > 0 && !agentMessages ? "failed" : agentMessages ? "unknown" : "unknown");
    return {
      status,
      reviewed: Boolean(explicit),
      editedFiles,
      toolCalls: finite(session?.toolCalls),
      toolErrors,
      compactions: finite(session?.compactions),
      prompts: finite(session?.prompt),
      agentMessages,
      durationMs: Math.max(0, (toMs(session?.latest) || 0) - (toMs(session?.startedAt) || 0)),
      evidence: [
        editedFiles ? `${editedFiles} files edited` : "",
        toolErrors ? `${toolErrors} tool errors` : "",
        session?.latestAgentMessage ? "agent response captured" : "",
      ].filter(Boolean),
    };
  }

  function sessionMetrics(session) {
    const token = session?.aggregateToken || session?.latestToken || {};
    return {
      durationMs: Math.max(0, (toMs(session?.latest) || 0) - (toMs(session?.startedAt) || 0)),
      events: finite(session?.count),
      prompts: finite(session?.prompt),
      agentMessages: finite(session?.agent),
      toolCalls: finite(session?.toolCalls),
      toolErrors: finite(session?.toolErrors),
      editedFiles: session?.editedFiles?.length || 0,
      compactions: finite(session?.compactions),
      tokens: finite(token.effectiveTotal || token.total || session?.totalTokens || session?.tokens),
      cost: finite(session?.estimatedUsd),
      cacheRead: finite(token.cacheReadInput || token.cachedInput),
      output: finite(token.output),
    };
  }

  function compareSessions(left, right) {
    const leftMetrics = sessionMetrics(left);
    const rightMetrics = sessionMetrics(right);
    const delta = Object.fromEntries(Object.keys(leftMetrics).map((key) => [key, rightMetrics[key] - leftMetrics[key]]));
    return { left: leftMetrics, right: rightMetrics, delta };
  }

  function buildDataConfidence(input = {}) {
    const tokens = finite(input.totalTokens);
    const knownTokens = finite(input.knownTokenTotal);
    const sessions = finite(input.sessionsTotal);
    const sessionsWithTokens = finite(input.sessionsWithTokens);
    const files = finite(input.totalFiles);
    const reusedFiles = finite(input.reusedFiles);
    const costCoverage = tokens > 0 ? Math.min(100, knownTokens / tokens * 100) : 100;
    const sessionCoverage = sessions > 0 ? Math.min(100, sessionsWithTokens / sessions * 100) : 100;
    const cacheReuse = files > 0 ? Math.min(100, reusedFiles / files * 100) : 100;
    const unknownModels = [...new Set(input.unknownModels || [])].filter(Boolean);
    const score = Math.round(costCoverage * 0.5 + sessionCoverage * 0.35 + cacheReuse * 0.15);
    return {
      score,
      level: score >= 90 ? "high" : score >= 70 ? "medium" : "low",
      costCoverage,
      sessionCoverage,
      cacheReuse,
      unknownModels,
      pricingVersion: input.pricingVersion || "builtin",
    };
  }

  return {
    buildDataConfidence,
    buildExecutionReplay,
    compareSessions,
    deriveSessionOutcome,
    eventKind,
  };
});
