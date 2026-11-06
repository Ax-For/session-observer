import { useCallback, useEffect, useState } from "react";

export function usePerformanceBaseline(revision, status) {
  const [data, setData] = useState(null);
  const [requestError, setRequestError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/performance-baseline", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("无法读取历史基线");
      const value = await response.json();
      if (!controller.signal.aborted) { setData(value); setRequestError(""); }
    }).catch((error) => { if (!controller.signal.aborted) setRequestError(error.message); });
    return () => controller.abort();
  }, [revision, status]);
  const refresh = useCallback(async () => {
    try {
      setRequestError("");
      const response = await fetch("/api/performance-baseline/refresh", { method: "POST", headers: { "X-Observer-Request": "1" } });
      if (!response.ok) throw new Error("无法更新历史基线");
      setData(await response.json());
    } catch (error) { setRequestError(error.message); }
  }, []);
  return { data, refresh, requestError };
}
