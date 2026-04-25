import { startTransition, useCallback, useRef, useState } from "react";
import { apiClient } from "../api/client";

const EMPTY_SESSIONS_PAYLOAD = {
  groups: {},
  total: 0,
  generatedAt: "",
};

export function useSessionData({ dataSource, notify }) {
  const sessionsRequestId = useRef(0);
  const [sessionsPayload, setSessionsPayload] = useState(EMPTY_SESSIONS_PAYLOAD);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const loadSessions = useCallback(async () => {
    if (dataSource !== "server") return null;

    const requestId = ++sessionsRequestId.current;
    setLoadingSessions(true);
    try {
      const payload = await apiClient.fetchSessions();
      if (requestId !== sessionsRequestId.current) return null;
      startTransition(() => {
        setSessionsPayload(payload);
      });
      return payload;
    } catch (error) {
      notify({
        title: "会话列表加载失败",
        message: String(error.message || error),
        color: "red",
      });
      return null;
    } finally {
      if (requestId === sessionsRequestId.current) setLoadingSessions(false);
    }
  }, [dataSource, notify]);

  return {
    sessionsPayload,
    loadingSessions,
    loadSessions,
  };
}
