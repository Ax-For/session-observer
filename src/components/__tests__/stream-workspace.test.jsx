import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StreamWorkspace } from "../stream-workspace";

describe("StreamWorkspace", () => {
  test("renders the stream scope rail, summary cards, session list, and event feed", () => {
    render(
      <MantineProvider>
        <StreamWorkspace
          scope={{
            title: "Incident triage",
            subtitle: "Codex · 告警视图 · observe",
            tags: ["incident", "/Users/me/code/session-observer"],
          }}
          summary={{
            totals: {
              input: 2400,
              output: 220,
              total: 2620,
              cachedInput: 1200,
              reasoningOutput: 80,
            },
            tokenWindows: {
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
            },
            counts: {
              totalVisible: 44760,
              totalMatching: 320,
              totalLoaded: 250,
              sessions: 31,
            },
            topTypes: [
              { key: "Token_Usage", value: 60 },
              { key: "Tool_Call", value: 40 },
            ],
            topModels: [
              { key: "gpt-5.4", value: 10 },
              { key: "glm-5", value: 6 },
            ],
            platforms: [
              { key: "codex", sessions: 12, events: 8437 },
              { key: "claude", sessions: 19, events: 36323 },
            ],
          }}
          sessions={[
            {
              sessionId: "sess-1",
              title: "Incident triage",
              sessionTitle: "Incident triage",
              sourceType: "codex",
              latest: "2026-04-19T14:36:10.720Z",
              count: 44,
              totalTokens: 2620,
              cwd: "/Users/me/code/session-observer",
            },
          ]}
          events={[
            {
              time: "2026-04-19T14:36:10.720Z",
              callType: "Token_Usage",
              sourceType: "codex",
              model: "gpt-5.4",
              sessionId: "sess-1",
              summary: "Token usage · In 2.4k · Out 220 · Total 2.6k",
              extra: "token_count",
            },
          ]}
          selectedSessionId="sess-1"
          onSelectSession={() => {}}
          onClearSessionFocus={() => {}}
          generatedAt="2026-04-19T15:00:00.000Z"
          onOpenFilters={() => {}}
          onOpenEvent={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: "Incident triage" })).toBeInTheDocument();
    expect(screen.getByText("Codex · 告警视图 · observe")).toBeInTheDocument();
    expect(screen.getByText("观测总览")).toBeInTheDocument();
    expect(screen.getByText("平台分布")).toBeInTheDocument();
    expect(screen.getByText("观测上下文")).toBeInTheDocument();
    expect(screen.getByText("模型焦点")).toBeInTheDocument();
    expect(screen.getByText("时间消耗")).toBeInTheDocument();
    expect(screen.getByText("当前聚焦")).toBeInTheDocument();
    expect(screen.getByText("Incident triage · sess-1")).toBeInTheDocument();
    expect(screen.getByText("搜索关键词")).toBeInTheDocument();
    expect(screen.getAllByText("incident").length).toBeGreaterThan(0);
    expect(screen.getByText("工作区范围")).toBeInTheDocument();
    expect(screen.getAllByText("/Users/me/code/session-observer").length).toBeGreaterThan(0);
    expect(screen.getByText("最近刷新")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "返回全部会话" }).length).toBeGreaterThan(0);
    expect(screen.getByText("今日 Token")).toBeInTheDocument();
    expect(screen.getByText("本周 Token")).toBeInTheDocument();
    expect(screen.getByText("Claude Code 2,000")).toBeInTheDocument();
    expect(screen.getByText("Codex 1,200")).toBeInTheDocument();
    expect(screen.getByText("合计 8,400")).toBeInTheDocument();
    expect(screen.getAllByText("匹配 320").length).toBeGreaterThan(0);
    expect(screen.getAllByText("已加载 250 / 320").length).toBeGreaterThan(0);
    expect(screen.getByText("会话 31")).toBeInTheDocument();
    expect(screen.getByText("2,620")).toBeInTheDocument();
    expect(screen.getByText("总计 2,620 Tok")).toBeInTheDocument();
    expect(screen.getByText("缓存 1,200")).toBeInTheDocument();
    expect(screen.getByText("推理 80")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("8,437 事件")).toBeInTheDocument();
    expect(screen.getByText("12 会话")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("36,323 事件")).toBeInTheDocument();
    expect(screen.getByText("19 会话")).toBeInTheDocument();
    expect(screen.getAllByText("Token Usage").length).toBeGreaterThan(0);
    expect(screen.getAllByText("gpt-5.4").length).toBeGreaterThan(0);
    expect(screen.getByText("Token usage · In 2.4k · Out 220 · Total 2.6k")).toBeInTheDocument();
  });

  test("formats large token metrics with chinese units in the overview panel", () => {
    render(
      <MantineProvider>
        <StreamWorkspace
          scope={{
            title: "全部会话",
            subtitle: "跨平台 · 全部事件 · observe",
            tags: [],
          }}
          summary={{
            totals: {
              input: 1_049_900_000,
              output: 3_000_000,
              total: 1_053_342_339,
              cachedInput: 1_186_200_000,
              reasoningOutput: 503_200,
            },
            tokenWindows: {
              day: {
                total: 8_377_300,
                platforms: [
                  { key: "codex", total: 6_100_000 },
                  { key: "claude", total: 2_277_300 },
                ],
              },
              week: {
                total: 12_560_000,
                platforms: [
                  { key: "codex", total: 9_200_000 },
                  { key: "claude", total: 3_360_000 },
                ],
              },
            },
            counts: {
              totalVisible: 46_738,
              totalMatching: 46_738,
              totalLoaded: 250,
              sessions: 31,
            },
            topTypes: [{ key: "Tool_Call", value: 77 }],
            topModels: [{ key: "glm-5", value: 15 }],
            platforms: [{ key: "claude", sessions: 19, events: 36_323 }],
          }}
          sessions={[]}
          events={[]}
          selectedSessionId=""
          onSelectSession={() => {}}
          onClearSessionFocus={() => {}}
          generatedAt="2026-04-20T00:00:00.000Z"
          onOpenFilters={() => {}}
          onOpenEvent={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("10.53亿")).toBeInTheDocument();
    expect(screen.getByText("输入 10.5亿")).toBeInTheDocument();
    expect(screen.getByText("输出 300万")).toBeInTheDocument();
    expect(screen.getByText("缓存 11.86亿")).toBeInTheDocument();
    expect(screen.getByText("推理 50.32万")).toBeInTheDocument();
    expect(screen.getByText("合计 837.73万")).toBeInTheDocument();
    expect(screen.getByText("Codex 610万")).toBeInTheDocument();
    expect(screen.getByText("Claude Code 227.73万")).toBeInTheDocument();
    expect(screen.getByText("合计 1256万")).toBeInTheDocument();
  });

  test("offers a clear action when a session focus is active", () => {
    const onClearSessionFocus = vi.fn();

    render(
      <MantineProvider>
        <StreamWorkspace
          scope={{
            title: "Incident triage",
            subtitle: "Codex · 告警视图 · observe",
            tags: [],
          }}
          summary={{
            totals: {
              input: 0,
              output: 0,
              total: 0,
              cachedInput: 0,
              reasoningOutput: 0,
            },
            tokenWindows: {
              day: { total: 0, platforms: [] },
              week: { total: 0, platforms: [] },
            },
            counts: {
              totalVisible: 10,
              totalMatching: 10,
              totalLoaded: 10,
              sessions: 1,
            },
            topTypes: [],
            topModels: [],
            platforms: [],
          }}
          sessions={[
            {
              sessionId: "sess-1",
              title: "Incident triage",
              sessionTitle: "Incident triage",
              sourceType: "codex",
              latest: "2026-04-19T14:36:10.720Z",
              count: 10,
              totalTokens: 0,
              cwd: "/Users/me/code/session-observer",
            },
          ]}
          events={[]}
          selectedSessionId="sess-1"
          onSelectSession={() => {}}
          onClearSessionFocus={onClearSessionFocus}
          generatedAt="2026-04-19T15:00:00.000Z"
          onOpenFilters={() => {}}
          onOpenEvent={() => {}}
        />
      </MantineProvider>,
    );

    const clearButtons = screen.getAllByRole("button", { name: "返回全部会话" });
    fireEvent.click(clearButtons[clearButtons.length - 1]);
    expect(onClearSessionFocus).toHaveBeenCalledTimes(1);
  });
});
