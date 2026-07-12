const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createSessionAnnotationStore, normalizeAnnotation } = require("../server/session-annotations");

test("session annotations are normalized and persist across store instances", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "observer-annotations-"));
  const file = path.join(dir, "annotations.json");
  const first = createSessionAnnotationStore({ file });
  const saved = first.set("session-1", {
    outcome: "success",
    favorite: true,
    tags: ["frontend", "frontend", "review"],
    note: "Useful result",
  });

  assert.equal(saved.outcome, "success");
  assert.deepEqual(saved.tags, ["frontend", "review"]);
  const second = createSessionAnnotationStore({ file });
  assert.equal(second.get("session-1").favorite, true);
  assert.equal(second.list().length, 1);
});

test("invalid annotation outcomes remain unreviewed", () => {
  assert.equal(normalizeAnnotation("s", { outcome: "invented" }).outcome, "unreviewed");
});
