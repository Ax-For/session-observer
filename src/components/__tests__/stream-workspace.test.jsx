import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
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
          onOpenFilters={() => {}}
          onOpenEvent={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByRole("heading", { name: "Incident triage" })).toBeInTheDocument();
    expect(screen.getByText("Codex · 告警视图 · observe")).toBeInTheDocument();
    expect(screen.getByText("观测总览")).toBeInTheDocument();
    expect(screen.getByText("平台分布")).toBeInTheDocument();
    expect(screen.getByText("事件构成")).toBeInTheDocument();
    expect(screen.getByText("模型焦点")).toBeInTheDocument();
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
    expect(screen.getAllByText("60").length).toBeGreaterThan(0);
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
  });
});
