import { useCallback, useEffect, useState } from "react";
import { apiClient } from "../api/client";

export function useDailyHistory(filters) {
  const [status, setStatus] = useState(null);
  const [result, setResult] = useState(null);
  const [requestError, setRequestError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify(filters);
  const revision = status?.generatedAt;

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    const poll = async () => {
      let next;
      try {
        next = await apiClient.fetchUsageHistoryStatus({ signal: controller.signal });
        if (!controller.signal.aborted) setStatus(next);
      } catch { /* The history query provides the retryable error state. */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, next?.status === "loading" || !next ? 900 : 5000);
    };
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [retry]);

  useEffect(() => {
    const controller = new AbortController();
    setRequestError("");
    apiClient.fetchUsageHistory(JSON.parse(key), { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setResult({ key, revision, data });
    }).catch((error) => {
      if (!controller.signal.aborted) setRequestError(error.message);
    });
    return () => controller.abort();
  }, [key, revision, retry]);

  const refresh = useCallback(async () => {
    setRefreshing(true); setRefreshError("");
    try {
      const next = await apiClient.refreshUsageHistory();
      setStatus(next); setRetry((value) => value + 1);
    } catch { setRefreshError("无法开始更新历史，请重试。"); }
    finally { setRefreshing(false); }
  }, []);
  const data = result?.key === key ? result.data : null;
  return { data, status, refresh, refreshError, requestError,
    loading: !requestError && (!data || (revision != null && result?.revision !== revision && data.scan?.generatedAt !== revision)),
    refreshing: refreshing || status?.status === "loading", retry: () => setRetry((value) => value + 1) };
}
