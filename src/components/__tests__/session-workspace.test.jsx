import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SessionWorkspace } from "../session-workspace";

describe("SessionWorkspace", () => {
  test("renders active sessions above the grouped session list", () => {
    const onOpenConversation = vi.fn();

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
    fireEvent.click(screen.getByRole("button", { name: /打开活跃会话 当前项目 UI 调整/ }));
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
});
