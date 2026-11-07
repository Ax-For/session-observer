import { useEffect, useState } from "react";
import responsePerformance from "../../shared/response-performance.js";

const { DEFAULT_HISTORY_MINUTES } = responsePerformance;

export function useLiveSpeed(enabled = true, historyMinutes = DEFAULT_HISTORY_MINUTES) {
  const [state, setState] = useState({ data: null, status: "connecting" });
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    let source;
    let lastMessage = 0;
    const url = historyMinutes === DEFAULT_HISTORY_MINUTES ? "/api/live-speed" : `/api/live-speed?minutes=${historyMinutes}`;
    const connect = () => {
      source?.close();
      source = null;
      lastMessage = 0;
      if (document.hidden) { setState((s) => ({ ...s, status: "paused" })); return; }
      setState((s) => ({ ...s, status: "connecting" }));
      const connection = new EventSource(url);
      source = connection;
      connection.addEventListener("speed", (event) => {
        if (source !== connection) return;
        try {
          const data = JSON.parse(event.data);
          if (!Number.isFinite(data.generatedAt) || !Array.isArray(data.history)) return;
          lastMessage = Date.now();
          setState({ data, status: "connected" });
        } catch { /* A malformed frame must not replace the last usable snapshot. */ }
      });
      connection.onerror = () => {
        if (source === connection) setState((s) => ({ ...s, status: "reconnecting" }));
      };
    };
    connect();
    document.addEventListener("visibilitychange", connect);
    const timer = setInterval(() => {
      if (!document.hidden && lastMessage && Date.now() - lastMessage > 6000) setState((s) => ({ ...s, status: "reconnecting" }));
    }, 2000);
    return () => {
      source?.close();
      source = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", connect);
    };
  }, [enabled, historyMinutes]);
  return state;
}
