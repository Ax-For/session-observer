import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useSessionActions } from "../use-session-actions";

function renderSessionActions() {
  return renderHook(() => useSessionActions({
    loadSessions: vi.fn(),
    loadEvents: vi.fn(),
    notify: vi.fn(),
  }));
}

describe("useSessionActions", () => {
  test("tracks selection and modal targets", () => {
    const { result } = renderSessionActions();

    act(() => {
      result.current.toggleSessionSelection("sess-1");
      result.current.toggleSessionSelection("sess-2");
    });
    expect(result.current.selectedSessionIds).toEqual(["sess-1", "sess-2"]);

    act(() => {
      result.current.toggleSessionSelection("sess-1");
    });
    expect(result.current.selectedSessionIds).toEqual(["sess-2"]);

    act(() => {
      result.current.openRename({ sessionId: "sess-2", title: "Named session" });
      result.current.openDelete({ sessionId: "sess-2", title: "Named session" });
    });
    expect(result.current.renameTarget.sessionId).toBe("sess-2");
    expect(result.current.renameValue).toBe("Named session");
    expect(result.current.deleteTarget.sessionId).toBe("sess-2");

    act(() => {
      result.current.clearSessionSelection();
    });
    expect(result.current.selectedSessionIds).toEqual([]);
  });
});
