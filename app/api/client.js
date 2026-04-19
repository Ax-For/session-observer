(function bootstrapObserverApi(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverApi = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverApiModule() {
  "use strict";

  function buildEventsQuery(input) {
    const params = new URLSearchParams();
    const data = input || {};

    params.set("mode", data.mode || "observe");
    params.set("order", data.order || "desc");
    params.set("offset", String(Number(data.offset) || 0));
    params.set("limit", String(Number(data.limit) || 250));
    params.set("quickFilter", data.quickFilter || "all");
    params.set("tokenThreshold", String(Number(data.tokenThreshold) || 0));

    if (String(data.q || "").trim()) params.set("q", String(data.q).trim());
    if (data.platform) params.set("platform", data.platform);
    if (data.model) params.set("model", data.model);
    if (data.type) params.set("type", data.type);
    if (data.start) params.set("start", data.start);
    if (data.end) params.set("end", data.end);
    if (data.sessionId) params.set("sessionId", data.sessionId);

    return params.toString();
  }

  async function readJsonSafely(response) {
    if (!response || typeof response.json !== "function") return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function getErrorMessage(response, payload) {
    if (payload && typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
    const status = response && Number.isFinite(Number(response.status)) ? response.status : "unknown";
    return `HTTP ${status}`;
  }

  function createApiClient(options) {
    const fetchImpl = options?.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    if (!fetchImpl) {
      throw new Error("fetch implementation is required");
    }

    async function requestJson(url, requestOptions) {
      const response = await fetchImpl(url, requestOptions);
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        throw new Error(getErrorMessage(response, payload));
      }
      return payload;
    }

    function listRealtimeEvents(input) {
      const query = buildEventsQuery(input);
      return requestJson(`/api/events?${query}`, { cache: "no-store" });
    }

    function listSessionEvents(input) {
      const query = buildEventsQuery({
        mode: input?.mode || "observe",
        order: input?.order || "asc",
        offset: input?.offset || 0,
        limit: input?.limit || 100,
        sessionId: input?.sessionId || "",
      });
      return requestJson(`/api/events?${query}`, { cache: "no-store" });
    }

    function listSessions() {
      return requestJson("/api/sessions", { cache: "no-store" });
    }

    function renameSession(input) {
      return requestJson("/api/sessions/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: input?.sessionId || "",
          newName: input?.newName || "",
        }),
      });
    }

    function deleteSession(input) {
      return requestJson(`/api/sessions/${input?.sessionId || ""}`, { method: "DELETE" });
    }

    function batchDeleteSessions(sessionIds) {
      return requestJson("/api/sessions/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: Array.isArray(sessionIds) ? sessionIds : [] }),
      });
    }

    async function exportSessionEvents(sessionIds, options) {
      const ids = Array.isArray(sessionIds) ? sessionIds : [];
      const limit = Number(options?.limit) || 10000;
      const exportData = [];

      for (const sessionId of ids) {
        try {
          const payload = await listSessionEvents({ sessionId, limit });
          if (!payload || !Array.isArray(payload.events)) continue;
          exportData.push(
            ...payload.events.map((event) => ({
              sessionId: event.sessionId,
              time: event.time,
              callType: event.callType,
              model: event.model,
              content: event.content,
              tokenUsage: event.tokenUsage,
            }))
          );
        } catch {
          // Keep existing behavior: skip failed session fetches during batch export.
        }
      }

      return exportData;
    }

    return {
      listRealtimeEvents,
      listSessionEvents,
      listSessions,
      renameSession,
      deleteSession,
      batchDeleteSessions,
      exportSessionEvents,
    };
  }

  return {
    buildEventsQuery,
    createApiClient,
  };
});
