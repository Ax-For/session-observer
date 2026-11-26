import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useUrlStateSync } from "../use-url-state-sync";
import { DEFAULT_SESSION_FILTERS, DEFAULT_STREAM_FILTERS, parseUrlState } from "../../lib/url-state";

afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState(null, "", "/"); });

test("tab changes are persisted before an immediate reload, without waiting for a timer", () => {
  vi.useFakeTimers();
  const props = { dataSource: "server", tab: "sessions", selectedSessionId: "s", mode: "observe", quickFilter: "all",
    tokenThreshold: "20000", streamFilters: DEFAULT_STREAM_FILTERS, sessionFilters: DEFAULT_SESSION_FILTERS };
  const ui = renderHook((value) => useUrlStateSync(value), { initialProps: props });
  expect(parseUrlState(window.location.search).tab).toBe("sessions");
  ui.rerender({ ...props, tab: "stream" });
  expect(parseUrlState(window.location.search).tab).toBe("stream");
  expect(parseUrlState(window.location.search).selectedSessionId).toBe("s");
});

test("agent scope changes persist without changing the focused session", () => {
  const props = { dataSource: "server", tab: "sessions", selectedSessionId: "child", mode: "observe", quickFilter: "all",
    tokenThreshold: "20000", streamFilters: DEFAULT_STREAM_FILTERS, sessionFilters: DEFAULT_SESSION_FILTERS };
  const ui = renderHook((value) => useUrlStateSync(value), { initialProps: props });
  for (const agentScope of ["all", "children", "main"]) {
    ui.rerender({ ...props, sessionFilters: { ...DEFAULT_SESSION_FILTERS, agentScope } });
    expect(parseUrlState(window.location.search).sessionFilters.agentScope).toBe(agentScope);
    expect(parseUrlState(window.location.search).selectedSessionId).toBe("child");
  }
});
