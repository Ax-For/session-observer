import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "../api/client";
import { mergeEventPages } from "../lib/event-pages";

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
  enabled = true,
  mode,
  quickFilter,
  tokenThreshold,
  selectedSessionId,
  streamFilters,
  query,
  notify,
}) {
  const eventRequestId = useRef(0);
  const controllerRef = useRef(null);
  const streamPayloadRef = useRef(EMPTY_STREAM_PAYLOAD);
  const [streamPayload, setStreamPayload] = useState(EMPTY_STREAM_PAYLOAD);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [searchProgress, setSearchProgress] = useState(null);
  const completedKey = useRef("");
  const sourceRevision = useRef(0);
  const queryKey = JSON.stringify([mode, quickFilter, tokenThreshold, selectedSessionId, streamFilters, query]);

  const loadEvents = useCallback(async ({ append = false, refresh = false, sessionIdOverride } = {}) => {
    if (dataSource !== "server") return null;

    const requestId = ++eventRequestId.current;
    const requestedRevision = sourceRevision.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoadingEvents(true);
    setSearchProgress(null);
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
        cursor: append ? currentPayload.page?.nextCursor : "",
        offset: append && !currentPayload.page?.nextCursor ? Number(currentPayload.page?.offset || 0) + PAGE_LIMIT : 0,
        summary: append ? 0 : 1,
      }, { signal: controller.signal });

      if (requestId !== eventRequestId.current) return null;
      completedKey.current = queryKey;
      setSourceChanged(sourceRevision.current !== requestedRevision);
      startTransition(() => {
        setStreamPayload((current) => {
          const nextPayload = append || refresh
            ? {
                ...payload,
                events: mergeEventPages(current.events, payload.events, streamFilters.order, 4000, undefined, append ? "end" : "start"),
                sessions: append ? current.sessions : payload.sessions,
                tokenWindows: append ? current.tokenWindows : payload.tokenWindows,
                meta: append ? current.meta : payload.meta,
                page: refresh && current.events.length ? current.page : payload.page,
              }
            : payload;
          streamPayloadRef.current = nextPayload;
          return nextPayload;
        });
      });
      return payload;
    } catch (error) {
      if (error.name === "AbortError" || requestId !== eventRequestId.current) return null;
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
    queryKey,
  ]);

  useEffect(() => {
    if (dataSource !== "server" || !enabled) return undefined;
    if (query.trim() && completedKey.current === queryKey) return undefined;
    const timer = window.setTimeout(() => {
      loadEvents();
    }, 140);

    return () => { window.clearTimeout(timer); controllerRef.current?.abort(); };
  }, [dataSource, enabled, loadEvents, query, queryKey]);

  useEffect(() => {
    if (!loadingEvents || !query.trim()) return undefined;
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const payload = await apiClient.fetchDiagnostics({ signal: controller.signal });
        if (!controller.signal.aborted) setSearchProgress(payload.active?.progress || null);
      } catch { /* Search errors are reported by the query itself. */ }
      if (!controller.signal.aborted) timer = window.setTimeout(poll, 1000);
    }
    timer = window.setTimeout(poll, 700);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [loadingEvents, query]);

  return {
    streamPayload,
    loadingEvents,
    loadEvents,
    sourceChanged,
    searchProgress,
    markSourceChanged: () => { sourceRevision.current += 1; setSourceChanged(true); },
    cancelEvents: () => controllerRef.current?.abort(),
  };
}
