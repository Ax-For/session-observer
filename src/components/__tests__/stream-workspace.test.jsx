import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StreamWorkspace } from "../stream-workspace";

describe("StreamWorkspace", () => {
  test("renders the stream scope rail, summary cards, session list, and event feed", () => {
    const onOpenSessionDetail = vi.fn();
    const onOpenEvent = vi.fn();

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
            {
              time: "2026-04-19T14:36:11.720Z",
              callType: "Tool_Call",
              sourceType: "codex",
              model: "gpt-5.4",
              sessionId: "sess-1",
              summary: "tool=navigate_page args={\"type\":\"reload\"}",
              extra: "call_id=call-1",
            },
            {
              time: "2026-04-19T14:36:12.720Z",
              callType: "Prompt",
              sourceType: "codex",
              model: "gpt-5.4",
              sessionId: "sess-1",
              summary: "用户输入 · 这里需要突出用户消息",
              extra: "role=user",
            },
            {
              time: "2026-04-19T14:36:13.720Z",
              callType: "Agent",
              sourceType: "codex",
              model: "gpt-5.4",
              sessionId: "sess-1",
              summary: "助手输出 · 我会优先展示对话内容",
              extra: "role=assistant",
            },
          ]}
          selectedSessionId="sess-1"
          onSelectSession={() => {}}
          onClearSessionFocus={() => {}}
          generatedAt="2026-04-19T15:00:00.000Z"
          onOpenFilters={() => {}}
          onOpenEvent={onOpenEvent}
          onOpenSessionDetail={onOpenSessionDetail}
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
    expect(screen.getByText("调用 navigate_page · {\"type\":\"reload\"}")).toBeInTheDocument();
    expect(screen.getByText("用户")).toBeInTheDocument();
    expect(screen.getByText("这里需要突出用户消息")).toBeInTheDocument();
    expect(screen.getAllByText("Agent").length).toBeGreaterThan(0);
    expect(screen.getByText("我会优先展示对话内容")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看会话详情 Incident triage/ }));
    expect(onOpenSessionDetail).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess-1" }));
    fireEvent.click(screen.getAllByRole("button", { name: /查看会话详情 sess-1/ })[0]);
    expect(onOpenSessionDetail).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess-1" }));
    fireEvent.click(screen.getByText("Token usage · In 2.4k · Out 220 · Total 2.6k"));
    expect(onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ callType: "Token_Usage" }));
  });

  test("highlights the submitted search term only in dialogue content", () => {
    const { container } = render(
      <MantineProvider>
        <StreamWorkspace
          scope={{
            title: "全部会话",
            subtitle: "跨平台 · 全部事件 · observe",
            tags: ["token_count"],
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
              totalVisible: 1,
              totalMatching: 1,
              totalLoaded: 1,
              sessions: 1,
            },
            topTypes: [{ key: "Token_Usage", value: 1 }],
            topModels: [{ key: "gpt-5.5", value: 1 }],
            platforms: [{ key: "codex", sessions: 1, events: 1 }],
          }}
          sessions={[
            {
              sessionId: "needle-session",
              title: "Needle count analysis",
              sourceType: "codex",
              latest: "2026-06-01T13:58:02.406Z",
              count: 1,
              totalTokens: 100,
              cwd: "/Users/me/code/needle-workspace",
            },
          ]}
          events={[
            {
              time: "2026-06-01T13:58:02.406Z",
              callType: "Agent",
              sourceType: "codex",
              model: "needle-model",
              sessionId: "needle-session",
              content: "Needle answer from the agent",
              summary: "Needle answer from the agent",
              extra: "needle-extra",
              cwd: "/Users/me/code/needle-workspace",
            },
          ]}
          selectedSessionId=""
          onSelectSession={() => {}}
          onClearSessionFocus={() => {}}
          generatedAt="2026-06-01T13:58:02.406Z"
          onOpenFilters={() => {}}
          onOpenEvent={() => {}}
          onOpenSessionDetail={() => {}}
          searchQuery="needle"
        />
      </MantineProvider>,
    );

    const highlights = [...container.querySelectorAll(".event-search-highlight")].map((node) => node.textContent);
    expect(highlights).toEqual(["Needle"]);
    expect(screen.getByText("Needle count analysis")).toBeInTheDocument();
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

  test("renders compact session rail rows for long active session metadata", () => {
    const longCwd = "/Users/me/code/session-observer/packages/web-frontend-with-a-very-long-path";
    const { container } = render(
      <MantineProvider>
        <StreamWorkspace
          scope={{
            title: "全部会话",
            subtitle: "跨平台 · 全部事件 · observe",
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
              sessionId: "019e5fc9-10b7-7cd3-98f0-6c1c2cbfecad",
              title: "对于当前项目我希望可以显示当前有哪些活跃会话并持续观察布局",
              sourceType: "codex",
              latest: "2026-06-01T13:58:02.406Z",
              count: 4273,
              totalTokens: 166_600_000,
              cwd: longCwd,
            },
          ]}
          events={[]}
          selectedSessionId=""
          onSelectSession={() => {}}
          onClearSessionFocus={() => {}}
          generatedAt="2026-06-01T13:58:02.406Z"
          onOpenFilters={() => {}}
          onOpenEvent={() => {}}
        />
      </MantineProvider>,
    );

    expect(container.querySelector(".session-rail__title-row")).toBeInTheDocument();
    expect(container.querySelectorAll(".session-rail__metric")).toHaveLength(3);
    expect(container.querySelector(".session-rail__path")).toHaveAttribute("title", longCwd);
    expect(screen.getAllByText("019e5fc9").length).toBeGreaterThan(0);
  });

  test("windows the event list instead of rendering every loaded event", () => {
    const events = Array.from({ length: 180 }, (_, index) => ({
      time: `2026-04-19T14:${String(index % 60).padStart(2, "0")}:10.720Z`,
      callType: index % 2 === 0 ? "Tool_Call" : "Token_Usage",
      sourceType: "codex",
      model: "gpt-5.4",
      sessionId: "sess-1",
      summary: index % 2 === 0 ? `tool=exec_command args={"index":${index}}` : `Token usage · Total ${index}`,
      extra: `event-${index}`,
    }));

    const { container } = render(
      <MantineProvider>
        <StreamWorkspace
          scope={{
            title: "全部会话",
            subtitle: "跨平台 · 全部事件 · observe",
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
              totalVisible: 180,
              totalMatching: 180,
              totalLoaded: 180,
              sessions: 1,
            },
            topTypes: [],
            topModels: [],
            platforms: [],
          }}
          sessions={[]}
          events={events}
          selectedSessionId=""
          onSelectSession={() => {}}
          onClearSessionFocus={() => {}}
          generatedAt="2026-04-19T15:00:00.000Z"
          onOpenFilters={() => {}}
          onOpenEvent={() => {}}
        />
      </MantineProvider>,
    );

    expect(container.querySelectorAll(".event-row").length).toBeLessThan(40);
    expect(screen.getByText("当前显示 180 条事件")).toBeInTheDocument();
  });
});
