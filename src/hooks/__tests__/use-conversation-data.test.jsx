import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useConversationData } from "../use-conversation-data";

function buildLocalEvents(count) {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: "sess-local",
    callType: "Agent",
    content: `message-${index}`,
    time: new Date(Date.UTC(2026, 3, 19, 10, 0, index)).toISOString(),
  }));
}

describe("useConversationData", () => {
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
});
