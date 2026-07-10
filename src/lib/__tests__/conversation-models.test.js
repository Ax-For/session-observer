import { describe, expect, test } from "vitest";
import {
  buildConversationEntries,
  buildConversationTurns,
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

  test("buildConversationEntries removes duplicate semantic dialogue messages", () => {
    const entries = buildConversationEntries([
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
    ]);

    expect(entries.filter((entry) => entry.kind === "message" && entry.role === "agent")).toHaveLength(1);
    expect(entries.map((entry) => entry.content)).toEqual([
      "帮我检查对话详情为什么重复",
      "我会先检查完整对话的数据来源。",
    ]);
  });

  test("buildConversationEntries preserves repeated dialogue across separate turns", () => {
    const entries = buildConversationEntries([
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Prompt",
        content: "先总结当前问题",
      },
      {
        time: "2026-04-19T10:00:01.000Z",
        callType: "Agent",
        content: "当前问题是对话详情重复。",
      },
      {
        time: "2026-04-19T10:01:00.000Z",
        callType: "Prompt",
        content: "再总结一次当前问题",
      },
      {
        time: "2026-04-19T10:01:01.000Z",
        callType: "Agent",
        content: "当前问题是对话详情重复。",
      },
    ]);

    expect(entries.filter((entry) => entry.kind === "message" && entry.role === "agent")).toHaveLength(2);
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

  test("buildConversationTurns groups messages and tool activity by user turn", () => {
    const turns = buildConversationTurns([
      {
        time: "2026-04-19T10:00:00.000Z",
        callType: "Prompt",
        content: "第一轮问题",
      },
      {
        time: "2026-04-19T10:00:01.000Z",
        callType: "Agent",
        content: "先看文件。",
      },
      {
        time: "2026-04-19T10:00:02.000Z",
        callType: "Tool_Call",
        toolName: "Read",
        content: "tool=Read\nargs={\"file_path\":\"/repo/server.js\"}",
        extra: "{\"file_path\":\"/repo/server.js\"}",
      },
      {
        time: "2026-04-19T10:00:03.000Z",
        callType: "Tool_Result",
        toolName: "Tool",
        content: "Process exited with code 1\nError: failed",
      },
      {
        time: "2026-04-19T10:00:04.000Z",
        callType: "Thinking",
        content: "错误需要解释给用户",
      },
      {
        time: "2026-04-19T10:00:05.000Z",
        callType: "Prompt",
        content: "第二轮问题",
      },
      {
        time: "2026-04-19T10:00:06.000Z",
        callType: "Agent",
        content: "继续处理。",
      },
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({
      index: 1,
      userMessages: [expect.objectContaining({ content: "第一轮问题" })],
      assistantMessages: [expect.objectContaining({ content: "先看文件。" })],
      thinkingEntries: [expect.objectContaining({ content: "错误需要解释给用户" })],
      toolSummary: {
        total: 2,
        errors: 1,
        labels: ["Read", "Tool"],
      },
    });
    expect(turns[0].toolEntries.map((entry) => entry.toolName)).toEqual(["Read", "Tool"]);
    expect(turns[1]).toMatchObject({
      index: 2,
      userMessages: [expect.objectContaining({ content: "第二轮问题" })],
      assistantMessages: [expect.objectContaining({ content: "继续处理。" })],
      toolSummary: {
        total: 0,
        errors: 0,
        labels: [],
      },
    });
  });
});
