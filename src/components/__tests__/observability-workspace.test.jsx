import { MantineProvider } from "@mantine/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
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
      output: 2000,
      cachedInput: 6000,
      reasoningOutput: 800,
      effectiveTotal: 18_000,
      windows: {
        day: {
          total: 8000,
          platforms: [
            { key: "codex", total: 5000 },
            { key: "claude", total: 3000 },
          ],
        },
        week: {
          total: 18_000,
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
  },
};

describe("ObservabilityWorkspace", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the overview health, source, runtime, workspace, and tool panels", () => {
    render(
      <MantineProvider>
        <ObservabilityWorkspace payload={payload} view="overview" loading={false} onRefresh={() => {}} />
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: "运行总览" })).toBeInTheDocument();
    expect(screen.getByText("事件总量")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("数据源状态")).toBeInTheDocument();
    expect(screen.getByText("按天 Token 趋势")).toBeInTheDocument();
    expect(screen.getByText("平台 Token 占比")).toBeInTheDocument();
    expect(screen.getByText("24h 异常热度")).toBeInTheDocument();
    expect(screen.getByText("/Users/me/.codex/sessions")).toBeInTheDocument();
    expect(screen.getByText("运行健康")).toBeInTheDocument();
    expect(screen.getByText("Codex codex-cli 0.130.0 / Claude 1.0.0")).toBeInTheDocument();
    expect(screen.getByText("高活跃工作区")).toBeInTheDocument();
    expect(screen.getByText("工具调用画像")).toBeInTheDocument();
    expect(screen.getByText("Shell")).toBeInTheDocument();
  });

  test("renders token windows, model ranking, and high-cost sessions", () => {
    render(
      <MantineProvider>
        <ObservabilityWorkspace payload={payload} view="tokens" loading={false} onRefresh={() => {}} />
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: "Token 消耗" })).toBeInTheDocument();
    expect(screen.getByText("近 14 天 Token 消耗趋势")).toBeInTheDocument();
    expect(screen.getByText("平台占比")).toBeInTheDocument();
    expect(screen.getByTestId("token-trend-chart")).toBeInTheDocument();
    expect(screen.getByTestId("platform-donut-chart")).toBeInTheDocument();
    expect(screen.getByText("时间窗口")).toBeInTheDocument();
    expect(screen.getByText("Codex 5,000 · Claude Code 3,000")).toBeInTheDocument();
    expect(screen.getByText("模型消耗")).toBeInTheDocument();
    expect(screen.getByText("gpt-5.4")).toBeInTheDocument();
    expect(screen.getByText("高消耗会话")).toBeInTheDocument();
    expect(screen.getByText("Investigate timeout")).toBeInTheDocument();
  });

  test("renders alert rows and opens the alert stream when selected", () => {
    const onOpenAlertStream = vi.fn();

    render(
      <MantineProvider>
        <ObservabilityWorkspace
          payload={payload}
          view="alerts"
          loading={false}
          onRefresh={() => {}}
          onOpenAlertStream={onOpenAlertStream}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /failed with timeout/ }));

    expect(screen.getByRole("heading", { name: "异常队列" })).toBeInTheDocument();
    expect(screen.getByText("24h 异常热度")).toBeInTheDocument();
    expect(screen.getByText("异常类型分布")).toBeInTheDocument();
    expect(screen.getByText("异常分布")).toBeInTheDocument();
    expect(onOpenAlertStream).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "sess-alert",
      toolName: "Shell",
    }));
  });
});
