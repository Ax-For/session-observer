(function bootstrapObserverStreamFilters(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverStreamFilters = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverStreamFiltersModule() {
  "use strict";

  const ALERT_PATTERN = /(error|failed|exception|timeout|invalid|reject|denied|拒绝|失败|错误|异常)/i;

  function toDateMs(input) {
    if (!input) return null;
    const ms = Date.parse(input);
    return Number.isNaN(ms) ? null : ms;
  }

  function isAlertEvent(event) {
    if (!event) return false;
    if (event.callType === "Tool_Result" || event.callType === "Tool_Call") {
      return ALERT_PATTERN.test(event.content || "") || ALERT_PATTERN.test(event.extra || "");
    }
    if (event.callType === "Agent") {
      return ALERT_PATTERN.test(event.content || "");
    }
    return false;
  }

  function matchStreamEvent(event, filters, helpers = {}) {
    const safeEvent = event || {};
    const safeFilters = filters || {};
    const eventMatchesMode = helpers.eventMatchesMode || (() => true);

    const query = (safeFilters.query || "").trim().toLowerCase();
    const model = safeFilters.model || "";
    const type = safeFilters.type || "";
    const platform = safeFilters.platform || "";
    const start = toDateMs(safeFilters.start);
    const end = toDateMs(safeFilters.end);
    const eventMs = toDateMs(safeEvent.time);

    if (!eventMatchesMode(safeEvent)) return false;
    if (platform && safeEvent.sourceType !== platform) return false;
    if (model && safeEvent.model !== model) return false;
    if (type && safeEvent.callType !== type) return false;
    if (safeFilters.selectedSessionId && safeEvent.sessionId !== safeFilters.selectedSessionId) return false;
    if (safeFilters.quickFilter === "alert" && !isAlertEvent(safeEvent)) return false;
    if (safeFilters.quickFilter === "high_token") {
      const total = Number(safeEvent.tokenUsage?.total);
      const threshold = Number(safeFilters.tokenThreshold || 20000);
      if (!(Number.isFinite(total) && total >= threshold)) return false;
    }
    if (start && eventMs && eventMs < start) return false;
    if (end && eventMs && eventMs > end) return false;
    if (!query) return true;

    return [
      safeEvent.content,
      safeEvent.callType,
      safeEvent.model,
      safeEvent.sessionId,
      safeEvent.turnId,
      safeEvent.callId,
      safeEvent.toolName,
      safeEvent.extra,
      safeEvent.rawType,
      safeEvent.rawSubType,
      safeEvent.cwd,
      safeEvent.sessionTitle,
      safeEvent.tokenUsage ? JSON.stringify(safeEvent.tokenUsage) : "",
    ]
      .filter((value) => value != null)
      .some((value) => String(value).toLowerCase().includes(query));
  }

  return {
    ALERT_PATTERN,
    toDateMs,
    isAlertEvent,
    matchStreamEvent,
  };
});
