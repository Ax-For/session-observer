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
    response = await fetch(url, options);
  } catch (error) {
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

export const apiClient = {
  fetchEvents(params = {}) {
    const query = buildQuery(params);
    return request(`/api/events${query ? `?${query}` : ""}`);
  },

  fetchEventDetail(eventId) {
    const query = buildQuery({ eventId });
    return request(`/api/events/detail?${query}`);
  },

  fetchSessions() {
    return request("/api/sessions");
  },

  fetchObservability() {
    return request("/api/observability");
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
};
