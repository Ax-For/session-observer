function buildQuery(params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === "" || value == null) return;
    search.set(key, String(value));
  });
  return search.toString();
}

async function request(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
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
