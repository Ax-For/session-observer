const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createAnalysisServices, analyzeTurns, agentRelations, gitEvidence } = require("../server/analysis-services");
const core = require("../shared/observer-core");
const pricing = require("../shared/token-pricing");

test("library and audit survive a service restart without storing transcripts", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-analysis-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const service = createAnalysisServices(dir);
  service.saveLibrary("views", { id: "a", label: "中文", filters: { q: "中文", raw: "must-not-save" } });
  service.saveLibrary("bookmarks", { id: "b", eventId: "v2:ref", sessionId: "s", label: "message" });
  const restored = createAnalysisServices(dir);
  assert.deepEqual(restored.library().views[0].filters, { q: "中文" });
  assert.equal(restored.library().bookmarks[0].eventId, "v2:ref");
  const before = { tokens: 10, cost: 1, pricingVersion: "old", sessions: [{ id: "s", tokens: 10, cost: 1 }] };
  const after = { tokens: 8, cost: 0.5, pricingVersion: "new", sessions: [{ id: "s", tokens: 8, cost: 0.5 }] };
  service.recordAudit(before, after);
  assert.equal(restored.audit().runs[0].changes[0].after.tokens, 8);
});

test("prices use exact models, effective dates and recorded per-message costs", () => {
  assert.equal(pricing.findModelPrice("qwen-custom-unknown"), null);
  assert.equal(pricing.estimateTokenCost({ input: 1e6 }, "claude-opus-4-5").estimatedUsd, 5);
  pricing.configureRates([{ model: "local", from: "2026-01-01", until: "2026-02-01", input: 2, output: 3, cacheRead: 0, cacheCreation: 1 }]);
  assert.equal(pricing.estimateTokenCost({ input: 1e6 }, "local", { time: "2026-01-15" }).estimatedUsd, 2);
  assert.equal(pricing.findModelPrice("local", { time: "2026-03-01" }), null);
  assert.equal(pricing.estimateTokenCost({}, "unknown", { recordedUsd: 0.25 }).estimatedUsd, 0.25);
  pricing.configureRates([]);
});

test("turn totals conserve usage and parallel tool timing is paired", () => {
  const events = [
    { eventId: "p", time: "2026-01-01T00:00:00Z", callType: "Prompt", content: "question" },
    { eventId: "c", time: "2026-01-01T00:00:01Z", callType: "Tool_Call", callId: "a" },
    { eventId: "r", time: "2026-01-01T00:00:03Z", callType: "Tool_Result", callId: "a" },
    { eventId: "t", time: "2026-01-01T00:00:04Z", callType: "Token_Usage", sourceType: "codex", model: "gpt-5.5", tokenUsage: { input: 100, total: 100 } },
  ];
  const result = analyzeTurns(events);
  assert.equal(result.turns[0].tokens, 100);
  assert.equal(result.turns[0].toolTimeMs, 2000);
  assert.equal(result.turns[0].pairedTools, 1);
});

test("child agents have independent identities and nonduplicated rollups", () => {
  const parsed = core.parseClaudeCodeLineToEvent({ type: "user", sessionId: "parent", message: { content: "hello" } },
    { sourceFile: "/tmp/.claude/projects/project/parent/subagents/agent-child.jsonl" });
  const event = Array.isArray(parsed) ? parsed[0] : parsed;
  assert.equal(event.sessionId, "parent:agent:child");
  assert.equal(event.parentSessionId, "parent");
  const result = agentRelations([
    { sessionId: "p", aggregateToken: { effectiveTotal: 100 } },
    { sessionId: "c", parentSessionId: "p", aggregateToken: { effectiveTotal: 20 } },
    { sessionId: "d", parentSessionId: "c", aggregateToken: { effectiveTotal: 10 } },
  ], "p");
  assert.equal(result.ownTokens, 100);
  assert.equal(result.childTokens, 30);
  assert.equal(agentRelations([{ sessionId: "self", parentSessionId: "self" }], "self").parent, null);
  assert.equal(gitEvidence({ cwd: "/nonexistent-observer-directory" }).available, false);
});

test("Claude tool-result user envelopes do not start a new turn and include cached usage", () => {
  const result = analyzeTurns([
    { eventId: "p", time: "2026-01-01T00:00:00Z", callType: "User", content: "run tool_result check" },
    { eventId: "c", time: "2026-01-01T00:00:01Z", callType: "Tool_Call", rawType: "assistant", callId: "call" },
    { eventId: "r", time: "2026-01-01T00:00:03Z", callType: "Tool_Result", rawType: "user", callId: "call" },
    { eventId: "u", time: "2026-01-01T00:00:04Z", callType: "Token_Usage", sourceType: "claude", model: "claude-sonnet-4-5",
      tokenUsage: { input: 100, output: 10, total: 110, cacheReadInput: 200, cacheCreationInput: 20 } },
  ]);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].tokens, 330);
  assert.equal(result.turns[0].pairedTools, 1);
  assert.equal(result.turns[0].toolTimeMs, 2000);
});

test("revised Claude message costs are deltas, not repeated complete charges", () => {
  const context = {};
  const row = (output, cost) => ({ type: "assistant", sessionId: "p", costUSD: cost, message: { id: "msg", model: "claude-sonnet-4-5",
    content: [{ type: "text", text: "answer" }], usage: { input_tokens: 100, output_tokens: output } } });
  const first = core.parseClaudeCodeLineToEvent(row(10, 0.4), context).find((event) => event.tokenUsage);
  const revision = core.parseClaudeCodeLineToEvent(row(12, 0.5), context).find((event) => event.tokenUsage);
  assert.equal(first.recordedCostUsd, 0.4);
  assert.ok(Math.abs(revision.recordedCostUsd - 0.1) < 1e-8);
});

test("Git evidence restricts commits to the session window without changing the checkout", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-git-evidence-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: {
    ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    GIT_AUTHOR_DATE: "2026-01-01T12:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T12:00:00Z",
  } });
  git("init", "--quiet");
  git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "fixture evidence", "--quiet");
  const head = git("rev-parse", "HEAD").trim();
  const session = { cwd: dir, startedAt: "2026-01-01T11:00:00Z", latest: "2026-01-01T13:00:00Z" };
  const result = gitEvidence(session);
  assert.equal(result.available, true);
  assert.equal(result.commits[0].hash, head);
  assert.equal(result.commits[0].subject, "fixture evidence");
  assert.match(result.basis, /不代表由该会话创建/);
  assert.equal(gitEvidence({ ...session, startedAt: "2026-01-02T00:00:00Z", latest: "2026-01-03T00:00:00Z" }).commits.length, 0);
  assert.equal(git("status", "--porcelain"), "");
  assert.equal(git("rev-parse", "HEAD").trim(), head);
});
