const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const reader = require("../server/recent-events-reader");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-reader-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, rows, mtimeMs) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return { file, mtimeMs };
  };
  const parser = (obj, context) => ({ ...obj, sourceFile: context.sourceFile, sourceType: "codex", callType: "Agent", sessionId: "session" });
  return { write, parsers: { parseCodexLineToEvent: parser } };
}

test("latest page merges interleaved files rather than trusting mtime", (t) => {
  const { write, parsers } = fixture(t);
  const files = [write("a.jsonl", [
    { time: "2026-09-12T10:00:00Z", content: "old" },
    { time: "2026-09-12T12:00:00Z", content: "newest" },
  ], 200), write("b.jsonl", [{ time: "2026-09-12T11:00:00Z", content: "middle" }], 100)];
  const page = reader.queryRecentEvents({ files, parsers, limit: 2, filters: { order: "desc" } });
  assert.deepEqual(page.events.map((e) => e.content), ["newest", "middle"]);
  assert.equal(page.page.hasMore, true);
  const next = reader.queryRecentEvents({ files, parsers, limit: 2, filters: { order: "desc", cursor: page.page.nextCursor } });
  assert.deepEqual(next.events.map((e) => e.content), ["old"]);
});

test("event locators can be recovered after cache eviction without scanning transcripts", (t) => {
  const { write, parsers } = fixture(t);
  const files = [write("a.jsonl", [{ time: "2026-09-12T10:00:00Z", content: "detail" }], 100)];
  const page = reader.queryRecentEvents({ files, parsers, limit: 1 });
  reader.clearLocatorCache();
  const locator = reader.resolveEventLocator(page.events[0].eventId, files);
  assert.equal(locator.sourceFile, files[0].file);
  assert.equal(locator.sourceOffset, 0);
  assert.equal(reader.resolveEventLocator(page.events[0].eventId, []), null);
});

test("cursor stays stable when new events arrive between pages", (t) => {
  const { write, parsers } = fixture(t);
  const files = [write("a.jsonl", [1, 2, 3].map((n) => ({ time: `2026-09-12T10:00:0${n}Z`, content: String(n) })), 100)];
  const page = reader.queryRecentEvents({ files, parsers, limit: 2 });
  fs.appendFileSync(files[0].file, JSON.stringify({ time: "2026-09-12T10:00:04Z", content: "4" }) + "\n");
  const next = reader.queryRecentEvents({ files, parsers, limit: 2, filters: { cursor: page.page.nextCursor } });
  assert.deepEqual(next.events.map((e) => e.content), ["1"]);
});
