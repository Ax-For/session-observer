const test = require("node:test");
const assert = require("node:assert/strict");

const {
  addTokenUsage,
  buildSessionGroups,
  collectMeta,
} = require("../shared/observer-core");
const {
  createStreamUiController,
} = require("../app/views/stream-ui");

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
  return {
    value: "",
    innerHTML: "",
    textContent: "",
    hidden: false,
    scrollTop: 0,
    clientHeight: 320,
    classList: createClassList(),
    dataset: {},
    querySelectorAll() {
      return [];
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

function highlightMatch(text) {
  return escapeHtml(text || "");
}

function shortId(value, size = 8) {
  if (!value) return "-";
  return value.length <= size ? value : value.slice(0, size);
}

function shortPathN(value, count = 3) {
  const parts = String(value || "").split(/[\\/]/).filter(Boolean);
  if (parts.length <= count) return value;
  return `.../${parts.slice(-count).join("/")}`;
}

function shortModel(value) {
  return String(value || "");
}

function fmtNum(value) {
  return Number(value).toLocaleString("zh-CN");
}

function fmtTokenHuman(value) {
  return String(Number(value));
}

function hasTokenUsageData(tokenUsage) {
  return Boolean(tokenUsage && Number.isFinite(Number(tokenUsage.total)));
}

function formatShanghaiTime(value) {
  return `formatted:${value}`;
}

function createControllerContext(overrides = {}) {
  const quickButtons = [
    createElement({ dataset: { quickFilter: "all" }, classList: createClassList(["active"]) }),
    createElement({ dataset: { quickFilter: "alert" }, classList: createClassList() }),
  ];
  const rows = createElement({ clientHeight: 240 });
  const sessionList = createElement({ clientHeight: 280 });
  const loadMoreBtn = createElement();
  const modelSelect = createElement({ value: "" });
  const typeSelect = createElement({ value: "" });
  const platformSelect = createElement({ value: "" });
  const searchInput = createElement({ value: "" });
  const dashElements = new Map([
    ["dashScope", createElement()],
    ["tokenInput", createElement()],
    ["tokenOutput", createElement()],
    ["tokenTotal", createElement()],
    ["tokenCached", createElement()],
    ["tokenReason", createElement()],
    ["countTotal", createElement()],
    ["countMatch", createElement()],
    ["countSessions", createElement()],
    ["countLoaded", createElement()],
    ["typeBars", createElement()],
    ["modelList", createElement()],
    ["platformBars", createElement()],
  ]);
  const documentRef = {
    getElementById(id) {
      return dashElements.get(id) || null;
    },
  };
  const els = {
    rows,
    sessionList,
    loadMoreBtn,
    modelSelect,
    typeSelect,
    platformSelect,
    searchInput,
    quickFilters: createElement({
      querySelectorAll(selector) {
        if (selector === "button[data-quick-filter]") return quickButtons;
        return [];
      },
    }),
    ...overrides.els,
  };
  const state = {
    dataSource: "local",
    filtered: [
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Agent",
        content: "Fix applied",
        summary: "Fix applied",
        model: "gpt-5.4",
        sessionId: "sess-1234567890",
        sourceType: "codex",
        extra: "done",
        toolName: "",
        cwd: "/Users/me/repo-a",
        tokenUsage: { input: 10, output: 5, total: 15, cachedInput: 2, reasoningOutput: 1 },
      },
    ],
    events: [
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Agent",
        content: "Fix applied",
        summary: "Fix applied",
        model: "gpt-5.4",
        sessionId: "sess-1234567890",
        sourceType: "codex",
        extra: "done",
        cwd: "/Users/me/repo-a",
        tokenUsage: { input: 10, output: 5, total: 15, cachedInput: 2, reasoningOutput: 1 },
      },
      {
        time: "2026-04-19T10:01:00.000Z",
        callType: "Tool_Result",
        content: "ok",
        summary: "tool ok",
        model: "gpt-5.4",
        sessionId: "sess-1234567890",
        sourceType: "codex",
        extra: "tool=Read",
        cwd: "/Users/me/repo-a",
      },
    ],
    sessions: [],
    meta: { models: ["gpt-5.4"], types: ["Agent"], platforms: ["codex"] },
    sessionGroups: [],
    totalVisible: 2,
    totalMatching: 1,
    selectedSessionId: "sess-1234567890",
    selectedRowIndex: 0,
    hasMore: true,
    scrollTop: 0,
    sessionScrollTop: 0,
    viewportHeight: 240,
    sessionViewportHeight: 280,
    quickFilter: "alert",
    claudeVersion: "1.0.0",
    codexVersion: "2.0.0",
    ...overrides.state,
  };

  const controller = createStreamUiController({
    state,
    els,
    documentRef,
    core: {
      addTokenUsage,
      buildSessionGroups,
      collectMeta,
    },
    helpers: {
      escapeHtml,
      highlightMatch,
      shortId,
      shortPathN,
      shortModel,
      fmtNum,
      fmtTokenHuman,
      hasTokenUsageData,
      formatShanghaiTime,
      rowHeightForDensity: () => 48,
      sessionRowHeightForDensity: () => 84,
    },
    callbacks: {
      isVisibleInCurrentMode: () => true,
      isServerMode: () => state.dataSource === "server",
    },
  });

  return { controller, state, els, documentRef, dashElements, quickButtons };
}

test("stream ui renders dashboard stats and quick filter state", () => {
  const { controller, dashElements, quickButtons } = createControllerContext();

  controller.renderStats();
  controller.renderQuickFilterUi();

  assert.equal(dashElements.get("dashScope").textContent, "Session: sess-1234567");
  assert.equal(dashElements.get("tokenTotal").textContent, "15");
  assert.equal(dashElements.get("countMatch").textContent, "1");
  assert.match(dashElements.get("typeBars").innerHTML, /Agent/);
  assert.match(dashElements.get("platformBars").innerHTML, /Codex/);
  assert.equal(quickButtons[0].classList.contains("active"), false);
  assert.equal(quickButtons[1].classList.contains("active"), true);
});

test("stream ui renders local rows, session groups, and filter metadata", () => {
  const { controller, state, els } = createControllerContext();

  controller.refreshFiltersMeta();
  controller.renderSessionGroups();
  controller.renderRows();

  assert.match(els.modelSelect.innerHTML, /gpt-5\.4/);
  assert.match(els.typeSelect.innerHTML, /Tool_Result/);
  assert.match(els.platformSelect.innerHTML, /codex/);
  assert.equal(state.sessionGroups.length, 1);
  assert.match(els.sessionList.innerHTML, /session-item active/);
  assert.match(els.rows.innerHTML, /log-row active/);
  assert.equal(els.loadMoreBtn.hidden, false);
  assert.equal(els.loadMoreBtn.textContent, "加载更多 (1/1)");
});

test("stream ui uses server session metadata when data source is server", () => {
  const { controller, state, els, dashElements } = createControllerContext({
    state: {
      dataSource: "server",
      sessions: [
        {
          sessionId: "sess-1",
          models: ["claude-sonnet-4-6"],
          sourceType: "claude",
          count: 4,
          aggregateToken: { input: 20, output: 10, total: 30, cachedInput: 0, reasoningOutput: 0 },
        },
      ],
      filtered: [
        {
          time: "2026-04-19T12:00:00.000Z",
          callType: "Agent",
          content: "Server mode",
          summary: "Server mode",
          model: "claude-sonnet-4-6",
          sessionId: "sess-1",
          sourceType: "claude",
          extra: "",
        },
      ],
      sessionGroups: [],
      totalVisible: 4,
      totalMatching: 1,
      hasMore: false,
    },
  });

  controller.refreshFiltersMeta();
  controller.renderSessionGroups();
  controller.renderStats();

  assert.equal(state.sessionGroups, state.sessions);
  assert.equal(els.loadMoreBtn.hidden, false);
  assert.match(dashElements.get("platformBars").innerHTML, /Claude Code/);
  assert.equal(dashElements.get("tokenTotal").textContent, "30");
  assert.equal(dashElements.get("countSessions").textContent, "1");
});
