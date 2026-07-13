const assert = require("node:assert/strict");
const { test } = require("node:test");

const { shouldApplySessionTitleOverride } = require("../server/session-meta");

test("native session titles replace stale local title overrides", () => {
  assert.equal(shouldApplySessionTitleOverride(
    { title: "Renamed in Codex", updatedAtMs: 3000 },
    { title: "Old observer name", updatedAtMs: 2000 },
  ), false);

  assert.equal(shouldApplySessionTitleOverride(
    { title: "Old Codex name", updatedAtMs: 2000 },
    { title: "Renamed in observer", updatedAtMs: 3000 },
  ), true);

  assert.equal(shouldApplySessionTitleOverride(
    { title: "Same native name", updatedAtMs: 2000 },
    { title: "Same native name", updatedAtMs: 3000 },
  ), false);

  assert.equal(shouldApplySessionTitleOverride(
    { title: "", updatedAtMs: 4000 },
    { title: "Only available name", updatedAtMs: 1000 },
  ), true);
});
