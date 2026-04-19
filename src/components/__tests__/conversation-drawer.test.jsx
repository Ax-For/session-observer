import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ConversationDrawer } from "../conversation-drawer";

describe("ConversationDrawer", () => {
  test("renders a conversation timeline instead of raw event cards", () => {
    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Codex rename fix",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={[
            {
              time: "2026-04-19T10:00:00.000Z",
              callType: "Prompt",
              content: "帮我排查为什么会话标题没更新",
            },
            {
              time: "2026-04-19T10:00:01.000Z",
              callType: "Agent",
              content: "我先看会话聚合链路。",
            },
            {
              time: "2026-04-19T10:00:02.000Z",
              callType: "Tool_Call",
              toolName: "Read",
              content: "tool=Read\nargs={\"file_path\":\"/Users/me/code/session-observer/server.js\"}",
              extra: "{\"file_path\":\"/Users/me/code/session-observer/server.js\"}",
            },
            {
              time: "2026-04-19T10:00:03.000Z",
              callType: "Thinking",
              content: "先确认 /api/events 和 /api/sessions 有没有共用元数据覆盖。",
            },
            {
              time: "2026-04-19T10:00:04.000Z",
              callType: "Raw",
              content: "<environment_context>ignore</environment_context>",
            },
            {
              time: "2026-04-19T10:00:05.000Z",
              callType: "Token_Usage",
              content: "token_count",
            },
          ]}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("帮我排查为什么会话标题没更新")).toBeInTheDocument();
    expect(screen.getByText("我先看会话聚合链路。")).toBeInTheDocument();
    expect(screen.getByText("server.js")).toBeInTheDocument();
    expect(screen.getByText("思考过程")).toBeInTheDocument();
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Tool Call")).not.toBeInTheDocument();
    expect(screen.queryByText("token_count")).not.toBeInTheDocument();
    expect(screen.queryByText(/environment_context/i)).not.toBeInTheDocument();
  });

  test("shows progressive loading status and allows manual continuation", () => {
    const onLoadMore = vi.fn();

    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "claude",
            models: ["glm-5"],
            title: "长会话",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          loadingMore={false}
          hasMore
          page={{ loaded: 100, total: 480 }}
          onLoadMore={onLoadMore}
          events={[
            {
              time: "2026-04-19T10:00:00.000Z",
              callType: "Prompt",
              content: "先看第一页",
            },
          ]}
        />
      </MantineProvider>,
    );

    expect(screen.getByText("已加载 100 / 共 480 · 向下滚动加载更多")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "继续加载" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  test("surfaces conversation progress in the drawer header", () => {
    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "claude",
            models: ["glm-5"],
            title: "长会话",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          loadingMore={false}
          hasMore
          page={{ loaded: 100, total: 480 }}
          events={[
            {
              time: "2026-04-19T10:00:00.000Z",
              callType: "Prompt",
              content: "先看第一页",
            },
          ]}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(within(dialog).getByText("会话进度")).toBeInTheDocument();
    expect(within(dialog).getByText("已加载 100 / 共 480 条事件")).toBeInTheDocument();
  });

  test("renders conversation content inside a dedicated fixed-height scroll shell", () => {
    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "claude",
            models: ["glm-5"],
            title: "桌面滚动",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={[
            {
              time: "2026-04-19T10:00:00.000Z",
              callType: "Prompt",
              content: "第一页内容",
            },
          ]}
        />
      </MantineProvider>,
    );

    expect(document.querySelector(".conversation-scroll-shell")).toBeInTheDocument();
  });

  test("renders markdown bodies and json tool parameters in the conversation timeline", () => {
    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          onCopySessionId={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Markdown rendering",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={[
            {
              time: "2026-04-19T10:00:00.000Z",
              callType: "Agent",
              content: "支持 **加粗** 和 `inline code`",
            },
            {
              time: "2026-04-19T10:00:01.000Z",
              callType: "Tool_Call",
              toolName: "Tool",
              content: "tool=Tool\nargs={\"path\":\"/tmp/demo.md\",\"recursive\":true,\"options\":{\"depth\":2}}",
            },
            {
              time: "2026-04-19T10:00:02.000Z",
              callType: "Tool_Result",
              toolName: "Tool",
              content: "## 输出摘要\n\n- 第一项\n- 第二项",
            },
          ]}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(dialog.querySelector(".conv-message-body strong")).toHaveTextContent("加粗");
    expect(dialog.querySelector(".conv-message-body code")).toHaveTextContent("inline code");
    expect(dialog.querySelector(".conv-json .json-token--key")).toHaveTextContent("\"path\"");
    expect(dialog.querySelector(".conv-markdown h2")).toHaveTextContent("输出摘要");
    expect(dialog.querySelectorAll(".conv-markdown li")).toHaveLength(2);
  });

  test("keeps a session id copy action in the conversation header", () => {
    const onCopySessionId = vi.fn();

    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          onCopySessionId={onCopySessionId}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "会话详情",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={[]}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];
    fireEvent.click(within(dialog).getByRole("button", { name: /复制会话 id · 019da544/i }));
    expect(onCopySessionId).toHaveBeenCalledWith("019da544-e133-7b71-9e63-79d2bbba8713");
  });
});
