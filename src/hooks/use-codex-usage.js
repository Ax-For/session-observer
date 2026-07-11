import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient } from "../api/client";

const EMPTY_CODEX_USAGE_PAYLOAD = {
  status: "idle",
  installed: null,
  version: "unknown",
  updatedAt: null,
  planType: null,
  defaultLimitId: null,
  resetCredits: null,
  limits: [],
  error: "",
};

export function useCodexUsage({ enabled = true } = {}) {
  const requestId = useRef(0);
  const restored = useRef(false);
  const [codexUsagePayload, setCodexUsagePayload] = useState(EMPTY_CODEX_USAGE_PAYLOAD);

  useEffect(() => {
    if (!enabled || restored.current) return;
    restored.current = true;
    const currentRequestId = ++requestId.current;
    apiClient.fetchCodexUsage()
      .then((payload) => {
        if (currentRequestId !== requestId.current) return;
        setCodexUsagePayload({ ...EMPTY_CODEX_USAGE_PAYLOAD, ...payload });
      })
      .catch(() => {
        // A missing or corrupt local snapshot should leave the manual query state available.
      });
  }, [enabled]);

  const queryCodexUsage = useCallback(async () => {
    if (!enabled) return null;
    const currentRequestId = ++requestId.current;
    setCodexUsagePayload((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const payload = await apiClient.refreshCodexUsage();
      if (currentRequestId !== requestId.current) return null;
      setCodexUsagePayload({ ...EMPTY_CODEX_USAGE_PAYLOAD, ...payload });
      return payload;
    } catch {
      if (currentRequestId !== requestId.current) return null;
      setCodexUsagePayload((current) => ({
        ...current,
        status: "unavailable",
        installed: current.installed !== false,
        error: "Codex 使用额度暂时无法读取",
      }));
      return null;
    }
  }, [enabled]);

  return {
    codexUsagePayload,
    queryCodexUsage,
  };
}
