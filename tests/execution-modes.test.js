const test = require("node:test");
const assert = require("node:assert/strict");
const { executionModes, configuredCodexTier } = require("../server/execution-modes");

test("Codex keeps chosen turn, recorded request, and configuration evidence separate", () => {
  const context = {};
  const configured = configuredCodexTier('service_tier = "priority"\n[profiles.other]\nservice_tier = "default"');
  assert.deepEqual(configured, { value: "fast", evidence: "configured" });
  assert.equal(configuredCodexTier('[profiles.other]\nservice_tier = "default"'), null);
  assert.equal(configuredCodexTier('service_tier="priority"\nservice_tier="default"'), null);
  assert.deepEqual(executionModes({}, context, "codex", configured).current.tier, configured);
  executionModes({ type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { reasoning_effort: "medium", service_tier: "default" } } }, context, "codex", configured);
  executionModes({ type: "turn_context", payload: { effort: "xhigh", service_tier: "priority" } }, context, "codex", configured);
  const response = executionModes({ type: "token_usage_record", payload: { service_tier: "ultrafast" } }, context, "codex", configured);
  assert.deepEqual(response.current.tier, { value: "fast", evidence: "selected" });
  assert.deepEqual(response.response.tier, { value: "ultrafast", evidence: "recorded" });
  assert.deepEqual(response.response.effort, { value: "xhigh", evidence: "recorded" });
  const next = executionModes({ type: "turn_context", payload: { model: "some-fast-model" } }, context, "codex", configured);
  assert.deepEqual(next.current.tier, { value: "standard", evidence: "selected" });
  assert.deepEqual(next.current.effort, { value: "medium", evidence: "selected" });
  assert.equal(next.response.tier.evidence, "selected");
  assert.equal(executionModes({}, {}, "codex", configured).response.tier, undefined);
});

test("Claude uses explicit response speed, keeps missing evidence unknown, and clears turn Ultracode at the next prompt", () => {
  const context = {};
  executionModes({ type: "attachment", attachment: { type: "workflow_keyword_request" } }, context, "claude");
  const fast = executionModes({ type: "assistant", perTurnEffort: "high", message: { usage: { speed: "fast" } } }, context, "claude");
  assert.deepEqual(fast.response.effort, { value: "ultracode", evidence: "recorded" });
  assert.deepEqual(fast.response.tier, { value: "fast", evidence: "served" });
  executionModes({ type: "user", message: { content: [{ type: "tool_result" }] } }, context, "claude");
  assert.equal(executionModes({ type: "assistant", message: {} }, context, "claude").response.effort.value, "ultracode");
  executionModes({ type: "user", message: { content: "next prompt" } }, context, "claude");
  const unknown = executionModes({ type: "assistant", perTurnEffort: "high", message: { usage: { service_tier: "standard" } } }, context, "claude");
  assert.deepEqual(unknown.current.effort, { value: "high", evidence: "recorded" });
  assert.equal(unknown.response.tier, undefined);
});
