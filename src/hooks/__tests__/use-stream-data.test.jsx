import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { apiClient } from "../../api/client";
import { useStreamData } from "../use-stream-data";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
test("returning to keyword results preserves pages and dirty hints do not trigger queries", async () => {
  const request = vi.spyOn(apiClient, "fetchEvents").mockResolvedValue({ events: [{ eventId: "hit", content: "keyword" }], sessions: [], page: { hasMore: false } });
  const notify = vi.fn();
  const filters = { order: "desc", model: "", type: "", platform: "", start: "", end: "", query: "keyword" };
  const { result, rerender } = renderHook(({ enabled }) => useStreamData({ enabled, dataSource: "server", mode: "observe", quickFilter: "all",
    tokenThreshold: 20000, selectedSessionId: "", query: "keyword", streamFilters: filters, notify }), { initialProps: { enabled: true } });
  await waitFor(() => expect(result.current.streamPayload.events).toHaveLength(1));
  act(() => result.current.markSourceChanged());
  expect(result.current.sourceChanged).toBe(true);
  rerender({ enabled: false });
  rerender({ enabled: true });
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  expect(request).toHaveBeenCalledTimes(1);
  await act(() => result.current.loadEvents());
  expect(request).toHaveBeenCalledTimes(2);
  expect(result.current.sourceChanged).toBe(false);
});
