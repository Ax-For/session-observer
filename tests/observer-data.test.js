const test = require("node:test");
const assert = require("node:assert/strict");

const {
  detectSourceType,
  normalizeRealtimePayload,
  parseFiles,
} = require("../shared/observer-data");

test("detectSourceType identifies Claude and Codex transcript filenames", () => {
  assert.equal(detectSourceType("/Users/me/.claude/projects/demo/session.jsonl"), "claude");
  assert.equal(detectSourceType("codex-session.jsonl"), "codex");
});

test("parseFiles parses and sorts mixed Codex and Claude files", async () => {
  const files = [
    {
      name: "codex-session.jsonl",
      async text() {
        return [
          JSON.stringify({
            timestamp: "2026-04-19T10:00:05.000Z",
            type: "turn_context",
            payload: { model: "gpt-5.4", thread_id: "sess-codex", cwd: "/tmp/codex" },
          }),
          JSON.stringify({
            timestamp: "2026-04-19T10:00:06.000Z",
            type: "response_item",
            payload: {
              type: "message",
              role: "user",
              content: [{ text: "Summarize this session" }],
            },
          }),
        ].join("\n");
      },
    },
    {
      name: "/Users/me/.claude/projects/demo/session.jsonl",
      async text() {
        return JSON.stringify({
          timestamp: "2026-04-19T10:00:01.000Z",
          sessionId: "sess-claude",
          cwd: "/tmp/claude",
          uuid: "turn-1",
          type: "assistant",
          message: {
            model: "claude-sonnet-4-6",
            usage: { input_tokens: 8, output_tokens: 3 },
            content: [{ type: "text", text: "I found the issue." }],
          },
        });
      },
    },
  ];

  const events = await parseFiles(files);

  assert.equal(events.length, 4);
  assert.equal(events[0].sourceType, "claude");
  assert.equal(events[0].callType, "Agent");
  assert.equal(events[1].callType, "Token_Usage");
  assert.equal(events[2].sourceType, "codex");
  assert.equal(events[2].callType, "Raw");
  assert.equal(events[3].callType, "Prompt");
});

test("normalizeRealtimePayload validates payload shape and applies append semantics", () => {
  assert.throws(() => normalizeRealtimePayload({
    totalVisible: 0,
    totalMatching: 0,
  }, { append: false, currentEvents: [], pageLimit: 250 }), /invalid payload/);

  const normalized = normalizeRealtimePayload({
    events: [{ sessionId: "sess-1", callType: "Agent", content: "ok", time: "2026-04-19T10:00:00.000Z", turnId: "", extra: "" }],
    sessions: [{ sessionId: "sess-1" }],
    meta: { models: ["gpt-5.4"], types: ["Agent"], platforms: ["codex"] },
    totalVisible: 1,
    totalMatching: 1,
    page: { offset: 0, limit: 100, hasMore: false },
    claudeVersion: "2.1.91",
    codexVersion: "codex-cli 0.121.0",
  }, { append: true, currentEvents: [{ sessionId: "sess-0", callType: "Prompt", content: "hi", time: "2026-04-19T09:59:00.000Z", turnId: "", extra: "" }], pageLimit: 250 });

  assert.equal(normalized.events.length, 2);
  assert.equal(normalized.sessions.length, 1);
  assert.equal(normalized.meta.models[0], "gpt-5.4");
  assert.equal(normalized.totalVisible, 1);
  assert.equal(normalized.pageLimit, 100);
  assert.equal(normalized.codexVersion, "codex-cli 0.121.0");
});
