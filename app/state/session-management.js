(function bootstrapObserverSessionState(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverSessionState = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverSessionStateModule() {
  "use strict";

  function filterSessionGroups(groups, filters) {
    const sourceGroups = groups || {};
    const query = String(filters?.query || "").trim().toLowerCase();
    const platform = filters?.platform || "";
    const namedOnly = Boolean(filters?.namedOnly);
    const filteredGroups = {};

    for (const [cwd, sessions] of Object.entries(sourceGroups)) {
      const filteredSessions = (sessions || []).filter((session) => {
        if (platform && session.sourceType !== platform) return false;
        if (namedOnly && !session.sessionTitle) return false;
        if (!query) return true;

        const title = String(session.sessionTitle || session.fallbackTitle || "").toLowerCase();
        const sessionId = String(session.sessionId || "").toLowerCase();
        const cwdLower = String(cwd).toLowerCase();
        return title.includes(query) || sessionId.includes(query) || cwdLower.includes(query);
      });

      if (filteredSessions.length > 0) {
        filteredGroups[cwd] = filteredSessions;
      }
    }

    return filteredGroups;
  }

  function getAllSessionIds(groups) {
    const ids = [];
    for (const sessions of Object.values(groups || {})) {
      for (const session of sessions || []) {
        ids.push(session.sessionId);
      }
    }
    return ids;
  }

  function areAllSelected(groups, selectedSessionIds) {
    const ids = getAllSessionIds(groups);
    return ids.length > 0 && ids.every((sessionId) => selectedSessionIds.has(sessionId));
  }

  function buildSelectedSessionList(groups, selectedSessionIds) {
    const selectedList = [];
    for (const sessions of Object.values(groups || {})) {
      for (const session of sessions || []) {
        if (!selectedSessionIds.has(session.sessionId)) continue;
        selectedList.push({
          sessionId: session.sessionId,
          title: session.sessionTitle || session.fallbackTitle || "未命名会话",
        });
      }
    }
    return selectedList;
  }

  function renameSessionInGroups(groups, sessionId, newName) {
    if (!groups || !sessionId || !newName) return false;
    for (const sessions of Object.values(groups)) {
      const found = sessions.find((session) => session.sessionId === sessionId);
      if (!found) continue;
      found.sessionTitle = newName;
      found.fallbackTitle = "";
      return true;
    }
    return false;
  }

  function removeSessionsFromGroups(groups, sessionIds) {
    if (!groups) return 0;
    const sessionIdSet = new Set(Array.isArray(sessionIds) ? sessionIds : [sessionIds]);
    let removed = 0;

    for (const [cwd, sessions] of Object.entries(groups)) {
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (!sessionIdSet.has(sessions[index].sessionId)) continue;
        sessions.splice(index, 1);
        removed += 1;
      }
      if (sessions.length === 0) {
        delete groups[cwd];
      }
    }

    return removed;
  }

  return {
    areAllSelected,
    buildSelectedSessionList,
    filterSessionGroups,
    getAllSessionIds,
    removeSessionsFromGroups,
    renameSessionInGroups,
  };
});
