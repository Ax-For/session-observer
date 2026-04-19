const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyUrlSearch,
  buildUrlSearch,
  createUrlStateController,
} = require("../app/state/url-state");

function createElement(value = "") {
  return { value };
}

function createState(overrides = {}) {
  return {
    activeTab: "stream",
    selectedSessionId: "",
    quickFilter: "all",
    viewMode: "observe",
    dashboardCollapsed: false,
    autoRefreshEnabled: false,
    ...overrides,
  };
}

function createElements(overrides = {}) {
  return {
    searchInput: createElement(""),
    modelSelect: createElement(""),
    typeSelect: createElement(""),
    platformSelect: createElement(""),
    sortOrder: createElement("desc"),
    startTime: createElement(""),
    endTime: createElement(""),
    ...overrides,
  };
}

test("buildUrlSearch serializes active stream and workspace filters", () => {
  const state = createState({
    activeTab: "sessions",
    selectedSessionId: "sess-9",
    quickFilter: "high_token",
    viewMode: "raw",
    dashboardCollapsed: true,
    autoRefreshEnabled: true,
  });
  const els = createElements({
    searchInput: createElement(" timeout "),
    modelSelect: createElement("gpt-5.4"),
    typeSelect: createElement("Agent"),
    platformSelect: createElement("claude"),
    sortOrder: createElement("asc"),
    startTime: createElement("2026-04-19T09:00"),
    endTime: createElement("2026-04-19T10:00"),
  });

  const params = new URLSearchParams(buildUrlSearch({ state, els }));

  assert.equal(params.get("tab"), "sessions");
  assert.equal(params.get("session"), "sess-9");
  assert.equal(params.get("q"), " timeout ");
  assert.equal(params.get("model"), "gpt-5.4");
  assert.equal(params.get("type"), "Agent");
  assert.equal(params.get("platform"), "claude");
  assert.equal(params.get("qf"), "high_token");
  assert.equal(params.get("mode"), "raw");
  assert.equal(params.get("sort"), "asc");
  assert.equal(params.get("from"), "2026-04-19T09:00");
  assert.equal(params.get("to"), "2026-04-19T10:00");
  assert.equal(params.get("dash"), "1");
  assert.equal(params.get("ar"), "1");
});

test("applyUrlSearch mutates state and filter inputs from valid params", () => {
  const state = createState();
  const els = createElements();

  const applied = applyUrlSearch(
    "?tab=sessions&session=sess-1&q=prompt&model=gpt-5.4&type=Agent&platform=claude&qf=alert&mode=raw&sort=asc&from=2026-04-19T09:00&to=2026-04-19T10:00&dash=1&ar=1",
    { state, els }
  );

  assert.equal(applied, true);
  assert.equal(state.activeTab, "sessions");
  assert.equal(state.selectedSessionId, "sess-1");
  assert.equal(els.searchInput.value, "prompt");
  assert.equal(els.modelSelect.value, "gpt-5.4");
  assert.equal(els.typeSelect.value, "Agent");
  assert.equal(els.platformSelect.value, "claude");
  assert.equal(state.quickFilter, "alert");
  assert.equal(state.viewMode, "raw");
  assert.equal(els.sortOrder.value, "asc");
  assert.equal(els.startTime.value, "2026-04-19T09:00");
  assert.equal(els.endTime.value, "2026-04-19T10:00");
  assert.equal(state.dashboardCollapsed, true);
  assert.equal(state.autoRefreshEnabled, true);
});

test("applyUrlSearch ignores invalid params and reports no applied state", () => {
  const state = createState();
  const els = createElements();

  const applied = applyUrlSearch("?tab=bad&qf=nope&mode=other&sort=sideways", { state, els });

  assert.equal(applied, false);
  assert.equal(state.activeTab, "stream");
  assert.equal(state.quickFilter, "all");
  assert.equal(state.viewMode, "observe");
  assert.equal(els.sortOrder.value, "desc");
});

test("url state controller debounces syncUrl and writes updated search once", () => {
  const state = createState({ activeTab: "sessions", quickFilter: "alert" });
  const els = createElements({
    searchInput: createElement("error"),
  });
  const locationRef = { search: "", pathname: "/" };
  const historyCalls = [];
  const historyRef = {
    replaceState(...args) {
      historyCalls.push(args);
    },
  };
  const timers = {
    nextId: 0,
    pending: [],
    cleared: [],
    setTimeout(fn, delay) {
      const id = ++this.nextId;
      this.pending.push({ id, fn, delay });
      return id;
    },
    clearTimeout(id) {
      this.cleared.push(id);
    },
  };

  const controller = createUrlStateController({
    state,
    els,
    locationRef,
    historyRef,
    timers,
  });

  controller.syncUrl();
  controller.syncUrl();

  assert.deepEqual(timers.cleared, [1]);
  assert.equal(timers.pending.length, 2);
  timers.pending[1].fn();

  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0][2], "/?tab=sessions&q=error&qf=alert");
});

test("url state controller syncUrl still works when method is detached", () => {
  const state = createState({ activeTab: "sessions" });
  const els = createElements();
  const locationRef = { search: "", pathname: "/" };
  const historyCalls = [];
  const historyRef = {
    replaceState(...args) {
      historyCalls.push(args);
    },
  };
  const timers = {
    nextId: 0,
    pending: [],
    setTimeout(fn) {
      const id = ++this.nextId;
      this.pending.push({ id, fn });
      return id;
    },
    clearTimeout() {},
  };

  const controller = createUrlStateController({
    state,
    els,
    locationRef,
    historyRef,
    timers,
  });
  const syncUrl = controller.syncUrl;

  syncUrl();
  timers.pending[0].fn();

  assert.equal(historyCalls.length, 1);
  assert.equal(historyCalls[0][2], "/?tab=sessions");
});
