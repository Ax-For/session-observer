(function bootstrapObserverSessionWorkspace(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverSessionWorkspace = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverSessionWorkspaceModule() {
  "use strict";

  const DEFAULT_STREAM_HEAD_META = "类型标签 / 模型标签 / 会话标签 / 调用标签";

  function defaultNoop() {}

  function defaultEscapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function defaultShortId(value, size = 8) {
    if (!value) return "-";
    return value.length <= size ? value : value.slice(0, size);
  }

  function defaultFilterSessionGroups(groups) {
    return groups || {};
  }

  function defaultGetAllSessionIds(groups) {
    const ids = [];
    for (const sessions of Object.values(groups || {})) {
      for (const session of sessions || []) {
        ids.push(session.sessionId);
      }
    }
    return ids;
  }

  function defaultAreAllSelected(groups, selectedSessionIds) {
    const ids = defaultGetAllSessionIds(groups);
    return ids.length > 0 && ids.every((sessionId) => selectedSessionIds.has(sessionId));
  }

  function defaultBuildSelectedSessionList(groups, selectedSessionIds) {
    const selectedList = [];
    for (const sessions of Object.values(groups || {})) {
      for (const session of sessions || []) {
        if (!selectedSessionIds.has(session.sessionId)) continue;
        selectedList.push({
          sessionId: session.sessionId,
          title: session.sessionTitle || session.fallbackTitle || "未命名会话",
        });
      }
    }
    return selectedList;
  }

  function defaultRenameSessionInGroups(groups, sessionId, newName) {
    if (!groups || !sessionId || !newName) return false;
    for (const sessions of Object.values(groups)) {
      const found = sessions.find((session) => session.sessionId === sessionId);
      if (!found) continue;
      found.sessionTitle = newName;
      found.fallbackTitle = "";
      return true;
    }
    return false;
  }

  function defaultRemoveSessionsFromGroups(groups, sessionIds) {
    if (!groups) return 0;
    const sessionIdSet = new Set(Array.isArray(sessionIds) ? sessionIds : [sessionIds]);
    let removed = 0;
    for (const [cwd, sessions] of Object.entries(groups)) {
      for (let index = sessions.length - 1; index >= 0; index -= 1) {
        if (!sessionIdSet.has(sessions[index].sessionId)) continue;
        sessions.splice(index, 1);
        removed += 1;
      }
      if (sessions.length === 0) delete groups[cwd];
    }
    return removed;
  }

  function resolveHelpers(helpers) {
    const safeHelpers = helpers || {};
    return {
      escapeHtml: safeHelpers.escapeHtml || defaultEscapeHtml,
      fmtTokenHuman: safeHelpers.fmtTokenHuman || ((value) => String(value ?? "-")),
      formatShanghaiTime: safeHelpers.formatShanghaiTime || ((value) => String(value || "-")),
      hasTokenUsageData: safeHelpers.hasTokenUsageData || ((tokenUsage) => Boolean(tokenUsage)),
      shortId: safeHelpers.shortId || defaultShortId,
      shortPathN: safeHelpers.shortPathN || ((value) => String(value || "-")),
      fmtNum: safeHelpers.fmtNum || ((value) => String(value ?? "-")),
      getToolConfig: safeHelpers.getToolConfig || (() => ({ category: "default" })),
      highlightJson: safeHelpers.highlightJson || ((value) => defaultEscapeHtml(JSON.stringify(value, null, 2))),
    };
  }

  function getSelectedSessionTitle(sessionMgmtData, sessionId) {
    if (!sessionMgmtData || !sessionId) return sessionId || "";
    for (const sessions of Object.values(sessionMgmtData.groups || {})) {
      const found = sessions.find((session) => session.sessionId === sessionId);
      if (found) {
        return found.sessionTitle || found.fallbackTitle || sessionId;
      }
    }
    return sessionId;
  }

  function buildStreamHeadMetaHtml(input, helpers) {
    const safeHelpers = resolveHelpers(helpers);
    const data = input || {};
    if (!data.fromSessionMgmt || !data.selectedSessionId) {
      return DEFAULT_STREAM_HEAD_META;
    }
    const sessionTitle = getSelectedSessionTitle(data.sessionMgmtData, data.selectedSessionId);
    const label = sessionTitle.length > 30 ? `${sessionTitle.substring(0, 30)}...` : sessionTitle;
    return `<span style="color: var(--ink);">当前: ${safeHelpers.escapeHtml(label)}</span> <a href="#" id="backToSessionMgmt" style="color: var(--accent); text-decoration: underline; cursor: pointer; margin-left: 12px;">← 返回会话管理</a>`;
  }

  function renderBatchConfirmListHtml(selectedList, helpers) {
    const safeHelpers = resolveHelpers(helpers);
    return (selectedList || [])
      .map(
        (session) =>
          `<div class="batch-confirm-item">
      <span>${safeHelpers.escapeHtml(session.title)}</span>
      <span class="mono">${safeHelpers.escapeHtml(safeHelpers.shortId(session.sessionId, 8))}</span>
    </div>`
      )
      .join("");
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

  function createSessionWorkspaceController(config) {
    const state = config?.state || {};
    const els = config?.els || {};
    const apiClient = config?.apiClient || {};
    const views = config?.views || {};
    const helpers = resolveHelpers(config?.helpers);
    const sessionState = config?.sessionState || {};
    const callbacks = config?.callbacks || {};
    const documentRef = config?.documentRef || (typeof document !== "undefined" ? document : null);
    const navigatorRef = config?.navigatorRef || (typeof navigator !== "undefined" ? navigator : null);
    const timers = config?.timers || {
      setTimeout: typeof setTimeout === "function" ? setTimeout.bind(globalThis) : defaultNoop,
    };

    const syncUrl = callbacks.syncUrl || defaultNoop;
    const setStatus = callbacks.setStatus || defaultNoop;
    const applyFilters = callbacks.applyFilters || defaultNoop;
    const renderSessionGroups = callbacks.renderSessionGroups || defaultNoop;
    const downloadJsonl = callbacks.downloadJsonl || ((jsonl, filename) => defaultDownloadJsonl(jsonl, filename, documentRef));
    const logError = callbacks.logError || defaultNoop;

    const filterSessionGroups = sessionState.filterSessionGroups || defaultFilterSessionGroups;
    const getAllSessionIds = sessionState.getAllSessionIds || defaultGetAllSessionIds;
    const areAllSelected = sessionState.areAllSelected || defaultAreAllSelected;
    const buildSelectedSessionList = sessionState.buildSelectedSessionList || defaultBuildSelectedSessionList;
    const renameSessionInGroups = sessionState.renameSessionInGroups || defaultRenameSessionInGroups;
    const removeSessionsFromGroups = sessionState.removeSessionsFromGroups || defaultRemoveSessionsFromGroups;

    const findSessionById = views.findSessionById || (() => null);
    const renderSessionDetailHtml = views.renderSessionDetailHtml || (() => "");
    const renderSessionGroupsHtml = views.renderSessionGroupsHtml || (() => "");
    const renderConversationHtml = views.renderConversationHtml || (() => "");

    let inlineConvIsLoading = false;

    function getSelectedSessionIds() {
      if (!(state.selectedSessionIds instanceof Set)) {
        state.selectedSessionIds = new Set();
      }
      return state.selectedSessionIds;
    }

    function getSessionsWrapper() {
      return documentRef?.getElementById?.("sessionsWrapper") || null;
    }

    function getStreamHeadMetaElement() {
      return documentRef?.getElementById?.("streamHeadMeta") || null;
    }

    function updateTabButtons(tab) {
      const buttons = documentRef?.querySelectorAll?.(".tab-btn") || [];
      buttons.forEach((button) => {
        button.classList?.toggle?.("active", button.dataset?.tab === tab);
      });
    }

    function filterSessionMgmtData() {
      if (!state.sessionMgmtData) return { groups: {} };
      const groups = filterSessionGroups(state.sessionMgmtData.groups || {}, {
        query: els.sessionMgmtSearch?.value || "",
        platform: els.sessionMgmtPlatform?.value || "",
        namedOnly: Boolean(els.sessionMgmtNamedOnly?.checked),
      });
      return { ...state.sessionMgmtData, groups };
    }

    function renderSessionMgmtView() {
      const data = filterSessionMgmtData();
      if (els.sessionGroups) {
        els.sessionGroups.innerHTML = renderSessionGroupsHtml(data.groups, {
          selectedSessionIds: getSelectedSessionIds(),
          escapeHtml: helpers.escapeHtml,
          fmtTokenHuman: helpers.fmtTokenHuman,
          formatShanghaiTime: helpers.formatShanghaiTime,
          hasTokenUsageData: helpers.hasTokenUsageData,
          shortId: helpers.shortId,
          shortPathN: helpers.shortPathN,
        });
      }
      return data;
    }

    async function loadSessionMgmtData() {
      try {
        state.sessionMgmtData = await apiClient.listSessions();
        renderSessionMgmtView();
      } catch (err) {
        if (els.sessionGroups) {
          els.sessionGroups.innerHTML = `<div class="empty">加载失败: ${helpers.escapeHtml(err.message)}</div>`;
        }
      }
    }

    async function switchTab(tab) {
      state.activeTab = tab;
      updateTabButtons(tab);

      if (els.streamView) els.streamView.hidden = true;
      const wrapper = getSessionsWrapper();
      if (wrapper) {
        wrapper.hidden = true;
        wrapper.classList?.remove?.("with-conv");
      }
      if (els.inlineConvPanel) els.inlineConvPanel.hidden = true;

      if (tab === "stream") {
        if (els.streamView) els.streamView.hidden = false;
      } else if (tab === "sessions") {
        if (wrapper) wrapper.hidden = false;
        await loadSessionMgmtData();
      }
      syncUrl();
    }

    function openSessionDetail(sessionId) {
      const found = findSessionById(state.sessionMgmtData?.groups || {}, sessionId);
      if (!found) return;
      if (els.sessionDetailBody) {
        els.sessionDetailBody.innerHTML = renderSessionDetailHtml(found, {
          escapeHtml: helpers.escapeHtml,
          fmtNum: helpers.fmtNum,
          formatShanghaiTime: helpers.formatShanghaiTime,
          hasTokenUsageData: helpers.hasTokenUsageData,
        });
      }
      els.sessionDetailModal?.classList?.remove?.("hidden");
      els.sessionDetailModal?.setAttribute?.("aria-hidden", "false");
    }

    function closeSessionDetail() {
      els.sessionDetailModal?.classList?.add?.("hidden");
      els.sessionDetailModal?.setAttribute?.("aria-hidden", "true");
    }

    function copySessionId(sessionId) {
      const writeText = navigatorRef?.clipboard?.writeText;
      if (typeof writeText !== "function") {
        setStatus("复制失败，请手动复制");
        return Promise.resolve(false);
      }
      return writeText.call(navigatorRef.clipboard, sessionId).then(() => {
        setStatus("已复制 Session ID");
        return true;
      }).catch(() => {
        setStatus("复制失败，请手动复制");
        return false;
      });
    }

    async function openInlineConversation(sessionId) {
      const found = findSessionById(state.sessionMgmtData?.groups || {}, sessionId);
      if (!found) return;

      const wrapper = getSessionsWrapper();
      wrapper?.classList?.add?.("with-conv");
      if (els.inlineConvPanel) els.inlineConvPanel.hidden = false;

      state.inlineConvSessionId = sessionId;
      state.inlineConvSessionInfo = found;
      state.inlineConvEvents = [];
      state.inlineConvOffset = 0;
      state.inlineConvTotal = found.count;

      if (els.inlineConvTitle) {
        els.inlineConvTitle.textContent = found.sessionTitle || found.fallbackTitle || "未命名会话";
      }
      if (els.inlineConvPlatform) {
        els.inlineConvPlatform.textContent = found.sourceType;
        els.inlineConvPlatform.className = `chip chip-platform chip-${found.sourceType}`;
      }
      if (els.inlineConvStats) {
        els.inlineConvStats.textContent = `${found.count} 个事件`;
      }
      if (els.inlineConvLoadStatus) {
        els.inlineConvLoadStatus.textContent = `已加载 0 / 共 ${found.count}`;
      }
      if (els.inlineConvBody) {
        els.inlineConvBody.innerHTML = '<div class="conv-loading">加载中...</div>';
      }

      await loadInlineConversationEvents(0, 100);
    }

    function closeInlineConversation() {
      if (els.inlineConvPanel) els.inlineConvPanel.hidden = true;
      const wrapper = getSessionsWrapper();
      wrapper?.classList?.remove?.("with-conv");
      state.inlineConvSessionId = null;
      state.inlineConvEvents = [];
      state.inlineConvOffset = 0;
      inlineConvIsLoading = false;
    }

    async function loadInlineConversationEvents(offset, limit) {
      const sessionId = state.inlineConvSessionId;
      if (!sessionId) return;
      try {
        const data = await apiClient.listSessionEvents({
          sessionId,
          mode: "observe",
          order: "asc",
          offset,
          limit,
        });
        state.inlineConvEvents = state.inlineConvEvents.concat(data.events || []);
        state.inlineConvOffset = state.inlineConvEvents.length;
        state.inlineConvTotal = data.totalMatching || state.inlineConvSessionInfo?.count || state.inlineConvOffset;
        if (els.inlineConvLoadStatus) {
          els.inlineConvLoadStatus.textContent = `已加载 ${state.inlineConvOffset} / 共 ${state.inlineConvTotal}`;
        }
        renderInlineConversationMessages(offset === 0);
      } catch (err) {
        logError("Failed to load inline conversation events:", err);
        if (els.inlineConvBody) {
          els.inlineConvBody.innerHTML = `<div class="conv-empty">加载失败: ${helpers.escapeHtml(err.message)}</div>`;
        }
      }
    }

    function handleInlineConvScroll() {
      const body = els.inlineConvBody;
      if (!body) return;
      const scrollTop = body.scrollTop;
      const scrollHeight = body.scrollHeight;
      const clientHeight = body.clientHeight;
      if (scrollHeight - scrollTop - clientHeight < 300) {
        loadMoreInlineConversationEvents();
      }
    }

    function setupInlineConvInfiniteScroll() {
      const body = els.inlineConvBody;
      if (!body) return;
      body.removeEventListener?.("scroll", handleInlineConvScroll);
      body.addEventListener?.("scroll", handleInlineConvScroll);
    }

    async function loadMoreInlineConversationEvents() {
      if (inlineConvIsLoading) return;
      if (state.inlineConvOffset >= state.inlineConvTotal) return;
      inlineConvIsLoading = true;
      if (els.inlineConvLoadStatus) {
        els.inlineConvLoadStatus.textContent = `加载中 ${state.inlineConvOffset} / ${state.inlineConvTotal}...`;
      }
      await loadInlineConversationEvents(state.inlineConvOffset, 100);
      inlineConvIsLoading = false;
    }

    function renderInlineConversationMessages(isInitial) {
      if (els.inlineConvBody) {
        els.inlineConvBody.innerHTML = renderConversationHtml({
          events: state.inlineConvEvents,
          offset: state.inlineConvOffset,
          total: state.inlineConvTotal,
        }, {
          escapeHtml: helpers.escapeHtml,
          formatShanghaiTime: helpers.formatShanghaiTime,
          getToolConfig: helpers.getToolConfig,
          highlightJson: helpers.highlightJson,
        });
      }
      setupInlineConvInfiniteScroll();
      if (isInitial && els.inlineConvBody) els.inlineConvBody.scrollTop = 0;
    }

    function openRenameModal(sessionId, currentName) {
      state.renameTargetSessionId = sessionId;
      if (els.renameInput) els.renameInput.value = currentName || "";
      els.renameModal?.classList?.remove?.("hidden");
      els.renameModal?.setAttribute?.("aria-hidden", "false");
      timers.setTimeout(() => els.renameInput?.focus?.(), 100);
    }

    function closeRenameModal() {
      els.renameModal?.classList?.add?.("hidden");
      els.renameModal?.setAttribute?.("aria-hidden", "true");
      state.renameTargetSessionId = null;
    }

    async function confirmRename() {
      const sessionId = state.renameTargetSessionId;
      const newName = (els.renameInput?.value || "").trim();
      if (!sessionId || !newName) return;

      try {
        await apiClient.renameSession({ sessionId, newName });
        renameSessionInGroups(state.sessionMgmtData?.groups || {}, sessionId, newName);
        renderSessionMgmtView();
        closeRenameModal();
        setStatus(`已重命名会话: ${newName}`);
      } catch (err) {
        setStatus(`重命名失败: ${err.message}`);
      }
    }

    function openDeleteModal(sessionId, name) {
      state.deleteTargetSessionId = sessionId;
      if (els.deleteMessage) {
        els.deleteMessage.textContent = `确定要删除会话 "${name}" 吗？此操作不可撤销。`;
      }
      els.deleteModal?.classList?.remove?.("hidden");
      els.deleteModal?.setAttribute?.("aria-hidden", "false");
    }

    function closeDeleteModal() {
      els.deleteModal?.classList?.add?.("hidden");
      els.deleteModal?.setAttribute?.("aria-hidden", "true");
      state.deleteTargetSessionId = null;
    }

    async function confirmDelete() {
      const sessionId = state.deleteTargetSessionId;
      if (!sessionId) return;

      try {
        await apiClient.deleteSession({ sessionId });
        removeSessionsFromGroups(state.sessionMgmtData?.groups || {}, sessionId);
        renderSessionMgmtView();
        closeDeleteModal();
        setStatus("已删除会话");
      } catch (err) {
        setStatus(`删除失败: ${err.message}`);
      }
    }

    function navigateToSessionEvents(sessionId) {
      switchTab("stream");
      state.selectedSessionId = sessionId;
      state.fromSessionMgmt = true;
      state.lastViewedSessionId = sessionId;
      applyFilters();
      renderSessionGroups();
      updateStreamHeadMeta();
    }

    function updateStreamHeadMeta() {
      const metaEl = getStreamHeadMetaElement();
      if (!metaEl) return;
      const content = buildStreamHeadMetaHtml({
        fromSessionMgmt: state.fromSessionMgmt,
        selectedSessionId: state.selectedSessionId,
        sessionMgmtData: state.sessionMgmtData,
      }, helpers);
      if (content === DEFAULT_STREAM_HEAD_META) {
        metaEl.textContent = content;
      } else {
        metaEl.innerHTML = content;
      }
    }

    function highlightAndScrollToSessionCard(sessionId) {
      const cards = documentRef?.querySelectorAll?.(".session-card.highlighted") || [];
      cards.forEach((card) => card.classList?.remove?.("highlighted"));
      const selector = `.session-card[data-session-id="${sessionId}"]`;
      const card = documentRef?.querySelector?.(selector) || null;
      if (!card) return;
      card.classList?.add?.("highlighted");
      card.scrollIntoView?.({ behavior: "smooth", block: "center" });
      timers.setTimeout(() => card.classList?.remove?.("highlighted"), 3000);
    }

    function goBackToSessionMgmt() {
      const targetSessionId = state.lastViewedSessionId;
      state.selectedSessionId = "";
      state.fromSessionMgmt = false;
      switchTab("sessions");
      updateStreamHeadMeta();
      if (targetSessionId) {
        timers.setTimeout(() => {
          highlightAndScrollToSessionCard(targetSessionId);
        }, 100);
      }
    }

    function isAllSelected() {
      const data = filterSessionMgmtData();
      return areAllSelected(data.groups || {}, getSelectedSessionIds());
    }

    function updateBatchUi() {
      const count = getSelectedSessionIds().size;
      if (els.selectAllCheckbox) {
        els.selectAllCheckbox.checked = count > 0 && isAllSelected();
      }
      if (els.batchDeleteBtn) {
        els.batchDeleteBtn.disabled = count === 0;
        els.batchDeleteBtn.textContent = `批量删除 (${count})`;
      }
      if (els.batchExportBtn) {
        els.batchExportBtn.disabled = count === 0;
        els.batchExportBtn.textContent = `批量导出 (${count})`;
      }
    }

    function toggleSessionSelection(sessionId) {
      const selectedSessionIds = getSelectedSessionIds();
      if (selectedSessionIds.has(sessionId)) {
        selectedSessionIds.delete(sessionId);
      } else {
        selectedSessionIds.add(sessionId);
      }
      updateBatchUi();
      renderSessionMgmtView();
    }

    function toggleSelectAll() {
      const data = filterSessionMgmtData();
      const allSessionIds = getAllSessionIds(data.groups || {});
      const selectedSessionIds = getSelectedSessionIds();
      const allSelected = areAllSelected(data.groups || {}, selectedSessionIds);

      if (allSelected) {
        selectedSessionIds.clear();
      } else {
        allSessionIds.forEach((sessionId) => selectedSessionIds.add(sessionId));
      }

      updateBatchUi();
      renderSessionMgmtView();
    }

    function openBatchDeleteConfirm() {
      if (getSelectedSessionIds().size === 0) return;
      state.batchConfirmAction = "delete";
      const selectedList = buildSelectedSessionList(state.sessionMgmtData?.groups || {}, getSelectedSessionIds());

      if (els.batchConfirmTitle) els.batchConfirmTitle.textContent = "批量删除确认";
      if (els.batchConfirmMessage) {
        els.batchConfirmMessage.textContent = `确定要删除 ${selectedList.length} 个会话吗？此操作不可撤销。`;
      }
      if (els.batchConfirmList) {
        els.batchConfirmList.innerHTML = renderBatchConfirmListHtml(selectedList, helpers);
      }
      if (els.batchConfirmOkBtn) {
        els.batchConfirmOkBtn.textContent = "确认删除";
        els.batchConfirmOkBtn.className = "btn-danger";
      }
      els.batchConfirmModal?.classList?.remove?.("hidden");
      els.batchConfirmModal?.setAttribute?.("aria-hidden", "false");
    }

    function openBatchExportConfirm() {
      if (getSelectedSessionIds().size === 0) return;
      state.batchConfirmAction = "export";
      const selectedList = buildSelectedSessionList(state.sessionMgmtData?.groups || {}, getSelectedSessionIds());

      if (els.batchConfirmTitle) els.batchConfirmTitle.textContent = "批量导出确认";
      if (els.batchConfirmMessage) {
        els.batchConfirmMessage.textContent = `确定要导出 ${selectedList.length} 个会话的事件数据吗？`;
      }
      if (els.batchConfirmList) {
        els.batchConfirmList.innerHTML = renderBatchConfirmListHtml(selectedList, helpers);
      }
      if (els.batchConfirmOkBtn) {
        els.batchConfirmOkBtn.textContent = "确认导出";
        els.batchConfirmOkBtn.className = "";
      }
      els.batchConfirmModal?.classList?.remove?.("hidden");
      els.batchConfirmModal?.setAttribute?.("aria-hidden", "false");
    }

    function closeBatchConfirmModal() {
      els.batchConfirmModal?.classList?.add?.("hidden");
      els.batchConfirmModal?.setAttribute?.("aria-hidden", "true");
      state.batchConfirmAction = null;
    }

    async function executeBatchDelete() {
      const sessionIds = [...getSelectedSessionIds()];
      if (sessionIds.length === 0) return;

      try {
        const data = await apiClient.batchDeleteSessions(sessionIds);
        removeSessionsFromGroups(state.sessionMgmtData?.groups || {}, sessionIds);
        getSelectedSessionIds().clear();
        updateBatchUi();
        renderSessionMgmtView();
        closeBatchConfirmModal();
        setStatus(`已删除 ${data.deleted} 个会话`);
      } catch (err) {
        setStatus(`批量删除失败: ${err.message}`);
      }
    }

    async function executeBatchExport() {
      const sessionIds = [...getSelectedSessionIds()];
      if (sessionIds.length === 0) return;

      try {
        const exportData = await apiClient.exportSessionEvents(sessionIds, { limit: 10000 });
        if (exportData.length === 0) {
          setStatus("无数据可导出");
          return;
        }
        const jsonl = exportData.map((event) => JSON.stringify(event)).join("\n");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        downloadJsonl(jsonl, `batch-export-${timestamp}.jsonl`);
        getSelectedSessionIds().clear();
        updateBatchUi();
        closeBatchConfirmModal();
        setStatus(`已导出 ${exportData.length} 条事件，来自 ${sessionIds.length} 个会话`);
      } catch (err) {
        setStatus(`批量导出失败: ${err.message}`);
      }
    }

    async function confirmBatchAction() {
      if (state.batchConfirmAction === "delete") {
        await executeBatchDelete();
      } else if (state.batchConfirmAction === "export") {
        await executeBatchExport();
      }
    }

    return {
      switchTab,
      loadSessionMgmtData,
      filterSessionMgmtData,
      renderSessionMgmtView,
      openSessionDetail,
      closeSessionDetail,
      copySessionId,
      openInlineConversation,
      closeInlineConversation,
      loadInlineConversationEvents,
      setupInlineConvInfiniteScroll,
      handleInlineConvScroll,
      loadMoreInlineConversationEvents,
      renderInlineConversationMessages,
      openRenameModal,
      closeRenameModal,
      confirmRename,
      openDeleteModal,
      closeDeleteModal,
      confirmDelete,
      navigateToSessionEvents,
      updateStreamHeadMeta,
      goBackToSessionMgmt,
      highlightAndScrollToSessionCard,
      toggleSessionSelection,
      toggleSelectAll,
      updateBatchUi,
      isAllSelected,
      openBatchDeleteConfirm,
      openBatchExportConfirm,
      closeBatchConfirmModal,
      confirmBatchAction,
      executeBatchDelete,
      executeBatchExport,
    };
  }

  return {
    DEFAULT_STREAM_HEAD_META,
    buildStreamHeadMetaHtml,
    renderBatchConfirmListHtml,
    createSessionWorkspaceController,
  };
});
