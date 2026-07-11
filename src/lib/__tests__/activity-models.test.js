import { describe, expect, test } from "vitest";
import {
  buildActivityRuns,
  buildSessionArtifacts,
  buildSessionPresentation,
  filterActivityRuns,
} from "../activity-models";

describe("activity models", () => {
  const events = [
    {
      eventId: "prompt-1",
      time: "2026-07-11T08:00:00.000Z",
      sessionId: "session-1",
      sourceType: "codex",
      callType: "Prompt",
      content: "检查事件流交互",
      model: "gpt-5.5",
    },
    {
      eventId: "tool-1",
      time: "2026-07-11T08:00:02.000Z",
      sessionId: "session-1",
      sourceType: "codex",
      callType: "Tool_Call",
      toolName: "Read",
      content: "tool=Read\nargs={\"file_path\":\"/repo/src/app.jsx\"}",
      model: "gpt-5.5",
    },
    {
      eventId: "agent-1",
      time: "2026-07-11T08:00:05.000Z",
      sessionId: "session-1",
      sourceType: "codex",
      callType: "Agent",
      content: "已经定位到事件流组件。",
      model: "gpt-5.5",
    },
    {
      eventId: "token-1",
      time: "2026-07-11T08:00:06.000Z",
      sessionId: "session-1",
      sourceType: "codex",
      callType: "Token_Usage",
      tokenUsage: { input: 1000, cacheReadInput: 700, output: 120, total: 1820 },
      model: "gpt-5.5",
    },
    {
      eventId: "prompt-2",
      time: "2026-07-11T08:01:00.000Z",
      sessionId: "session-1",
      sourceType: "codex",
      callType: "Prompt",
      content: "继续优化会话页",
      model: "gpt-5.5",
    },
    {
      eventId: "agent-2",
      time: "2026-07-11T08:01:04.000Z",
      sessionId: "session-1",
      sourceType: "codex",
      callType: "Agent",
      content: "会话页已改成统一详情。",
      model: "gpt-5.6-sol",
    },
    {
      eventId: "raw-2",
      time: "2026-07-11T08:01:05.000Z",
      sessionId: "session-1",
      sourceType: "codex",
      callType: "Raw",
      content: "internal event",
      model: "gpt-5.6-sol",
    },
  ];

  test("groups flat events into user initiated runs and keeps token usage as run metadata", () => {
    const runs = buildActivityRuns(events, [{
      sessionId: "session-1",
      title: "Session Observer V2",
    }]);

    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      sessionId: "session-1",
      title: "Session Observer V2",
      userPreview: "继续优化会话页",
      assistantPreview: "会话页已改成统一详情。",
      eventCount: 3,
    });
    expect(runs[1]).toMatchObject({
      userPreview: "检查事件流交互",
      assistantPreview: "已经定位到事件流组件。",
      toolCalls: 1,
      tokenTotal: 1820,
    });
  });

  test("filters semantic activity without expanding raw token events back into rows", () => {
    const runs = buildActivityRuns(events);

    expect(filterActivityRuns(runs, "activity")).toHaveLength(2);
    expect(filterActivityRuns(runs, "dialogue")).toHaveLength(2);
    expect(filterActivityRuns(runs, "tools")).toHaveLength(1);
    expect(filterActivityRuns(runs, "usage")).toHaveLength(1);
  });

  test("keeps full-session totals stable while describing the loaded raw window separately", () => {
    const presentation = buildSessionPresentation({
      sessionId: "session-1",
      count: 25_424,
      startedAt: "2026-05-25T15:38:00.000Z",
      latest: "2026-07-11T08:01:05.000Z",
      prompt: 181,
      agent: 632,
      aggregateToken: {
        input: 35_000_000,
        cacheReadInput: 600_000_000,
        output: 4_500_000,
        total: 639_500_000,
      },
      models: ["gpt-5.5", "gpt-5.6-sol"],
    }, events, { total: 501, hasMore: true });

    expect(presentation.eventCount).toBe(25_424);
    expect(presentation.loadedEventCount).toBe(events.length);
    expect(presentation.rawWindowTotal).toBe(501);
    expect(presentation.tokens.total).toBe(639_500_000);
    expect(presentation.userEvents).toBe(181);
    expect(presentation.agentEvents).toBe(632);
    expect(presentation.first).toBe("2026-05-25T15:38:00.000Z");
  });

  test("prefers bounded session summaries and derives tool/file details from the loaded window", () => {
    const artifacts = buildSessionArtifacts({
      firstUserMessage: "把事件流改成按回合展示",
      latestAgentMessage: "已完成统一详情页",
      latestUserMessage: "继续优化会话页",
      editedFiles: ["/repo/src/app.jsx"],
      topTools: [{ key: "apply_patch", calls: 8 }],
      toolErrors: 2,
      compactions: 1,
      modelTimeline: [
        { model: "gpt-5.5", time: "2026-07-11T08:00:00.000Z" },
        { model: "gpt-5.6-sol", time: "2026-07-11T08:01:00.000Z" },
      ],
    }, events);

    expect(artifacts.goal).toBe("把事件流改成按回合展示");
    expect(artifacts.outcome).toBe("已完成统一详情页");
    expect(artifacts.editedFiles).toContain("/repo/src/app.jsx");
    expect(artifacts.tools[0]).toEqual({ key: "apply_patch", calls: 8 });
    expect(artifacts.toolErrors).toBe(2);
    expect(artifacts.compactions).toBe(1);
    expect(artifacts.modelTimeline).toHaveLength(2);
  });
});
