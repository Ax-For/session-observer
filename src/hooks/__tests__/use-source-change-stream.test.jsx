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
    vi.unstubAllGlobals();
    MockEventSource.instances = [];
  });

  test("subscribes to source change events and ignores duplicate versions", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const onChange = vi.fn();

    const { result, unmount } = renderHook(() => useSourceChangeStream({
      enabled: true,
      onChange,
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

  test("does not open an EventSource while disabled", () => {
    vi.stubGlobal("EventSource", MockEventSource);

    renderHook(() => useSourceChangeStream({
      enabled: false,
      onChange: vi.fn(),
    }));

    expect(MockEventSource.instances).toHaveLength(0);
  });
});
