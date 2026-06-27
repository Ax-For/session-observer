import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { formatDateTime } from "../../lib/formatters";
import { SessionWorkspace } from "../session-workspace";

describe("SessionWorkspace", () => {
  test("renders active sessions above the grouped session list", () => {
    const onOpenConversation = vi.fn();
    const onOpenSessionDetail = vi.fn();

    render(
      <MantineProvider>
        <SessionWorkspace
          activeOverview={{
            total: 2,
            windowMinutes: 30,
            hasMore: true,
            platforms: [
              { key: "codex", sessions: 1 },
              { key: "claude", sessions: 1 },
            ],
            sessions: [
              {
                sessionId: "active-1",
                sourceType: "codex",
                title: "当前项目 UI 调整",
                latest: "2026-05-25T15:30:00.000Z",
                ageMs: 120000,
                count: 42,
                totalTokens: 1200,
                hasTokenData: true,
                cwd: "/Users/me/code/session-observer",
                sourceFiles: [],
                models: ["gpt-5.4"],
              },
            ],
          }}
          sections={[]}
          workspaceIndex={[]}
          selectedIds={[]}
          onToggleSelect={() => {}}
          onOpenConversation={onOpenConversation}
          onOpenSessionDetail={onOpenSessionDetail}
          onFocusWorkspace={() => {}}
          onRename={() => {}}
          onDelete={() => {}}
          onCopySessionId={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("当前活跃")).toBeInTheDocument();
    expect(screen.getByText("最近 30 分钟仍在写入的会话")).toBeInTheDocument();
    expect(screen.getByText("还有 1 个活跃会话")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看活跃会话详情 当前项目 UI 调整/ }));
    expect(onOpenSessionDetail).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "active-1" }));
    fireEvent.click(screen.getByRole("button", { name: /查看活跃会话对话 当前项目 UI 调整/ }));
    expect(onOpenConversation).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "active-1" }));
  });

  test("keeps a session id copy action on session cards", () => {
    const onCopySessionId = vi.fn();
    const onFocusWorkspace = vi.fn();

    render(
      <MantineProvider>
        <SessionWorkspace
          sections={[
            {
              key: "/Users/me/.codex/sessions/2026/04/19/session.jsonl",
              cwd: "/Users/me/.codex/sessions/2026/04/19/session.jsonl",
              label: "/Users/me/.codex/sessions/2026/04/19/session.jsonl",
              groupType: "sourceFile",
              total: 1,
              sessions: [
                {
                  sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
                  sourceType: "codex",
                  title: "优化session-observer",
                  latest: "2026-04-19T18:28:36.000Z",
                  count: 6552,
                  totalTokens: 132100000,
                  cwd: "/Users/me/code/session-observer",
                  sourceFiles: ["/Users/me/.codex/sessions/2026/04/19/session.jsonl"],
                  models: ["gpt-5.4"],
                },
              ],
            },
          ]}
          workspaceIndex={[
            {
              key: "/Users/me/code/session-observer",
              cwd: "/Users/me/code/session-observer",
              sessions: 3,
              events: 6552,
              tokens: 132100000,
            },
          ]}
          selectedIds={[]}
          onToggleSelect={() => {}}
          onOpenConversation={() => {}}
          onFocusWorkspace={onFocusWorkspace}
          onRename={() => {}}
          onDelete={() => {}}
          onCopySessionId={onCopySessionId}
        />
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /复制会话 id · 019da544/i }));
    expect(onCopySessionId).toHaveBeenCalledWith("019da544-e133-7b71-9e63-79d2bbba8713");
    expect(screen.getByText("文件位置")).toBeInTheDocument();
    expect(screen.getAllByText(/session\.jsonl/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /定位工作目录 .*session-observer/i }));
    expect(onFocusWorkspace).toHaveBeenCalledWith("/Users/me/code/session-observer");
  });

  test("shows missing token data distinctly and toggles all ids in a grouped row", () => {
    const onToggleSelect = vi.fn();

    render(
      <MantineProvider>
        <SessionWorkspace
          sections={[
            {
              key: "/Users/me",
              cwd: "/Users/me",
              label: "/Users/me",
              groupType: "cwd",
              total: 1,
              sessions: [
                {
                  sessionId: "newer",
                  sessionIds: ["older", "newer"],
                  sourceType: "claude",
                  title: "这个 npm script 怎么启动",
                  latest: "2026-04-29T13:23:25.806Z",
                  count: 12,
                  totalTokens: 0,
                  hasTokenData: false,
                  groupedCount: 2,
                  cwd: "/Users/me",
                  sourceFiles: [],
                  models: [],
                },
              ],
            },
          ]}
          workspaceIndex={[]}
          selectedIds={[]}
          onToggleSelect={onToggleSelect}
          onOpenConversation={() => {}}
          onFocusWorkspace={() => {}}
          onRename={() => {}}
          onDelete={() => {}}
          onCopySessionId={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getAllByText("Token 未记录").length).toBeGreaterThan(0);
    expect(screen.getByText("2 个原始会话 · 每个约 6 条事件")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 这个 npm script 怎么启动" }));
    expect(onToggleSelect).toHaveBeenCalledWith(["older", "newer"]);
  });

  test("virtualizes large session groups while preserving scroll access", async () => {
    const sessions = Array.from({ length: 80 }, (_, index) => ({
      sessionId: `sess-${index}`,
      sourceType: "codex",
      title: `Session ${index}`,
      latest: `2026-05-31T10:${String(index).padStart(2, "0")}:00.000Z`,
      count: index + 1,
      totalTokens: 1000 + index,
      hasTokenData: true,
      cwd: "/Users/me/code/session-observer",
      sourceFiles: [],
      models: ["gpt-5.4"],
    }));

    render(
      <MantineProvider>
        <SessionWorkspace
          sections={[
            {
              key: "/Users/me/code/session-observer",
              cwd: "/Users/me/code/session-observer",
              label: "/Users/me/code/session-observer",
              groupType: "cwd",
              total: sessions.length,
              sessions,
            },
          ]}
          workspaceIndex={[]}
          selectedIds={[]}
          onToggleSelect={() => {}}
          onOpenConversation={() => {}}
          onFocusWorkspace={() => {}}
          onRename={() => {}}
          onDelete={() => {}}
          onCopySessionId={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Session 0")).toBeInTheDocument();
    expect(screen.queryByText("Session 79")).not.toBeInTheDocument();

    const virtualScroll = document.querySelector(".session-list-virtual-scroll");
    expect(virtualScroll).toBeTruthy();
    Object.defineProperty(virtualScroll, "scrollTop", { value: 8200, configurable: true });
    fireEvent.scroll(virtualScroll);

    await waitFor(() => {
      expect(screen.getByText("Session 79")).toBeInTheDocument();
    });
  });

  test("renders a rich selected session detail panel", () => {
    const onOpenEvent = vi.fn();
    const onOpenConversation = vi.fn();
    const onFocusStreamSession = vi.fn();
    const onClearSessionFocus = vi.fn();

    const { container } = render(
      <MantineProvider>
        <SessionWorkspace
          selectedSessionId="sess-1"
          detailSession={{
            sessionId: "sess-1",
            sourceType: "codex",
            title: "Session detail work",
            latest: "2026-05-31T10:10:00.000Z",
            count: 4,
            totalTokens: 4200,
            hasTokenData: true,
            cwd: "/Users/me/code/session-observer",
            sourceFiles: ["/Users/me/.codex/sessions/detail.jsonl"],
            models: ["gpt-5.4"],
          }}
          detailEvents={[
            {
              time: "2026-05-31T10:00:00.000Z",
              callType: "Prompt",
              sourceType: "codex",
              model: "gpt-5.4",
              sessionId: "sess-1",
              summary: "用户输入 · 改造详情页",
            },
            {
              time: "2026-05-31T10:01:00.000Z",
              callType: "Agent",
              sourceType: "codex",
              model: "gpt-5.4",
              sessionId: "sess-1",
              summary: "Agent 回复 · 已补充详情布局",
            },
            {
              time: "2026-05-31T10:01:01.000Z",
              callType: "Agent",
              sourceType: "codex",
              model: "gpt-5.4",
              sessionId: "sess-1",
              summary: "Agent 回复 · 已补充详情布局",
            },
            {
              time: "2026-05-31T10:02:00.000Z",
              callType: "Tool_Call",
              sourceType: "codex",
              model: "gpt-5.4",
              sessionId: "sess-1",
              toolName: "exec_command",
              summary: "tool=exec_command args={\"cmd\":\"npm test\"}",
            },
            {
              time: "2026-05-31T10:04:00.000Z",
              callType: "Token_Usage",
              sourceType: "codex",
              model: "gpt-5.4",
              sessionId: "sess-1",
              summary: "Token usage",
              tokenUsage: {
                input: 3000,
                output: 500,
                total: 3500,
                cachedInput: 1200,
                cacheCreationInput: 100,
                reasoningOutput: 200,
              },
            },
          ]}
          detailPage={{ total: 5, hasMore: false, nextOffset: 5, limit: 500 }}
          detailLoading={false}
          sections={[]}
          workspaceIndex={[]}
          selectedIds={[]}
          onToggleSelect={() => {}}
          onOpenConversation={onOpenConversation}
          onOpenSessionDetail={() => {}}
          onFocusStreamSession={onFocusStreamSession}
          onClearSessionFocus={onClearSessionFocus}
          onFocusWorkspace={() => {}}
          onRename={() => {}}
          onDelete={() => {}}
          onCopySessionId={() => {}}
          onOpenEvent={onOpenEvent}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("Session detail work")).toBeInTheDocument();
    expect(screen.getByText("Token 构成")).toBeInTheDocument();
    expect(screen.getByText("事件类型")).toBeInTheDocument();
    expect(screen.getByText("工具调用")).toBeInTheDocument();
    expect(screen.getByText("模型分布")).toBeInTheDocument();
    expect(screen.getByText("对话内容")).toBeInTheDocument();
    expect(screen.getAllByText(/用户输入 · 改造详情页/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Agent 回复 · 已补充详情布局/).length).toBeGreaterThan(0);
    const previewTexts = [...container.querySelectorAll(".session-detail-conversation__item p")].map((node) => node.textContent);
    expect(previewTexts.filter((text) => text.includes("Agent 回复 · 已补充详情布局"))).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "收起会话内容" }));
    expect(container.querySelectorAll(".session-detail-conversation__item")).toHaveLength(0);
    expect(screen.getByText("对话内容已折叠")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开完整对话" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开会话内容" }));
    expect(container.querySelectorAll(".session-detail-conversation__item").length).toBeGreaterThan(0);
    expect(screen.getByText("最近事件")).toBeInTheDocument();
    expect(screen.getByText("exec_command")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开完整对话" }));
    expect(onOpenConversation).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess-1" }));
    fireEvent.click(screen.getByRole("button", { name: "在事件流聚焦当前会话" }));
    expect(onFocusStreamSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "sess-1" }));
    fireEvent.click(screen.getByRole("button", { name: "取消当前会话聚焦" }));
    expect(onClearSessionFocus).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /Token usage/ }));
    expect(onOpenEvent).toHaveBeenCalledWith(expect.objectContaining({ callType: "Token_Usage" }));
  });

  test("shows the selected session start time from summary data before events are loaded", () => {
    render(
      <MantineProvider>
        <SessionWorkspace
          selectedSessionId="sess-start"
          detailSession={{
            sessionId: "sess-start",
            sourceType: "codex",
            title: "Session start time",
            startedAt: "2026-05-30T08:15:00.000Z",
            latest: "2026-06-01T10:10:00.000Z",
            count: 12,
            totalTokens: 1200,
            hasTokenData: true,
            cwd: "/Users/me/code/session-observer",
            sourceFiles: ["/Users/me/.codex/sessions/start.jsonl"],
            models: ["gpt-5.4"],
          }}
          detailEvents={[]}
          detailPage={{ total: 12, hasMore: true, nextOffset: 0, limit: 500 }}
          detailLoading={false}
          sections={[]}
          workspaceIndex={[]}
          selectedIds={[]}
          onToggleSelect={() => {}}
          onOpenConversation={() => {}}
          onOpenSessionDetail={() => {}}
          onFocusWorkspace={() => {}}
          onRename={() => {}}
          onDelete={() => {}}
          onCopySessionId={() => {}}
        />
      </MantineProvider>,
    );

    expect(screen.getAllByText("开始时间").length).toBeGreaterThan(0);
    expect(screen.getByText(formatDateTime("2026-05-30T08:15:00.000Z"))).toBeInTheDocument();
  });
});
