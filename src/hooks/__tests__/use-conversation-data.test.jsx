import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useConversationData } from "../use-conversation-data";

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

function buildLocalEvents(count) {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: "sess-local",
    callType: "Agent",
    content: `message-${index}`,
    time: new Date(Date.UTC(2026, 3, 19, 10, 0, index)).toISOString(),
  }));
}

describe("useConversationData", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("loads local conversation events without forcing scroll pagination", async () => {
    const notify = vi.fn();
    const localEvents = buildLocalEvents(205);

    const { result } = renderHook(() => useConversationData({
      dataSource: "local",
      localEvents,
      notify,
    }));

    await act(async () => {
      await result.current.openConversation({ sessionId: "sess-local", title: "Local session" });
    });

    await waitFor(() => {
      expect(result.current.conversationEvents).toHaveLength(205);
    });
    expect(result.current.conversationPage).toEqual({
      total: 205,
      loaded: 205,
      nextOffset: 205,
      hasMore: false,
    });

    await act(async () => {
      await result.current.loadMoreConversation();
    });

    await waitFor(() => {
      expect(result.current.conversationEvents).toHaveLength(205);
    });
    expect(result.current.conversationPage.hasMore).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  test("does not preload entire large server conversations in the background", async () => {
    const notify = vi.fn();
    const fetchMock = vi.fn(async () => jsonResponse({
      events: buildLocalEvents(400).map((event) => ({ ...event, sessionId: "sess-server" })),
      totalMatching: 5000,
      page: { offset: 0, limit: 400, hasMore: true },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useConversationData({
      dataSource: "server",
      localEvents: [],
      notify,
    }));

    await act(async () => {
      await result.current.openConversation({ sessionId: "sess-server", title: "Large server session" });
    });

    await waitFor(() => {
      expect(result.current.conversationEvents).toHaveLength(400);
    });
    expect(result.current.conversationPage).toEqual({
      total: 5000,
      loaded: 400,
      nextOffset: 400,
      hasMore: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("summary=0");
    expect(fetchMock.mock.calls[0][0]).toContain("order=desc");
    expect(fetchMock.mock.calls[0][0]).toContain("limit=400");
  });

  test("hydrates truncated dialogue messages without expanding tool output", async () => {
    const notify = vi.fn();
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes("/api/events/detail")) {
        return jsonResponse({
          event: {
            eventId: "agent-full",
            callType: "Agent",
            content: "完整回答，包含所有表格行和结论。",
            time: "2026-06-27T07:22:40.307Z",
          },
        });
      }
      return jsonResponse({
        events: [
          {
            eventId: "agent-preview",
            sessionId: "sess-server",
            callType: "Agent",
            content: "回答预览...",
            contentTruncated: true,
            time: "2026-06-27T07:22:40.307Z",
          },
          {
            eventId: "tool-preview",
            sessionId: "sess-server",
            callType: "Tool_Result",
            content: "工具输出预览...",
            contentTruncated: true,
            time: "2026-06-27T07:22:39.000Z",
          },
        ],
        totalMatching: 2,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useConversationData({
      dataSource: "server",
      localEvents: [],
      notify,
    }));

    await act(async () => {
      await result.current.openConversation({ sessionId: "sess-server", title: "Server session" });
    });

    await waitFor(() => {
      expect(result.current.conversationEvents.find((event) => event.callType === "Agent")?.content)
        .toBe("完整回答，包含所有表格行和结论。");
    });
    expect(result.current.conversationEvents.find((event) => event.callType === "Agent")?.contentTruncated).toBeUndefined();
    expect(result.current.conversationEvents.find((event) => event.callType === "Tool_Result")?.content)
      .toBe("工具输出预览...");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain("eventId=agent-preview");
    expect(notify).not.toHaveBeenCalled();
  });
});
