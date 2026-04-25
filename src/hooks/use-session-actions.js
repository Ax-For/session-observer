import { useCallback, useState } from "react";
import { apiClient } from "../api/client";
import { downloadJsonl, formatNumber } from "../lib/formatters";

async function fetchAllSessionEvents(sessionId) {
  const events = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const payload = await apiClient.fetchEvents({
      sessionId,
      order: "asc",
      limit: 1000,
      offset,
      mode: "raw",
    });
    events.push(...payload.events);
    hasMore = Boolean(payload.page?.hasMore);
    offset += Number(payload.page?.limit || 1000);
  }

  return events;
}

export function useSessionActions({ loadSessions, loadEvents, notify }) {
  const [selectedSessionIds, setSelectedSessionIds] = useState([]);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const openRename = useCallback((session) => {
    setRenameTarget(session);
    setRenameValue(session?.title || "");
  }, []);

  const openDelete = useCallback((session) => {
    setDeleteTarget(session);
  }, []);

  const confirmRename = useCallback(async () => {
    if (!renameTarget || !renameValue.trim()) return;
    const nextName = renameValue.trim();
    try {
      await apiClient.renameSession(renameTarget.sessionId, nextName);
      setRenameTarget(null);
      setRenameValue("");
      await loadSessions();
      await loadEvents();
      notify({
        title: "会话已重命名",
        message: nextName,
        color: "blue",
      });
    } catch (error) {
      notify({
        title: "重命名失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }, [loadEvents, loadSessions, notify, renameTarget, renameValue]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await apiClient.deleteSession(deleteTarget.sessionId);
      setDeleteTarget(null);
      setSelectedSessionIds((current) => current.filter((id) => id !== deleteTarget.sessionId));
      await loadSessions();
      await loadEvents();
      notify({
        title: "会话已删除",
        message: deleteTarget.title || deleteTarget.sessionTitle || deleteTarget.fallbackTitle || deleteTarget.sessionId,
        color: "red",
      });
    } catch (error) {
      notify({
        title: "删除失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }, [deleteTarget, loadEvents, loadSessions, notify]);

  const toggleSessionSelection = useCallback((sessionId) => {
    setSelectedSessionIds((current) => (
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId]
    ));
  }, []);

  const clearSessionSelection = useCallback(() => {
    setSelectedSessionIds([]);
  }, []);

  const batchDelete = useCallback(async () => {
    if (selectedSessionIds.length === 0) return;
    const count = selectedSessionIds.length;
    try {
      await apiClient.batchDeleteSessions(selectedSessionIds);
      setSelectedSessionIds([]);
      await loadSessions();
      await loadEvents();
      notify({
        title: "批量删除完成",
        message: `已处理 ${formatNumber(count)} 个会话`,
        color: "red",
      });
    } catch (error) {
      notify({
        title: "批量删除失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }, [loadEvents, loadSessions, notify, selectedSessionIds]);

  const batchExport = useCallback(async () => {
    if (selectedSessionIds.length === 0) return;
    try {
      const chunks = [];
      for (const sessionId of selectedSessionIds) {
        const events = await fetchAllSessionEvents(sessionId);
        chunks.push(...events);
      }
      downloadJsonl(`session-observer-selection-${Date.now()}.jsonl`, chunks);
      notify({
        title: "批量导出完成",
        message: `已导出 ${formatNumber(chunks.length)} 条事件`,
        color: "blue",
      });
    } catch (error) {
      notify({
        title: "批量导出失败",
        message: String(error.message || error),
        color: "red",
      });
    }
  }, [notify, selectedSessionIds]);

  return {
    selectedSessionIds,
    renameTarget,
    renameValue,
    deleteTarget,
    setRenameValue,
    setRenameTarget,
    setDeleteTarget,
    openRename,
    openDelete,
    confirmRename,
    confirmDelete,
    toggleSessionSelection,
    clearSessionSelection,
    batchDelete,
    batchExport,
  };
}
