const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDetailPayload,
  createStreamWorkspaceController,
} = require("../app/controllers/stream-workspace");

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
  const attributes = {};
  return {
    value: "",
    innerHTML: "",
    textContent: "",
    hidden: false,
    disabled: false,
    scrollTop: 0,
    className: "",
    classList: createClassList(),
    setAttribute(name, value) {
      attributes[name] = value;
    },
    getAttribute(name) {
      return attributes[name];
    },
    ...overrides,
  };
}

function createEvent(time, content, extra = {}) {
  return {
    time,
    content,
    callType: "Agent",
    sessionId: "sess-1",
    model: "gpt-5.4",
    turnId: "turn-1",
    callId: "call-1",
    toolName: "",
    cwd: "/Users/me/repo",
    sessionTitle: "Session Title",
    tokenUsage: { total: 12 },
    rawType: "agent_message",
    rawSubType: "",
    sourceFile: "/tmp/session.jsonl",
    raw: { content },
    extra: extra.extra || "",
    ...extra,
  };
}

function createControllerContext() {
  const els = {
    rows: createElement({ scrollTop: 60 }),
    searchInput: createElement({ value: "" }),
    platformSelect: createElement({ value: "" }),
    modelSelect: createElement({ value: "" }),
    typeSelect: createElement({ value: "" }),
    startTime: createElement({ value: "" }),
    endTime: createElement({ value: "" }),
    sortOrder: createElement({ value: "desc" }),
    tokenThresholdInput: createElement({ value: "20000" }),
    realtimeStatus: createElement(),
    autoRefreshBtn: createElement({ classList: createClassList() }),
    modalJson: createElement(),
    detailModal: createElement({ classList: createClassList(["hidden"]) }),
    prevEventBtn: createElement(),
    nextEventBtn: createElement(),
    sessionList: createElement({ scrollTop: 15 }),
  };
  const state = {
    dataSource: "local",
    events: [],
    filtered: [],
    sessions: [],
    meta: { models: [], types: [] },
    totalVisible: 0,
    totalMatching: 0,
    pageOffset: 0,
    pageLimit: 250,
    hasMore: false,
    viewMode: "observe",
    quickFilter: "all",
    selectedSessionId: "",
    selectedRowIndex: -1,
    scrollTop: 80,
    sessionScrollTop: 12,
    autoRefreshEnabled: false,
    autoRefreshTimer: null,
    filterTimer: null,
    claudeVersion: "unknown",
    codexVersion: "unknown",
  };
  const calls = [];
  const apiClient = {
    async listRealtimeEvents(input) {
      calls.push({ type: "listRealtimeEvents", input });
      return {
        events: [createEvent("2026-04-19T10:05:00.000Z", "server-a")],
        sessions: [{ sessionId: "sess-1" }],
        meta: { models: ["gpt-5.4"], types: ["Agent"], platforms: ["codex"] },
        totalVisible: 1,
        totalMatching: 1,
        page: { offset: 0, limit: 100, hasMore: false },
        claudeVersion: "2.1.91",
        codexVersion: "codex-cli 0.121.0",
      };
    },
  };
  const timers = {
    timeoutId: 0,
    intervalId: 0,
    timeouts: [],
    intervals: [],
    clearedTimeouts: [],
    clearedIntervals: [],
    setTimeout(fn, delay) {
      const id = ++this.timeoutId;
      this.timeouts.push({ id, fn, delay });
      return id;
    },
    clearTimeout(id) {
      this.clearedTimeouts.push(id);
    },
    setInterval(fn, delay) {
      const id = ++this.intervalId;
      this.intervals.push({ id, fn, delay });
      return id;
    },
    clearInterval(id) {
      this.clearedIntervals.push(id);
    },
  };
  const callbacks = {
    statuses: [],
    syncUrl() {
      this.synced = (this.synced || 0) + 1;
    },
    renderRows() {
      this.rowsRendered = (this.rowsRendered || 0) + 1;
    },
    refreshFiltersMeta() {
      this.filtersRefreshed = (this.filtersRefreshed || 0) + 1;
    },
    renderSessionGroups() {
      this.sessionGroupsRendered = (this.sessionGroupsRendered || 0) + 1;
    },
    matchFilters(event) {
      return String(event.content).includes("keep");
    },
    isServerMode() {
      return state.dataSource === "server";
    },
    formatShanghaiTime(value) {
      return `formatted:${value}`;
    },
    highlightJson(value) {
      return JSON.stringify(value);
    },
    toDateMs(value) {
      return Date.parse(value);
    },
    setStatus(message) {
      this.statuses.push(message);
      els.realtimeStatus.textContent = message;
    },
    eventMatchesMode() {
      return true;
    },
  };

  const controller = createStreamWorkspaceController({
    state,
    els,
    apiClient,
    normalizeRealtimePayload(payload, options) {
      calls.push({ type: "normalizeRealtimePayload", options });
      return {
        events: options.append ? state.events.concat(payload.events) : payload.events,
        filtered: options.append ? state.filtered.concat(payload.events) : payload.events,
        sessions: payload.sessions,
        meta: payload.meta,
        totalVisible: payload.totalVisible,
        totalMatching: payload.totalMatching,
        pageOffset: payload.page.offset,
        pageLimit: payload.page.limit,
        hasMore: payload.page.hasMore,
        claudeVersion: payload.claudeVersion,
        codexVersion: payload.codexVersion,
      };
    },
    helpers: {
      formatShanghaiTime: callbacks.formatShanghaiTime.bind(callbacks),
      highlightJson: callbacks.highlightJson.bind(callbacks),
      toDateMs: callbacks.toDateMs.bind(callbacks),
    },
    callbacks: {
      syncUrl: callbacks.syncUrl.bind(callbacks),
      renderRows: callbacks.renderRows.bind(callbacks),
      refreshFiltersMeta: callbacks.refreshFiltersMeta.bind(callbacks),
      renderSessionGroups: callbacks.renderSessionGroups.bind(callbacks),
      matchFilters: callbacks.matchFilters.bind(callbacks),
      isServerMode: callbacks.isServerMode.bind(callbacks),
      setStatus: callbacks.setStatus.bind(callbacks),
      eventMatchesMode: callbacks.eventMatchesMode.bind(callbacks),
    },
    timers,
  });

  return { controller, state, els, apiClient, callbacks, calls, timers };
}

test("buildDetailPayload includes formatted time and raw metadata", () => {
  const payload = buildDetailPayload(
    createEvent("2026-04-19T10:00:00.000Z", "hello", { extra: "tool-output" }),
    { formatShanghaiTime: (value) => `formatted:${value}` }
  );

  assert.equal(payload.time_iso, "2026-04-19T10:00:00.000Z");
  assert.equal(payload.time_shanghai, "formatted:2026-04-19T10:00:00.000Z");
  assert.equal(payload.call_type, "Agent");
  assert.equal(payload.extra, "tool-output");
  assert.deepEqual(payload.raw, { content: "hello" });
});

test("stream workspace applyFilters filters local events, sorts, resets scroll, and syncs url", () => {
  const { controller, state, els, callbacks } = createControllerContext();
  state.events = [
    createEvent("2026-04-19T10:00:00.000Z", "keep older"),
    createEvent("2026-04-19T10:10:00.000Z", "drop newer"),
    createEvent("2026-04-19T10:20:00.000Z", "keep latest"),
  ];
  state.filtered = [];
  state.selectedRowIndex = 5;

  controller.applyFilters();

  assert.deepEqual(state.filtered.map((event) => event.content), ["keep latest", "keep older"]);
  assert.equal(state.selectedRowIndex, -1);
  assert.equal(state.scrollTop, 0);
  assert.equal(els.rows.scrollTop, 0);
  assert.equal(callbacks.rowsRendered, 1);
  assert.equal(callbacks.synced, 1);
});

test("stream workspace applyFilters delegates to refresh path in server mode", () => {
  const { controller, state, els, callbacks } = createControllerContext();
  state.dataSource = "server";
  let refreshPrefix = null;
  controller.refreshOnce = async (prefix) => {
    refreshPrefix = prefix;
  };

  controller.applyFilters();

  assert.equal(state.scrollTop, 0);
  assert.equal(els.rows.scrollTop, 0);
  assert.equal(refreshPrefix, "筛选刷新");
  assert.equal(callbacks.synced, 1);
});

test("stream workspace loadRealtimeEventsPage updates state and refreshes views", async () => {
  const { controller, state, els, callbacks, calls } = createControllerContext();
  state.dataSource = "server";
  state.filtered = [createEvent("2026-04-19T09:00:00.000Z", "old")];

  const count = await controller.loadRealtimeEventsPage({ append: false });

  assert.equal(count, 1);
  assert.equal(state.events.length, 1);
  assert.equal(state.filtered.length, 1);
  assert.equal(state.totalMatching, 1);
  assert.equal(state.pageLimit, 100);
  assert.equal(state.codexVersion, "codex-cli 0.121.0");
  assert.equal(els.rows.scrollTop, 0);
  assert.equal(els.sessionList.scrollTop, 0);
  assert.equal(callbacks.filtersRefreshed, 1);
  assert.equal(callbacks.sessionGroupsRendered, 1);
  assert.equal(callbacks.rowsRendered, 1);
  assert.equal(calls[0].type, "listRealtimeEvents");
});

test("stream workspace showDetail opens modal and updates navigation state", () => {
  const { controller, state, els } = createControllerContext();
  state.filtered = [
    createEvent("2026-04-19T10:00:00.000Z", "first"),
    createEvent("2026-04-19T10:10:00.000Z", "second"),
  ];

  controller.showDetail(1);

  assert.equal(state.selectedRowIndex, 1);
  assert.equal(els.detailModal.classList.contains("hidden"), false);
  assert.equal(els.detailModal.getAttribute("aria-hidden"), "false");
  assert.match(els.modalJson.innerHTML, /formatted:2026-04-19T10:10:00.000Z/);
  assert.equal(els.prevEventBtn.disabled, false);
  assert.equal(els.nextEventBtn.disabled, true);
});

test("stream workspace auto refresh toggles button state and schedules polling", async () => {
  const { controller, state, els, timers, callbacks } = createControllerContext();
  controller.refreshOnce = async (prefix) => {
    callbacks.setStatus(`refresh:${prefix}`);
  };

  await controller.startAutoRefresh();

  assert.equal(state.autoRefreshEnabled, true);
  assert.equal(els.autoRefreshBtn.textContent, "停止自动刷新");
  assert.equal(els.autoRefreshBtn.classList.contains("active"), true);
  assert.equal(timers.intervals.length, 1);

  controller.stopAutoRefresh("自动刷新已停止");

  assert.equal(state.autoRefreshEnabled, false);
  assert.equal(els.autoRefreshBtn.textContent, "自动刷新(5s)");
  assert.deepEqual(callbacks.statuses.slice(-1), ["自动刷新已停止"]);
  assert.deepEqual(timers.clearedIntervals, [1]);
});
