(function bootstrapObserverSessionEvents(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.ObserverSessionEvents = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createObserverSessionEventsModule() {
  "use strict";

  function defaultNoop() {}

  function defaultCopyText(text, navigatorRef, documentRef) {
    if (navigatorRef?.clipboard?.writeText) {
      return navigatorRef.clipboard.writeText(text).then(() => true).catch(() => false);
    }
    if (!documentRef?.createElement || !documentRef?.body?.appendChild || !documentRef?.body?.removeChild) {
      return Promise.resolve(false);
    }
    const textarea = documentRef.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    documentRef.body.appendChild(textarea);
    textarea.select?.();
    try {
      const copied = documentRef.execCommand?.("copy");
      documentRef.body.removeChild(textarea);
      return Promise.resolve(Boolean(copied));
    } catch {
      documentRef.body.removeChild(textarea);
      return Promise.resolve(false);
    }
  }

  function getClosestTarget(target, selector) {
    return target?.closest?.(selector) || null;
  }

  function showTransientButtonState(button, copiedLabel, idleLabel, timers) {
    if (!button) return;
    button.textContent = copiedLabel;
    button.classList?.add?.("copied");
    timers.setTimeout(() => {
      button.textContent = idleLabel;
      button.classList?.remove?.("copied");
    }, 2000);
  }

  function createSessionEventsController(config) {
    const state = config?.state || {};
    const els = config?.els || {};
    const documentRef = config?.documentRef || (typeof document !== "undefined" ? document : null);
    const navigatorRef = config?.navigatorRef || (typeof navigator !== "undefined" ? navigator : null);
    const timers = config?.timers || {
      setTimeout: typeof setTimeout === "function" ? setTimeout.bind(globalThis) : defaultNoop,
    };
    const helpers = {
      copyText: config?.helpers?.copyText || ((text) => defaultCopyText(text, navigatorRef, documentRef)),
    };
    const callbacks = {
      switchTab: config?.callbacks?.switchTab || defaultNoop,
      renderSessionMgmtView: config?.callbacks?.renderSessionMgmtView || defaultNoop,
      loadSessionMgmtData: config?.callbacks?.loadSessionMgmtData || defaultNoop,
      toggleSelectAll: config?.callbacks?.toggleSelectAll || defaultNoop,
      openBatchDeleteConfirm: config?.callbacks?.openBatchDeleteConfirm || defaultNoop,
      openBatchExportConfirm: config?.callbacks?.openBatchExportConfirm || defaultNoop,
      toggleSessionSelection: config?.callbacks?.toggleSessionSelection || defaultNoop,
      copySessionId: config?.callbacks?.copySessionId || defaultNoop,
      openInlineConversation: config?.callbacks?.openInlineConversation || defaultNoop,
      openRenameModal: config?.callbacks?.openRenameModal || defaultNoop,
      openDeleteModal: config?.callbacks?.openDeleteModal || defaultNoop,
      navigateToSessionEvents: config?.callbacks?.navigateToSessionEvents || defaultNoop,
      closeSessionDetail: config?.callbacks?.closeSessionDetail || defaultNoop,
      closeInlineConversation: config?.callbacks?.closeInlineConversation || defaultNoop,
      closeRenameModal: config?.callbacks?.closeRenameModal || defaultNoop,
      confirmRename: config?.callbacks?.confirmRename || defaultNoop,
      closeDeleteModal: config?.callbacks?.closeDeleteModal || defaultNoop,
      confirmDelete: config?.callbacks?.confirmDelete || defaultNoop,
      closeBatchConfirmModal: config?.callbacks?.closeBatchConfirmModal || defaultNoop,
      confirmBatchAction: config?.callbacks?.confirmBatchAction || defaultNoop,
      setStatus: config?.callbacks?.setStatus || defaultNoop,
    };

    function copyConversationContent(contentId, button) {
      const contentEl = documentRef?.getElementById?.(contentId);
      if (!contentEl) return Promise.resolve(false);
      const text = contentEl.textContent || contentEl.innerText || "";
      return Promise.resolve(helpers.copyText(text))
        .then((success) => {
          if (!success) {
            callbacks.setStatus("复制失败，请手动复制");
            return false;
          }
          showTransientButtonState(
            button || contentEl.parentElement?.querySelector?.(".conv-copy-btn"),
            "已复制",
            "复制",
            timers
          );
          callbacks.setStatus("已复制内容");
          return true;
        })
        .catch(() => {
          callbacks.setStatus("复制失败，请手动复制");
          return false;
        });
    }

    function copyConversationTerminal(contentId, button) {
      const wrap = documentRef?.querySelector?.(`[data-content-id="${contentId}"]`) || null;
      const code = wrap?.querySelector?.(".conv-terminal-code");
      if (!code) return Promise.resolve(false);
      const text = code.textContent || code.innerText || "";
      return Promise.resolve(helpers.copyText(text))
        .then((success) => {
          if (!success) {
            callbacks.setStatus("复制失败，请手动复制");
            return false;
          }
          showTransientButtonState(
            button || wrap.querySelector?.(".conv-terminal-copy-btn"),
            "✓",
            "⧉",
            timers
          );
          callbacks.setStatus("已复制终端输出");
          return true;
        })
        .catch(() => {
          callbacks.setStatus("复制失败，请手动复制");
          return false;
        });
    }

    function wireSessionMgmt() {
      documentRef?.querySelectorAll?.(".toolbar-tabs .tab-btn")?.forEach?.((btn) => {
        btn.addEventListener?.("click", () => callbacks.switchTab(btn.dataset?.tab));
      });

      if (els.filterToggleBtn) {
        els.filterToggleBtn.addEventListener("click", () => {
          const panel = els.streamFilters;
          const isHidden = Boolean(panel?.hidden);
          if (panel) panel.hidden = !isHidden;
          els.filterToggleBtn.classList?.toggle?.("open", isHidden);
          els.filterToggleBtn.textContent = isHidden ? "筛选 ▴" : "筛选 ▾";
        });
      }

      els.sessionMgmtSearch?.addEventListener?.("input", () => callbacks.renderSessionMgmtView());
      els.sessionMgmtPlatform?.addEventListener?.("change", () => callbacks.renderSessionMgmtView());
      els.sessionMgmtNamedOnly?.addEventListener?.("change", () => callbacks.renderSessionMgmtView());
      els.sessionMgmtRefreshBtn?.addEventListener?.("click", () => callbacks.loadSessionMgmtData());

      els.selectAllCheckbox?.addEventListener?.("change", callbacks.toggleSelectAll);
      els.batchDeleteBtn?.addEventListener?.("click", callbacks.openBatchDeleteConfirm);
      els.batchExportBtn?.addEventListener?.("click", callbacks.openBatchExportConfirm);

      els.sessionGroups?.addEventListener?.("click", (event) => {
        const checkbox = getClosestTarget(event.target, ".session-card-checkbox");
        if (checkbox) {
          event.stopPropagation?.();
          const sessionId = checkbox.dataset?.checkboxSessionId;
          if (sessionId) callbacks.toggleSessionSelection(sessionId);
          return;
        }

        const actionBtn = getClosestTarget(event.target, "[data-action]");
        if (actionBtn) {
          event.stopPropagation?.();
          const action = actionBtn.dataset?.action;
          const sessionId = actionBtn.dataset?.sessionId;
          if (action === "copy-id") callbacks.copySessionId(sessionId);
          else if (action === "view-conversation") callbacks.openInlineConversation(sessionId);
          else if (action === "rename") callbacks.openRenameModal(sessionId, actionBtn.dataset?.sessionName);
          else if (action === "delete") callbacks.openDeleteModal(sessionId, actionBtn.dataset?.sessionName);
          else if (action === "view-events") callbacks.navigateToSessionEvents(sessionId);
          return;
        }

        const card = getClosestTarget(event.target, ".session-card");
        if (card?.dataset?.sessionId) {
          callbacks.navigateToSessionEvents(card.dataset.sessionId);
        }
      });

      els.sessionGroups?.addEventListener?.("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const checkbox = getClosestTarget(event.target, ".session-card-checkbox");
        if (!checkbox?.dataset?.checkboxSessionId) return;
        event.preventDefault?.();
        callbacks.toggleSessionSelection(checkbox.dataset.checkboxSessionId);
      });

      els.sessionDetailCloseBtn?.addEventListener?.("click", callbacks.closeSessionDetail);
      els.sessionDetailModal?.addEventListener?.("click", (event) => {
        if (getClosestTarget(event.target, "[data-close-session-detail]")) {
          callbacks.closeSessionDetail();
          return;
        }
        const viewEventsBtn = getClosestTarget(event.target, "[data-action='view-events']");
        if (viewEventsBtn?.dataset?.sessionId) {
          callbacks.closeSessionDetail();
          callbacks.navigateToSessionEvents(viewEventsBtn.dataset.sessionId);
          return;
        }
        const viewConversationBtn = getClosestTarget(event.target, "[data-action='view-conversation']");
        if (viewConversationBtn?.dataset?.sessionId) {
          callbacks.closeSessionDetail();
          callbacks.openInlineConversation(viewConversationBtn.dataset.sessionId);
        }
      });

      els.inlineConvClose?.addEventListener?.("click", callbacks.closeInlineConversation);
      els.inlineConvBody?.addEventListener?.("click", (event) => {
        const contentButton = getClosestTarget(event.target, "[data-copy-content-id]");
        if (contentButton?.dataset?.copyContentId) {
          copyConversationContent(contentButton.dataset.copyContentId, contentButton);
          return;
        }
        const terminalButton = getClosestTarget(event.target, "[data-copy-terminal-id]");
        if (terminalButton?.dataset?.copyTerminalId) {
          copyConversationTerminal(terminalButton.dataset.copyTerminalId, terminalButton);
        }
      });

      els.renameModalCloseBtn?.addEventListener?.("click", callbacks.closeRenameModal);
      els.renameModal?.addEventListener?.("click", (event) => {
        if (getClosestTarget(event.target, "[data-close-rename]")) {
          callbacks.closeRenameModal();
        }
      });
      els.renameConfirmBtn?.addEventListener?.("click", callbacks.confirmRename);
      els.renameInput?.addEventListener?.("keydown", (event) => {
        if (event.key === "Enter") callbacks.confirmRename();
        if (event.key === "Escape") callbacks.closeRenameModal();
      });

      els.deleteModalCloseBtn?.addEventListener?.("click", callbacks.closeDeleteModal);
      els.deleteModal?.addEventListener?.("click", (event) => {
        if (getClosestTarget(event.target, "[data-close-delete]")) {
          callbacks.closeDeleteModal();
        }
      });
      els.deleteConfirmBtn?.addEventListener?.("click", callbacks.confirmDelete);

      els.batchConfirmCloseBtn?.addEventListener?.("click", callbacks.closeBatchConfirmModal);
      els.batchConfirmCancelBtn?.addEventListener?.("click", callbacks.closeBatchConfirmModal);
      els.batchConfirmModal?.addEventListener?.("click", (event) => {
        if (getClosestTarget(event.target, "[data-close-batch-confirm]")) {
          callbacks.closeBatchConfirmModal();
        }
      });
      els.batchConfirmOkBtn?.addEventListener?.("click", callbacks.confirmBatchAction);
    }

    return {
      copyConversationContent,
      copyConversationTerminal,
      wireSessionMgmt,
    };
  }

  return {
    createSessionEventsController,
  };
});
