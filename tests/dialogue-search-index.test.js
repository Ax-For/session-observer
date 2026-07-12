const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDialogueSearchIndex } = require("../server/dialogue-search-index");

test("optional SQLite dialogue index stores immutable archives on disk", (t) => {
  let DatabaseSync;
  try {
    DatabaseSync = require("node:sqlite").DatabaseSync;
  } catch {
    t.skip("node:sqlite unavailable");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-search-"));
  const sourceDir = path.join(dir, ".codex");
  fs.mkdirSync(sourceDir);
  const source = path.join(sourceDir, "00000000-0000-0000-0000-000000000001.jsonl");
  fs.writeFileSync(source, `${JSON.stringify({ role: "user", content: "repair cache accounting", time: "2026-07-01T10:00:00Z" })}\n`);
  const oldTime = new Date("2026-07-01T10:00:00Z");
  fs.utimesSync(source, oldTime, oldTime);
  const stat = fs.statSync(source);
  const index = createDialogueSearchIndex({
    enabled: true,
    DatabaseSync,
    file: path.join(dir, "search.sqlite"),
    parsers: {
      parseCodexLineToEvent(obj, context) {
        return { ...obj, callType: "Prompt", sessionId: context.sessionId, sourceType: "codex", sourceFile: source };
      },
    },
  });
  const result = index.ensureArchives([{ file: source, mtimeMs: stat.mtimeMs, signature: `${source}:${stat.size}:${stat.mtimeMs}` }], Date.parse("2026-07-12T10:00:00Z"));
  assert.equal(result.indexedFiles, 1);
  assert.equal(index.search("cache accounting").length, 1);
  assert.equal(index.ensureArchives([{ file: source, mtimeMs: stat.mtimeMs, signature: `${source}:${stat.size}:${stat.mtimeMs}` }], Date.parse("2026-07-12T10:00:00Z")).reusedFiles, 1);
});
