export const CONVERSATION_PAGE_LIMIT = 1000;

export function createEmptyConversationPage() {
  return {
    total: 0,
    loaded: 0,
    nextOffset: 0,
    hasMore: false,
  };
}

export function sliceConversationPage(allEvents = [], offset = 0, limit = CONVERSATION_PAGE_LIMIT) {
  const total = Array.isArray(allEvents) ? allEvents.length : 0;
  const normalizedOffset = Math.max(0, Number(offset) || 0);
  const normalizedLimit = Math.max(1, Number(limit) || CONVERSATION_PAGE_LIMIT);
  const events = allEvents.slice(normalizedOffset, normalizedOffset + normalizedLimit);
  const loaded = normalizedOffset + events.length;

  return {
    events,
    page: {
      total,
      loaded,
      nextOffset: loaded,
      hasMore: loaded < total,
    },
  };
}

export function mergeConversationPage(currentEvents = [], currentPage = createEmptyConversationPage(), incomingEvents = [], options = {}) {
  const { total, replace = false } = options;
  const events = replace ? [...incomingEvents] : [...currentEvents, ...incomingEvents];
  const fallbackTotal = Number(currentPage?.total) || 0;
  const normalizedTotal = Number.isFinite(Number(total))
    ? Math.max(events.length, Number(total))
    : Math.max(events.length, fallbackTotal);

  return {
    events,
    page: {
      total: normalizedTotal,
      loaded: events.length,
      nextOffset: events.length,
      hasMore: events.length < normalizedTotal,
    },
  };
}
