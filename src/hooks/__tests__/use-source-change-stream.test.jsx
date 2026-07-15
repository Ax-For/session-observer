import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useSourceChangeStream } from "../use-source-change-stream";

class MockEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || new Set();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  open() {
    this.onopen?.();
  }

  error() {
    this.onerror?.();
  }

  dispatch(type, payload) {
    for (const handler of this.listeners.get(type) || []) {
      handler({ data: JSON.stringify(payload) });
    }
  }

  close() {
    this.closed = true;
  }
}

describe("useSourceChangeStream", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    MockEventSource.instances = [];
  });

  test("subscribes to source change events and ignores duplicate versions", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const onChange = vi.fn();

    const { result, unmount } = renderHook(() => useSourceChangeStream({
      enabled: true,
      onChange,
      refreshDelayMs: 0,
    }));

    const source = MockEventSource.instances[0];
    expect(source.url).toBe("/api/source-events");

    act(() => {
      source.open();
    });
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      source.dispatch("source-changed", { version: 1, reason: "watch" });
      source.dispatch("source-changed", { version: 1, reason: "watch" });
      source.dispatch("source-changed", { version: 2, reason: "rename" });
    });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenNthCalledWith(1, { version: 1, reason: "watch" });
    expect(onChange).toHaveBeenNthCalledWith(2, { version: 2, reason: "rename" });

    unmount();
    expect(source.closed).toBe(true);
  });

  test("coalesces rapid source changes into one refresh", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const onChange = vi.fn();

    renderHook(() => useSourceChangeStream({
      enabled: true,
      onChange,
      refreshDelayMs: 200,
    }));

    const source = MockEventSource.instances[0];
    act(() => {
      source.open();
      source.dispatch("source-changed", { version: 1, reason: "watch" });
      source.dispatch("source-changed", { version: 2, reason: "rename" });
      vi.advanceTimersByTime(199);
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ version: 2, reason: "rename" });
  });

  test("catches up from the ready version after reconnecting", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const onChange = vi.fn();

    renderHook(() => useSourceChangeStream({
      enabled: true,
      onChange,
      refreshDelayMs: 0,
    }));

    const source = MockEventSource.instances[0];
    act(() => {
      source.open();
      source.dispatch("ready", { version: 7 });
    });
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      source.dispatch("source-changed", { version: 8, reason: "watch" });
      source.error();
      source.open();
      source.dispatch("ready", { version: 10 });
    });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ version: 10, reason: "reconnect" });
  });

  test("defers refreshes while hidden and runs once when visible", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("hidden");
    const onChange = vi.fn();

    renderHook(() => useSourceChangeStream({
      enabled: true,
      onChange,
      refreshDelayMs: 200,
    }));

    const source = MockEventSource.instances[0];
    act(() => {
      source.open();
      source.dispatch("source-changed", { version: 1, reason: "watch" });
      vi.advanceTimersByTime(500);
    });
    expect(onChange).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(200);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ version: 1, reason: "watch" });
  });

  test("uses a low-frequency fallback while disconnected", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const onChange = vi.fn();

    renderHook(() => useSourceChangeStream({
      enabled: true,
      onChange,
      refreshDelayMs: 0,
      fallbackIntervalMs: 1_000,
    }));

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ reason: "fallback" }));
  });

  test("does not open an EventSource while disabled", () => {
    vi.stubGlobal("EventSource", MockEventSource);

    renderHook(() => useSourceChangeStream({
      enabled: false,
      onChange: vi.fn(),
    }));

    expect(MockEventSource.instances).toHaveLength(0);
  });
});
