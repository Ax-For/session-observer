#!/usr/bin/env node
/**
 * Debounced source-change notifications for SSE clients.
 */

function createSourceChangeBus(options = {}) {
  const debounceMs = Math.max(0, Number(options.debounceMs) || 0);
  const listeners = new Set();
  let timer = null;
  let version = 0;
  let pendingReasons = new Set();
  let lastEvent = {
    type: "ready",
    version,
    reason: "initial",
    generatedAt: new Date().toISOString(),
  };

  function state() {
    return {
      ...lastEvent,
      listenerCount: listeners.size,
    };
  }

  function emit() {
    timer = null;
    version += 1;
    const reasons = [...pendingReasons].filter(Boolean);
    pendingReasons = new Set();
    lastEvent = {
      type: "source-changed",
      version,
      reason: reasons[0] || "watch",
      reasons,
      generatedAt: new Date().toISOString(),
    };
    for (const listener of listeners) {
      try {
        listener(lastEvent);
      } catch {
        // Keep other subscribers alive.
      }
    }
    return lastEvent;
  }

  function notify(reason = "watch") {
    pendingReasons.add(reason || "watch");
    if (timer) clearTimeout(timer);
    timer = setTimeout(emit, debounceMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function flush() {
    if (timer) clearTimeout(timer);
    if (!pendingReasons.size) return lastEvent;
    return emit();
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function close() {
    if (timer) clearTimeout(timer);
    timer = null;
    listeners.clear();
    pendingReasons = new Set();
  }

  return {
    close,
    flush,
    notify,
    state,
    subscribe,
  };
}

module.exports = {
  createSourceChangeBus,
};
