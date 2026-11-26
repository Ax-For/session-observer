const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateAgent, pooled, baselineFor, highest, createDayRecorder, dayOffset } = require("../server/performance-score");
const fixture = require("./fixtures/performance-score-reference.json");
const normalize = (value) => JSON.parse(JSON.stringify(value).replaceAll('"source":', '"sourceType":').replaceAll('"claudeCode"', '"claude"'));
function close(actual, expected, path = "value") {
  if (typeof expected === "number") assert.ok(Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected)), `${path}: ${actual} != ${expected}`);
  else if (Array.isArray(expected)) { assert.equal(actual.length, expected.length, path); expected.forEach((v, i) => close(actual[i], v, `${path}[${i}]`)); }
  else if (expected && typeof expected === "object") for (const key of Object.keys(expected)) close(actual[key], expected[key], `${path}.${key}`);
  else assert.equal(actual, expected, path);
}
for (const original of fixture.agents) test(`agent-speed parity: ${original.name}`, () => {
  const c = normalize(original);
  for (const query of c.queries) for (const agent of c.agents) {
    const responses = c.responses.filter((r) => r.agentId === agent.id);
    const actions = (c.actions[agent.id] || []).map((row) => ({ ...row, agentId: agent.id }));
    const current = evaluateAgent(agent, responses, actions, query.nowMs);
    const base = baselineFor(c.history || [], agent.sourceType, current.model, c.today || "2027-01-15");
    close(evaluateAgent(agent, responses, actions, query.nowMs, base), query.expect[agent.id]);
  }
});
for (const original of fixture.pooled) test(`agent-speed pooled parity: ${original.name}`, () => close(pooled(normalize(original.records)), original.expect));
for (const original of fixture.baseline) test(`agent-speed baseline parity: ${original.name}`, () => {
  const c = normalize(original);
  close(baselineFor(c.records, c.sourceType, c.model, c.today).score, c.expect);
});
for (const original of fixture.days) test(`agent-speed daily record parity: ${original.name}`, () => {
  const c = normalize(original), recorder = createDayRecorder({ dayFor: (ms) => new Date(ms).toISOString().slice(0, 10) });
  for (const agent of c.agents) for (const event of agent.events) {
    const kind = event.response ? "response" : "action";
    recorder.add(kind, { ...event[kind], agentId: agent.id, sourceType: agent.sourceType });
  }
  const sort = (rows) => rows.sort((a, b) => `${a.day}|${a.sourceType}|${a.model}`.localeCompare(`${b.day}|${b.sourceType}|${b.model}`));
  close(sort(recorder.records()), sort(c.expect));
});
test("history unions completed intervals by agent/model and excludes today from the 14-day baseline", () => {
  const today = "2026-11-07", yesterday = dayOffset(today, -1);
  const recorder = createDayRecorder({ dayFor: () => yesterday });
  const response = { agentId: "a", sourceType: "codex", model: "test", startMs: 0, endMs: 4000, firstMs: 1000, output: 200, input: 1000, cachedInput: 950, reasoning: 100, final: true };
  recorder.add("response", response);
  recorder.add("action", { agentId: "a", sourceType: "codex", model: "test", callMs: 2000, resultMs: 5000, failed: true });
  const row = recorder.records()[0];
  assert.equal(row.activeMs, 5000); assert.equal(row.toolFailed, 1); assert.equal(row.reasonN, 1);
  assert.equal(baselineFor([{ ...row, n: 20, day: today }], "codex", "test", today).score, null);
  assert.equal(baselineFor([{ ...row, n: 20, day: dayOffset(today, -15) }], "codex", "test", today).score, null);
  assert.ok(baselineFor([{ ...row, n: 20, day: dayOffset(today, -14) }], "codex", "test", today).score > 0);
});
test("overview chooses the highest live score, not a sum or an idle agent's larger score", () => {
  const rows = [{ id: "a", lastLineMs: 1, performance: { score: 100, form: "live" } }, { id: "b", lastLineMs: 2, performance: { score: 2000, form: "resting" } }];
  assert.equal(highest(rows).id, "a"); assert.equal(highest(rows.slice(1)).id, "b");
});
