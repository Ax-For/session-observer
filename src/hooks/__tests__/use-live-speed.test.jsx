import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useLiveSpeed } from "../use-live-speed";
class Source {
  static instances = [];
  constructor(url) { this.url = url; Source.instances.push(this); }
  addEventListener(name, callback) { this[name] = callback; }
  close() { this.closed = true; }
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); Source.instances = []; });
test("receives pushed speed, marks connection loss, suspends hidden tabs and cleans up", () => {
  vi.stubGlobal("EventSource", Source);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const { result, unmount } = renderHook(() => useLiveSpeed());
  const source = Source.instances[0]; expect(source.url).toBe("/api/live-speed");
  act(() => source.speed({ data: JSON.stringify({ generatedAt: 1, history: [] }) }));
  expect(result.current.status).toBe("connected");
  act(() => source.onerror()); expect(result.current.status).toBe("reconnecting");
  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(source.closed).toBe(true); expect(result.current.status).toBe("paused");
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(Source.instances).toHaveLength(2);
  unmount(); expect(Source.instances[1].closed).toBe(true);
});
test("a silent connection becomes stale and malformed frames preserve the previous snapshot", () => {
  vi.useFakeTimers(); vi.stubGlobal("EventSource", Source);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const { result } = renderHook(() => useLiveSpeed());
  const source = Source.instances[0];
  act(() => source.speed({ data: JSON.stringify({ generatedAt: 1, history: [] }) }));
  act(() => source.speed({ data: "malformed" })); expect(result.current.data.generatedAt).toBe(1);
  act(() => vi.advanceTimersByTime(8000)); expect(result.current.status).toBe("reconnecting");
});

test("changing the chart range closes the old stream and ignores its late frames", () => {
  vi.stubGlobal("EventSource", Source);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const { result, rerender } = renderHook((minutes) => useLiveSpeed(true, minutes), { initialProps: 5 });
  const original = Source.instances[0];
  act(() => original.speed({ data: JSON.stringify({ generatedAt: 1, historyWindowMs: 300_000, history: [] }) }));
  rerender(30);
  const longer = Source.instances[1];
  expect(original.closed).toBe(true);
  expect(longer.url).toBe("/api/live-speed?minutes=30");
  act(() => longer.speed({ data: JSON.stringify({ generatedAt: 2, historyWindowMs: 1_800_000, history: [] }) }));
  act(() => original.speed({ data: JSON.stringify({ generatedAt: 3, historyWindowMs: 300_000, history: [] }) }));
  expect(result.current.data.historyWindowMs).toBe(1_800_000);
});
