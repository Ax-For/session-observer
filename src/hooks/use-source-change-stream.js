import { useEffect, useRef, useState } from "react";

const SOURCE_EVENTS_URL = "/api/source-events";

export function useSourceChangeStream({ enabled, onChange }) {
  const onChangeRef = useRef(onChange);
  const lastVersionRef = useRef(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") {
      setConnected(false);
      return undefined;
    }

    let closed = false;
    const source = new EventSource(SOURCE_EVENTS_URL);

    function handleSourceChanged(event) {
      try {
        const payload = JSON.parse(event.data || "{}");
        const version = Number(payload.version) || 0;
        if (version <= lastVersionRef.current) return;
        lastVersionRef.current = version;
        onChangeRef.current?.(payload);
      } catch {
        // Ignore malformed SSE payloads; the periodic fallback still refreshes.
      }
    }

    source.onopen = () => {
      if (!closed) setConnected(true);
    };
    source.onerror = () => {
      if (!closed) setConnected(false);
    };
    source.addEventListener("source-changed", handleSourceChanged);

    return () => {
      closed = true;
      source.removeEventListener("source-changed", handleSourceChanged);
      source.close();
      setConnected(false);
    };
  }, [enabled]);

  return {
    connected,
    lastVersion: lastVersionRef.current,
  };
}
