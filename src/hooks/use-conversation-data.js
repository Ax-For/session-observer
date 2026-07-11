import { startTransition, useCallback, useRef, useState } from "react";
import { apiClient } from "../api/client";
import {
  CONVERSATION_PAGE_LIMIT,
  createEmptyConversationPage,
  mergeConversationPage,
  sliceConversationPage,
} from "../lib/conversation-paging";

export function useConversationData({ dataSource, localEvents, notify }) {
  const conversationRequestId = useRef(0);
  const conversationEventsRef = useRef([]);
  const conversationPageRef = useRef(createEmptyConversationPage());
  const conversationLocalSource = useRef([]);
  const [conversationSession, setConversationSession] = useState(null);
  const [conversationEvents, setConversationEvents] = useState([]);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationLoadingMore, setConversationLoadingMore] = useState(false);
  const [conversationPage, setConversationPage] = useState(createEmptyConversationPage());

  const commitConversationChunk = useCallback((nextEvents, total, options = {}) => {
    const merged = mergeConversationPage(
      conversationEventsRef.current,
      conversationPageRef.current,
      nextEvents,
      { total, replace: Boolean(options.replace) },
    );
    conversationEventsRef.current = merged.events;
    conversationPageRef.current = merged.page;
    startTransition(() => {
      setConversationEvents(merged.events);
      setConversationPage(merged.page);
    });
  }, []);

  const closeConversation = useCallback(() => {
    conversationRequestId.current += 1;
    conversationLocalSource.current = [];
    conversationEventsRef.current = [];
    conversationPageRef.current = createEmptyConversationPage();
    setConversationSession(null);
    setConversationLoading(false);
    setConversationLoadingMore(false);
    startTransition(() => {
      setConversationEvents([]);
      setConversationPage(createEmptyConversationPage());
    });
  }, []);

  const openConversation = useCallback(async (session) => {
    const requestId = ++conversationRequestId.current;
    conversationLocalSource.current = [];
    conversationEventsRef.current = [];
    conversationPageRef.current = createEmptyConversationPage();
    setConversationSession(session);
    setConversationEvents([]);
    setConversationPage(createEmptyConversationPage());
    setConversationLoadingMore(false);
    setConversationLoading(true);

    if (dataSource !== "server") {
      const allEvents = localEvents
        .filter((event) => event.sessionId === session.sessionId)
        .sort((left, right) => String(left.time).localeCompare(String(right.time)));
      conversationLocalSource.current = allEvents;
      commitConversationChunk(allEvents, allEvents.length, { replace: true });
      setConversationLoading(false);
      return;
    }

    try {
      const payload = await apiClient.fetchEvents({
        sessionId: session.sessionId,
        order: "desc",
        limit: CONVERSATION_PAGE_LIMIT,
        offset: 0,
        mode: "raw",
        summary: 0,
      });
      if (requestId !== conversationRequestId.current) return;
      commitConversationChunk(payload.events || [], Number(payload.totalMatching) || payload.events?.length || 0, { replace: true });
    } catch (error) {
      if (requestId !== conversationRequestId.current) return;
      notify({
        title: "会话加载失败",
        message: String(error.message || error),
        color: "red",
      });
    } finally {
      if (requestId === conversationRequestId.current) setConversationLoading(false);
    }
  }, [commitConversationChunk, dataSource, localEvents, notify]);

  const loadMoreConversation = useCallback(async () => {
    if (!conversationSession || conversationLoading || conversationLoadingMore || !conversationPageRef.current.hasMore) return;

    if (dataSource !== "server") {
      setConversationLoadingMore(true);
      try {
        const nextSlice = sliceConversationPage(
          conversationLocalSource.current,
          conversationPageRef.current.nextOffset,
          CONVERSATION_PAGE_LIMIT,
        );
        commitConversationChunk(nextSlice.events, nextSlice.page.total);
      } finally {
        setConversationLoadingMore(false);
      }
      return;
    }

    const requestId = ++conversationRequestId.current;
    setConversationLoadingMore(true);
    try {
      const payload = await apiClient.fetchEvents({
        sessionId: conversationSession.sessionId,
        order: "desc",
        limit: CONVERSATION_PAGE_LIMIT,
        offset: conversationPageRef.current.nextOffset,
        mode: "raw",
        summary: 0,
      });
      if (requestId !== conversationRequestId.current) return;
      commitConversationChunk(payload.events || [], Number(payload.totalMatching) || payload.events?.length || 0);
    } catch (error) {
      if (requestId !== conversationRequestId.current) return;
      notify({
        title: "继续加载失败",
        message: String(error.message || error),
        color: "red",
      });
    } finally {
      if (requestId === conversationRequestId.current) setConversationLoadingMore(false);
    }
  }, [
    commitConversationChunk,
    conversationLoading,
    conversationLoadingMore,
    conversationSession,
    dataSource,
    notify,
  ]);

  return {
    conversationSession,
    conversationEvents,
    conversationLoading,
    conversationLoadingMore,
    conversationPage,
    openConversation,
    loadMoreConversation,
    closeConversation,
  };
}
