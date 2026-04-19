const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createAppShellController,
} = require("../app/controllers/app-shell");

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
    textContent: "",
    clientHeight: 0,
    classList: createClassList(),
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatch(type, payload) {
      const handler = listeners.get(type);
      if (handler) handler(payload);
    },
    getListener(type) {
      return listeners.get(type);
    },
    ...overrides,
  };
}

function createStorage(values = {}) {
  const store = new Map(Object.entries(values));
  const writes = [];
  return {
    writes,
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      store.set(key, String(value));
    },
  };
}

function createDocumentRef() {
  const docListeners = new Map();
  const bodyAttrs = {};
  const cssVars = {};
  return {
    body: {
      setAttribute(name, value) {
        bodyAttrs[name] = value;
      },
      getAttribute(name) {
        return bodyAttrs[name];
      },
    },
    documentElement: {
      style: {
        setProperty(name, value) {
          cssVars[name] = value;
        },
        getPropertyValue(name) {
          return cssVars[name] || "";
        },
      },
    },
    addEventListener(type, handler) {
      docListeners.set(type, handler);
    },
    removeEventListener(type) {
      docListeners.delete(type);
    },
    getListener(type) {
      return docListeners.get(type);
    },
    querySelector(selector) {
      if (selector === ".content-grid") {
        return { offsetWidth: 1000 };
      }
      return null;
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

function createContext(overrides = {}) {
  const state = {
    viewMode: "observe",
    theme: "light",
    density: "cozy",
    rowHeight: 156,
    sessionRowHeight: 152,
    dashboardCollapsed: false,
    autoRefreshEnabled: false,
    activeTab: "stream",
    sessionPaneWidth: 320,
    viewportHeight: 0,
    sessionViewportHeight: 0,
    ...overrides.state,
  };
  const els = {
    modeToggleBtn: createElement(),
    themeToggleBtn: createElement(),
    densityToggleBtn: createElement(),
    tokenThresholdInput: createElement({ value: "20000" }),
    stats: createElement(),
    resizeHandle: createElement(),
    rows: createElement({ clientHeight: 640 }),
    sessionList: createElement({ clientHeight: 480 }),
    ...overrides.els,
  };
  const storageRef = overrides.storageRef || createStorage();
  const documentRef = overrides.documentRef || createDocumentRef();
  const windowRef = overrides.windowRef || createWindowRef();
  const calls = [];
  const controller = createAppShellController({
    state,
    els,
    storageRef,
    documentRef,
    windowRef,
    helpers: {
      rowHeightForDensity: overrides.rowHeightForDensity || (() => 128),
      sessionRowHeightForDensity: overrides.sessionRowHeightForDensity || (() => 120),
    },
    callbacks: {
      syncUrl: () => calls.push("syncUrl"),
      wireEvents: () => calls.push("wireEvents"),
      wireSessionMgmt: () => calls.push("wireSessionMgmt"),
      decodeStateFromUrl: () => {
        calls.push("decodeStateFromUrl");
        if (typeof overrides.onDecodeStateFromUrl === "function") {
          return overrides.onDecodeStateFromUrl(state);
        }
        return false;
      },
      renderQuickFilterUi: () => calls.push("renderQuickFilterUi"),
      renderSessionGroups: () => calls.push("renderSessionGroups"),
      renderStats: () => calls.push("renderStats"),
      switchTab: (tab) => calls.push(["switchTab", tab]),
      setAutoRefreshUi: (enabled) => calls.push(["setAutoRefreshUi", enabled]),
      setStatus: (message) => calls.push(["setStatus", message]),
      refreshOnce: (message) => calls.push(["refreshOnce", message]),
      renderVirtualSessionGroups: () => calls.push("renderVirtualSessionGroups"),
      renderVirtualRows: () => calls.push("renderVirtualRows"),
    },
  });

  return { controller, state, els, storageRef, documentRef, windowRef, calls };
}

test("app shell applyViewMode updates button state, storage, and url sync", () => {
  const { controller, state, els, storageRef, calls } = createContext();

  controller.applyViewMode("raw");

  assert.equal(state.viewMode, "raw");
  assert.equal(els.modeToggleBtn.textContent, "观测模式");
  assert.equal(els.modeToggleBtn.classList.contains("active"), true);
  assert.deepEqual(storageRef.writes[0], ["observer_view_mode", "raw"]);
  assert.deepEqual(calls, ["syncUrl"]);
});

test("app shell initAppearance restores saved theme, density, view mode, and threshold", () => {
  const storageRef = createStorage({
    observer_theme: "dark",
    observer_density: "compact",
    observer_view_mode: "raw",
    observer_high_token_threshold: "45000",
    observer_dash_collapsed: "true",
  });
  const { controller, state, els, documentRef } = createContext({ storageRef });

  controller.initAppearance();

  assert.equal(state.viewMode, "raw");
  assert.equal(state.theme, "dark");
  assert.equal(state.density, "compact");
  assert.equal(state.dashboardCollapsed, true);
  assert.equal(state.rowHeight, 128);
  assert.equal(state.sessionRowHeight, 120);
  assert.equal(documentRef.body.getAttribute("data-theme"), "dark");
  assert.equal(documentRef.body.getAttribute("data-density"), "compact");
  assert.equal(els.modeToggleBtn.textContent, "观测模式");
  assert.equal(els.themeToggleBtn.textContent, "白天模式");
  assert.equal(els.densityToggleBtn.textContent, "舒展视图");
  assert.equal(els.tokenThresholdInput.value, "45000");
  assert.equal(els.stats.classList.contains("collapsed"), true);
});

test("app shell initResizeHandle restores width, resizes within bounds, and persists on mouseup", () => {
  const storageRef = createStorage({
    observer_session_pane_width: "400",
  });
  const { controller, state, els, storageRef: storage, documentRef } = createContext({ storageRef });

  controller.initResizeHandle();

  assert.equal(state.sessionPaneWidth, 400);
  assert.equal(documentRef.documentElement.style.getPropertyValue("--session-pane-width"), "400px");

  els.resizeHandle.dispatch("mousedown", {
    clientX: 100,
    preventDefault() {},
  });
  documentRef.getListener("mousemove")({ clientX: 350 });
  assert.equal(state.sessionPaneWidth, 500);
  assert.equal(documentRef.documentElement.style.getPropertyValue("--session-pane-width"), "500px");

  documentRef.getListener("mouseup")();
  assert.equal(els.resizeHandle.classList.contains("dragging"), false);
  assert.deepEqual(storage.writes.at(-1), ["observer_session_pane_width", "500"]);
  assert.equal(documentRef.getListener("mousemove"), undefined);
  assert.equal(documentRef.getListener("mouseup"), undefined);
});

test("app shell startApp runs startup sequence, applies url overrides, and wires resize updates", () => {
  const { controller, state, els, windowRef, calls } = createContext({
    onDecodeStateFromUrl(targetState) {
      targetState.viewMode = "raw";
      targetState.dashboardCollapsed = true;
      targetState.autoRefreshEnabled = true;
      targetState.activeTab = "sessions";
      return true;
    },
  });

  controller.startApp();

  assert.deepEqual(calls.slice(0, 9), [
    "wireEvents",
    "wireSessionMgmt",
    "syncUrl",
    "decodeStateFromUrl",
    "syncUrl",
    ["setAutoRefreshUi", true],
    "renderQuickFilterUi",
    "renderSessionGroups",
    "renderStats",
  ]);
  assert.equal(els.stats.classList.contains("collapsed"), true);
  assert.deepEqual(calls.at(-3), ["switchTab", "sessions"]);
  assert.deepEqual(calls.at(-2), ["setStatus", "正在加载数据..."]);
  assert.deepEqual(calls.at(-1), ["refreshOnce", "初始加载"]);

  const resizeHandler = windowRef.getListener("resize");
  assert.equal(typeof resizeHandler, "function");
  els.rows.clientHeight = 720;
  els.sessionList.clientHeight = 540;
  resizeHandler();
  assert.equal(state.viewportHeight, 720);
  assert.equal(state.sessionViewportHeight, 540);
  assert.ok(calls.includes("renderVirtualSessionGroups"));
  assert.ok(calls.includes("renderVirtualRows"));
});
