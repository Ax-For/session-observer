import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ObservabilityWorkspace } from "../observability-workspace";

const payload = {
  generatedAt: "2026-04-23T12:00:00.000Z",
  index: {
    lastBuiltAt: "2026-04-23T11:59:00.000Z",
    lastError: "",
  },
  runtime: {
    uptimeSeconds: 120,
    memory: { rss: 42_000_000 },
    versions: { codex: "codex-cli 0.130.0", claude: "1.0.0" },
  },
  sources: {
    codex: {
      path: "/Users/me/.codex/sessions",
      exists: true,
      files: 12,
      updatedAt: "2026-04-23T11:50:00.000Z",
    },
    claude: {
      path: "/Users/me/.claude/projects",
      exists: true,
      files: 8,
      updatedAt: "2026-04-23T11:40:00.000Z",
    },
  },
  summary: {
    health: {
      eventsTotal: 1200,
      sessionsTotal: 32,
      platformCount: 2,
      modelCount: 4,
      lastEventAt: "2026-04-23T11:58:00.000Z",
      alertEvents: 3,
    },
    tokens: {
      input: 10_000,
      inputTotal: 16_000,
      output: 2000,
      cachedInput: 6000,
      cacheReadInput: 5000,
      cacheCreationInput: 1000,
      reasoningOutput: 800,
      effectiveTotal: 18_000,
      cost: {
        estimatedUsd: 0.0525,
        knownTokenTotal: 18_000,
        currency: "USD",
        source: "built-in-estimate",
        unknownModels: [],
        byModel: [
          { model: "gpt-5.4", estimatedUsd: 0.035, knownTokenTotal: 12_000 },
          { model: "claude-sonnet-4-6", estimatedUsd: 0.0175, knownTokenTotal: 6000 },
        ],
      },
      windows: {
        day: {
          total: 8000,
          rawTotal: 6000,
          input: 5000,
          inputTotal: 6800,
          output: 1000,
          cachedInput: 2000,
          cacheReadInput: 1800,
          cacheCreationInput: 200,
          reasoningOutput: 250,
          platforms: [
            { key: "codex", total: 5000 },
            { key: "claude", total: 3000 },
          ],
        },
        week: {
          total: 18_000,
          rawTotal: 12_000,
          input: 10_000,
          inputTotal: 16_000,
          output: 2000,
          cachedInput: 6000,
          cacheReadInput: 5000,
          cacheCreationInput: 1000,
          reasoningOutput: 800,
          platforms: [
            { key: "codex", total: 12_000 },
            { key: "claude", total: 6000 },
          ],
        },
      },
      byModel: [
        { key: "gpt-5.4", total: 12_000 },
        { key: "claude-sonnet-4-6", total: 6000 },
      ],
      topSessions: [
        {
          sessionId: "sess-alert",
          title: "Investigate timeout",
          sourceType: "codex",
          events: 20,
          tokens: 12_000,
        },
      ],
    },
    alerts: {
      total: 3,
      byType: [{ key: "Tool_Result", count: 3 }],
      byPlatform: [{ key: "codex", count: 3 }],
      recent: [
        {
          time: "2026-04-23T11:56:00.000Z",
          sessionId: "sess-alert",
          sourceType: "codex",
          callType: "Tool_Result",
          toolName: "Shell",
          summary: "failed with timeout",
        },
      ],
    },
    tools: {
      totalCalls: 9,
      totalResults: 7,
      topTools: [{ key: "Shell", calls: 4, results: 3, alerts: 2 }],
    },
    workspaces: {
      topWorkspaces: [
        {
          cwd: "/Users/me/code/session-observer",
          events: 900,
          sessions: 12,
          tokens: 14_000,
          alerts: 2,
        },
      ],
    },
    charts: {
      hourly: [
        { time: "2026-04-23T10:00:00.000Z", label: "10:00", events: 2, alerts: 0, tokens: 3000, platforms: [{ key: "codex", total: 3000 }] },
        { time: "2026-04-23T11:00:00.000Z", label: "11:00", events: 4, alerts: 1, tokens: 15000, platforms: [{ key: "codex", total: 9000 }, { key: "claude", total: 6000 }] },
      ],
      daily: [
        { time: "2026-04-22T00:00:00.000Z", label: "04/22", events: 5, alerts: 0, tokens: 6000, platforms: [{ key: "claude", total: 6000 }] },
        { time: "2026-04-23T00:00:00.000Z", label: "04/23", events: 6, alerts: 1, tokens: 12000, platforms: [{ key: "codex", total: 12000 }] },
      ],
      platformShare: [
        { key: "codex", total: 12000 },
        { key: "claude", total: 6000 },
      ],
      modelTokens: [
        { key: "gpt-5.4", total: 12000 },
        { key: "claude-sonnet-4-6", total: 6000 },
      ],
      alertTypes: [{ key: "Tool_Result", count: 3 }],
    },
    traces: {
      traces: 32,
      spans: 480,
      llmSpans: 300,
      toolSpans: 120,
      tokenSpans: 60,
      thinkingSpans: 0,
      maxDepth: 3,
    },
  },
};

const activeOverview = {
  total: 1,
  windowMinutes: 30,
  latestAt: "2026-04-23T11:58:00.000Z",
  hasMore: false,
  platforms: [{ key: "codex", sessions: 1 }],
  sessions: [
    {
      sessionId: "sess-active",
      title: "Active Codex session",
      sourceType: "codex",
      cwd: "/Users/me/code/session-observer",
      latest: "2026-04-23T11:58:00.000Z",
      count: 42,
      ageMs: 120000,
      activity: {
        projectedHourlyTokens: 2400,
        tokensPerMinute: 40,
        eventsPerMinute: 1.4,
        confidence: "low",
      },
    },
  ],
};

describe("ObservabilityWorkspace", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the overview health, source, runtime, workspace, and tool panels", () => {
    render(
      <MantineProvider>
        <ObservabilityWorkspace
          payload={payload}
          view="overview"
          activeOverview={activeOverview}
          loading={false}
          onRefresh={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: "运行总览" })).toBeInTheDocument();
    expect(screen.getByText("事件总量")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("数据源状态")).toBeInTheDocument();
    expect(screen.getByText("按天 Token 趋势")).toBeInTheDocument();
    expect(screen.getByText("活跃会话")).toBeInTheDocument();
    expect(screen.getByText("Trace Span")).toBeInTheDocument();
    expect(screen.getAllByText("480").length).toBeGreaterThan(0);
    expect(screen.getByText("观测覆盖")).toBeInTheDocument();
    expect(screen.getByText("成本覆盖")).toBeInTheDocument();
    expect(screen.getByText("模型集中度")).toBeInTheDocument();
    expect(screen.getByText("关键观察")).toBeInTheDocument();
    expect(screen.getByText("最贵模型")).toBeInTheDocument();
    expect(screen.getByText("最近活跃会话")).toBeInTheDocument();
    expect(screen.getByText("Active Codex session")).toBeInTheDocument();
    expect(screen.getByText("预计 2,400/h")).toBeInTheDocument();
    expect(screen.getByText("/Users/me/.codex/sessions")).toBeInTheDocument();
    expect(screen.getByText("运行健康")).toBeInTheDocument();
    expect(screen.getByText("Codex codex-cli 0.130.0 / Claude 1.0.0")).toBeInTheDocument();
    expect(screen.getByText("工作区集中度")).toBeInTheDocument();
    expect(screen.getAllByText("Shell").length).toBeGreaterThan(0);
    expect(screen.queryByText("平台 Token 占比")).not.toBeInTheDocument();
  });

  test("renders token windows, model ranking, and high-cost sessions", () => {
    render(
      <MantineProvider>
        <ObservabilityWorkspace payload={payload} view="tokens" loading={false} onRefresh={() => {}} />
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: "Token 消耗" })).toBeInTheDocument();
    expect(screen.getAllByText("有效总量").length).toBeGreaterThan(0);
    expect(screen.getAllByText("输入侧总量").length).toBeGreaterThan(0);
    expect(screen.getAllByText("非缓存输入 Token").length).toBeGreaterThan(0);
    expect(screen.getAllByText("缓存命中 Token").length).toBeGreaterThan(0);
    expect(screen.getAllByText("输出 Token").length).toBeGreaterThan(0);
    expect(screen.getAllByText("推理输出 Token").length).toBeGreaterThan(0);
    expect(screen.getByText("成本估算")).toBeInTheDocument();
    expect(screen.getByText("$0.0525")).toBeInTheDocument();
    expect(screen.getByText("缓存经济性")).toBeInTheDocument();
    expect(screen.getByText("命中覆盖")).toBeInTheDocument();
    expect(screen.getByText("读写杠杆")).toBeInTheDocument();
    expect(screen.getByText("模型成本效率")).toBeInTheDocument();
    expect(screen.getAllByText((_, element) => element.textContent.includes("/M")).length).toBeGreaterThan(0);
    expect(screen.getByText("近 14 天 Token 消耗趋势")).toBeInTheDocument();
    expect(screen.getByText("Token 明细")).toBeInTheDocument();
    expect(screen.getByTestId("token-trend-chart")).toBeInTheDocument();
    expect(screen.getByText("时间窗口")).toBeInTheDocument();
    expect(screen.getByText("Codex 5,000 · Claude Code 3,000")).toBeInTheDocument();
    expect(screen.getByText("输入侧 6,800")).toBeInTheDocument();
    expect(screen.getByText("非缓存 5,000")).toBeInTheDocument();
    expect(screen.getByText("命中 1,800")).toBeInTheDocument();
    expect(screen.getByText("写入 200")).toBeInTheDocument();
    expect(screen.getByText("输出 1,000")).toBeInTheDocument();
    expect(screen.getAllByText("gpt-5.4").length).toBeGreaterThan(0);
    expect(screen.getByText("高消耗会话")).toBeInTheDocument();
    expect(screen.getByText("Investigate timeout")).toBeInTheDocument();
    expect(screen.queryByText("平台占比")).not.toBeInTheDocument();
  });

  test("renders activity insights without the old alert queue", () => {
    render(
      <MantineProvider>
        <ObservabilityWorkspace
          payload={payload}
          view="insights"
          activeOverview={activeOverview}
          loading={false}
          onRefresh={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: "活动洞察" })).toBeInTheDocument();
    expect(screen.getByText("24h 活动热度")).toBeInTheDocument();
    expect(screen.getByTestId("activity-heat-chart")).toBeInTheDocument();
    expect(screen.getByText("工具调用结构")).toBeInTheDocument();
    expect(screen.getByText("命名调用")).toBeInTheDocument();
    expect(screen.getByText("Trace 组成")).toBeInTheDocument();
    expect(screen.getByText("活跃速率")).toBeInTheDocument();
    expect(screen.getByText("工作区负载象限")).toBeInTheDocument();
    expect(screen.getByText("会话压力分布")).toBeInTheDocument();
    expect(screen.getByText("活动结构")).toBeInTheDocument();
    expect(screen.queryByText("模型消耗排行")).not.toBeInTheDocument();
    expect(screen.queryByText("异常队列")).not.toBeInTheDocument();
  });
});
