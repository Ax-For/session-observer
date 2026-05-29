import { describe, expect, test } from "vitest";
import {
  buildDashboardSummary,
  buildActiveSessionOverview,
  buildLocalSessionGroups,
  buildLocalStreamPayload,
  buildLowContentSessionIds,
  buildSessionSections,
  buildSessionWorkspaceIndex,
  buildSessionWorkspaceTree,
  buildStreamSessionRailItems,
  buildStreamScope,
} from "../workspace-models";

const sampleEvents = [
  {
    callType: "Token_Usage",
    model: "gpt-5.4",
    sourceType: "codex",
    sessionId: "sess-1",
    sessionTitle: "Incident triage",
    time: "2026-04-19T14:36:10.720Z",
    tokenUsage: {
      input: 2400,
      output: 220,
      total: 2620,
      cachedInput: 1200,
      cacheReadInput: 1200,
      reasoningOutput: 80,
    },
  },
  {
    callType: "Tool_Call",
    model: "gpt-5.4",
    sourceType: "codex",
    sessionId: "sess-1",
    sessionTitle: "Incident triage",
    time: "2026-04-19T14:35:10.720Z",
  },
  {
    callType: "Agent",
    model: "claude-sonnet-4-6",
    sourceType: "claude",
    sessionId: "sess-2",
    sessionTitle: "Conversation review",
    time: "2026-04-18T13:00:00.000Z",
  },
];

const sampleGroups = {
  "/Users/me/code/session-observer": [
    {
      sessionId: "sess-1",
      sessionTitle: "Incident triage",
      fallbackTitle: "Fallback 1",
      cwd: "/Users/me/code/session-observer",
      sourceType: "codex",
      latest: "2026-04-19T14:36:10.720Z",
      count: 44,
      aggregateToken: { total: 2620 },
      models: ["gpt-5.4"],
      sourceFiles: ["/Users/me/.codex/sessions/2026/04/19/session-a.jsonl"],
    },
    {
      sessionId: "sess-2",
      sessionTitle: "",
      fallbackTitle: "Conversation review",
      cwd: "/Users/me/code/session-observer",
      sourceType: "claude",
      latest: "2026-04-18T13:00:00.000Z",
      count: 18,
      aggregateToken: { total: 820 },
      models: ["claude-sonnet-4-6"],
      sourceFiles: ["/Users/me/.claude/projects/repo/session-b.jsonl"],
    },
  ],
  "/Users/me/code/another-app": [
    {
      sessionId: "sess-3",
      sessionTitle: "Batch export",
      fallbackTitle: "Fallback 3",
      cwd: "/Users/me/code/another-app",
      sourceType: "codex",
      latest: "2026-04-17T09:00:00.000Z",
      count: 10,
      aggregateToken: { total: 400 },
      models: ["gpt-5.3-codex"],
      sourceFiles: ["/Users/me/.codex/sessions/2026/04/17/session-c.jsonl"],
    },
  ],
};

describe("buildDashboardSummary", () => {
  test("prefers session aggregates for tokens, models, and platform totals when available", () => {
    expect(buildDashboardSummary({
      events: sampleEvents,
      sessions: Object.values(sampleGroups).flat(),
      totalVisible: 3,
      totalMatching: 3,
      totalLoaded: 3,
      nowMs: Date.parse("2026-04-19T23:59:59.000Z"),
      timezoneOffsetMinutes: 0,
    })).toEqual({
      totals: {
        input: 0,
        output: 0,
        total: 3840,
        cachedInput: 0,
        reasoningOutput: 0,
      },
      counts: {
        totalVisible: 3,
        totalMatching: 3,
        totalLoaded: 3,
        sessions: 3,
      },
      topTypes: [
        { key: "Agent", value: 1 },
        { key: "Token_Usage", value: 1 },
        { key: "Tool_Call", value: 1 },
      ],
      topModels: [
        { key: "claude-sonnet-4-6", value: 1 },
        { key: "gpt-5.3-codex", value: 1 },
        { key: "gpt-5.4", value: 1 },
      ],
      platforms: [
        { key: "codex", sessions: 2, events: 54 },
        { key: "claude", sessions: 1, events: 18 },
      ],
      tokenWindows: {
        day: {
          total: 2620,
          rawTotal: 2620,
          input: 2400,
          inputTotal: 2400,
          output: 220,
          cachedInput: 1200,
          cacheReadInput: 1200,
          cacheCreationInput: 0,
          reasoningOutput: 80,
          platforms: [
            { key: "codex", total: 2620 },
          ],
        },
        week: {
          total: 2620,
          rawTotal: 2620,
          input: 2400,
          inputTotal: 2400,
          output: 220,
          cachedInput: 1200,
          cacheReadInput: 1200,
          cacheCreationInput: 0,
          reasoningOutput: 80,
          platforms: [
            { key: "codex", total: 2620 },
          ],
        },
      },
    });
  });

  test("uses precomputed token windows when provided", () => {
    const tokenWindows = {
      day: {
        total: 3200,
        platforms: [
          { key: "codex", total: 1200 },
          { key: "claude", total: 2000 },
        ],
      },
      week: {
        total: 8400,
        platforms: [
          { key: "codex", total: 3600 },
          { key: "claude", total: 4800 },
        ],
      },
    };

    const summary = buildDashboardSummary({
      events: sampleEvents,
      sessions: Object.values(sampleGroups).flat(),
      totalVisible: 3,
      totalMatching: 3,
      totalLoaded: 3,
      tokenWindows,
    });

    expect(summary.tokenWindows).toEqual(tokenWindows);
  });
});

describe("buildSessionSections", () => {
  test("filters and sorts session groups into workspace sections", () => {
    expect(buildSessionSections(sampleGroups, {
      query: "conversation",
      platform: "claude",
      namedOnly: false,
    })).toEqual([
      expect.objectContaining({
        cwd: "/Users/me/code/session-observer",
        total: 1,
        sessions: [
          expect.objectContaining({
            sessionId: "sess-2",
            title: "Conversation review",
            sourceType: "claude",
          }),
        ],
      }),
    ]);
  });

  test("can hide unnamed sessions", () => {
    expect(buildSessionSections(sampleGroups, {
      query: "",
      platform: "",
      namedOnly: true,
    })).toEqual([
      expect.objectContaining({
        cwd: "/Users/me/code/session-observer",
        total: 1,
      }),
      expect.objectContaining({
        cwd: "/Users/me/code/another-app",
        total: 1,
      }),
    ]);
  });

  test("deduplicates repeated fallback-title sessions inside session sections", () => {
    const sections = buildSessionSections({
      "/Users/me": [
        {
          sessionId: "151831b9-83e5-4f57-af0f-4f8b60bbeab8",
          sessionTitle: "",
          fallbackTitle: "这个 npm script 怎么启动",
          cwd: "/Users/me",
          sourceType: "claude",
          latest: "2026-04-29T13:23:25.174Z",
          count: 6,
          aggregateToken: { total: 0 },
          models: [],
        },
        {
          sessionId: "baac828f-e96c-4e96-8841-a31888dfc7f1",
          sessionTitle: "",
          fallbackTitle: "这个 npm script 怎么启动",
          cwd: "/Users/me",
          sourceType: "claude",
          latest: "2026-04-29T13:23:25.806Z",
          count: 6,
          aggregateToken: { total: 0 },
          models: [],
        },
      ],
    });

    expect(sections).toEqual([
      expect.objectContaining({
        cwd: "/Users/me",
        total: 1,
        sessions: [
          expect.objectContaining({
            sessionId: "baac828f-e96c-4e96-8841-a31888dfc7f1",
            sessionIds: [
              "151831b9-83e5-4f57-af0f-4f8b60bbeab8",
              "baac828f-e96c-4e96-8841-a31888dfc7f1",
            ],
            title: "这个 npm script 怎么启动",
            count: 12,
            groupedCount: 2,
          }),
        ],
      }),
    ]);
  });

  test("applies token and event filters before repeated sessions are merged", () => {
    const repeatedGroups = {
      "/Users/me": [
        {
          sessionId: "first",
          sessionTitle: "",
          fallbackTitle: "这个 npm script 怎么启动",
          cwd: "/Users/me",
          sourceType: "claude",
          latest: "2026-04-29T13:23:25.174Z",
          count: 6,
          aggregateToken: { total: 600 },
          models: [],
        },
        {
          sessionId: "second",
          sessionTitle: "",
          fallbackTitle: "这个 npm script 怎么启动",
          cwd: "/Users/me",
          sourceType: "claude",
          latest: "2026-04-29T13:23:25.806Z",
          count: 6,
          aggregateToken: { total: 600 },
          models: [],
        },
      ],
    };

    expect(buildSessionSections(repeatedGroups, { maxEvents: "10" })).toEqual([
      expect.objectContaining({
        total: 1,
        sessions: [
          expect.objectContaining({
            sessionId: "second",
            count: 12,
            totalTokens: 1200,
            groupedCount: 2,
            sessionIds: ["first", "second"],
          }),
        ],
      }),
    ]);
    expect(buildSessionSections(repeatedGroups, { tokenMax: "1000" })).toEqual([
      expect.objectContaining({
        total: 1,
        sessions: [
          expect.objectContaining({
            sessionId: "second",
            count: 12,
            totalTokens: 1200,
            groupedCount: 2,
          }),
        ],
      }),
    ]);
    expect(buildLowContentSessionIds(repeatedGroups)).toEqual(["first", "second"]);
  });

  test("groups sessions by transcript file location and filters by token and event count", () => {
    const sections = buildSessionSections(sampleGroups, {
      groupBy: "sourceFile",
      tokenMin: "500",
      tokenMax: "3000",
      maxEvents: "30",
    });

    expect(sections).toEqual([
      expect.objectContaining({
        groupType: "sourceFile",
        label: "/Users/me/.claude/projects/repo/session-b.jsonl",
        total: 1,
        sessions: [
          expect.objectContaining({
            sessionId: "sess-2",
            totalTokens: 820,
            count: 18,
          }),
        ],
      }),
    ]);
  });

  test("builds a workspace index from visible session sections", () => {
    const sections = buildSessionSections(sampleGroups, { groupBy: "sourceFile" });

    expect(buildSessionWorkspaceIndex(sections)).toEqual([
      expect.objectContaining({
        cwd: "/Users/me/code/session-observer",
        sessions: 2,
        events: 62,
        tokens: 3440,
      }),
      expect.objectContaining({
        cwd: "/Users/me/code/another-app",
        sessions: 1,
        events: 10,
        tokens: 400,
      }),
    ]);
  });

  test("builds a workspace tree that folds shared path prefixes", () => {
    const tree = buildSessionWorkspaceTree([
      { key: "/Users/me/code/session-observer", cwd: "/Users/me/code/session-observer", sessions: 2, events: 12, tokens: 1200 },
      { key: "/Users/me/code/another-app", cwd: "/Users/me/code/another-app", sessions: 1, events: 8, tokens: 800 },
      { key: "/Users/me/Desktop/demo", cwd: "/Users/me/Desktop/demo", sessions: 1, events: 4, tokens: 400 },
    ]);

    expect(tree.label).toBe("/Users/me");
    expect(tree.children).toEqual([
      expect.objectContaining({
        label: "code",
        sessions: 3,
        children: expect.arrayContaining([
          expect.objectContaining({ label: "session-observer", workspace: expect.objectContaining({ cwd: "/Users/me/code/session-observer" }) }),
          expect.objectContaining({ label: "another-app", workspace: expect.objectContaining({ cwd: "/Users/me/code/another-app" }) }),
        ]),
      }),
      expect.objectContaining({
        label: "Desktop",
        sessions: 1,
        children: [
          expect.objectContaining({ label: "demo", workspace: expect.objectContaining({ cwd: "/Users/me/Desktop/demo" }) }),
        ],
      }),
    ]);
  });

  test("workspace index counts visible rows separately from merged raw sessions", () => {
    const sections = [
      {
        sessions: [
          {
            cwd: "/Users/me",
            groupedCount: 15,
            count: 90,
            totalTokens: 0,
            latest: "2026-04-29T13:23:26.524Z",
          },
          {
            cwd: "/Users/me",
            groupedCount: 1,
            count: 58,
            totalTokens: 1000,
            latest: "2026-05-02T06:38:59.273Z",
          },
        ],
      },
    ];

    expect(buildSessionWorkspaceIndex(sections)).toEqual([
      expect.objectContaining({
        cwd: "/Users/me",
        sessions: 2,
        rawSessions: 16,
        events: 148,
        tokens: 1000,
      }),
    ]);
  });
});

describe("buildActiveSessionOverview", () => {
  test("returns sessions updated inside the active window with platform totals", () => {
    const overview = buildActiveSessionOverview(sampleGroups, {
      nowMs: Date.parse("2026-04-19T14:45:10.720Z"),
      activeWindowMs: 30 * 60 * 1000,
    });

    expect(overview.total).toBe(1);
    expect(overview.windowMinutes).toBe(30);
    expect(overview.latestAt).toBe("2026-04-19T14:36:10.720Z");
    expect(overview.platforms).toEqual([{ key: "codex", sessions: 1 }]);
    expect(overview.sessions).toEqual([
      expect.objectContaining({
        sessionId: "sess-1",
        title: "Incident triage",
        ageMs: 9 * 60 * 1000,
        sourceType: "codex",
      }),
    ]);
  });

  test("respects session filters and limits the visible active list", () => {
    const overview = buildActiveSessionOverview(sampleGroups, {
      nowMs: Date.parse("2026-04-19T15:00:00.000Z"),
      activeWindowMs: 72 * 60 * 60 * 1000,
      limit: 1,
      filters: { platform: "codex", query: "" },
    });

    expect(overview.total).toBe(2);
    expect(overview.sessions).toHaveLength(1);
    expect(overview.sessions[0].sessionId).toBe("sess-1");
    expect(overview.hasMore).toBe(true);
    expect(overview.platforms).toEqual([{ key: "codex", sessions: 2 }]);
  });
});

describe("local workspace models", () => {
  test("buildLocalStreamPayload filters focused events but keeps matching session metadata", () => {
    const payload = buildLocalStreamPayload({
      events: sampleEvents,
      filters: {
        query: "",
        model: "",
        type: "",
        platform: "",
        order: "desc",
      },
      selectedSessionId: "sess-1",
      quickFilter: "all",
      tokenThreshold: 20000,
      mode: "observe",
    });

    expect(payload.events.map((event) => event.sessionId)).toEqual(["sess-1", "sess-1"]);
    expect(payload.sessions.map((session) => session.sessionId).sort()).toEqual(["sess-1", "sess-2"]);
    expect(payload.totalVisible).toBe(3);
    expect(payload.totalMatching).toBe(2);
  });

  test("buildLocalStreamPayload keeps session token aggregates when text filters exclude token events", () => {
    const payload = buildLocalStreamPayload({
      events: sampleEvents,
      filters: {
        query: "tool",
        model: "",
        type: "",
        platform: "",
        order: "desc",
      },
      selectedSessionId: "",
      quickFilter: "all",
      tokenThreshold: 20000,
      mode: "observe",
    });

    expect(payload.events.map((event) => event.callType)).toEqual(["Tool_Call"]);
    expect(payload.sessions).toEqual([
      expect.objectContaining({
        sessionId: "sess-1",
        count: 1,
        aggregateToken: expect.objectContaining({ total: 2620 }),
      }),
    ]);
  });

  test("buildLocalStreamPayload keeps session titles when type filters exclude prompt events", () => {
    const payload = buildLocalStreamPayload({
      events: [
        {
          callType: "User",
          content: "帮我启动 session-observer",
          model: "claude-sonnet-4-6",
          sourceType: "claude",
          sessionId: "claude-session-1",
          sessionTitle: "",
          time: "2026-04-29T13:46:41.362Z",
        },
        {
          callType: "Agent",
          content: "我会检查 manage.sh 并启动服务",
          model: "claude-sonnet-4-6",
          sourceType: "claude",
          sessionId: "claude-session-1",
          sessionTitle: "",
          time: "2026-04-29T13:46:44.371Z",
        },
      ],
      filters: {
        query: "",
        model: "",
        type: "Agent",
        platform: "",
        order: "desc",
      },
      selectedSessionId: "",
      quickFilter: "all",
      tokenThreshold: 20000,
      mode: "observe",
    });

    expect(payload.events.map((event) => event.callType)).toEqual(["Agent"]);
    expect(payload.sessions).toEqual([
      expect.objectContaining({
        sessionId: "claude-session-1",
        count: 1,
        fallbackTitle: "帮我启动 session-observer",
      }),
    ]);
  });

  test("buildLocalSessionGroups produces cwd sections without stream filter coupling", () => {
    expect(buildLocalSessionGroups(sampleEvents)).toEqual({
      "未分类": [
        expect.objectContaining({
          sessionId: "sess-1",
          count: 2,
        }),
        expect.objectContaining({
          sessionId: "sess-2",
          count: 1,
        }),
      ],
    });
  });
});

describe("buildStreamSessionRailItems", () => {
  test("deduplicates visually identical recent sessions for the stream rail", () => {
    const items = buildStreamSessionRailItems([
      {
        sessionId: "older",
        sessionTitle: "",
        fallbackTitle: "You are optimizing a skill descripti...",
        cwd: "/Users/me/.cc-switch/skills/skill-creator",
        sourceType: "claude",
        latest: "2026-04-29T13:16:05.702Z",
        count: 1,
        aggregateToken: { total: 100 },
      },
      {
        sessionId: "newer",
        sessionTitle: "",
        fallbackTitle: "You are optimizing a skill descripti...",
        cwd: "/Users/me/.cc-switch/skills/skill-creator",
        sourceType: "claude",
        latest: "2026-04-29T13:22:23.796Z",
        count: 1,
        aggregateToken: { total: 200 },
      },
      {
        sessionId: "distinct-cwd",
        sessionTitle: "",
        fallbackTitle: "You are optimizing a skill descripti...",
        cwd: "/Users/me/other",
        sourceType: "claude",
        latest: "2026-04-29T13:21:00.000Z",
        count: 1,
        aggregateToken: { total: 50 },
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        sessionId: "newer",
        title: "You are optimizing a skill descripti...",
        count: 2,
        totalTokens: 300,
        groupedCount: 2,
      }),
      expect.objectContaining({
        sessionId: "distinct-cwd",
        groupedCount: 1,
      }),
    ]);
  });
});

describe("buildStreamScope", () => {
  test("summarizes the current stream focus for the header rail", () => {
    expect(buildStreamScope({
      selectedSessionId: "sess-1",
      sessions: Object.values(sampleGroups).flat(),
      quickFilter: "alert",
      platform: "codex",
      query: "incident",
      mode: "observe",
    })).toEqual({
      title: "Incident triage",
      subtitle: "Codex · 告警视图 · observe",
      tags: ["incident", "/Users/me/code/session-observer"],
    });
  });
});
