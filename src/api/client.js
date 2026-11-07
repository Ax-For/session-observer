/**
 * API client for the Session Observer backend.
 * @module apiClient
 */

/**
 * @typedef {Object} FetchEventsParams
 * @property {string} [mode] - "observe" | "raw"
 * @property {string} [platform]
 * @property {string} [model]
 * @property {string} [type]
 * @property {string} [sessionId]
 * @property {string} [q] - Search query
 * @property {number} [offset]
 * @property {number} [limit]
 * @property {string} [order] - "asc" | "desc"
 */

/** Build URL query string from params, omitting empty values */
function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === "" || value == null) return;
    search.set(key, String(value));
  });
  return search.toString();
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, headers: { "X-Observer-Request": "1", ...options?.headers } });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error(`Network error: ${error.message || "request failed"}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Invalid JSON response: ${response.status} ${response.statusText}`);
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return payload;
}

async function requestDownload(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Network error: ${error.message || "request failed"}`);
  }

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // fall back to status text below
    }
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }

  const disposition = response.headers.get("content-disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"]+)"/i);
  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] || "session-export.md",
  };
}

export const apiClient = {
  fetchUsageHistory(params, options) { return request(`/api/usage-history?${buildQuery(params)}`, options); },
  fetchUsageHistoryStatus(options) { return request("/api/usage-history/status", options); },
  refreshUsageHistory() { return request("/api/usage-history/refresh", { method: "POST" }); },
  downloadUsageHistory(params, format = "csv") { return requestDownload(`/api/usage-history?${buildQuery({ ...params, format })}`); },
  fetchDiagnostics(options) { return request("/api/diagnostics", options); },
  recoverDiagnostics() { return request("/api/diagnostics/recover", { method: "POST" }); },
  cancelQuery(id) { return request("/api/diagnostics/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); },
  fetchLibrary(options) { return request("/api/library", options); },
  saveLibrary(kind, value) { return request("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...value, kind }) }); },
  fetchAudit(options) { return request("/api/audit", options); },
  fetchPricebook(options) { return request("/api/pricebook", options); },
  savePricebook(rates) { return request("/api/pricebook", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rates }) }); },
  fetchSessionAnalysis(id, options) { return request(`/api/sessions/${encodeURIComponent(id)}/analysis`, options); },
  fetchEvents(params = {}, options = {}) {
    const query = buildQuery(params);
    return request(`/api/events${query ? `?${query}` : ""}`, options);
  },

  fetchEventDetail(eventId, options) {
    const query = buildQuery({ eventId });
    return request(`/api/events/detail?${query}`, options);
  },
  fetchDialogueBody(eventId, params = {}, options) {
    return request(`/api/events/body?${buildQuery({ eventId, ...params })}`, options);
  },
  fetchDialogueContext(eventId, options) {
    return request(`/api/events/context?${buildQuery({ eventId })}`, options);
  },

  fetchSessions(options) {
    return request("/api/sessions", options);
  },

  fetchSessionReplay(sessionId, limit = 500, options) {
    const query = buildQuery({ limit });
    return request(`/api/sessions/${encodeURIComponent(sessionId)}/replay?${query}`, options);
  },

  compareSessions(left, right) {
    const query = buildQuery({ left, right });
    return request(`/api/sessions/compare?${query}`);
  },

  fetchSessionAnnotation(sessionId) {
    return request(`/api/sessions/${encodeURIComponent(sessionId)}/annotation`);
  },

  saveSessionAnnotation(sessionId, annotation) {
    return request(`/api/sessions/${encodeURIComponent(sessionId)}/annotation`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotation || {}),
    });
  },

  fetchObservability(options) {
    return request("/api/observability", options);
  },

  recalculateObservability(options) {
    return request("/api/observability/recalculate", {
      method: "POST",
      ...options,
    });
  },

  fetchCodexUsage() {
    return request("/api/codex-usage");
  },

  refreshCodexUsage() {
    return request("/api/codex-usage/refresh", {
      method: "POST",
    });
  },

  fetchIndexWindow() {
    return request("/api/index-window");
  },

  setIndexWindow(days) {
    return request("/api/index-window", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
  },

  renameSession(sessionId, newName) {
    return request("/api/sessions/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, newName }),
    });
  },

  deleteSession(sessionId) {
    return request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
  },

  batchDeleteSessions(sessionIds) {
    return request("/api/sessions/batch-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds }),
    });
  },

  exportSession(sessionId, options = {}) {
    const query = buildQuery({
      format: options.format || "markdown",
      sanitize: options.sanitize === false ? 0 : 1,
    });
    return requestDownload(`/api/sessions/${encodeURIComponent(sessionId)}/export?${query}`);
  },
};
