(function bootstrapObserverUrlState(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverUrlState = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverUrlStateModule() {
  "use strict";

  function defaultNoop() {}

  function getSearchValue(search) {
    return String(search || "").replace(/^\?/, "");
  }

  function buildUrlSearch(context) {
    const state = context?.state || {};
    const els = context?.els || {};
    const params = new URLSearchParams();

    if (state.activeTab !== "stream") params.set("tab", state.activeTab);
    if (state.selectedSessionId) params.set("session", state.selectedSessionId);
    if (els.searchInput?.value) params.set("q", els.searchInput.value);
    if (els.modelSelect?.value) params.set("model", els.modelSelect.value);
    if (els.typeSelect?.value) params.set("type", els.typeSelect.value);
    if (els.platformSelect?.value) params.set("platform", els.platformSelect.value);
    if (state.quickFilter !== "all") params.set("qf", state.quickFilter);
    if (state.viewMode !== "observe") params.set("mode", state.viewMode);
    if (els.sortOrder?.value && els.sortOrder.value !== "desc") params.set("sort", els.sortOrder.value);
    if (els.startTime?.value) params.set("from", els.startTime.value);
    if (els.endTime?.value) params.set("to", els.endTime.value);
    if (state.dashboardCollapsed) params.set("dash", "1");
    if (state.autoRefreshEnabled) params.set("ar", "1");

    return params.toString();
  }

  function applyUrlSearch(search, context) {
    const state = context?.state || {};
    const els = context?.els || {};
    const params = new URLSearchParams(getSearchValue(search));
    if (!params.toString()) return false;

    let applied = false;

    if (params.has("tab")) {
      const tab = params.get("tab");
      if (tab === "stream" || tab === "sessions") {
        state.activeTab = tab;
        applied = true;
      }
    }

    if (params.has("session")) {
      state.selectedSessionId = params.get("session");
      applied = true;
    }

    if (params.has("q") && els.searchInput) {
      els.searchInput.value = params.get("q");
      applied = true;
    }

    if (params.has("model") && els.modelSelect) {
      els.modelSelect.value = params.get("model");
      applied = true;
    }

    if (params.has("type") && els.typeSelect) {
      els.typeSelect.value = params.get("type");
      applied = true;
    }

    if (params.has("platform") && els.platformSelect) {
      els.platformSelect.value = params.get("platform");
      applied = true;
    }

    if (params.has("qf")) {
      const quickFilter = params.get("qf");
      if (quickFilter === "all" || quickFilter === "alert" || quickFilter === "high_token") {
        state.quickFilter = quickFilter;
        applied = true;
      }
    }

    if (params.has("mode")) {
      const mode = params.get("mode");
      if (mode === "observe" || mode === "raw") {
        state.viewMode = mode;
        applied = true;
      }
    }

    if (params.has("sort") && els.sortOrder) {
      const sort = params.get("sort");
      if (sort === "asc" || sort === "desc") {
        els.sortOrder.value = sort;
        applied = true;
      }
    }

    if (params.has("from") && els.startTime) {
      els.startTime.value = params.get("from");
      applied = true;
    }

    if (params.has("to") && els.endTime) {
      els.endTime.value = params.get("to");
      applied = true;
    }

    if (params.has("dash")) {
      state.dashboardCollapsed = params.get("dash") === "1";
      applied = true;
    }

    if (params.has("ar")) {
      state.autoRefreshEnabled = params.get("ar") === "1";
      applied = true;
    }

    return applied;
  }

  function createUrlStateController(config) {
    const state = config?.state || {};
    const els = config?.els || {};
    const locationRef = config?.locationRef || (typeof window !== "undefined" ? window.location : { search: "", pathname: "/" });
    const historyRef = config?.historyRef || (typeof history !== "undefined" ? history : null);
    const timerSource = config?.timers || null;
    const timers = {
      setTimeout:
        typeof timerSource?.setTimeout === "function"
          ? timerSource.setTimeout.bind(timerSource)
          : typeof setTimeout === "function"
            ? setTimeout.bind(globalThis)
            : defaultNoop,
      clearTimeout:
        typeof timerSource?.clearTimeout === "function"
          ? timerSource.clearTimeout.bind(timerSource)
          : typeof clearTimeout === "function"
            ? clearTimeout.bind(globalThis)
            : defaultNoop,
    };

    let urlSyncTimer = null;

    const controller = {
      encodeStateToUrl() {
        try {
          const newSearch = buildUrlSearch({ state, els });
          const currentSearch = getSearchValue(locationRef?.search);
          if (newSearch === currentSearch || !historyRef?.replaceState) return;
          const pathname = locationRef?.pathname || "/";
          const nextUrl = newSearch ? `${pathname}?${newSearch}` : pathname;
          historyRef.replaceState(null, "", nextUrl);
        } catch (err) {
          return;
        }
      },

      decodeStateFromUrl() {
        try {
          return applyUrlSearch(locationRef?.search, { state, els });
        } catch (err) {
          return false;
        }
      },

      syncUrl() {
        if (urlSyncTimer) timers.clearTimeout(urlSyncTimer);
        urlSyncTimer = timers.setTimeout(() => {
          controller.encodeStateToUrl();
          urlSyncTimer = null;
        }, 150);
      },
    };

    return controller;
  }

  return {
    applyUrlSearch,
    buildUrlSearch,
    createUrlStateController,
  };
});
