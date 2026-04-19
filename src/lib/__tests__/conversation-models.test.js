import { describe, expect, test } from "vitest";
import {
  buildConversationEntries,
  prepareConversationEvents,
} from "../conversation-models";

describe("conversation-models", () => {
  test("prepareConversationEvents filters internal records and cleans visible text", () => {
    const prepared = prepareConversationEvents([
      {
        callType: "Raw",
        content: "<environment_context>secret</environment_context>\n<task-notification>ignore</task-notification>",
      },
      {
        callType: "Prompt",
        content: "<environment_context>secret</environment_context>\n请帮我看下这个报错",
      },
      {
        callType: "Raw",
        content: "{\"type\":\"reasoning\",\"summary\":[]}",
      },
      {
        callType: "Agent",
        content: "[agent=planner]\n先检查构建日志",
      },
      {
        callType: "Thinking",
        content: "先排查最近的变更",
      },
      {
        callType: "Token_Usage",
        content: "token_count",
      },
    ]);

    expect(prepared).toHaveLength(3);
    expect(prepared.map((event) => event.callType)).toEqual(["Prompt", "Agent", "Thinking"]);
    expect(prepared[0].content).toBe("请帮我看下这个报错");
    expect(prepared[1].content).toBe("[agent=planner]\n先检查构建日志");
  });

  test("buildConversationEntries groups semantic messages and tool displays", () => {
    const entries = buildConversationEntries([
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Prompt",
        content: "帮我看下 session title 的问题",
      },
      {
        time: "2026-04-19T10:00:01.000Z",
        callType: "Agent",
        content: "[agent=planner]\n先确认 transcript 里有没有 rename 事件",
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
        callType: "Tool_Result",
        toolName: "Read",
        content: "const PORT = 8787;",
      },
      {
        time: "2026-04-19T10:00:04.000Z",
        callType: "Thinking",
        content: "rename 元数据需要前后端统一覆盖",
      },
    ]);

    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({
      kind: "message",
      role: "user",
      content: "帮我看下 session title 的问题",
    });
    expect(entries[1]).toMatchObject({
      kind: "message",
      role: "agent",
      agentPrefix: "planner",
      content: "先确认 transcript 里有没有 rename 事件",
    });
    expect(entries[2]).toMatchObject({
      kind: "tool",
      toolName: "Read",
      category: "read",
      display: {
        type: "one-line",
        value: "/Users/me/code/session-observer/server.js",
      },
    });
    expect(entries[3]).toMatchObject({
      kind: "thinking",
      content: "rename 元数据需要前后端统一覆盖",
    });
  });

  test("tool results stay collapsible when content merely mentions error handling", () => {
    const entries = buildConversationEntries([
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Tool_Result",
        toolName: "Tool",
        content: "Architecture notes: focus on error handling, testing, and deployment.",
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "tool",
      phase: "result",
      isError: false,
      display: {
        type: "result",
        title: "工具输出",
      },
    });
  });

  test("tool results stay in error mode for actual failing command output", () => {
    const entries = buildConversationEntries([
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Tool_Result",
        toolName: "Tool",
        content: "Chunk ID: deadbeef\nProcess exited with code 1\nOutput:\nError: command failed",
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "tool",
      phase: "result",
      isError: true,
      display: {
        type: "error",
      },
    });
  });

  test("tool call parameters keep a json display model", () => {
    const entries = buildConversationEntries([
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Tool_Call",
        toolName: "Tool",
        content: "tool=Tool\nargs={\"path\":\"/tmp/demo.md\",\"recursive\":true,\"options\":{\"depth\":2}}",
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "tool",
      phase: "input",
      display: {
        type: "json",
        title: "工具参数",
      },
    });
  });

  test("markdown-like tool output is marked for rich rendering", () => {
    const entries = buildConversationEntries([
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Tool_Result",
        toolName: "Tool",
        content: "## 输出摘要\n\n- 第一项\n- 第二项\n\n`inline code`",
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: "tool",
      phase: "result",
      isError: false,
      display: {
        type: "markdown",
        title: "工具输出",
      },
    });
  });
});
