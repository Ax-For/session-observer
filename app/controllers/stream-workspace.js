(function bootstrapObserverStreamWorkspace(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverStreamWorkspace = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverStreamWorkspaceModule() {
  "use strict";

  function defaultFormatShanghaiTime(value) {
    return String(value || "-");
  }

  function defaultHighlightJson(value) {
    return JSON.stringify(value, null, 2);
  }

  function defaultToDateMs(value) {
    return Date.parse(value);
  }

  function defaultNoop() {}

  function buildDetailPayload(item, helpers) {
    const formatShanghaiTime = helpers?.formatShanghaiTime || defaultFormatShanghaiTime;
    return {
      time_iso: item.time,
      time_shanghai: formatShanghaiTime(item.time),
      sessionId: item.sessionId,
      model: item.model,
      turnId: item.turnId,
      callId: item.callId,
      toolName: item.toolName,
      cwd: item.cwd,
      session_title: item.sessionTitle || "",
      token_usage: item.tokenUsage || null,
      raw_type: item.rawType || "",
      raw_sub_type: item.rawSubType || "",
      extra: item.extra,
      sourceFile: item.sourceFile,
      call_type: item.callType,
      content: item.content,
      raw: item.raw,
    };
  }

  function createStreamWorkspaceController(config) {
    const state = config?.state || {};
    const els = config?.els || {};
    const apiClient = config?.apiClient || {};
    const normalizeRealtimePayload = config?.normalizeRealtimePayload || ((payload) => payload);
    const helpers = {
      formatShanghaiTime: config?.helpers?.formatShanghaiTime || defaultFormatShanghaiTime,
      highlightJson: config?.helpers?.highlightJson || defaultHighlightJson,
      toDateMs: config?.helpers?.toDateMs || defaultToDateMs,
    };
    const callbacks = {
      syncUrl: config?.callbacks?.syncUrl || defaultNoop,
      renderRows: config?.callbacks?.renderRows || defaultNoop,
      refreshFiltersMeta: config?.callbacks?.refreshFiltersMeta || defaultNoop,
      renderSessionGroups: config?.callbacks?.renderSessionGroups || defaultNoop,
      matchFilters: config?.callbacks?.matchFilters || (() => true),
      isServerMode: config?.callbacks?.isServerMode || (() => false),
      setStatus: config?.callbacks?.setStatus || defaultNoop,
      eventMatchesMode: config?.callbacks?.eventMatchesMode || (() => true),
    };
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
      setInterval:
        typeof timerSource?.setInterval === "function"
          ? timerSource.setInterval.bind(timerSource)
          : typeof setInterval === "function"
            ? setInterval.bind(globalThis)
            : defaultNoop,
      clearInterval:
        typeof timerSource?.clearInterval === "function"
          ? timerSource.clearInterval.bind(timerSource)
          : typeof clearInterval === "function"
            ? clearInterval.bind(globalThis)
            : defaultNoop,
    };

    const controller = {
      getRealtimeQueryInput(offset = 0) {
        return {
          mode: state.viewMode,
          order: els.sortOrder?.value || "desc",
          offset,
          limit: state.pageLimit,
          quickFilter: state.quickFilter,
          tokenThreshold: Number(els.tokenThresholdInput?.value || 20000),
          q: els.searchInput?.value || "",
          platform: els.platformSelect?.value || "",
          model: els.modelSelect?.value || "",
          type: els.typeSelect?.value || "",
          start: els.startTime?.value || "",
          end: els.endTime?.value || "",
          sessionId: state.selectedSessionId,
        };
      },

      applyFilters() {
        if (callbacks.isServerMode()) {
          state.scrollTop = 0;
          if (els.rows) els.rows.scrollTop = 0;
          controller.refreshOnce("筛选刷新");
          callbacks.syncUrl();
          return;
        }

        state.filtered = (state.events || []).filter((event) => callbacks.matchFilters(event));
        const order = els.sortOrder?.value || "desc";
        state.filtered.sort((a, b) => {
          const am = helpers.toDateMs(a.time) ?? 0;
          const bm = helpers.toDateMs(b.time) ?? 0;
          return order === "asc" ? am - bm : bm - am;
        });
        if (state.selectedRowIndex >= state.filtered.length) {
          state.selectedRowIndex = -1;
        }
        state.scrollTop = 0;
        if (els.rows) els.rows.scrollTop = 0;
        callbacks.renderRows();
        callbacks.syncUrl();
      },

      scheduleApplyFilters(delay = 100) {
        if (state.filterTimer) timers.clearTimeout(state.filterTimer);
        state.filterTimer = timers.setTimeout(() => {
          state.filterTimer = null;
          controller.applyFilters();
        }, delay);
      },

      showDetail(index) {
        const item = state.filtered?.[index];
        if (!item) return;
        state.selectedRowIndex = index;
        callbacks.renderRows();
        const payload = buildDetailPayload(item, helpers);
        if (els.modalJson) {
          els.modalJson.innerHTML = helpers.highlightJson(payload);
        }
        els.detailModal?.classList?.remove?.("hidden");
        els.detailModal?.setAttribute?.("aria-hidden", "false");
        controller.updateNavBtnsState();
      },

      updateNavBtnsState() {
        const total = state.filtered?.length || 0;
        const current = state.selectedRowIndex;
        if (els.prevEventBtn) els.prevEventBtn.disabled = current <= 0;
        if (els.nextEventBtn) els.nextEventBtn.disabled = current >= total - 1;
      },

      closeModal() {
        els.detailModal?.classList?.add?.("hidden");
        els.detailModal?.setAttribute?.("aria-hidden", "true");
      },

      setAutoRefreshUi(enabled) {
        state.autoRefreshEnabled = enabled;
        els.autoRefreshBtn?.classList?.toggle?.("active", enabled);
        if (els.autoRefreshBtn) {
          els.autoRefreshBtn.textContent = enabled ? "停止自动刷新" : "自动刷新(5s)";
        }
        callbacks.syncUrl();
      },

      setStatus(message) {
        callbacks.setStatus(message);
      },

      loadRealtimeEvents() {
        return controller.loadRealtimeEventsPage({ append: false });
      },

      async loadRealtimeEventsPage({ append }) {
        state.dataSource = "server";
        const offset = append ? state.filtered.length : 0;
        const data = await apiClient.listRealtimeEvents(controller.getRealtimeQueryInput(offset));
        const normalized = normalizeRealtimePayload(data, {
          append,
          currentEvents: state.events,
          pageLimit: state.pageLimit,
        });
        state.events = normalized.events;
        state.filtered = normalized.filtered;
        state.sessions = normalized.sessions;
        state.meta = normalized.meta;
        state.totalVisible = normalized.totalVisible;
        if (normalized.claudeVersion) state.claudeVersion = normalized.claudeVersion;
        if (normalized.codexVersion) state.codexVersion = normalized.codexVersion;
        state.totalMatching = normalized.totalMatching;
        state.pageOffset = normalized.pageOffset;
        state.pageLimit = normalized.pageLimit;
        state.hasMore = normalized.hasMore;
        if (!append) {
          state.scrollTop = 0;
          if (els.rows) els.rows.scrollTop = 0;
          state.sessionScrollTop = 0;
          if (els.sessionList) els.sessionList.scrollTop = 0;
        }
        callbacks.refreshFiltersMeta();
        callbacks.renderSessionGroups();
        callbacks.renderRows();
        return state.totalMatching;
      },

      async refreshOnce(prefix) {
        try {
          const count = await controller.loadRealtimeEventsPage({ append: false });
          const now = new Date().toLocaleTimeString();
          const mode = state.autoRefreshEnabled ? "自动刷新中" : prefix;
          controller.setStatus(`${mode}成功，最近刷新: ${now}，匹配事件: ${count}`);
        } catch (err) {
          controller.setStatus(`${prefix}失败: ${err.message}`);
        }
      },

      async startAutoRefresh() {
        controller.setAutoRefreshUi(true);
        await controller.refreshOnce("自动刷新");
        if (state.autoRefreshTimer) timers.clearInterval(state.autoRefreshTimer);
        state.autoRefreshTimer = timers.setInterval(async () => {
          try {
            await controller.refreshOnce("自动刷新");
          } catch (err) {
            controller.setStatus(`自动刷新失败: ${err.message}`);
          }
        }, 5000);
      },

      stopAutoRefresh(message) {
        if (state.autoRefreshTimer) timers.clearInterval(state.autoRefreshTimer);
        state.autoRefreshTimer = null;
        controller.setAutoRefreshUi(false);
        controller.setStatus(message || "自动刷新未启用");
      },
    };

    return controller;
  }

  return {
    buildDetailPayload,
    createStreamWorkspaceController,
  };
});
