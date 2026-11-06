import { useEffect, useState } from "react";

export function useLiveSpeed(enabled = true) {
  const [state, setState] = useState({ data: null, status: "connecting" });
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    let source;
    let lastMessage = 0;
    const connect = () => {
      source?.close();
      if (document.hidden) { setState((s) => ({ ...s, status: "paused" })); return; }
      setState((s) => ({ ...s, status: "connecting" }));
      source = new EventSource("/api/live-speed");
      source.addEventListener("speed", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (!Number.isFinite(data.generatedAt) || !Array.isArray(data.history)) return;
          lastMessage = Date.now();
          setState({ data, status: "connected" });
        } catch { /* A malformed frame must not replace the last usable snapshot. */ }
      });
      source.onerror = () => setState((s) => ({ ...s, status: "reconnecting" }));
    };
    connect();
    document.addEventListener("visibilitychange", connect);
    const timer = setInterval(() => {
      if (!document.hidden && lastMessage && Date.now() - lastMessage > 6000) setState((s) => ({ ...s, status: "reconnecting" }));
    }, 2000);
    return () => { source?.close(); clearInterval(timer); document.removeEventListener("visibilitychange", connect); };
  }, [enabled]);
  return state;
}
