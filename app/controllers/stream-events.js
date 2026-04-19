(function bootstrapObserverStreamEvents(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverStreamEvents = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverStreamEventsModule() {
  "use strict";

  function defaultNoop() {}

  function defaultShortId(value, size = 8) {
    const text = String(value || "");
    return text.length <= size ? text : text.slice(0, size);
  }

  function defaultBuildDetailPayload(value) {
    return value;
  }

  function defaultIsVisibleInCurrentMode() {
    return true;
  }

  function defaultFormatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  function defaultDownloadJsonl(jsonl, filename, documentRef) {
    if (typeof Blob !== "function" || typeof URL === "undefined" || !documentRef?.body || !documentRef?.createElement) {
      return;
    }
    const blob = new Blob([jsonl], { type: "application/jsonl" });
    const url = URL.createObjectURL(blob);
    const link = documentRef.createElement("a");
    link.href = url;
    link.download = filename;
    documentRef.body.appendChild(link);
    if (typeof link.click === "function") link.click();
    documentRef.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function isEditableTarget(target) {
    const tagName = String(target?.tagName || "").toUpperCase();
    return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
  }

  function clearTimeQuickButtons(documentRef) {
    const buttons = documentRef?.querySelectorAll?.(".time-quick-btn") || [];
    buttons.forEach((button) => button.classList?.remove?.("active"));
  }

  function createStreamEventsController(config) {
    const state = config?.state || {};
    const els = config?.els || {};
    const parseFiles = config?.parseFiles || (async () => []);
    const documentRef = config?.documentRef || (typeof document !== "undefined" ? document : null);
    const windowRef = config?.windowRef || (typeof window !== "undefined" ? window : null);
    const navigatorRef = config?.navigatorRef || (typeof navigator !== "undefined" ? navigator : null);
    const storageRef = config?.storageRef || (typeof localStorage !== "undefined" ? localStorage : null);
    const timerSource = config?.timers || null;
    const timers = {
      setTimeout:
        typeof timerSource?.setTimeout === "function"
          ? timerSource.setTimeout.bind(timerSource)
          : typeof setTimeout === "function"
            ? setTimeout.bind(globalThis)
            : defaultNoop,
    };
    const helpers = {
      buildDetailPayload: config?.helpers?.buildDetailPayload || defaultBuildDetailPayload,
      shortId: config?.helpers?.shortId || defaultShortId,
      isServerMode: config?.helpers?.isServerMode || (() => false),
      isVisibleInCurrentMode: config?.helpers?.isVisibleInCurrentMode || defaultIsVisibleInCurrentMode,
      rowHeightForDensity: config?.helpers?.rowHeightForDensity || (() => Number(state.rowHeight) || 156),
      formatDateTimeLocal: config?.helpers?.formatDateTimeLocal || defaultFormatDateTimeLocal,
      downloadJsonl:
        config?.helpers?.downloadJsonl || ((jsonl, filename) => defaultDownloadJsonl(jsonl, filename, documentRef)),
    };
    const callbacks = {
      applyFilters: config?.callbacks?.applyFilters || defaultNoop,
      scheduleApplyFilters: config?.callbacks?.scheduleApplyFilters || defaultNoop,
      showDetail: config?.callbacks?.showDetail || defaultNoop,
      renderVirtualRows: config?.callbacks?.renderVirtualRows || defaultNoop,
      renderVirtualSessionGroups: config?.callbacks?.renderVirtualSessionGroups || defaultNoop,
      loadRealtimeEventsPage: config?.callbacks?.loadRealtimeEventsPage || (async () => 0),
      setStatus: config?.callbacks?.setStatus || defaultNoop,
      closeModal: config?.callbacks?.closeModal || defaultNoop,
      closeSessionDetail: config?.callbacks?.closeSessionDetail || defaultNoop,
      closeRenameModal: config?.callbacks?.closeRenameModal || defaultNoop,
      closeDeleteModal: config?.callbacks?.closeDeleteModal || defaultNoop,
      refreshOnce: config?.callbacks?.refreshOnce || (async () => {}),
      stopAutoRefresh: config?.callbacks?.stopAutoRefresh || defaultNoop,
      startAutoRefresh: config?.callbacks?.startAutoRefresh || (async () => {}),
      applyViewMode: config?.callbacks?.applyViewMode || defaultNoop,
      applyTheme: config?.callbacks?.applyTheme || defaultNoop,
      applyDensity: config?.callbacks?.applyDensity || defaultNoop,
      refreshFiltersMeta: config?.callbacks?.refreshFiltersMeta || defaultNoop,
      renderSessionGroups: config?.callbacks?.renderSessionGroups || defaultNoop,
      renderQuickFilterUi: config?.callbacks?.renderQuickFilterUi || defaultNoop,
      renderStats: config?.callbacks?.renderStats || defaultNoop,
      syncUrl: config?.callbacks?.syncUrl || defaultNoop,
      goBackToSessionMgmt: config?.callbacks?.goBackToSessionMgmt || defaultNoop,
      renderRows: config?.callbacks?.renderRows || defaultNoop,
    };

    function closeHelpModal() {
      els.helpModal?.classList?.add?.("hidden");
      els.helpModal?.setAttribute?.("aria-hidden", "true");
    }

    async function handleFiles(files) {
      if (!files?.length) return;
      state.dataSource = "local";
      state.events = await parseFiles(files);
      state.filtered = [];
      state.sessions = [];
      state.meta = { models: [], types: [] };
      state.totalVisible = state.events.filter((event) => helpers.isVisibleInCurrentMode(event)).length;
      state.totalMatching = state.totalVisible;
      state.pageOffset = 0;
      state.hasMore = false;
      state.sessionScrollTop = 0;
      if (els.sessionList) els.sessionList.scrollTop = 0;
      state.scrollTop = 0;
      if (els.rows) els.rows.scrollTop = 0;
      callbacks.refreshFiltersMeta();
      callbacks.renderSessionGroups();
      callbacks.applyFilters();
      callbacks.closeModal();
    }

    function scrollSelectedRowIntoView(index) {
      const rowHeight = helpers.rowHeightForDensity();
      const viewportHeight = els.rows?.clientHeight || 0;
      const scrollTop = els.rows?.scrollTop || 0;
      const targetTop = index * rowHeight;
      if (targetTop < scrollTop || targetTop > scrollTop + viewportHeight - rowHeight) {
        if (els.rows) els.rows.scrollTop = targetTop - rowHeight;
      }
    }

    function resetFilters() {
      state.selectedSessionId = "";
      state.selectedRowIndex = -1;
      state.quickFilter = "all";
      if (els.searchInput) els.searchInput.value = "";
      if (els.startTime) els.startTime.value = "";
      if (els.endTime) els.endTime.value = "";
      if (els.sortOrder) els.sortOrder.value = "desc";
      if (els.modelSelect?.options?.length > 0) els.modelSelect.value = "";
      if (els.typeSelect?.options?.length > 0) els.typeSelect.value = "";
      if (els.platformSelect?.options?.length > 0) els.platformSelect.value = "";
      callbacks.renderQuickFilterUi();
      callbacks.renderSessionGroups();
      callbacks.applyFilters();
      callbacks.setStatus("筛选条件已重置");
    }

    function clearAllData() {
      state.events = [];
      state.filtered = [];
      state.sessions = [];
      state.meta = { models: [], types: [] };
      state.totalVisible = 0;
      state.totalMatching = 0;
      state.pageOffset = 0;
      state.hasMore = false;
      state.selectedSessionId = "";
      state.selectedRowIndex = -1;
      state.sessionGroups = [];
      state.sessionScrollTop = 0;
      state.sessionViewportHeight = 0;
      state.scrollTop = 0;
      state.viewportHeight = 0;
      state.quickFilter = "all";
      if (els.fileInput) els.fileInput.value = "";
      if (els.searchInput) els.searchInput.value = "";
      if (els.modelSelect) els.modelSelect.innerHTML = '<option value="">全部</option>';
      if (els.typeSelect) els.typeSelect.innerHTML = '<option value="">全部</option>';
      if (els.platformSelect) els.platformSelect.innerHTML = '<option value="">全部</option>';
      if (els.startTime) els.startTime.value = "";
      if (els.endTime) els.endTime.value = "";
      if (els.sortOrder) els.sortOrder.value = "desc";
      if (els.rows) {
        els.rows.innerHTML = "";
        els.rows.scrollTop = 0;
      }
      if (els.sessionList) els.sessionList.scrollTop = 0;
      callbacks.closeModal();
      callbacks.renderQuickFilterUi();
      callbacks.renderSessionGroups();
      callbacks.renderStats();
    }

    async function copySelectedJson() {
      const item = state.filtered?.[state.selectedRowIndex];
      if (!item) return;
      const payload = helpers.buildDetailPayload(item);
      const json = JSON.stringify(payload, null, 2);
      try {
        await navigatorRef?.clipboard?.writeText?.(json);
        callbacks.setStatus("JSON 已复制到剪贴板");
      } catch (err) {
        callbacks.setStatus("复制失败：浏览器未授权剪贴板");
      }
    }

    function exportFilteredEvents() {
      const events = state.filtered || [];
      if (events.length === 0) {
        callbacks.setStatus("无数据可导出");
        return;
      }
      const jsonl = events.map((event) => JSON.stringify(helpers.buildDetailPayload(event))).join("\n");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const sessionSuffix = state.selectedSessionId ? `_${helpers.shortId(state.selectedSessionId, 8)}` : "";
      const filename = `session-export_${timestamp}${sessionSuffix}.jsonl`;
      helpers.downloadJsonl(jsonl, filename);
      callbacks.setStatus(`已导出 ${events.length} 条事件`);
    }

    function handleStreamKeydown(event) {
      if (event.key === "Escape") {
        callbacks.closeModal();
        callbacks.closeSessionDetail();
        callbacks.closeRenameModal();
        callbacks.closeDeleteModal();
        closeHelpModal();
        return;
      }

      if (isEditableTarget(event.target)) return;

      if (event.key === "/" || (event.key === "f" && !event.ctrlKey && !event.metaKey)) {
        event.preventDefault?.();
        els.searchInput?.focus?.();
        return;
      }

      if (event.key === "r" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault?.();
        callbacks.refreshOnce("手动刷新");
        return;
      }

      if (event.key === "a" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault?.();
        if (state.autoRefreshEnabled) callbacks.stopAutoRefresh("自动刷新已停止");
        else callbacks.startAutoRefresh();
        return;
      }

      if (event.key === "t" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault?.();
        callbacks.applyTheme(state.theme === "dark" ? "light" : "dark");
        return;
      }

      if (event.key === "m" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault?.();
        callbacks.applyViewMode(state.viewMode === "raw" ? "observe" : "raw");
        state.selectedRowIndex = -1;
        state.scrollTop = 0;
        if (els.rows) els.rows.scrollTop = 0;
        callbacks.refreshFiltersMeta();
        callbacks.renderSessionGroups();
        callbacks.applyFilters();
        return;
      }

      if (state.activeTab !== "stream" || !state.filtered?.length) return;

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault?.();
        if (state.selectedRowIndex < state.filtered.length - 1) {
          state.selectedRowIndex += 1;
          callbacks.renderRows();
          scrollSelectedRowIntoView(state.selectedRowIndex);
        }
        return;
      }

      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault?.();
        if (state.selectedRowIndex > 0) {
          state.selectedRowIndex -= 1;
          callbacks.renderRows();
          scrollSelectedRowIntoView(state.selectedRowIndex);
        }
        return;
      }

      if (event.key === "Enter" && state.selectedRowIndex >= 0) {
        event.preventDefault?.();
        callbacks.showDetail(state.selectedRowIndex);
        return;
      }

      if (event.key === "g") {
        state._ggPending = true;
        timers.setTimeout(() => {
          state._ggPending = false;
        }, 500);
        return;
      }

      if (event.key === "G" || (event.key === "g" && event.shiftKey)) {
        event.preventDefault?.();
        state.selectedRowIndex = state.filtered.length - 1;
        if (els.rows) els.rows.scrollTop = state.selectedRowIndex * helpers.rowHeightForDensity();
        callbacks.renderRows();
      }
    }

    function wireEvents() {
      els.fileInput?.addEventListener?.("change", (event) => {
        handleFiles(Array.from(event.target?.files || []));
      });

      els.searchInput?.addEventListener?.("input", () => callbacks.scheduleApplyFilters(120));
      els.modelSelect?.addEventListener?.("change", callbacks.applyFilters);
      els.typeSelect?.addEventListener?.("change", callbacks.applyFilters);
      els.platformSelect?.addEventListener?.("change", callbacks.applyFilters);
      els.sortOrder?.addEventListener?.("change", callbacks.applyFilters);

      const timeQuickButtons = documentRef?.querySelectorAll?.(".time-quick-btn") || [];
      timeQuickButtons.forEach((button) => {
        button.addEventListener("click", () => {
          const quick = button.dataset?.timeQuick;
          const now = new Date();
          let start = null;
          let end = now;

          switch (quick) {
            case "1h":
              start = new Date(now.getTime() - 60 * 60 * 1000);
              break;
            case "today":
              start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
              break;
            case "week": {
              const dayOfWeek = now.getDay();
              const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
              start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToMonday, 0, 0, 0);
              break;
            }
            case "month":
              start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
              break;
            default:
              return;
          }

          if (els.startTime) els.startTime.value = helpers.formatDateTimeLocal(start);
          if (els.endTime) els.endTime.value = helpers.formatDateTimeLocal(end);
          clearTimeQuickButtons(documentRef);
          button.classList?.add?.("active");
          callbacks.applyFilters();
          callbacks.setStatus(`时间范围已设置: ${quick === "1h" ? "最近1小时" : quick === "today" ? "今天" : quick === "week" ? "本周" : "本月"}`);
        });
      });

      els.startTime?.addEventListener?.("input", () => {
        clearTimeQuickButtons(documentRef);
        callbacks.scheduleApplyFilters(220);
      });
      els.endTime?.addEventListener?.("input", () => {
        clearTimeQuickButtons(documentRef);
        callbacks.scheduleApplyFilters(220);
      });
      els.startTime?.addEventListener?.("change", callbacks.applyFilters);
      els.endTime?.addEventListener?.("change", callbacks.applyFilters);

      els.rows?.addEventListener?.("click", (event) => {
        const expandBtn = event.target?.closest?.(".log-expand-btn");
        if (expandBtn) {
          const logMain = expandBtn.previousElementSibling;
          if (!logMain) return;
          const expanded = logMain.classList?.toggle?.("expanded");
          expandBtn.textContent = expanded ? "收起" : "展开";
          expandBtn.dataset.expand = expanded ? "false" : "true";
          return;
        }

        const item = event.target?.closest?.(".log-row, .log-item");
        if (!item || item.dataset?.index == null) return;
        callbacks.showDetail(Number(item.dataset.index));
      });

      els.rows?.addEventListener?.("scroll", () => {
        state.scrollTop = els.rows.scrollTop;
        callbacks.renderVirtualRows();
      });

      els.sessionList?.addEventListener?.("scroll", () => {
        state.sessionScrollTop = els.sessionList.scrollTop;
        callbacks.renderVirtualSessionGroups();
      });

      els.loadMoreBtn?.addEventListener?.("click", async () => {
        if (!state.hasMore || !helpers.isServerMode()) return;
        try {
          await callbacks.loadRealtimeEventsPage({ append: true });
          callbacks.setStatus(`已加载更多，当前显示 ${state.filtered.length} / ${state.totalMatching}`);
        } catch (err) {
          callbacks.setStatus(`加载更多失败: ${err.message}`);
        }
      });

      els.modalCloseBtn?.addEventListener?.("click", callbacks.closeModal);
      els.copyJsonBtn?.addEventListener?.("click", copySelectedJson);
      els.exportBtn?.addEventListener?.("click", exportFilteredEvents);
      els.prevEventBtn?.addEventListener?.("click", () => {
        if (state.selectedRowIndex > 0) callbacks.showDetail(state.selectedRowIndex - 1);
      });
      els.nextEventBtn?.addEventListener?.("click", () => {
        if (state.selectedRowIndex < state.filtered.length - 1) callbacks.showDetail(state.selectedRowIndex + 1);
      });
      els.detailModal?.addEventListener?.("click", (event) => {
        if (event.target?.closest?.("[data-close='1']")) callbacks.closeModal();
      });

      windowRef?.addEventListener?.("keydown", handleStreamKeydown);

      els.sessionList?.addEventListener?.("click", async (event) => {
        const copyBtn = event.target?.closest?.("button[data-copy-session-id]");
        if (copyBtn) {
          const sessionId = copyBtn.dataset?.copySessionId || "";
          if (!sessionId) return;
          try {
            await navigatorRef?.clipboard?.writeText?.(sessionId);
            callbacks.setStatus(`已复制 Session ID: ${sessionId}`);
          } catch (err) {
            callbacks.setStatus("复制失败：浏览器未授权剪贴板");
          }
          return;
        }

        const button = event.target?.closest?.("[data-session-id]");
        if (!button) return;
        state.selectedSessionId = button.dataset?.sessionId || "";
        state.selectedRowIndex = -1;
        callbacks.renderSessionGroups();
        callbacks.applyFilters();
      });

      els.sessionList?.addEventListener?.("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const card = event.target?.closest?.(".session-item[data-session-id]");
        if (!card) return;
        event.preventDefault?.();
        state.selectedSessionId = card.dataset?.sessionId || "";
        state.selectedRowIndex = -1;
        callbacks.renderSessionGroups();
        callbacks.applyFilters();
      });

      els.allSessionsBtn?.addEventListener?.("click", () => {
        state.selectedSessionId = "";
        state.selectedRowIndex = -1;
        callbacks.renderSessionGroups();
        callbacks.applyFilters();
      });

      els.resetFiltersBtn?.addEventListener?.("click", resetFilters);
      els.clearBtn?.addEventListener?.("click", clearAllData);
      els.manualRefreshBtn?.addEventListener?.("click", async () => {
        await callbacks.refreshOnce("手动刷新");
      });
      els.autoRefreshBtn?.addEventListener?.("click", async () => {
        if (state.autoRefreshEnabled) {
          callbacks.stopAutoRefresh("自动刷新已停止");
          return;
        }
        await callbacks.startAutoRefresh();
      });

      els.modeToggleBtn?.addEventListener?.("click", () => {
        callbacks.applyViewMode(state.viewMode === "raw" ? "observe" : "raw");
        state.selectedRowIndex = -1;
        state.scrollTop = 0;
        if (els.rows) els.rows.scrollTop = 0;
        callbacks.refreshFiltersMeta();
        callbacks.renderSessionGroups();
        callbacks.applyFilters();
      });
      els.themeToggleBtn?.addEventListener?.("click", () => {
        callbacks.applyTheme(state.theme === "dark" ? "light" : "dark");
      });
      els.densityToggleBtn?.addEventListener?.("click", () => {
        callbacks.applyDensity(state.density === "compact" ? "cozy" : "compact");
        callbacks.renderRows();
      });

      els.dashCollapseBtn?.addEventListener?.("click", () => {
        state.dashboardCollapsed = !state.dashboardCollapsed;
        els.stats?.classList?.toggle?.("collapsed", state.dashboardCollapsed);
        if (els.dashCollapseBtn) {
          els.dashCollapseBtn.textContent = state.dashboardCollapsed ? "(+)" : "(−)";
        }
        storageRef?.setItem?.("observer_dash_collapsed", state.dashboardCollapsed ? "true" : "false");
        callbacks.syncUrl();
      });

      els.quickFilters?.addEventListener?.("click", (event) => {
        const button = event.target?.closest?.("button[data-quick-filter]");
        if (!button) return;
        state.quickFilter = button.dataset?.quickFilter || "all";
        state.selectedRowIndex = -1;
        callbacks.renderQuickFilterUi();
        callbacks.applyFilters();
      });

      els.tokenThresholdInput?.addEventListener?.("input", () => {
        const raw = Number(els.tokenThresholdInput.value || 0);
        const normalized = Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : 0;
        els.tokenThresholdInput.value = String(normalized);
        storageRef?.setItem?.("observer_high_token_threshold", String(normalized));
        if (state.quickFilter === "high_token") {
          callbacks.scheduleApplyFilters(80);
        }
      });

      els.helpBtn?.addEventListener?.("click", () => {
        els.helpModal?.classList?.remove?.("hidden");
        els.helpModal?.setAttribute?.("aria-hidden", "false");
      });
      els.helpModalCloseBtn?.addEventListener?.("click", closeHelpModal);
      els.helpModal?.addEventListener?.("click", (event) => {
        if (event.target?.closest?.("[data-close-help]")) closeHelpModal();
      });

      documentRef?.addEventListener?.("click", (event) => {
        if (event.target?.id === "backToSessionMgmt") {
          event.preventDefault?.();
          callbacks.goBackToSessionMgmt();
        }
      });
    }

    return {
      closeHelpModal,
      handleFiles,
      wireEvents,
    };
  }

  return {
    createStreamEventsController,
  };
});
