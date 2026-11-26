import { useEffect, useRef, useState } from "react";

const SOURCE_EVENTS_URL = "/api/source-events";
const DEFAULT_REFRESH_DELAY_MS = 650;
const DEFAULT_FALLBACK_INTERVAL_MS = 30_000;

function parseEventPayload(event) {
  return JSON.parse(event.data || "{}");
}

export function useSourceChangeStream({
  enabled,
  onChange,
  refreshDelayMs = DEFAULT_REFRESH_DELAY_MS,
  fallbackIntervalMs = DEFAULT_FALLBACK_INTERVAL_MS,
}) {
  const onChangeRef = useRef(onChange);
  const lastVersionRef = useRef(0);
  const hasBaselineRef = useRef(false);
  const instanceRef = useRef("");
  const pendingPayloadRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [lastVersion, setLastVersion] = useState(0);
  const [lastChangeAt, setLastChangeAt] = useState("");
  const [lastRefreshAt, setLastRefreshAt] = useState("");

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return undefined;
    }

    let closed = false;
    let refreshTimer = null;
    let inFlight = false;
    let lastHeartbeatAt = Date.now();
    const connectedRef = { current: false };
    const source = typeof EventSource === "undefined" ? null : new EventSource(SOURCE_EVENTS_URL);
    const delay = Math.max(0, Number(refreshDelayMs) || 0);
    const fallbackDelay = Math.max(1_000, Number(fallbackIntervalMs) || DEFAULT_FALLBACK_INTERVAL_MS);

    function isHidden() {
      return typeof document !== "undefined" && document.visibilityState === "hidden";
    }

    function clearRefreshTimer() {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    }

    function flushPendingRefresh() {
      clearRefreshTimer();
      if (closed || inFlight || !pendingPayloadRef.current || isHidden()) return;

      const payload = pendingPayloadRef.current;
      pendingPayloadRef.current = null;
      setPending(false);
      const complete = (success) => {
        inFlight = false;
        if (closed) return;
        if (success) setLastRefreshAt(new Date().toISOString());
        else {
          pendingPayloadRef.current ||= payload;
          setPending(true);
          refreshTimer = setTimeout(flushPendingRefresh, fallbackDelay);
          return;
        }
        if (pendingPayloadRef.current) schedulePendingRefresh();
      };
      try {
        const result = onChangeRef.current?.(payload);
        if (result?.then) {
          inFlight = true;
          result.then((value) => complete(value !== null && value !== false), () => complete(false));
        } else complete(result !== null && result !== false);
      } catch { complete(false); }
    }

    function schedulePendingRefresh() {
      if (refreshTimer) return;
      if (closed || !pendingPayloadRef.current || isHidden()) return;
      if (delay === 0) {
        flushPendingRefresh();
        return;
      }
      refreshTimer = setTimeout(flushPendingRefresh, delay);
    }

    function queueRefresh(payload) {
      pendingPayloadRef.current = payload;
      setPending(true);
      setLastChangeAt(payload.generatedAt || new Date().toISOString());
      schedulePendingRefresh();
    }

    function acceptVersion(payload, reason) {
      const version = Number(payload.version) || 0;
      if (version <= lastVersionRef.current) return false;
      lastVersionRef.current = version;
      hasBaselineRef.current = true;
      setLastVersion(version);
      queueRefresh(reason ? { ...payload, reason } : payload);
      return true;
    }

    function handleReady(event) {
      try {
        const payload = parseEventPayload(event);
        const version = Number(payload.version) || 0;
        lastHeartbeatAt = Date.now();
        connectedRef.current = true;
        setConnected(true);

        if ((instanceRef.current && payload.instanceId && instanceRef.current !== payload.instanceId)
          || (hasBaselineRef.current && version < lastVersionRef.current)) {
          instanceRef.current = payload.instanceId || "";
          lastVersionRef.current = version;
          setLastVersion(version);
          queueRefresh({ ...payload, reason: "restart" });
          return;
        }
        instanceRef.current = payload.instanceId || instanceRef.current;

        if (!hasBaselineRef.current && lastVersionRef.current === 0) {
          hasBaselineRef.current = true;
          lastVersionRef.current = version;
          setLastVersion(version);
          return;
        }
        acceptVersion(payload, payload.reason || "reconnect");
      } catch {
        // A later source event or fallback refresh will recover malformed state.
      }
    }

    function handleSourceChanged(event) {
      try {
        acceptVersion(parseEventPayload(event));
      } catch {
        // The low-frequency fallback still refreshes after malformed payloads.
      }
    }

    function handleHeartbeat(event) {
      lastHeartbeatAt = Date.now();
      connectedRef.current = true;
      setConnected(true);
      try { acceptVersion(parseEventPayload(event), "heartbeat-reconcile"); } catch { /* next heartbeat retries */ }
    }

    function handleVisibilityChange() {
      if (!isHidden() && pendingPayloadRef.current) schedulePendingRefresh();
    }

    if (source) source.onopen = () => {
      if (closed) return;
      connectedRef.current = true;
      setConnected(true);
    };
    if (source) source.onerror = () => {
      if (closed) return;
      connectedRef.current = false;
      setConnected(false);
    };
    source?.addEventListener("ready", handleReady);
    source?.addEventListener("source-changed", handleSourceChanged);
    source?.addEventListener("heartbeat", handleHeartbeat);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const fallbackTimer = setInterval(() => {
      if (Date.now() - lastHeartbeatAt > 60_000) {
        connectedRef.current = false;
        setConnected(false);
      }
      if (closed || pendingPayloadRef.current) return;
      queueRefresh({
        version: lastVersionRef.current,
        reason: connectedRef.current ? "reconcile" : "fallback",
        generatedAt: new Date().toISOString(),
      });
    }, fallbackDelay);

    return () => {
      closed = true;
      connectedRef.current = false;
      clearRefreshTimer();
      clearInterval(fallbackTimer);
      pendingPayloadRef.current = null;
      source?.removeEventListener("ready", handleReady);
      source?.removeEventListener("source-changed", handleSourceChanged);
      source?.removeEventListener("heartbeat", handleHeartbeat);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      source?.close();
      setConnected(false);
      setPending(false);
    };
  }, [enabled, fallbackIntervalMs, refreshDelayMs]);

  return {
    connected,
    pending,
    lastVersion,
    lastChangeAt,
    lastRefreshAt,
  };
}
