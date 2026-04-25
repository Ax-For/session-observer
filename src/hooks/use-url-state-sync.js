import { useEffect } from "react";
import { buildUrlSearch } from "../lib/url-state";

export function useUrlStateSync({
  dataSource,
  tab,
  selectedSessionId,
  mode,
  quickFilter,
  tokenThreshold,
  streamFilters,
  sessionFilters,
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = buildUrlSearch({
        dataSource,
        tab,
        selectedSessionId,
        mode,
        quickFilter,
        tokenThreshold,
        streamFilters,
        sessionFilters,
      });
      const currentSearch = String(window.location.search || "").replace(/^\?/, "");
      if (nextSearch === currentSearch) return;
      const nextUrl = nextSearch ? `${window.location.pathname}?${nextSearch}` : window.location.pathname;
      window.history.replaceState(null, "", nextUrl);
    }, 150);

    return () => window.clearTimeout(timer);
  }, [
    dataSource,
    tab,
    selectedSessionId,
    mode,
    quickFilter,
    tokenThreshold,
    streamFilters.query,
    streamFilters.model,
    streamFilters.type,
    streamFilters.platform,
    streamFilters.start,
    streamFilters.end,
    streamFilters.order,
    sessionFilters.query,
    sessionFilters.platform,
    sessionFilters.namedOnly,
  ]);
}
