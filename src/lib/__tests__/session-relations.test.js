import { describe, expect, test } from "vitest";
import { buildSessionCatalog, buildSessionRelations } from "../workspace-models";
import { buildUrlSearch, parseUrlState } from "../url-state";

describe("session family navigation", () => {
  const catalog = buildSessionCatalog([
    { sessionId: "root", parentSessionId: "root", sessionTitle: "Main" },
    { sessionId: "child", parentSessionId: "root", sessionTitle: "Child" },
    { sessionId: "nested", parentSessionId: "child", sessionTitle: "Nested" },
    { sessionId: "self-child", parentSessionId: "self-child", isSubagent: true },
  ]);
  test("returns immediate parent and descendants without self parents", () => {
    expect(buildSessionRelations(catalog, "root").parent).toBeNull();
    expect(buildSessionRelations(catalog, "self-child").parent).toBeNull();
    expect(buildSessionRelations(catalog, "root").children.map((item) => [item.sessionId, item.depth])).toEqual([["child", 1], ["nested", 2]]);
    expect(buildSessionRelations(catalog, "child").parent.sessionId).toBe("root");
    expect(buildSessionRelations(catalog, "child").children[0].sessionId).toBe("nested");
  });
  test("persists scope and child deep links independently", () => {
    expect(parseUrlState("").sessionFilters.agentScope).toBe("main");
    for (const agentScope of ["main", "all", "children"]) {
      const state = parseUrlState(buildUrlSearch({ tab: "sessions", selectedSessionId: "child", sessionFilters: { agentScope } }));
      expect(state.sessionFilters.agentScope).toBe(agentScope);
      expect(state.selectedSessionId).toBe("child");
    }
    expect(parseUrlState("agents=invalid").sessionFilters.agentScope).toBe("main");
  });
});
