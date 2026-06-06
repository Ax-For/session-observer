import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ObserverCore from "../../shared/observer-core.js";
import { apiClient } from "../api/client";

const { buildObservabilitySummary } = ObserverCore;

const EMPTY_OBSERVABILITY_PAYLOAD = {
  generatedAt: "",
  mode: "observe",
  index: null,
  runtime: null,
  sources: null,
  summary: buildObservabilitySummary([]),
};

export function useObservabilityData({ dataSource, localEvents, notify, enabled = true }) {
  const requestId = useRef(0);
  const [observabilityPayload, setObservabilityPayload] = useState(EMPTY_OBSERVABILITY_PAYLOAD);
  const [loadingObservability, setLoadingObservability] = useState(false);

  const localPayload = useMemo(() => ({
    generatedAt: new Date().toISOString(),
    mode: "observe",
    index: null,
    runtime: null,
    sources: null,
    summary: buildObservabilitySummary(localEvents || []),
  }), [localEvents]);

  const loadObservability = useCallback(async () => {
    if (dataSource !== "server") {
      startTransition(() => {
        setObservabilityPayload(localPayload);
      });
      return localPayload;
    }

    const currentRequestId = ++requestId.current;
    setLoadingObservability(true);
    try {
      const payload = await apiClient.fetchObservability();
      if (currentRequestId !== requestId.current) return null;
      startTransition(() => {
        setObservabilityPayload(payload);
      });
      return payload;
    } catch (error) {
      notify({
        title: "可观测数据加载失败",
        message: String(error.message || error),
        color: "red",
      });
      return null;
    } finally {
      if (currentRequestId === requestId.current) setLoadingObservability(false);
    }
  }, [dataSource, localPayload, notify]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setTimeout(() => {
      loadObservability();
    }, 140);
    return () => window.clearTimeout(timer);
  }, [enabled, loadObservability]);

  return {
    observabilityPayload,
    loadingObservability,
    loadObservability,
  };
}
