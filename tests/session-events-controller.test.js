const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createSessionEventsController,
} = require("../app/controllers/session-events");

function createClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...values) {
      values.forEach((value) => set.add(value));
    },
    remove(...values) {
      values.forEach((value) => set.delete(value));
    },
    toggle(value, force) {
      if (force === true) {
        set.add(value);
        return true;
      }
      if (force === false) {
        set.delete(value);
        return false;
      }
      if (set.has(value)) {
        set.delete(value);
        return false;
      }
      set.add(value);
      return true;
    },
    contains(value) {
      return set.has(value);
    },
  };
}

function createElement(overrides = {}) {
  const listeners = new Map();
  const attributes = {};
  return {
    hidden: false,
    value: "",
    checked: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    className: "",
    classList: createClassList(),
    dataset: {},
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatch(type, event = {}) {
      const handler = listeners.get(type);
      if (handler) return handler(event);
      return undefined;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
    getAttribute(name) {
      return attributes[name];
    },
    focus() {},
    ...overrides,
  };
}

function createTarget(closestMap = {}) {
  return {
    closest(selector) {
      return closestMap[selector] || null;
    },
  };
}

function createTimers() {
  const queue = [];
  return {
    setTimeout(fn) {
      queue.push(fn);
      return queue.length;
    },
    flush() {
      while (queue.length) {
        const fn = queue.shift();
        fn();
      }
    },
  };
}

function createControllerContext(overrides = {}) {
  const tabButtons = [
    createElement({ dataset: { tab: "stream" } }),
    createElement({ dataset: { tab: "sessions" } }),
  ];
  const copyContentBtn = createElement({ dataset: { copyContentId: "content-1" }, textContent: "复制" });
  const terminalCopyBtn = createElement({ dataset: { copyTerminalId: "terminal-1" }, textContent: "⧉" });
  const contentElement = createElement({
    textContent: "Patch applied successfully",
    parentElement: {
      querySelector(selector) {
        if (selector === ".conv-copy-btn") return copyContentBtn;
        return null;
      },
    },
  });
  const terminalWrap = {
    querySelector(selector) {
      if (selector === ".conv-terminal-code") return { textContent: "npm test" };
      if (selector === ".conv-terminal-copy-btn") return terminalCopyBtn;
      return null;
    },
  };

  const els = {
    filterToggleBtn: createElement({ textContent: "筛选 ▾" }),
    streamFilters: createElement({ hidden: true }),
    sessionMgmtSearch: createElement(),
    sessionMgmtPlatform: createElement(),
    sessionMgmtNamedOnly: createElement(),
    sessionMgmtRefreshBtn: createElement(),
    selectAllCheckbox: createElement(),
    batchDeleteBtn: createElement(),
    batchExportBtn: createElement(),
    sessionGroups: createElement(),
    sessionDetailCloseBtn: createElement(),
    sessionDetailModal: createElement(),
    inlineConvClose: createElement(),
    inlineConvBody: createElement(),
    renameModalCloseBtn: createElement(),
    renameModal: createElement(),
    renameConfirmBtn: createElement(),
    renameInput: createElement(),
    deleteModalCloseBtn: createElement(),
    deleteModal: createElement(),
    deleteConfirmBtn: createElement(),
    batchConfirmCloseBtn: createElement(),
    batchConfirmCancelBtn: createElement(),
    batchConfirmModal: createElement(),
    batchConfirmOkBtn: createElement(),
    ...overrides.els,
  };
  const state = {
    ...overrides.state,
  };
  const copyCalls = [];
  const calls = [];
  const timers = createTimers();
  const documentRef = overrides.documentRef || {
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement() {
      return createElement({ select() {}, click() {} });
    },
    execCommand() {
      return true;
    },
    querySelectorAll(selector) {
      if (selector === ".toolbar-tabs .tab-btn") return tabButtons;
      return [];
    },
    getElementById(id) {
      if (id === "content-1") return contentElement;
      return null;
    },
    querySelector(selector) {
      if (selector === '[data-content-id="terminal-1"]') return terminalWrap;
      return null;
    },
  };
  const navigatorRef = overrides.navigatorRef || {
    clipboard: {
      writeText(text) {
        copyCalls.push(text);
        return Promise.resolve();
      },
    },
  };

  const controller = createSessionEventsController({
    state,
    els,
    documentRef,
    navigatorRef,
    timers,
    helpers: {
      copyText: overrides.copyText || ((text) => {
        copyCalls.push(text);
        return true;
      }),
    },
    callbacks: {
      switchTab: (tab) => calls.push(["switchTab", tab]),
      renderSessionMgmtView: () => calls.push("renderSessionMgmtView"),
      loadSessionMgmtData: async () => calls.push("loadSessionMgmtData"),
      toggleSelectAll: () => calls.push("toggleSelectAll"),
      openBatchDeleteConfirm: () => calls.push("openBatchDeleteConfirm"),
      openBatchExportConfirm: () => calls.push("openBatchExportConfirm"),
      toggleSessionSelection: (sessionId) => calls.push(["toggleSessionSelection", sessionId]),
      copySessionId: (sessionId) => calls.push(["copySessionId", sessionId]),
      openInlineConversation: (sessionId) => calls.push(["openInlineConversation", sessionId]),
      openRenameModal: (sessionId, sessionName) => calls.push(["openRenameModal", sessionId, sessionName]),
      openDeleteModal: (sessionId, sessionName) => calls.push(["openDeleteModal", sessionId, sessionName]),
      navigateToSessionEvents: (sessionId) => calls.push(["navigateToSessionEvents", sessionId]),
      closeSessionDetail: () => calls.push("closeSessionDetail"),
      closeInlineConversation: () => calls.push("closeInlineConversation"),
      closeRenameModal: () => calls.push("closeRenameModal"),
      confirmRename: () => calls.push("confirmRename"),
      closeDeleteModal: () => calls.push("closeDeleteModal"),
      confirmDelete: () => calls.push("confirmDelete"),
      closeBatchConfirmModal: () => calls.push("closeBatchConfirmModal"),
      confirmBatchAction: () => calls.push("confirmBatchAction"),
      setStatus: (message) => calls.push(["setStatus", message]),
    },
  });

  return {
    controller,
    calls,
    copyCalls,
    els,
    tabButtons,
    timers,
    copyContentBtn,
    terminalCopyBtn,
  };
}

test("session events wireSessionMgmt binds toolbar and session filters", async () => {
  const { controller, calls, els, tabButtons } = createControllerContext();

  controller.wireSessionMgmt();
  await tabButtons[1].dispatch("click");
  els.filterToggleBtn.dispatch("click");
  els.sessionMgmtSearch.dispatch("input");
  els.sessionMgmtPlatform.dispatch("change");
  els.sessionMgmtNamedOnly.dispatch("change");
  await els.sessionMgmtRefreshBtn.dispatch("click");
  els.selectAllCheckbox.dispatch("change");
  els.batchDeleteBtn.dispatch("click");
  els.batchExportBtn.dispatch("click");

  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "switchTab" && entry[1] === "sessions"));
  assert.equal(els.streamFilters.hidden, false);
  assert.equal(els.filterToggleBtn.classList.contains("open"), true);
  assert.equal(els.filterToggleBtn.textContent, "筛选 ▴");
  assert.equal(calls.filter((entry) => entry === "renderSessionMgmtView").length, 3);
  assert.ok(calls.includes("loadSessionMgmtData"));
  assert.ok(calls.includes("toggleSelectAll"));
  assert.ok(calls.includes("openBatchDeleteConfirm"));
  assert.ok(calls.includes("openBatchExportConfirm"));
});

test("session events wireSessionMgmt routes delegated session actions", () => {
  const { controller, calls, els } = createControllerContext();

  controller.wireSessionMgmt();

  els.sessionGroups.dispatch("click", {
    stopPropagation() {},
    target: createTarget({
      ".session-card-checkbox": { dataset: { checkboxSessionId: "sess-check" } },
    }),
  });
  els.sessionGroups.dispatch("click", {
    stopPropagation() {},
    target: createTarget({
      "[data-action]": { dataset: { action: "copy-id", sessionId: "sess-copy" } },
    }),
  });
  els.sessionGroups.dispatch("click", {
    stopPropagation() {},
    target: createTarget({
      "[data-action]": { dataset: { action: "view-conversation", sessionId: "sess-conv" } },
    }),
  });
  els.sessionGroups.dispatch("click", {
    stopPropagation() {},
    target: createTarget({
      "[data-action]": { dataset: { action: "rename", sessionId: "sess-rename", sessionName: "Rename Me" } },
    }),
  });
  els.sessionGroups.dispatch("click", {
    stopPropagation() {},
    target: createTarget({
      "[data-action]": { dataset: { action: "delete", sessionId: "sess-delete", sessionName: "Delete Me" } },
    }),
  });
  els.sessionGroups.dispatch("click", {
    stopPropagation() {},
    target: createTarget({
      "[data-action]": { dataset: { action: "view-events", sessionId: "sess-events" } },
    }),
  });
  els.sessionGroups.dispatch("click", {
    target: createTarget({
      ".session-card": { dataset: { sessionId: "sess-card" } },
    }),
  });
  els.sessionGroups.dispatch("keydown", {
    key: "Enter",
    preventDefault() {},
    target: createTarget({
      ".session-card-checkbox": { dataset: { checkboxSessionId: "sess-key" } },
    }),
  });

  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "toggleSessionSelection" && entry[1] === "sess-check"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "copySessionId" && entry[1] === "sess-copy"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "openInlineConversation" && entry[1] === "sess-conv"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "openRenameModal" && entry[1] === "sess-rename" && entry[2] === "Rename Me"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "openDeleteModal" && entry[1] === "sess-delete" && entry[2] === "Delete Me"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "navigateToSessionEvents" && entry[1] === "sess-events"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "navigateToSessionEvents" && entry[1] === "sess-card"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "toggleSessionSelection" && entry[1] === "sess-key"));
});

test("session events wireSessionMgmt wires modal controls and rename shortcuts", () => {
  const { controller, calls, els } = createControllerContext();

  controller.wireSessionMgmt();

  els.sessionDetailCloseBtn.dispatch("click");
  els.sessionDetailModal.dispatch("click", {
    target: createTarget({
      "[data-close-session-detail]": {},
    }),
  });
  els.sessionDetailModal.dispatch("click", {
    target: createTarget({
      "[data-action='view-events']": { dataset: { sessionId: "sess-events" } },
    }),
  });
  els.sessionDetailModal.dispatch("click", {
    target: createTarget({
      "[data-action='view-conversation']": { dataset: { sessionId: "sess-conv" } },
    }),
  });
  els.inlineConvClose.dispatch("click");
  els.renameModalCloseBtn.dispatch("click");
  els.renameModal.dispatch("click", {
    target: createTarget({
      "[data-close-rename]": {},
    }),
  });
  els.renameConfirmBtn.dispatch("click");
  els.renameInput.dispatch("keydown", { key: "Enter" });
  els.renameInput.dispatch("keydown", { key: "Escape" });
  els.deleteModalCloseBtn.dispatch("click");
  els.deleteModal.dispatch("click", {
    target: createTarget({
      "[data-close-delete]": {},
    }),
  });
  els.deleteConfirmBtn.dispatch("click");
  els.batchConfirmCloseBtn.dispatch("click");
  els.batchConfirmCancelBtn.dispatch("click");
  els.batchConfirmModal.dispatch("click", {
    target: createTarget({
      "[data-close-batch-confirm]": {},
    }),
  });
  els.batchConfirmOkBtn.dispatch("click");

  assert.ok(calls.includes("closeSessionDetail"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "navigateToSessionEvents" && entry[1] === "sess-events"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "openInlineConversation" && entry[1] === "sess-conv"));
  assert.ok(calls.includes("closeInlineConversation"));
  assert.ok(calls.includes("closeRenameModal"));
  assert.equal(calls.filter((entry) => entry === "confirmRename").length, 2);
  assert.ok(calls.includes("closeDeleteModal"));
  assert.ok(calls.includes("confirmDelete"));
  assert.equal(calls.filter((entry) => entry === "closeBatchConfirmModal").length, 3);
  assert.ok(calls.includes("confirmBatchAction"));
});

test("session events wireSessionMgmt handles inline conversation copy buttons", async () => {
  const { controller, calls, copyCalls, els, timers, copyContentBtn, terminalCopyBtn } = createControllerContext();

  controller.wireSessionMgmt();
  await els.inlineConvBody.dispatch("click", {
    target: createTarget({
      "[data-copy-content-id]": copyContentBtn,
    }),
  });
  await els.inlineConvBody.dispatch("click", {
    target: createTarget({
      "[data-copy-terminal-id]": terminalCopyBtn,
    }),
  });

  assert.deepEqual(copyCalls, ["Patch applied successfully", "npm test"]);
  assert.equal(copyContentBtn.textContent, "已复制");
  assert.equal(copyContentBtn.classList.contains("copied"), true);
  assert.equal(terminalCopyBtn.textContent, "✓");
  assert.equal(terminalCopyBtn.classList.contains("copied"), true);
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "setStatus" && entry[1] === "已复制内容"));
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "setStatus" && entry[1] === "已复制终端输出"));

  timers.flush();

  assert.equal(copyContentBtn.textContent, "复制");
  assert.equal(copyContentBtn.classList.contains("copied"), false);
  assert.equal(terminalCopyBtn.textContent, "⧉");
  assert.equal(terminalCopyBtn.classList.contains("copied"), false);
});
