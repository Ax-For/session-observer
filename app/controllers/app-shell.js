(function bootstrapObserverAppShell(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverAppShell = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverAppShellModule() {
  "use strict";

  function defaultNoop() {}

  function createAppShellController(config) {
    const state = config?.state || {};
    const els = config?.els || {};
    const storageRef = config?.storageRef || (typeof localStorage !== "undefined" ? localStorage : null);
    const documentRef = config?.documentRef || (typeof document !== "undefined" ? document : null);
    const windowRef = config?.windowRef || (typeof window !== "undefined" ? window : null);
    const helpers = {
      rowHeightForDensity: config?.helpers?.rowHeightForDensity || (() => Number(state.rowHeight) || 156),
      sessionRowHeightForDensity: config?.helpers?.sessionRowHeightForDensity || (() => Number(state.sessionRowHeight) || 152),
    };
    const callbacks = {
      syncUrl: config?.callbacks?.syncUrl || defaultNoop,
      wireEvents: config?.callbacks?.wireEvents || defaultNoop,
      wireSessionMgmt: config?.callbacks?.wireSessionMgmt || defaultNoop,
      decodeStateFromUrl: config?.callbacks?.decodeStateFromUrl || (() => false),
      renderQuickFilterUi: config?.callbacks?.renderQuickFilterUi || defaultNoop,
      renderSessionGroups: config?.callbacks?.renderSessionGroups || defaultNoop,
      renderStats: config?.callbacks?.renderStats || defaultNoop,
      switchTab: config?.callbacks?.switchTab || defaultNoop,
      setAutoRefreshUi: config?.callbacks?.setAutoRefreshUi || defaultNoop,
      setStatus: config?.callbacks?.setStatus || defaultNoop,
      refreshOnce: config?.callbacks?.refreshOnce || defaultNoop,
      renderVirtualSessionGroups: config?.callbacks?.renderVirtualSessionGroups || defaultNoop,
      renderVirtualRows: config?.callbacks?.renderVirtualRows || defaultNoop,
    };

    const controller = {
      applySessionPaneWidth() {
        documentRef?.documentElement?.style?.setProperty?.("--session-pane-width", `${state.sessionPaneWidth}px`);
      },

      applyViewMode(mode) {
        state.viewMode = mode === "raw" ? "raw" : "observe";
        if (els.modeToggleBtn) {
          els.modeToggleBtn.textContent = state.viewMode === "raw" ? "观测模式" : "原始模式";
          els.modeToggleBtn.classList?.toggle?.("active", state.viewMode === "raw");
        }
        storageRef?.setItem?.("observer_view_mode", state.viewMode);
        callbacks.syncUrl();
      },

      applyTheme(theme) {
        state.theme = theme === "dark" ? "dark" : "light";
        documentRef?.body?.setAttribute?.("data-theme", state.theme);
        storageRef?.setItem?.("observer_theme", state.theme);
        if (els.themeToggleBtn) {
          els.themeToggleBtn.textContent = state.theme === "dark" ? "白天模式" : "夜间模式";
        }
      },

      applyDensity(mode) {
        state.density = mode === "compact" ? "compact" : "cozy";
        state.rowHeight = helpers.rowHeightForDensity();
        state.sessionRowHeight = helpers.sessionRowHeightForDensity();
        documentRef?.body?.setAttribute?.("data-density", state.density);
        storageRef?.setItem?.("observer_density", state.density);
        if (els.densityToggleBtn) {
          els.densityToggleBtn.textContent = state.density === "compact" ? "舒展视图" : "紧凑视图";
        }
      },

      initAppearance() {
        const savedTheme = storageRef?.getItem?.("observer_theme") || "light";
        const savedDensity = storageRef?.getItem?.("observer_density") || "cozy";
        const savedViewMode = storageRef?.getItem?.("observer_view_mode") || "observe";
        const savedThreshold = storageRef?.getItem?.("observer_high_token_threshold") || "20000";
        const savedDashCollapsed = storageRef?.getItem?.("observer_dash_collapsed") === "true";
        controller.applyViewMode(savedViewMode);
        controller.applyTheme(savedTheme);
        controller.applyDensity(savedDensity);
        if (savedDashCollapsed) {
          state.dashboardCollapsed = true;
          els.stats?.classList?.add?.("collapsed");
        }
        if (els.tokenThresholdInput) {
          els.tokenThresholdInput.value = savedThreshold;
        }
      },

      initResizeHandle() {
        const handle = els.resizeHandle;
        if (!handle) return;

        const savedWidth = storageRef?.getItem?.("observer_session_pane_width");
        if (savedWidth) {
          state.sessionPaneWidth = parseInt(savedWidth, 10) || 320;
          controller.applySessionPaneWidth();
        }

        let startX = 0;
        let startWidth = 0;

        function onMouseMove(event) {
          const container = documentRef?.querySelector?.(".content-grid");
          if (!container) return;
          const containerWidth = container.offsetWidth;
          const delta = event.clientX - startX;
          const nextWidth = Math.max(260, Math.min(startWidth + delta, containerWidth / 2));
          state.sessionPaneWidth = nextWidth;
          controller.applySessionPaneWidth();
        }

        function onMouseUp() {
          handle.classList?.remove?.("dragging");
          storageRef?.setItem?.("observer_session_pane_width", String(state.sessionPaneWidth));
          documentRef?.removeEventListener?.("mousemove", onMouseMove);
          documentRef?.removeEventListener?.("mouseup", onMouseUp);
        }

        handle.addEventListener("mousedown", (event) => {
          event.preventDefault?.();
          startX = event.clientX;
          startWidth = state.sessionPaneWidth;
          handle.classList?.add?.("dragging");
          documentRef?.addEventListener?.("mousemove", onMouseMove);
          documentRef?.addEventListener?.("mouseup", onMouseUp);
        });
      },

      startApp() {
        callbacks.wireEvents();
        callbacks.wireSessionMgmt();
        controller.initAppearance();
        callbacks.decodeStateFromUrl();
        if (state.viewMode) {
          controller.applyViewMode(state.viewMode);
        }
        if (state.dashboardCollapsed) {
          els.stats?.classList?.add?.("collapsed");
        }
        if (state.autoRefreshEnabled) {
          callbacks.setAutoRefreshUi(true);
        }
        controller.initResizeHandle();
        callbacks.renderQuickFilterUi();
        callbacks.renderSessionGroups();
        callbacks.renderStats();
        if (state.activeTab && state.activeTab !== "stream") {
          callbacks.switchTab(state.activeTab);
        }
        callbacks.setStatus("正在加载数据...");
        callbacks.refreshOnce("初始加载");

        windowRef?.addEventListener?.("resize", () => {
          state.viewportHeight = els.rows?.clientHeight || 0;
          state.sessionViewportHeight = els.sessionList?.clientHeight || 0;
          callbacks.renderVirtualSessionGroups();
          callbacks.renderVirtualRows();
        });
      },
    };

    return controller;
  }

  return {
    createAppShellController,
  };
});
