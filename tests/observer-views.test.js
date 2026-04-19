const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findSessionById,
  renderSessionDetailHtml,
  renderSessionGroupsHtml,
} = require("../app/views/session-management");
const {
  prepareConversationEvents,
  renderConversationHtml,
} = require("../app/views/conversation");

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortPathN(value, count = 3) {
  const parts = String(value || "").split(/[\\/]/).filter(Boolean);
  if (parts.length <= count) return value;
  return `.../${parts.slice(-count).join("/")}`;
}

function shortId(value, size = 8) {
  if (!value) return "-";
  return value.length <= size ? value : value.slice(0, size);
}

function fmtNum(value) {
  return Number(value).toLocaleString("zh-CN");
}

function fmtTokenHuman(value) {
  const n = Number(value);
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\\.0$/, "")}k`;
  return String(n);
}

function hasTokenUsageData(tokenUsage) {
  return Boolean(tokenUsage && Number.isFinite(Number(tokenUsage.total)));
}

function formatShanghaiTime(value) {
  return `formatted:${value}`;
}

function renderMarkdown(text) {
  return `<p>${escapeHtml(text)}</p>`;
}

function getToolConfig(toolName) {
  if (toolName === "Bash") {
    return { category: "bash", inputStyle: "terminal", hideResult: true };
  }
  return { category: "default", inputStyle: "collapsible", resultStyle: "collapsible" };
}

function highlightJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

test("findSessionById locates a nested session", () => {
  const session = { sessionId: "sess-2", sessionTitle: "Investigate timeout" };
  const found = findSessionById({
    "/Users/me/repo-a": [{ sessionId: "sess-1" }],
    "/Users/me/repo-b": [session],
  }, "sess-2");

  assert.equal(found, session);
  assert.equal(findSessionById({}, "missing"), null);
});

test("renderSessionGroupsHtml marks selected sessions and formats token metadata", () => {
  const html = renderSessionGroupsHtml({
    "/Users/me/workspace/session-observer": [
      {
        sessionId: "sess-1-abcdef",
        sessionTitle: "Release Review",
        fallbackTitle: "",
        aggregateToken: { total: 1530 },
        sourceType: "codex",
        count: 12,
        latest: "2026-04-19T10:00:00.000Z",
      },
    ],
  }, {
    selectedSessionIds: new Set(["sess-1-abcdef"]),
    escapeHtml,
    fmtTokenHuman,
    formatShanghaiTime,
    hasTokenUsageData,
    shortId,
    shortPathN,
  });

  assert.match(html, /session-card selected/);
  assert.match(html, /aria-checked="true"/);
  assert.match(html, /Release Review/);
  assert.match(html, /Tok 1\.5k/);
  assert.match(html, /formatted:2026-04-19T10:00:00.000Z/);
  assert.match(html, /session-observer/);
});

test("renderSessionDetailHtml shows model and token aggregates", () => {
  const html = renderSessionDetailHtml({
    sessionId: "sess-9",
    sessionTitle: "Trace regression",
    fallbackTitle: "",
    sourceType: "claude",
    models: ["claude-sonnet-4-6", "claude-opus-4-1"],
    count: 8,
    latest: "2026-04-19T12:00:00.000Z",
    cwd: "/Users/me/workspace/session-observer",
    aggregateToken: { total: 200, input: 120, output: 80, cachedInput: 25, reasoningOutput: 10 },
  }, {
    escapeHtml,
    fmtNum,
    formatShanghaiTime,
    hasTokenUsageData,
  });

  assert.match(html, /Trace regression/);
  assert.match(html, /claude-sonnet-4-6/);
  assert.match(html, /Total: 200/);
  assert.match(html, /In: 120 · Out: 80/);
  assert.match(html, /查看事件流/);
  assert.match(html, /查看对话/);
});

test("prepareConversationEvents strips internal payloads and environment context", () => {
  const events = prepareConversationEvents([
    { callType: "Token_Usage", content: "", time: "2026-04-19T10:00:00.000Z" },
    { callType: "Raw", content: "[subagent:worker] hidden", time: "2026-04-19T10:00:01.000Z" },
    {
      callType: "User",
      content: "  Ship the patch  ",
      time: "2026-04-19T10:00:02.000Z",
    },
    {
      callType: "Agent",
      content: "[Request interrupted due to tool handoff]",
      time: "2026-04-19T10:00:03.000Z",
    },
    {
      callType: "Agent",
      content: "[agent=worker]\nPatch applied successfully",
      time: "2026-04-19T10:00:04.000Z",
    },
  ]);

  assert.equal(events.length, 2);
  assert.equal(events[0].content, "Ship the patch");
  assert.equal(events[1].content, "[agent=worker]\nPatch applied successfully");
});

test("renderConversationHtml hides successful bash results and renders completion state", () => {
  const html = renderConversationHtml({
    events: prepareConversationEvents([
      {
        callType: "Tool_Call",
        toolName: "Bash",
        content: 'tool=Bash\\nargs={"command":"npm test","description":"run tests"}',
        extra: "",
        time: "2026-04-19T10:00:05.000Z",
        callId: "tool-1",
      },
      {
        callType: "Tool_Result",
        toolName: "Bash",
        content: "ok",
        extra: "",
        time: "2026-04-19T10:00:06.000Z",
        callId: "tool-2",
      },
      {
        callType: "Agent",
        content: "Tests are green",
        extra: "",
        time: "2026-04-19T10:00:07.000Z",
        callId: "agent-1",
      },
    ]),
    offset: 3,
    total: 3,
  }, {
    escapeHtml,
    formatShanghaiTime,
    getToolConfig,
    highlightJson,
    renderMarkdown,
  });

  assert.match(html, /npm test/);
  assert.match(html, /data-copy-terminal-id=/);
  assert.match(html, /data-copy-content-id=/);
  assert.doesNotMatch(html, /onclick=/);
  assert.doesNotMatch(html, /<span class="coll-title">Result<\/span>/);
  assert.match(html, /Tests are green/);
  assert.match(html, /已全部加载/);
});

test("renderConversationHtml escapes raw html inside agent markdown by default", () => {
  const previousMarked = global.marked;
  global.marked = {
    Renderer: function Renderer() {},
    parse(input, options = {}) {
      return `<p>${input
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/<script>alert\(1\)<\/script>/g, options.renderer.html("<script>alert(1)</script>"))
        .replace(/<img src=x onerror=alert\(2\)>/g, options.renderer.html("<img src=x onerror=alert(2)>"))}</p>`;
    },
  };

  try {
    const html = renderConversationHtml({
      events: prepareConversationEvents([
        {
          callType: "Agent",
          content: "Safe **markdown** <script>alert(1)</script> <img src=x onerror=alert(2)>",
          extra: "",
          time: "2026-04-19T10:00:07.000Z",
          callId: "agent-safe",
        },
      ]),
      offset: 1,
      total: 1,
    }, {
      escapeHtml,
      formatShanghaiTime,
      getToolConfig,
      highlightJson,
    });

    assert.match(html, /<strong>markdown<\/strong>/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  } finally {
    global.marked = previousMarked;
  }
});
