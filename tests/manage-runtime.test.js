const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "..", "manage.sh"), "utf8");

test("manage.sh defaults to a constrained Node heap for lower RSS", () => {
  const oldSpaceMatch = script.match(/OBSERVER_NODE_MAX_OLD_SPACE_MB="\$\{OBSERVER_NODE_MAX_OLD_SPACE_MB:-(\d+)\}"/);
  const semiSpaceMatch = script.match(/OBSERVER_NODE_SEMI_SPACE_MB="\$\{OBSERVER_NODE_SEMI_SPACE_MB:-(\d+)\}"/);

  assert.ok(oldSpaceMatch, "old-space default should be configurable");
  assert.ok(semiSpaceMatch, "semi-space default should be configurable");
  assert.ok(Number(oldSpaceMatch[1]) <= 192);
  assert.ok(Number(semiSpaceMatch[1]) <= 8);
});

test("manage.sh starts Node with memory-oriented V8 flags", () => {
  assert.match(script, /--max-old-space-size=\{max_old_space_mb\}/);
  assert.match(script, /--max-semi-space-size=\{semi_space_mb\}/);
  assert.match(script, /"--optimize-for-size"/);
  assert.match(script, /"--expose-gc"/);
});
