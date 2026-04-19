const test = require("node:test");
const assert = require("node:assert/strict");

const {
  areAllSelected,
  buildSelectedSessionList,
  filterSessionGroups,
  getAllSessionIds,
  removeSessionsFromGroups,
  renameSessionInGroups,
} = require("../app/state/session-management");

function createGroups() {
  return {
    "/Users/me/repo-a": [
      {
        sessionId: "sess-1",
        sessionTitle: "Release Review",
        fallbackTitle: "",
        sourceType: "codex",
      },
      {
        sessionId: "sess-2",
        sessionTitle: "",
        fallbackTitle: "Untitled fallback",
        sourceType: "claude",
      },
    ],
    "/Users/me/repo-b": [
      {
        sessionId: "sess-3",
        sessionTitle: "Hotfix Followup",
        fallbackTitle: "",
        sourceType: "claude",
      },
    ],
  };
}

test("filterSessionGroups applies query, platform, and named-only filters", () => {
  const filtered = filterSessionGroups(createGroups(), {
    query: "release",
    platform: "codex",
    namedOnly: true,
  });

  assert.deepEqual(Object.keys(filtered), ["/Users/me/repo-a"]);
  assert.equal(filtered["/Users/me/repo-a"].length, 1);
  assert.equal(filtered["/Users/me/repo-a"][0].sessionId, "sess-1");
});

test("renameSessionInGroups updates session title and clears fallback title", () => {
  const groups = createGroups();
  const changed = renameSessionInGroups(groups, "sess-2", "Incident Triage");

  assert.equal(changed, true);
  assert.equal(groups["/Users/me/repo-a"][1].sessionTitle, "Incident Triage");
  assert.equal(groups["/Users/me/repo-a"][1].fallbackTitle, "");
});

test("removeSessionsFromGroups removes sessions and drops empty cwd buckets", () => {
  const groups = createGroups();
  const removed = removeSessionsFromGroups(groups, ["sess-1", "sess-3"]);

  assert.equal(removed, 2);
  assert.deepEqual(Object.keys(groups), ["/Users/me/repo-a"]);
  assert.equal(groups["/Users/me/repo-a"].length, 1);
  assert.equal(groups["/Users/me/repo-a"][0].sessionId, "sess-2");
});

test("selection helpers return visible ids and complete selection state", () => {
  const groups = createGroups();
  const ids = getAllSessionIds(groups);
  const selected = new Set(["sess-1", "sess-2", "sess-3"]);

  assert.deepEqual(ids, ["sess-1", "sess-2", "sess-3"]);
  assert.equal(areAllSelected(groups, selected), true);
  assert.deepEqual(buildSelectedSessionList(groups, new Set(["sess-2", "sess-3"])), [
    { sessionId: "sess-2", title: "Untitled fallback" },
    { sessionId: "sess-3", title: "Hotfix Followup" },
  ]);
});
