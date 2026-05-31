const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getSourceAdapter,
  listSourceAdapters,
  resolveSourceAdapterForFile,
} = require("../shared/source-adapters");

test("source adapters describe supported local coding agent sources", () => {
  const adapters = listSourceAdapters();

  assert.deepEqual(adapters.map((adapter) => adapter.key), ["codex", "claude"]);
  assert.equal(getSourceAdapter("codex").label, "Codex");
  assert.equal(getSourceAdapter("claude").sessionGlob, "~/.claude/projects/**/*.jsonl");
});

test("source adapters resolve transcript paths without parser-specific branching", () => {
  assert.equal(resolveSourceAdapterForFile("/Users/me/.codex/sessions/2026/05/session.jsonl").key, "codex");
  assert.equal(resolveSourceAdapterForFile("/Users/me/.claude/projects/repo/session.jsonl").key, "claude");
  assert.equal(resolveSourceAdapterForFile("/tmp/manual-import.jsonl").key, "codex");
});
