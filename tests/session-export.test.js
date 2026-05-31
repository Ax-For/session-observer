const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSessionExport,
  sanitizeEventForExport,
} = require("../server/session-export");
const { resolveSessionIdentifier } = require("../server/routes");

test("sanitizeEventForExport redacts secrets and local home paths", () => {
  const sanitized = sanitizeEventForExport({
    sessionId: "sess-1",
    callType: "Tool_Result",
    content: "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz1234567890 path /Users/alice/code/app",
    sourceFile: "/Users/alice/.codex/sessions/session.jsonl",
    raw: { secret: "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890" },
  }, { homeDir: "/Users/alice" });

  assert.equal(sanitized.raw, undefined);
  assert.match(sanitized.content, /\[REDACTED_SECRET\]/);
  assert.match(sanitized.content, /~\/code\/app/);
  assert.equal(sanitized.sourceFile, "~/.codex/sessions/session.jsonl");
});

test("createSessionExport emits sanitized markdown with trace summary", () => {
  const result = createSessionExport([
    {
      eventId: "evt-1",
      time: "2026-05-30T10:00:00.000Z",
      sessionId: "sess-1",
      turnId: "turn-1",
      callType: "Prompt",
      model: "gpt-5.4",
      sourceType: "codex",
      cwd: "/Users/alice/code/app",
      content: "Please inspect sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
    },
  ], {
    format: "markdown",
    sanitize: true,
    homeDir: "/Users/alice",
  });

  assert.equal(result.contentType, "text/markdown; charset=utf-8");
  assert.match(result.body, /# Session sess-1/);
  assert.match(result.body, /Trace spans: 3/);
  assert.match(result.body, /\[REDACTED_SECRET\]/);
  assert.doesNotMatch(result.body, /sk-proj-/);
  assert.match(result.filename, /sess-1-sanitized\.md$/);
});

test("createSessionExport emits jsonl for machine-readable exports", () => {
  const result = createSessionExport([
    { eventId: "evt-1", sessionId: "sess-1", callType: "Agent", content: "done" },
    { eventId: "evt-2", sessionId: "sess-1", callType: "Token_Usage", tokenUsage: { total: 10 } },
  ], { format: "jsonl", sanitize: false });

  const lines = result.body.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(result.contentType, "application/x-ndjson; charset=utf-8");
  assert.equal(lines.length, 2);
  assert.equal(lines[1].tokenUsage.total, 10);
});

test("resolveSessionIdentifier accepts unique short session ids", () => {
  const events = [
    { sessionId: "019e5fc9-10bd-7000-aaee-111111111111" },
    { sessionId: "019e7d21-8d31-7000-bbee-222222222222" },
  ];

  assert.equal(
    resolveSessionIdentifier(events, "019e5fc9"),
    "019e5fc9-10bd-7000-aaee-111111111111",
  );
  assert.equal(resolveSessionIdentifier(events, "019e"), "019e");
});
