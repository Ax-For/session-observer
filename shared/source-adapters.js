(function initSourceAdapters(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverSourceAdapters = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createSourceAdapters() {
  "use strict";

  const SOURCE_ADAPTERS = [
    {
      key: "codex",
      label: "Codex",
      sessionGlob: "~/.codex/sessions/**/*.jsonl",
      metadataSources: ["~/.codex/session_index.jsonl", "~/.codex/state_5.sqlite"],
      parserKey: "parseCodexLineToEvent",
      pathMarkers: ["/.codex/"],
      capabilities: ["events", "conversation", "tokens", "rename", "delete", "export"],
    },
    {
      key: "claude",
      label: "Claude Code",
      sessionGlob: "~/.claude/projects/**/*.jsonl",
      metadataSources: ["~/.claude/sessions/*.json"],
      parserKey: "parseClaudeCodeLineToEvent",
      pathMarkers: ["/.claude/"],
      capabilities: ["events", "conversation", "tokens", "rename", "delete", "export"],
    },
  ];

  const DEFAULT_ADAPTER = SOURCE_ADAPTERS[0];

  function cloneAdapter(adapter) {
    return {
      ...adapter,
      metadataSources: [...adapter.metadataSources],
      pathMarkers: [...adapter.pathMarkers],
      capabilities: [...adapter.capabilities],
    };
  }

  function listSourceAdapters() {
    return SOURCE_ADAPTERS.map(cloneAdapter);
  }

  function getSourceAdapter(sourceType) {
    return cloneAdapter(SOURCE_ADAPTERS.find((adapter) => adapter.key === sourceType) || DEFAULT_ADAPTER);
  }

  function resolveSourceAdapterForFile(filePath) {
    const normalized = String(filePath || "").replace(/\\/g, "/");
    const adapter = SOURCE_ADAPTERS.find((item) => (
      item.pathMarkers.some((marker) => normalized.includes(marker))
    ));
    return cloneAdapter(adapter || DEFAULT_ADAPTER);
  }

  return {
    getSourceAdapter,
    listSourceAdapters,
    resolveSourceAdapterForFile,
  };
});
