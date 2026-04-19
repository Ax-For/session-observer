const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createStreamEventsController,
} = require("../app/controllers/stream-events");

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
  return {
    value: "",
    innerHTML: "",
    textContent: "",
    scrollTop: 0,
    classList: createClassList(),
    options: [{}],
    focusCount: 0,
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
    focus() {
      this.focusCount += 1;
    },
    setAttribute() {},
    ...overrides,
  };
}

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  const writes = [];
  return {
    writes,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      writes.push([key, String(value)]);
      store.set(key, String(value));
    },
  };
}

function createDocumentRef() {
  const listeners = new Map();
  return {
    listeners,
    body: {
      appendChild() {},
      removeChild() {},
    },
    querySelectorAll(selector) {
      if (selector === ".time-quick-btn") return [];
      return [];
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    getListener(type) {
      return listeners.get(type);
    },
    createElement() {
      return createElement({ click() {} });
    },
  };
}

function createWindowRef() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    getListener(type) {
      return listeners.get(type);
    },
  };
}

function createControllerContext(overrides = {}) {
  const state = {
    dataSource: "server",
    events: [{ time: "2026-04-19T10:00:00.000Z" }],
    filtered: [{ time: "2026-04-19T10:00:00.000Z" }],
    sessions: [{ sessionId: "sess-1" }],
    meta: { models: ["gpt-5.4"], types: ["Agent"] },
    totalVisible: 1,
    totalMatching: 1,
    pageOffset: 20,
    hasMore: true,
    selectedSessionId: "sess-1",
    selectedRowIndex: 3,
    sessionGroups: [{ sessionId: "sess-1" }],
    sessionScrollTop: 40,
    sessionViewportHeight: 500,
    scrollTop: 50,
    viewportHeight: 600,
    quickFilter: "all",
    viewMode: "observe",
    activeTab: "stream",
    autoRefreshEnabled: false,
    ...overrides.state,
  };
  const els = {
    fileInput: createElement(),
    searchInput: createElement(),
    modelSelect: createElement({ value: "" }),
    typeSelect: createElement({ value: "" }),
    platformSelect: createElement({ value: "" }),
    sortOrder: createElement({ value: "desc" }),
    startTime: createElement(),
    endTime: createElement(),
    rows: createElement({ scrollTop: 70, clientHeight: 400 }),
    sessionList: createElement({ scrollTop: 80, clientHeight: 360 }),
    loadMoreBtn: createElement(),
    modalCloseBtn: createElement(),
    copyJsonBtn: createElement(),
    exportBtn: createElement(),
    prevEventBtn: createElement(),
    nextEventBtn: createElement(),
    detailModal: createElement(),
    allSessionsBtn: createElement(),
    resetFiltersBtn: createElement(),
    clearBtn: createElement(),
    manualRefreshBtn: createElement(),
    autoRefreshBtn: createElement(),
    modeToggleBtn: createElement(),
    themeToggleBtn: createElement(),
    densityToggleBtn: createElement(),
    dashCollapseBtn: createElement({ textContent: "(−)" }),
    stats: createElement(),
    quickFilters: createElement(),
    tokenThresholdInput: createElement({ value: "20000" }),
    helpBtn: createElement(),
    helpModalCloseBtn: createElement(),
    helpModal: createElement({ classList: createClassList(["hidden"]) }),
    ...overrides.els,
  };
  const storageRef = overrides.storageRef || createStorage();
  const documentRef = overrides.documentRef || createDocumentRef();
  const windowRef = overrides.windowRef || createWindowRef();
  const navigatorRef = overrides.navigatorRef || {
    clipboard: {
      writeText: async () => {},
    },
  };
  const calls = [];
  const controller = createStreamEventsController({
    state,
    els,
    storageRef,
    documentRef,
    windowRef,
    navigatorRef,
    parseFiles: overrides.parseFiles || (async () => [{ time: "2026-04-19T11:00:00.000Z" }, { time: "2026-04-19T12:00:00.000Z" }]),
    helpers: {
      buildDetailPayload: overrides.buildDetailPayload || ((event) => event),
      shortId: overrides.shortId || ((value) => String(value || "").slice(0, 8)),
      isServerMode: overrides.isServerMode || (() => state.dataSource === "server"),
      isVisibleInCurrentMode: overrides.isVisibleInCurrentMode || (() => true),
      rowHeightForDensity: overrides.rowHeightForDensity || (() => 120),
      downloadJsonl: overrides.downloadJsonl || ((jsonl, filename) => calls.push(["downloadJsonl", jsonl, filename])),
    },
    callbacks: {
      applyFilters: () => calls.push("applyFilters"),
      scheduleApplyFilters: (delay) => calls.push(["scheduleApplyFilters", delay]),
      showDetail: (index) => calls.push(["showDetail", index]),
      renderVirtualRows: () => calls.push("renderVirtualRows"),
      renderVirtualSessionGroups: () => calls.push("renderVirtualSessionGroups"),
      loadRealtimeEventsPage: async (options) => calls.push(["loadRealtimeEventsPage", options]),
      setStatus: (message) => calls.push(["setStatus", message]),
      closeModal: () => calls.push("closeModal"),
      closeSessionDetail: () => calls.push("closeSessionDetail"),
      closeRenameModal: () => calls.push("closeRenameModal"),
      closeDeleteModal: () => calls.push("closeDeleteModal"),
      refreshOnce: async (message) => calls.push(["refreshOnce", message]),
      stopAutoRefresh: (message) => calls.push(["stopAutoRefresh", message]),
      startAutoRefresh: async () => calls.push("startAutoRefresh"),
      applyViewMode: (mode) => calls.push(["applyViewMode", mode]),
      applyTheme: (theme) => calls.push(["applyTheme", theme]),
      applyDensity: (density) => calls.push(["applyDensity", density]),
      refreshFiltersMeta: () => calls.push("refreshFiltersMeta"),
      renderSessionGroups: () => calls.push("renderSessionGroups"),
      renderQuickFilterUi: () => calls.push("renderQuickFilterUi"),
      renderStats: () => calls.push("renderStats"),
      syncUrl: () => calls.push("syncUrl"),
      goBackToSessionMgmt: () => calls.push("goBackToSessionMgmt"),
      renderRows: () => calls.push("renderRows"),
    },
  });

  return { controller, state, els, storageRef, documentRef, windowRef, calls };
}

test("stream events handleFiles resets local state and rerenders", async () => {
  const { controller, state, els, calls } = createControllerContext();

  await controller.handleFiles([{ name: "sample.jsonl" }]);

  assert.equal(state.dataSource, "local");
  assert.equal(state.events.length, 2);
  assert.deepEqual(state.meta, { models: [], types: [] });
  assert.equal(state.totalVisible, 2);
  assert.equal(state.totalMatching, 2);
  assert.equal(state.pageOffset, 0);
  assert.equal(state.hasMore, false);
  assert.equal(state.scrollTop, 0);
  assert.equal(state.sessionScrollTop, 0);
  assert.equal(els.rows.scrollTop, 0);
  assert.equal(els.sessionList.scrollTop, 0);
  assert.deepEqual(calls, ["refreshFiltersMeta", "renderSessionGroups", "applyFilters", "closeModal"]);
});

test("stream events wireEvents toggles auto refresh and mode state", async () => {
  const { controller, state, els, calls } = createControllerContext();
  controller.wireEvents();

  await els.autoRefreshBtn.dispatch("click");
  assert.ok(calls.includes("startAutoRefresh"));

  state.autoRefreshEnabled = true;
  await els.autoRefreshBtn.dispatch("click");
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "stopAutoRefresh" && entry[1] === "自动刷新已停止"));

  els.rows.scrollTop = 44;
  els.modeToggleBtn.dispatch("click");
  assert.ok(calls.some((entry) => Array.isArray(entry) && entry[0] === "applyViewMode" && entry[1] === "raw"));
  assert.ok(calls.includes("refreshFiltersMeta"));
  assert.ok(calls.includes("renderSessionGroups"));
  assert.ok(calls.includes("applyFilters"));
  assert.equal(state.selectedRowIndex, -1);
  assert.equal(state.scrollTop, 0);
  assert.equal(els.rows.scrollTop, 0);
});

test("stream events wireEvents handles dashboard toggle and quick filters", () => {
  const { controller, state, els, storageRef, calls } = createControllerContext();
  controller.wireEvents();

  els.dashCollapseBtn.dispatch("click");
  assert.equal(state.dashboardCollapsed, true);
  assert.equal(els.stats.classList.contains("collapsed"), true);
  assert.equal(els.dashCollapseBtn.textContent, "(+)");
  assert.deepEqual(storageRef.writes.at(-1), ["observer_dash_collapsed", "true"]);
  assert.ok(calls.includes("syncUrl"));

  const quickTarget = {
    closest(selector) {
      if (selector === "button[data-quick-filter]") {
        return { dataset: { quickFilter: "alert" } };
      }
      return null;
    },
  };
  els.quickFilters.dispatch("click", { target: quickTarget });
  assert.equal(state.quickFilter, "alert");
  assert.equal(state.selectedRowIndex, -1);
  assert.ok(calls.includes("renderQuickFilterUi"));
  assert.ok(calls.includes("applyFilters"));
});

test("stream events wireEvents handles keyboard shortcuts and modal closing", () => {
  const { controller, els, windowRef, calls } = createControllerContext();
  controller.wireEvents();

  const keydown = windowRef.getListener("keydown");
  keydown({
    key: "/",
    ctrlKey: false,
    metaKey: false,
    target: { tagName: "DIV" },
    preventDefault() {},
  });
  assert.equal(els.searchInput.focusCount, 1);

  keydown({
    key: "Escape",
    target: { tagName: "DIV" },
  });
  assert.ok(calls.includes("closeModal"));
  assert.ok(calls.includes("closeSessionDetail"));
  assert.ok(calls.includes("closeRenameModal"));
  assert.ok(calls.includes("closeDeleteModal"));
});

test("stream events wireEvents loads local files from file input change", async () => {
  const files = [{ name: "first.jsonl" }];
  const { controller, els, state } = createControllerContext({
    els: {
      fileInput: createElement(),
    },
    parseFiles: async (inputFiles) => {
      assert.deepEqual(inputFiles, files);
      return [{ time: "2026-04-19T12:00:00.000Z" }];
    },
  });

  controller.wireEvents();
  await els.fileInput.dispatch("change", { target: { files } });

  assert.equal(state.dataSource, "local");
  assert.equal(state.events.length, 1);
});
