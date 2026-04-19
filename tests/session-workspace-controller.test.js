const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStreamHeadMetaHtml,
  createSessionWorkspaceController,
} = require("../app/controllers/session-workspace");
const sessionState = require("../app/state/session-management");

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
    toString() {
      return [...set].join(" ");
    },
  };
}

function createElement(overrides = {}) {
  const attributes = {};
  return {
    hidden: false,
    value: "",
    checked: false,
    disabled: false,
    textContent: "",
    innerHTML: "",
    className: "",
    scrollTop: 0,
    scrollHeight: 400,
    clientHeight: 200,
    classList: createClassList(),
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    setAttribute(name, value) {
      attributes[name] = value;
    },
    getAttribute(name) {
      return attributes[name];
    },
    ...overrides,
  };
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortId(value, size = 8) {
  if (!value) return "-";
  return value.length <= size ? value : value.slice(0, size);
}

function createGroups() {
  return {
    "/Users/me/repo-a": [
      {
        sessionId: "sess-1",
        sessionTitle: "Release Review for refactor followup",
        fallbackTitle: "",
        sourceType: "codex",
        count: 12,
        latest: "2026-04-19T10:00:00.000Z",
      },
      {
        sessionId: "sess-2",
        sessionTitle: "",
        fallbackTitle: "Untitled session",
        sourceType: "claude",
        count: 6,
        latest: "2026-04-19T09:30:00.000Z",
      },
    ],
  };
}

function createControllerContext() {
  const tabButtons = [
    { dataset: { tab: "stream" }, classList: createClassList(["active"]) },
    { dataset: { tab: "sessions" }, classList: createClassList() },
  ];
  const sessionsWrapper = createElement({ hidden: true, classList: createClassList(["with-conv"]) });
  const streamHeadMeta = createElement();
  const els = {
    streamView: createElement({ hidden: false }),
    inlineConvPanel: createElement({ hidden: true }),
    sessionGroups: createElement(),
    sessionMgmtSearch: createElement(),
    sessionMgmtPlatform: createElement(),
    sessionMgmtNamedOnly: createElement(),
    sessionDetailBody: createElement(),
    sessionDetailModal: createElement({ classList: createClassList(["hidden"]) }),
    inlineConvTitle: createElement(),
    inlineConvPlatform: createElement(),
    inlineConvStats: createElement(),
    inlineConvLoadStatus: createElement(),
    inlineConvBody: createElement(),
    renameInput: createElement(),
    renameModal: createElement({ classList: createClassList(["hidden"]) }),
    deleteMessage: createElement(),
    deleteModal: createElement({ classList: createClassList(["hidden"]) }),
    selectAllCheckbox: createElement(),
    batchDeleteBtn: createElement(),
    batchExportBtn: createElement(),
    batchConfirmTitle: createElement(),
    batchConfirmMessage: createElement(),
    batchConfirmList: createElement(),
    batchConfirmOkBtn: createElement(),
    batchConfirmModal: createElement({ classList: createClassList(["hidden"]) }),
  };
  const state = {
    activeTab: "stream",
    sessionMgmtData: null,
    selectedSessionIds: new Set(),
    inlineConvEvents: [],
    inlineConvTotal: 0,
    inlineConvOffset: 0,
    inlineConvSessionId: null,
    inlineConvSessionInfo: null,
    renameTargetSessionId: null,
    deleteTargetSessionId: null,
    selectedSessionId: "",
    fromSessionMgmt: false,
    lastViewedSessionId: null,
    batchConfirmAction: null,
  };
  const statuses = [];
  const apiClient = {
    async listSessions() {
      return { groups: createGroups() };
    },
    async listSessionEvents() {
      return {
        events: [{ callType: "Agent", content: "Ship it", time: "2026-04-19T10:05:00.000Z" }],
        totalMatching: 7,
      };
    },
    async renameSession() {
      return { ok: true };
    },
    async deleteSession() {
      return { ok: true };
    },
    async batchDeleteSessions(ids) {
      return { deleted: ids.length };
    },
    async exportSessionEvents() {
      return [{ sessionId: "sess-1", time: "2026-04-19T10:05:00.000Z" }];
    },
  };
  const documentRef = {
    getElementById(id) {
      if (id === "sessionsWrapper") return sessionsWrapper;
      if (id === "streamHeadMeta") return streamHeadMeta;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".tab-btn") return tabButtons;
      if (selector === ".session-card.highlighted") return [];
      return [];
    },
    querySelector() {
      return null;
    },
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement() {
      return createElement();
    },
  };
  const navigatorRef = {
    clipboard: {
      writeText() {
        return Promise.resolve();
      },
    },
  };
  const downloads = [];

  const controller = createSessionWorkspaceController({
    state,
    els,
    apiClient,
    sessionState,
    views: {
      findSessionById(groups, sessionId) {
        for (const sessions of Object.values(groups || {})) {
          const found = sessions.find((session) => session.sessionId === sessionId);
          if (found) return found;
        }
        return null;
      },
      renderSessionDetailHtml(session) {
        return `DETAIL:${session.sessionId}`;
      },
      renderSessionGroupsHtml(groups, helpers) {
        return `GROUPS:${Object.keys(groups).length}:${helpers.selectedSessionIds.size}`;
      },
      renderConversationHtml(payload) {
        return `CONV:${payload.events.length}/${payload.total}`;
      },
    },
    helpers: {
      escapeHtml,
      fmtTokenHuman(value) {
        return String(value);
      },
      formatShanghaiTime(value) {
        return value;
      },
      hasTokenUsageData(tokenUsage) {
        return Boolean(tokenUsage && tokenUsage.total);
      },
      shortId,
      shortPathN(value) {
        return value;
      },
      fmtNum(value) {
        return String(value);
      },
      getToolConfig() {
        return { category: "default" };
      },
      highlightJson(value) {
        return JSON.stringify(value);
      },
    },
    callbacks: {
      syncUrl() {
        statuses.push("sync-url");
      },
      setStatus(message) {
        statuses.push(message);
      },
      applyFilters() {
        statuses.push("apply-filters");
      },
      renderSessionGroups() {
        statuses.push("render-session-groups");
      },
      downloadJsonl(jsonl, filename) {
        downloads.push({ jsonl, filename });
      },
      logError() {},
    },
    documentRef,
    navigatorRef,
  });

  return {
    controller,
    state,
    els,
    statuses,
    downloads,
    sessionsWrapper,
    streamHeadMeta,
    tabButtons,
  };
}

test("buildStreamHeadMetaHtml renders selected session title and back action", () => {
  const html = buildStreamHeadMetaHtml({
    fromSessionMgmt: true,
    selectedSessionId: "sess-1",
    sessionMgmtData: { groups: createGroups() },
  }, { escapeHtml });

  assert.match(html, /当前: Release Review for refactor fo/);
  assert.match(html, /backToSessionMgmt/);
  assert.equal(
    buildStreamHeadMetaHtml({ fromSessionMgmt: false }, { escapeHtml }),
    "类型标签 / 模型标签 / 会话标签 / 调用标签"
  );
});

test("session workspace switchTab loads session data and toggles workspace visibility", async () => {
  const { controller, state, els, sessionsWrapper, tabButtons, statuses } = createControllerContext();

  await controller.switchTab("sessions");

  assert.equal(state.activeTab, "sessions");
  assert.equal(els.streamView.hidden, true);
  assert.equal(els.inlineConvPanel.hidden, true);
  assert.equal(sessionsWrapper.hidden, false);
  assert.equal(sessionsWrapper.classList.contains("with-conv"), false);
  assert.equal(els.sessionGroups.innerHTML, "GROUPS:1:0");
  assert.equal(tabButtons[0].classList.contains("active"), false);
  assert.equal(tabButtons[1].classList.contains("active"), true);
  assert.ok(statuses.includes("sync-url"));
});

test("session workspace toggleSelectAll mirrors visible session selection state", async () => {
  const { controller, state, els } = createControllerContext();
  state.sessionMgmtData = { groups: createGroups() };

  controller.toggleSelectAll();
  assert.deepEqual([...state.selectedSessionIds].sort(), ["sess-1", "sess-2"]);
  assert.equal(els.selectAllCheckbox.checked, true);
  assert.equal(els.batchDeleteBtn.textContent, "批量删除 (2)");
  assert.equal(els.batchExportBtn.textContent, "批量导出 (2)");
  assert.equal(els.sessionGroups.innerHTML, "GROUPS:1:2");

  controller.toggleSelectAll();
  assert.equal(state.selectedSessionIds.size, 0);
  assert.equal(els.selectAllCheckbox.checked, false);
  assert.equal(els.batchDeleteBtn.textContent, "批量删除 (0)");
});

test("session workspace openInlineConversation loads first event page into the panel", async () => {
  const { controller, state, els, sessionsWrapper } = createControllerContext();
  state.sessionMgmtData = { groups: createGroups() };

  await controller.openInlineConversation("sess-1");

  assert.equal(sessionsWrapper.classList.contains("with-conv"), true);
  assert.equal(els.inlineConvPanel.hidden, false);
  assert.equal(state.inlineConvSessionId, "sess-1");
  assert.equal(state.inlineConvOffset, 1);
  assert.equal(state.inlineConvTotal, 7);
  assert.equal(els.inlineConvTitle.textContent, "Release Review for refactor followup");
  assert.equal(els.inlineConvStats.textContent, "12 个事件");
  assert.equal(els.inlineConvLoadStatus.textContent, "已加载 1 / 共 7");
  assert.equal(els.inlineConvBody.innerHTML, "CONV:1/7");
});

test("session workspace confirmRename updates session data and closes the modal", async () => {
  const { controller, state, els, statuses } = createControllerContext();
  state.sessionMgmtData = { groups: createGroups() };
  state.renameTargetSessionId = "sess-2";
  els.renameInput.value = "Incident Triage";

  await controller.confirmRename();

  assert.equal(state.sessionMgmtData.groups["/Users/me/repo-a"][1].sessionTitle, "Incident Triage");
  assert.equal(els.renameModal.classList.contains("hidden"), true);
  assert.equal(state.renameTargetSessionId, null);
  assert.ok(statuses.includes("已重命名会话: Incident Triage"));
});
