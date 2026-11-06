const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ObserverCore = require("../shared/observer-core");
const { createDialogueSearchIndex } = require("../server/dialogue-search-index");

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-dialogue-cache-"));
  const file = path.join(dir, "rollout-test.jsonl");
  const index = createDialogueSearchIndex({ enabled: true, file: path.join(dir, "cache.sqlite"), parsers: {
    parseCodexLineToEvent: ObserverCore.parseCodexLineToEvent,
    parseClaudeCodeLineToEvent: ObserverCore.parseClaudeCodeLineToEvent,
  }, ...options });
  t.after(() => { index.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const records = () => {
    const stat = fs.statSync(file);
    return [{ file, size: stat.size, mtimeMs: stat.mtimeMs, signature: `${stat.size}:${stat.mtimeMs}` }];
  };
  const write = (rows) => fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return { dir, file, index, records, write };
}
const message = (text, second = 0, role = "assistant") => ({
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, second)).toISOString(), type: "response_item",
  payload: { type: "message", role, content: [{ type: role === "user" ? "input_text" : "output_text", text }] },
});

test("cached search and contextual dialogue preserve child identity across parent turn metadata", (t) => {
  const { index, records, write } = fixture(t);
  write([
    { type: "session_meta", payload: { id: "child", source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } } } },
    { type: "turn_context", payload: { thread_id: "parent" } },
    message("child-only-keyword"),
  ]);
  index.ensureFiles(records());
  const result = index.query("child-only-keyword");
  assert.equal(result.sessions[0].sessionId, "child");
  assert.equal(result.events[0].sessionId, "child");
  assert.equal(index.context(result.events[0].eventId).sessionId, "child");
  assert.equal(index.query("child-only-keyword", { sessionId: "parent" }).events.length, 0);
});

test("dialogue cache searches complete long text and produces hit-centered previews", (t) => {
  const { index, records, write } = fixture(t);
  const text = "前".repeat(180000) + "跨块中文 SQL.Case 目标词" + "尾".repeat(40000);
  write([message(text)]);
  index.ensureFiles(records());
  const hits = index.search("sql.case");
  assert.equal(hits.length, 1);
  assert.match(hits[0].content, /SQL.Case/);
  assert.ok(hits[0].content.length < 1000);
  assert.equal(hits[0].contentLength, text.length);
  const body = index.readBody(hits[0].eventId, { offset: 179990, limit: 100 });
  assert.match(body.content, /目标词/);
  assert.equal(body.totalLength, text.length);
  assert.ok(body.hasMore);
});

test("image and tool payloads are excluded; metadata after a large image is preserved", (t) => {
  const { index, records, write } = fixture(t);
  const row = message("图中需要优化布局", 1, "user");
  row.payload.content.unshift({ type: "input_image", image_url: "data:image/png;base64," + "hiddenImage".repeat(50000) });
  write([row, { timestamp: row.timestamp, type: "response_item", payload: { type: "function_call_output", output: "hiddenTool", call_id: "a" } }]);
  index.ensureFiles(records());
  assert.equal(index.search("hiddenImage").length, 0);
  assert.equal(index.search("hiddenTool").length, 0);
  assert.equal(index.search("优化布局").length, 1);
});

test("cache reuses files, resumes partial appends, rebuilds rewrites, and removes deleted files", (t) => {
  const { index, records, write, file } = fixture(t);
  write([message("first", 1)]);
  assert.equal(index.ensureFiles(records()).indexedFiles, 1);
  assert.equal(index.ensureFiles(records()).reusedFiles, 1);
  const next = JSON.stringify(message("second", 2));
  fs.appendFileSync(file, next.slice(0, 60));
  index.ensureFiles(records());
  assert.equal(index.search("second").length, 0);
  fs.appendFileSync(file, next.slice(60) + "\n");
  assert.equal(index.ensureFiles(records()).appendedFiles, 1);
  assert.equal(index.search("first").length, 1);
  assert.equal(index.search("second").length, 1);
  write([message("third", 3)]);
  index.ensureFiles(records());
  assert.equal(index.search("first").length, 0);
  assert.equal(index.search("third").length, 1);
  fs.unlinkSync(file);
  index.ensureFiles([]);
  assert.equal(index.search("third").length, 0);
});

test("substring matching crosses chunk boundaries and reports exact session counts and context", (t) => {
  const { index, records, write } = fixture(t);
  write([message("before", 1, "user"), message("x".repeat(16383) + "缓存命中", 2), message("缓存命中 after", 3)]);
  index.ensureFiles(records());
  const page = index.query("缓存命中", { limit: 1, offset: 0 });
  assert.equal(page.totalMatching, 2);
  assert.equal(page.sessions[0].matchCount, 2);
  assert.ok(page.page.hasMore);
  const next = index.query("缓存命中", { limit: 1, cursor: page.page.nextCursor });
  assert.equal(next.events.length, 1);
  assert.notEqual(next.events[0].eventId, page.events[0].eventId);
  const context = index.context(next.events[0].eventId);
  assert.equal(context.events.length, 3);
  assert.ok(context.events.some((event) => event.content === "before"));
});

test("cache bodies preserve surrogate pairs at chunk boundaries", (t) => {
  const { index, records, write } = fixture(t);
  const text = "x".repeat(16383) + "🧪测试" + "z".repeat(90000);
  write([message(text)]);
  index.ensureFiles(records());
  const hit = index.search("🧪测试")[0];
  assert.ok(hit);
  assert.equal(index.readBody(hit.eventId, { offset: 16384, limit: 100 }).content, text.slice(16384, 16484));
});

test("writes during a scan are picked up incrementally on the next pass", (t) => {
  let growingFile;
  let appended = false;
  const { file, index, records, write } = fixture(t, { parsers: {
    parseCodexLineToEvent(obj, context) {
      if (!appended) { appended = true; fs.appendFileSync(growingFile, JSON.stringify(message("appended", 2)) + "\n"); }
      return ObserverCore.parseCodexLineToEvent(obj, context);
    },
  } });
  growingFile = file;
  write([message("original", 1)]);
  index.ensureFiles(records());
  assert.equal(index.search("appended").length, 0);
  const result = index.ensureFiles(records());
  assert.equal(result.appendedFiles, 1);
  assert.equal(result.rows, 1);
  assert.equal(index.search("original").length, 1);
  assert.equal(index.search("appended").length, 1);
});

test("completed files survive interruption and same-title sessions stay separate", (t) => {
  let interrupt = true;
  const { file, dir, index, records, write } = fixture(t, { onProgress() { if (interrupt) throw new Error("cancelled"); } });
  write([{ type: "session_meta", payload: { id: "first", title: "same title" } }, message("matching")]);
  const second = path.join(dir, "second.jsonl");
  fs.writeFileSync(second, [JSON.stringify({ type: "session_meta", payload: { id: "second", title: "same title" } }), JSON.stringify(message("matching"))].join("\n") + "\n");
  const list = [...records(), { file: second }];
  assert.throws(() => index.ensureFiles(list), /cancelled/);
  interrupt = false;
  index.close();
  assert.equal(index.ensureFiles(list).reusedFiles, 1);
  assert.equal(index.query("matching").sessions.length, 2);
  fs.writeFileSync(file, [JSON.stringify({ type: "session_meta", payload: { id: "first" } }), JSON.stringify(message("rewritten"))].join("\n") + "\n");
  index.ensureFiles(list);
  assert.equal(index.query("matching").sessions.length, 1);
});
