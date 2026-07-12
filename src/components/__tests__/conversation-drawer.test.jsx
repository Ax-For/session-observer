import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ConversationDrawer } from "../conversation-drawer";

describe("ConversationDrawer", () => {
  test("renders image prompts as user text with a compact attachment row", () => {
    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{ sourceType: "codex", title: "Image prompt", sessionId: "sess-image" }}
          loading={false}
          events={[
            {
              time: "2026-07-12T15:38:09.415Z",
              callType: "Prompt",
              sourceLength: 254948,
              content: [
                "# Files mentioned by the user:",
                "",
                "## screenshot.png: /var/folders/private/screenshot.png",
                "",
                "## My request for Codex:",
                "这里的工具调用字体大小还是有问题",
                "<image name=[Image #1] path=\"/var/folders/private/screenshot.png\">",
                "</image>",
              ].join("\n"),
            },
          ]}
        />
      </MantineProvider>,
    );

    const dialog = screen.getAllByRole("dialog", { name: "会话对话" }).at(-1);
    expect(within(dialog).getByText("这里的工具调用字体大小还是有问题")).toBeInTheDocument();
    expect(within(dialog).getByText("screenshot.png")).toBeInTheDocument();
    expect(within(dialog).getByText(/图片附件 · 原始记录/)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent("/var/folders/private");
    expect(dialog).not.toHaveTextContent("Files mentioned by the user");
  });

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

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(screen.getByText("帮我排查为什么会话标题没更新")).toBeInTheDocument();
    expect(screen.getByText("我先看会话聚合链路。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByText("工具活动"));
    expect(screen.getByText("server.js")).toBeInTheDocument();
    expect(screen.getByText(/思考过程/)).toBeInTheDocument();
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
    expect(screen.queryByText("Tool Call")).not.toBeInTheDocument();
    expect(screen.queryByText("token_count")).not.toBeInTheDocument();
    expect(screen.queryByText(/environment_context/i)).not.toBeInTheDocument();
  });

  test("renders duplicate semantic dialogue records only once", () => {
    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Duplicate detail check",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={[
            {
              time: "2026-04-19T10:00:00.000Z",
              callType: "Prompt",
              content: "帮我检查对话详情为什么重复",
            },
            {
              time: "2026-04-19T10:00:01.000Z",
              callType: "Agent",
              content: "我会先检查完整对话的数据来源。",
              extra: "type=event_msg",
            },
            {
              time: "2026-04-19T10:00:01.500Z",
              callType: "Agent",
              content: "我会先检查完整对话的数据来源。",
              extra: "role=assistant",
            },
            {
              time: "2026-04-19T10:00:02.000Z",
              callType: "Agent",
              content: "[agent=planner]\n我会先检查完整对话的数据来源。",
              extra: "role=assistant",
            },
          ]}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(within(dialog).getByText("帮我检查对话详情为什么重复")).toBeInTheDocument();
    expect(within(dialog).getAllByText("我会先检查完整对话的数据来源。")).toHaveLength(1);
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

    expect(screen.getByText("当前仅载入最近 100 / 480 条事件")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "加载更早内容" }));
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
    expect(within(dialog).getByText("已载入最近 100 / 共 480 条事件")).toBeInTheDocument();
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
    fireEvent.click(within(dialog).getByText("工具活动"));
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

  test("groups long conversations into turn navigation and tool activity summaries", () => {
    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Turn reader",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={[
            {
              time: "2026-04-19T10:00:00.000Z",
              callType: "Prompt",
              content: "第一轮：检查会话标题",
            },
            {
              time: "2026-04-19T10:00:01.000Z",
              callType: "Agent",
              content: "我先看数据链路。",
            },
            {
              time: "2026-04-19T10:00:02.000Z",
              callType: "Tool_Call",
              toolName: "Read",
              content: "tool=Read\nargs={\"file_path\":\"/repo/server.js\"}",
            },
            {
              time: "2026-04-19T10:00:03.000Z",
              callType: "Prompt",
              content: "第二轮：继续优化展示",
            },
            {
              time: "2026-04-19T10:00:04.000Z",
              callType: "Agent",
              content: "改成回合阅读器。",
            },
          ]}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(within(dialog).getByText("回合导航")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "回合导航" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "上一轮" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "下一轮" })).toBeDisabled();
    expect(within(dialog).getByText("已渲染 2 / 2 轮")).toBeInTheDocument();
    expect(within(dialog).getByText("拖动定位回合")).toBeInTheDocument();
    expect(within(dialog).getByRole("slider", { name: "拖动定位回合" })).toBeInTheDocument();
    expect(within(dialog).getByText("工具 1")).toBeInTheDocument();
    expect(within(dialog).getByText("工具活动")).toBeInTheDocument();
    expect(within(dialog).getByText("1 项 · Read")).toBeInTheDocument();
  });

  test("limits initially rendered turns and lets users reveal more", () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      time: `2026-04-19T10:${String(index).padStart(2, "0")}:00.000Z`,
      callType: "Prompt",
      content: `第 ${index + 1} 轮问题`,
    }));

    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Many turns",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={events}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(within(dialog).getByText(/已渲染 8 \/ 12 轮/)).toBeInTheDocument();
    expect(within(dialog).getByText("第 12 轮问题")).toBeInTheDocument();
    expect(within(dialog).queryByText("第 4 轮问题")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "显示更早回合" }));
    expect(within(dialog).getByText("第 1 轮问题")).toBeInTheDocument();
    expect(within(dialog).getByText(/已渲染 12 \/ 12 轮/)).toBeInTheDocument();
  });

  test("keeps the rendered turn window bounded when navigating deep into a session", () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      time: `2026-04-19T10:${String(index).padStart(2, "0")}:00.000Z`,
      callType: "Prompt",
      content: `第 ${index + 1} 轮问题`,
    }));

    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Many turns",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={events}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];
    const previousButton = within(dialog).getByRole("button", { name: "上一轮" });

    for (let index = 0; index < 11; index += 1) {
      fireEvent.click(previousButton);
    }

    expect(within(dialog).getByText("第 1 轮问题")).toBeInTheDocument();
    expect(dialog.querySelectorAll(".conversation-turn")).toHaveLength(8);
    expect(within(dialog).getByText(/当前范围 1-8/)).toBeInTheDocument();
  });

  test("searches conversation content and jumps to the matched turn window", () => {
    const events = Array.from({ length: 12 }, (_, index) => ({
      time: `2026-04-19T10:${String(index).padStart(2, "0")}:00.000Z`,
      callType: "Prompt",
      content: index === 1 ? "第 2 轮问题，包含特殊答案" : `第 ${index + 1} 轮问题`,
    }));

    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Search turns",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={events}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(within(dialog).queryByText("第 2 轮问题，包含特殊答案")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "搜索对话内容或回合" }), {
      target: { value: "特殊答案" },
    });

    expect(within(dialog).getByText("命中 1 / 1 · 第 2 轮 · 用户")).toBeInTheDocument();
    expect(within(dialog).getAllByText("第 2 轮问题，包含特殊答案").length).toBeGreaterThanOrEqual(1);
    expect(dialog.querySelector(".conversation-highlight")).toHaveTextContent("特殊答案");
    expect(dialog.querySelectorAll(".conversation-turn")).toHaveLength(8);
    expect(within(dialog).getByText(/当前范围 1-8/)).toBeInTheDocument();
  });

  test("keeps search controls in place when moving between matches", () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    Element.prototype.scrollIntoView = scrollIntoView;
    window.requestAnimationFrame = (callback) => {
      callback();
      return 1;
    };

    try {
      const events = Array.from({ length: 12 }, (_, index) => ({
        time: `2026-04-19T10:${String(index).padStart(2, "0")}:00.000Z`,
        callType: "Prompt",
        content: index === 2 || index === 9 ? `第 ${index + 1} 轮包含 needle` : `第 ${index + 1} 轮问题`,
      }));

      render(
        <MantineProvider>
          <ConversationDrawer
            opened
            onClose={() => {}}
            session={{
              sourceType: "codex",
              models: ["gpt-5.4"],
              title: "Search navigation",
              sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
              cwd: "/Users/me/code/session-observer",
            }}
            loading={false}
            events={events}
          />
        </MantineProvider>,
      );

      const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
      const dialog = dialogs[dialogs.length - 1];
      fireEvent.change(within(dialog).getByRole("textbox", { name: "搜索对话内容或回合" }), {
        target: { value: "needle" },
      });

      fireEvent.click(within(dialog).getByRole("button", { name: "下一处" }));

      expect(within(dialog).getByText("命中 2 / 2 · 第 10 轮 · 用户")).toBeInTheDocument();
      expect(within(dialog).getByRole("textbox", { name: "搜索对话内容或回合" })).toBeInTheDocument();
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      window.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  test("highlights matched tool content and expands the tool activity", () => {
    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Tool search",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={[
            {
              time: "2026-04-19T10:00:00.000Z",
              callType: "Prompt",
              content: "找工具输出",
            },
            {
              time: "2026-04-19T10:00:01.000Z",
              callType: "Tool_Result",
              toolName: "Tool",
              content: "工具输出里包含 needle-value",
            },
          ]}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(within(dialog).queryByText("工具输出里包含 needle-value")).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "搜索对话内容或回合" }), {
      target: { value: "needle-value" },
    });

    expect(within(dialog).getByText("命中 1 / 1 · 第 1 轮 · 工具结果")).toBeInTheDocument();
    expect(dialog.querySelector(".conv-code")).toHaveTextContent("工具输出里包含 needle-value");
    expect(dialog.querySelector(".conversation-highlight")).toHaveTextContent("needle-value");
  });

  test("collapses very long message bodies before markdown rendering", () => {
    const longContent = `${"长内容 ".repeat(500)}\n\n## 不应默认渲染的标题`;

    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Long content",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={[
            {
              time: "2026-04-19T10:00:00.000Z",
              callType: "Prompt",
              content: longContent,
            },
          ]}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(within(dialog).getByText(/内容较长，已显示预览/)).toBeInTheDocument();
    expect(dialog.querySelector(".conv-markdown h2")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "展开完整内容" }));
    expect(dialog.querySelector(".conv-markdown h2")).toHaveTextContent("不应默认渲染的标题");
  });

  test("lazy renders heavy tool details only after expanding the tool activity", () => {
    const events = [
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Prompt",
        content: "定位一个很深的回合",
      },
      ...Array.from({ length: 40 }, (_, index) => ({
        time: `2026-04-19T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
        callType: "Tool_Result",
        toolName: "Tool",
        content: `隐藏工具结果 lazy-secret-${index}`,
      })),
    ];

    render(
      <MantineProvider>
        <ConversationDrawer
          opened
          onClose={() => {}}
          session={{
            sourceType: "codex",
            models: ["gpt-5.4"],
            title: "Heavy tools",
            sessionId: "019da544-e133-7b71-9e63-79d2bbba8713",
            cwd: "/Users/me/code/session-observer",
          }}
          loading={false}
          events={events}
        />
      </MantineProvider>,
    );

    const dialogs = screen.getAllByRole("dialog", { name: "会话对话" });
    const dialog = dialogs[dialogs.length - 1];

    expect(within(dialog).getByText("工具活动")).toBeInTheDocument();
    expect(within(dialog).getByText(/40 项/)).toBeInTheDocument();
    expect(within(dialog).queryByText("隐藏工具结果 lazy-secret-39")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("工具活动"));
    expect(within(dialog).getByText("隐藏工具结果 lazy-secret-39")).toBeInTheDocument();
  });
});
