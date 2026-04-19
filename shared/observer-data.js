(function bootstrapObserverData(globalScope, factory) {
  const core = (typeof module === "object" && module.exports)
    ? require("./observer-core")
    : (globalScope && globalScope.ObserverCore);
  const api = factory(core);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverData = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverData(core) {
  "use strict";

  if (!core) {
    throw new Error("ObserverCore is required");
  }

  const {
    dedupeEvents,
    parseClaudeCodeLineToEvent,
    parseCodexLineToEvent,
  } = core;

  function detectSourceType(fileName) {
    return /claude|\.claude/i.test(fileName) || /\/\.claude\//i.test(fileName) ? "claude" : "codex";
  }

  async function parseFile(file) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const parsed = [];
    const context = { model: "unknown", sessionId: "unknown", sourceFile: file.name, cwd: "", sessionTitle: "" };
    const parser = detectSourceType(file.name) === "claude"
      ? parseClaudeCodeLineToEvent
      : parseCodexLineToEvent;

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const evtOrArray = parser(obj, context);
        const events = Array.isArray(evtOrArray) ? evtOrArray : [evtOrArray].filter(Boolean);
        for (const event of events) {
          if (event) parsed.push(event);
        }
      } catch {
        // Ignore invalid JSON lines.
      }
    }

    return dedupeEvents(parsed);
  }

  async function parseFiles(files) {
    const all = [];
    for (const file of files) {
      const parsed = await parseFile(file);
      all.push(...parsed);
    }
    all.sort((a, b) => (a.time < b.time ? -1 : 1));
    return dedupeEvents(all);
  }

  function normalizeRealtimePayload(payload, { append, currentEvents, pageLimit }) {
    if (!Array.isArray(payload.events)) {
      throw new Error("invalid payload");
    }
    const incoming = dedupeEvents(payload.events);
    const events = append ? [...currentEvents, ...incoming] : incoming;

    return {
      events,
      filtered: events,
      sessions: Array.isArray(payload.sessions) ? payload.sessions : [],
      meta: payload.meta || { models: [], types: [] },
      totalVisible: Number(payload.totalVisible) || 0,
      totalMatching: Number(payload.totalMatching) || events.length,
      pageOffset: Number(payload.page?.offset) || 0,
      pageLimit: Number(payload.page?.limit) || pageLimit,
      hasMore: Boolean(payload.page?.hasMore),
      claudeVersion: payload.claudeVersion || null,
      codexVersion: payload.codexVersion || null,
    };
  }

  return {
    detectSourceType,
    normalizeRealtimePayload,
    parseFile,
    parseFiles,
  };
});
