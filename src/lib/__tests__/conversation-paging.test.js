import { describe, expect, test } from "vitest";
import {
  CONVERSATION_PAGE_LIMIT,
  createEmptyConversationPage,
  mergeConversationPage,
  sliceConversationPage,
} from "../conversation-paging";

describe("conversation-paging", () => {
  test("sliceConversationPage returns only the requested window", () => {
    const allEvents = Array.from({ length: CONVERSATION_PAGE_LIMIT + 25 }, (_, index) => ({
      id: index + 1,
      callType: "Agent",
      content: `event-${index + 1}`,
    }));

    const result = sliceConversationPage(allEvents, 0, CONVERSATION_PAGE_LIMIT);

    expect(result.events).toHaveLength(CONVERSATION_PAGE_LIMIT);
    expect(result.events[0].content).toBe("event-1");
    expect(result.events.at(-1).content).toBe(`event-${CONVERSATION_PAGE_LIMIT}`);
    expect(result.page).toEqual({
      total: CONVERSATION_PAGE_LIMIT + 25,
      loaded: CONVERSATION_PAGE_LIMIT,
      nextOffset: CONVERSATION_PAGE_LIMIT,
      hasMore: true,
    });
  });

  test("mergeConversationPage appends later batches and tracks total progress", () => {
    const initial = mergeConversationPage([], createEmptyConversationPage(), [
      { id: 1, content: "one" },
      { id: 2, content: "two" },
    ], { total: 5, replace: true });

    const appended = mergeConversationPage(initial.events, initial.page, [
      { id: 3, content: "three" },
      { id: 4, content: "four" },
      { id: 5, content: "five" },
    ], { total: 5 });

    expect(appended.events.map((item) => item.content)).toEqual(["one", "two", "three", "four", "five"]);
    expect(appended.page).toEqual({
      total: 5,
      loaded: 5,
      nextOffset: 5,
      hasMore: false,
    });
  });
});
