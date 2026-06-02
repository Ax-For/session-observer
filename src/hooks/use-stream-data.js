import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "../api/client";

export const PAGE_LIMIT = 250;

const EMPTY_STREAM_PAYLOAD = {
  events: [],
  sessions: [],
  tokenWindows: null,
  meta: { models: [], types: [], platforms: [] },
  totalVisible: 0,
  totalMatching: 0,
  page: { offset: 0, limit: PAGE_LIMIT, hasMore: false },
  index: null,
  generatedAt: "",
  codexVersion: null,
  claudeVersion: null,
};

export function useStreamData({
  dataSource,
  mode,
  quickFilter,
  tokenThreshold,
  selectedSessionId,
  streamFilters,
  query,
  notify,
}) {
  const eventRequestId = useRef(0);
  const streamPayloadRef = useRef(EMPTY_STREAM_PAYLOAD);
  const [streamPayload, setStreamPayload] = useState(EMPTY_STREAM_PAYLOAD);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const loadEvents = useCallback(async ({ append = false, sessionIdOverride } = {}) => {
    if (dataSource !== "server") return null;

    const requestId = ++eventRequestId.current;
    setLoadingEvents(true);
    try {
      const currentPayload = streamPayloadRef.current;
      const effectiveSessionId = sessionIdOverride ?? selectedSessionId;
      const payload = await apiClient.fetchEvents({
        mode,
        quickFilter,
        tokenThreshold,
        q: query.trim().toLowerCase(),
        model: streamFilters.model,
        type: streamFilters.type,
        platform: streamFilters.platform,
        start: streamFilters.start,
        end: streamFilters.end,
        order: streamFilters.order,
        sessionId: effectiveSessionId,
        limit: PAGE_LIMIT,
        offset: append ? Number(currentPayload.page?.offset || 0) + PAGE_LIMIT : 0,
        summary: append ? 0 : 1,
      });

      if (requestId !== eventRequestId.current) return null;
      startTransition(() => {
        setStreamPayload((current) => {
          const nextPayload = append
            ? {
                ...payload,
                events: [...current.events, ...payload.events],
                sessions: current.sessions,
                tokenWindows: current.tokenWindows,
                meta: current.meta,
              }
            : payload;
          streamPayloadRef.current = nextPayload;
          return nextPayload;
        });
      });
      return payload;
    } catch (error) {
      notify({
        title: "事件流加载失败",
        message: String(error.message || error),
        color: "red",
      });
      return null;
    } finally {
      if (requestId === eventRequestId.current) setLoadingEvents(false);
    }
  }, [
    dataSource,
    mode,
    quickFilter,
    tokenThreshold,
    query,
    selectedSessionId,
    streamFilters.model,
    streamFilters.type,
    streamFilters.platform,
    streamFilters.start,
    streamFilters.end,
    streamFilters.order,
    notify,
  ]);

  useEffect(() => {
    if (dataSource !== "server") return undefined;
    const timer = window.setTimeout(() => {
      loadEvents();
    }, 140);

    return () => window.clearTimeout(timer);
  }, [dataSource, loadEvents]);

  return {
    streamPayload,
    loadingEvents,
    loadEvents,
  };
}
