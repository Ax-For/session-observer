import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { ObservabilityWorkspace } from "../observability-workspace";

const payload = {
  generatedAt: "2026-04-23T12:00:00.000Z",
  index: {
    lastBuiltAt: "2026-04-23T11:59:00.000Z",
    lastError: "",
    cachedFiles: 20,
    reusedFiles: 18,
  },
  runtime: {
    uptimeSeconds: 120,
    memory: {
      rss: 142_400_000,
      heapTotal: 22_800_000,
      heapUsed: 13_100_000,
      external: 2_100_000,
      arrayBuffers: 12_000,
    },
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
          estimatedUsd: 0.018,
          knownTokenTotal: 8000,
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
          estimatedUsd: 0.0525,
          knownTokenTotal: 18_000,
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
      byWorkspace: [
        { cwd: "/Users/me/code/session-observer", total: 14_000, estimatedUsd: 0.041, knownTokenTotal: 14_000 },
        { cwd: "/Users/me/docs", total: 4000, estimatedUsd: 0.0115, knownTokenTotal: 4000 },
      ],
      topSessions: [
        {
          sessionId: "sess-alert",
          title: "Investigate timeout",
          sourceType: "codex",
          events: 20,
          tokens: 12_000,
          estimatedUsd: 0.035,
          knownTokenTotal: 12_000,
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
      categories: [{ key: "terminal", label: "终端执行", calls: 4, tools: 1 }],
    },
    workspaces: {
      topWorkspaces: [
        {
          cwd: "/Users/me/code/session-observer",
          events: 900,
          sessions: 12,
          tokens: 14_000,
          estimatedUsd: 0.041,
          knownTokenTotal: 14_000,
          alerts: 2,
        },
      ],
    },
    charts: {
      hourly: [
        { time: "2026-04-23T10:00:00.000Z", label: "10:00", events: 2, alerts: 0, prompts: 1, agentMessages: 1, interactions: 2, toolCalls: 0, sessions: 1, tokens: 3000, platforms: [{ key: "codex", total: 3000 }] },
        { time: "2026-04-23T11:00:00.000Z", label: "11:00", events: 4, alerts: 1, prompts: 1, agentMessages: 1, interactions: 2, toolCalls: 1, sessions: 2, tokens: 15000, platforms: [{ key: "codex", total: 9000 }, { key: "claude", total: 6000 }] },
      ],
      daily: [
        { time: "2026-04-22T00:00:00.000Z", label: "04/22", events: 5, alerts: 0, prompts: 1, agentMessages: 1, interactions: 2, toolCalls: 1, sessions: 1, tokens: 6000, estimatedUsd: 0.0175, knownTokenTotal: 6000, platforms: [{ key: "claude", total: 6000 }] },
        { time: "2026-04-23T00:00:00.000Z", label: "04/23", events: 6, alerts: 1, prompts: 2, agentMessages: 2, interactions: 4, toolCalls: 1, sessions: 3, tokens: 12000, estimatedUsd: 0.035, knownTokenTotal: 12000, platforms: [{ key: "codex", total: 12000 }] },
      ],
      dailySessions: [
        { time: "2026-04-22T00:00:00.000Z", label: "04/22", sessions: 1, events: 5, prompts: 1, agentMessages: 1, interactions: 2, toolCalls: 1, tokens: 6000, topWorkspace: { cwd: "/Users/me/docs" } },
        { time: "2026-04-23T00:00:00.000Z", label: "04/23", sessions: 3, events: 6, prompts: 2, agentMessages: 2, interactions: 4, toolCalls: 1, tokens: 12000, topWorkspace: { cwd: "/Users/me/code/session-observer" } },
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
    usageStats: {
      today: { activeDays: 1, sessions: 3, events: 6, prompts: 2, agentMessages: 2, interactions: 4, toolCalls: 1, tokens: 12000, estimatedUsd: 0.035 },
      interactions: {
        prompts: 10,
        agentMessages: 12,
        toolCalls: 9,
        toolResults: 7,
        messages: 22,
        repliesPerPrompt: 1.2,
        toolCallsPerPrompt: 0.9,
        tokensPerPrompt: 1800,
      },
      sessions: {
        total: 32,
        measuredDurationSessions: 28,
        averageDurationMs: 2_700_000,
        medianDurationMs: 1_200_000,
        averagePrompts: 3.2,
        averageToolCalls: 2.8,
        averageEvents: 37.5,
        longest: { sessionId: "sess-active", title: "Active Codex session", sourceType: "codex", cwd: "/Users/me/code/session-observer", durationMs: 10_800_000, prompts: 4, toolCalls: 8, tokens: 12000 },
      },
      cadence: {
        activeDays7: 4,
        activeDays30: 12,
        recent7: { activeDays: 4, sessions: 8, events: 100, prompts: 20, agentMessages: 22, interactions: 42, toolCalls: 16, tokens: 18000, estimatedUsd: 0.0525 },
        previous7: { activeDays: 3, sessions: 6, events: 80, prompts: 15, agentMessages: 16, interactions: 31, toolCalls: 12, tokens: 12000, estimatedUsd: 0.035 },
        sessionChangePercent: 33.3,
        interactionChangePercent: 35.5,
        tokenChangePercent: 50,
        costChangePercent: 50,
        busiestHour: { hour: 11, label: "11:00", events: 40, interactions: 18, tokens: 15000 },
        recentFiveHours: { activeDays: 2, sessions: 2, events: 6, prompts: 2, agentMessages: 2, interactions: 4, toolCalls: 1, tokens: 18000, estimatedUsd: 0.0525 },
      },
      forecast: {
        monthCost: 0.0525,
        projectedMonthCost: 0.1575,
        dailyAverageCost: 0.00525,
        monthTokens: 18000,
        projectedMonthTokens: 54000,
        dayOfMonth: 10,
        daysInMonth: 30,
      },
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
  test.each([
    ["overview", "overview-pulse-v2"],
    ["tokens", "token-ledger-v2"],
  ])("renders a distinct %s workspace composition", (view, layout) => {
    const { container } = render(
      <MantineProvider>
        <ObservabilityWorkspace
          payload={payload}
          view={view}
          activeOverview={{ total: 0, sessions: [], windowMinutes: 30 }}
          onRefresh={() => {}}
        />
      </MantineProvider>,
    );

    expect(container.querySelector(`[data-layout="${layout}"]`)).toBeInTheDocument();
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the V2 overview pulse, activity, runtime, workspace, and tool panels", () => {
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

    expect(screen.getByRole("region", { name: "运行总览工作台" })).toHaveAttribute("data-layout", "overview-pulse-v2");
    expect(screen.getByText("运行健康")).toBeInTheDocument();
    expect(screen.getByText("今日概览")).toBeInTheDocument();
    expect(screen.getByText("今日会话")).toBeInTheDocument();
    expect(screen.getByText("当前活跃")).toBeInTheDocument();
    expect(screen.getByText("今日对话")).toBeInTheDocument();
    expect(screen.getByText("今日 Token")).toBeInTheDocument();
    expect(screen.getByText("今日成本")).toBeInTheDocument();
    expect(screen.getByText("缓存覆盖")).toBeInTheDocument();
    expect(screen.getByText("24 小时负载走势")).toBeInTheDocument();
    expect(screen.getByTestId("overview-activity-chart")).toBeInTheDocument();
    expect(screen.getByText("一年会话活跃度")).toBeInTheDocument();
    expect(screen.getByTestId("daily-session-heatmap")).toBeInTheDocument();
    expect(screen.getByText("活跃率")).toBeInTheDocument();
    expect(screen.getByText("活跃节奏")).toBeInTheDocument();
    expect(screen.getByText("当前连续")).toBeInTheDocument();
    expect(screen.getByText("主要工作区")).toBeInTheDocument();
    expect(screen.getByText("高值日期")).toBeInTheDocument();
    expect(screen.getByText("正在写入的会话")).toBeInTheDocument();
    expect(screen.getAllByText("Active Codex session").length).toBeGreaterThan(0);
    expect(screen.getByText("预计 2,400/h")).toBeInTheDocument();
    expect(screen.getByText("事件 / 分钟")).toBeInTheDocument();
    expect(screen.getByText("Token / 分钟")).toBeInTheDocument();
    expect(screen.getByText("使用统计")).toBeInTheDocument();
    expect(screen.getByText("累计提问")).toBeInTheDocument();
    expect(screen.getByText("中位会话跨度")).toBeInTheDocument();
    expect(screen.getByText("近 7 天节奏")).toBeInTheDocument();
    expect(screen.getByText("最近 5 小时")).toBeInTheDocument();
    expect(screen.getByText("工作方式")).toBeInTheDocument();
    expect(screen.queryByText("/Users/me/.codex/sessions")).not.toBeInTheDocument();
    expect(screen.getByText("服务与数据源")).toBeInTheDocument();
    expect(screen.getByText("进程 RSS")).toBeInTheDocument();
    expect(screen.getByText("数据延迟")).toBeInTheDocument();
    expect(screen.getByText("缓存复用")).toBeInTheDocument();
    expect(screen.getByText("监控文件")).toBeInTheDocument();
    expect(screen.getAllByText("135.8 MB").length).toBeGreaterThan(0);
    expect(screen.getByText("工作区负载")).toBeInTheDocument();
    expect(screen.getByText("工具调用结构")).toBeInTheDocument();
    expect(screen.getByText("今日负载")).toBeInTheDocument();
    expect(screen.getByText("每会话调用")).toBeInTheDocument();
    expect(screen.getAllByText("Shell").length).toBeGreaterThan(0);
    expect(screen.queryByText("Trace Span")).not.toBeInTheDocument();
    expect(screen.queryByText("观测覆盖")).not.toBeInTheDocument();
    expect(screen.queryByText("按天 Token 趋势")).not.toBeInTheDocument();
  });

  test("switches the daily session heatmap color metric", () => {
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

    const heatmap = screen.getByTestId("daily-session-heatmap");
    expect(within(heatmap).getByText("颜色依据：每日会话数")).toBeInTheDocument();
    expect(within(heatmap).getByText("4 次会话")).toBeInTheDocument();

    const metricGroup = within(heatmap).getByRole("radiogroup", { name: "切换热度图指标" });
    fireEvent.click(within(metricGroup).getByLabelText("对话"));
    expect(within(heatmap).getByText("颜色依据：每日提问与 Agent 消息数")).toBeInTheDocument();
    expect(within(heatmap).getByText("6 条消息")).toBeInTheDocument();

    fireEvent.click(within(metricGroup).getByLabelText("Token"));

    expect(within(metricGroup).getByLabelText("Token")).toBeChecked();
    expect(within(heatmap).getByText("颜色依据：每日 Token 量")).toBeInTheDocument();
    expect(within(heatmap).getByText("1.8万 Token")).toBeInTheDocument();
    expect(within(heatmap).getByText("Token 峰值")).toBeInTheDocument();
  });

  test("renders the consolidated token ledger, switchable trend, attribution, and sessions", () => {
    render(
      <MantineProvider>
        <ObservabilityWorkspace payload={payload} view="tokens" loading={false} onRefresh={() => {}} />
      </MantineProvider>,
    );

    expect(screen.getByRole("region", { name: "Token 账本工作台" })).toHaveAttribute("data-layout", "token-ledger-v2");
    expect(screen.getByText("Token 构成")).toBeInTheDocument();
    expect(screen.getByText("Prompt 与上下文未命中输入")).toBeInTheDocument();
    expect(screen.getByText("有效 Token")).toBeInTheDocument();
    expect(screen.getAllByText("非缓存输入").length).toBeGreaterThan(0);
    expect(screen.getAllByText("缓存命中").length).toBeGreaterThan(0);
    expect(screen.getAllByText("缓存写入").length).toBeGreaterThan(0);
    expect(screen.getAllByText("输出").length).toBeGreaterThan(0);
    expect(screen.getAllByText("推理输出").length).toBeGreaterThan(0);
    expect(screen.getByText("成本估算")).toBeInTheDocument();
    expect(screen.getAllByText("$0.0525").length).toBeGreaterThan(0);
    expect(screen.getByText("效率指标")).toBeInTheDocument();
    expect(screen.getByText("每会话 Token")).toBeInTheDocument();
    expect(screen.getByText("每会话成本")).toBeInTheDocument();
    expect(screen.getByText("百万 Token 成本")).toBeInTheDocument();
    expect(screen.getByText("缓存读写杠杆")).toBeInTheDocument();
    expect(screen.getByText("月度预测")).toBeInTheDocument();
    expect(screen.getByText("本月已估算")).toBeInTheDocument();
    expect(screen.getByText("月末成本预测")).toBeInTheDocument();
    expect(screen.getByText("模型成本归因")).toBeInTheDocument();
    expect(screen.getAllByText((_, element) => element.textContent.includes("/M")).length).toBeGreaterThan(0);
    expect(screen.getByText("30 天消耗趋势")).toBeInTheDocument();
    expect(screen.getByText("工作区消耗归因")).toBeInTheDocument();
    expect(screen.getByTestId("token-trend-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("token-cost-trend-chart")).not.toBeInTheDocument();
    expect(screen.getByText("当前周期")).toBeInTheDocument();
    expect(screen.getByText("Codex 5,000 · Claude 3,000")).toBeInTheDocument();
    expect(screen.getAllByText("gpt-5.4").length).toBeGreaterThan(0);
    expect(screen.getByText("高消耗会话")).toBeInTheDocument();
    expect(screen.getByText("Investigate timeout")).toBeInTheDocument();
    expect(screen.getAllByText("$0.0350").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("radio", { name: "7 天" }));
    expect(screen.getByText("7 天消耗趋势")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "金额" }));
    expect(screen.getByRole("radio", { name: "金额" })).toBeChecked();
  });
});
