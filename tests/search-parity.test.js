const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDialogueSearchIndex } = require("../server/dialogue-search-index");

test("archive search matches Chinese substrings and removes deleted or active records", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-search-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "data.jsonl");
  fs.writeFileSync(file, JSON.stringify({ time: "2026-01-01T00:00:00Z", content: "这里需要优化会话统计功能" }) + "\n");
  const index = createDialogueSearchIndex({ enabled: true, file: path.join(dir, "index.sqlite"), parsers: {
    parseCodexLineToEvent: (obj) => ({ ...obj, callType: "Agent", sourceType: "codex", sessionId: "test" }),
  } });
  t.after(() => index.close?.());
  index.ensureArchives([{ file, signature: "a", mtimeMs: 1 }]);
  assert.equal(index.search("会话统计").length, 1);
  assert.match(index.search("会话统计")[0].eventId, /^v3:/);
  index.ensureArchives([{ file, signature: "b", mtimeMs: Date.now() }]);
  assert.equal(index.search("会话统计").length, 0);
  index.ensureArchives([{ file, signature: "a", mtimeMs: 1 }]);
  fs.unlinkSync(file);
  index.ensureArchives([]);
  assert.equal(index.search("会话统计").length, 0);
});
