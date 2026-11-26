import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ActionIcon, Button, Drawer, Group, Select, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBookmark, IconBookmarkFilled, IconTrash } from "@tabler/icons-react";
import { apiClient } from "../../api/client";
import { formatFullDateTime } from "../../lib/formatters";
import styles from "./analysis.module.css";

const LibraryContext = createContext(null);
export function LibraryProvider({ children }) {
  const [library, setLibrary] = useState({ views: [], bookmarks: [] });
  useEffect(() => {
    const controller = new AbortController();
    apiClient.fetchLibrary({ signal: controller.signal }).then(setLibrary).catch((error) => {
      if (error.name !== "AbortError") notifications.show({ title: "本地收藏读取失败", message: error.message, color: "red" });
    });
    return () => controller.abort();
  }, []);
  const save = useCallback(async (kind, value) => {
    try { const next = await apiClient.saveLibrary(kind, value); setLibrary(next); return true; }
    catch (error) { notifications.show({ title: "保存失败", message: error.message, color: "red" }); return false; }
  }, []);
  const value = useMemo(() => ({ library, save }), [library, save]);
  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function BookmarkButton({ entry }) {
  const context = useContext(LibraryContext);
  const [busy, setBusy] = useState(false);
  if (!context || !entry.eventId || !entry.sessionId) return null;
  const saved = context.library.bookmarks.find((item) => item.eventId === entry.eventId);
  return <ActionIcon size="sm" variant="subtle" color={saved ? "teal" : "gray"} loading={busy}
    title={saved ? "取消消息书签" : "保存消息书签"} aria-label={saved ? "取消消息书签" : "保存消息书签"}
    onClick={async () => { setBusy(true); await context.save("bookmarks", { id: saved?.id, remove: Boolean(saved),
      eventId: entry.eventId, sessionId: entry.sessionId, time: entry.time, label: String(entry.content || "消息").slice(0, 80) }); setBusy(false); }}>
    {saved ? <IconBookmarkFilled size={14} /> : <IconBookmark size={14} />}
  </ActionIcon>;
}

export function SavedViews({ filters, onApply }) {
  const context = useContext(LibraryContext);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!context) return null;
  return <div className={styles.savedViews}>
    <Select size="xs" aria-label="已保存检索" placeholder="已保存检索" value={selected}
      data={context.library.views.map((item) => ({ value: item.id, label: item.label || "未命名检索" }))}
      onChange={(id) => { setSelected(id); const view = context.library.views.find((item) => item.id === id); if (view) onApply(view.filters); }} clearable />
    <TextInput size="xs" aria-label="检索名称" placeholder="检索名称" value={name} maxLength={120} onChange={(event) => setName(event.currentTarget.value)} />
    <Button size="xs" variant="subtle" loading={busy} disabled={!name.trim()} onClick={async () => {
      setBusy(true); if (await context.save("views", { label: name, filters })) setName(""); setBusy(false);
    }}>保存当前检索</Button>
    <ActionIcon title="删除所选检索" aria-label="删除所选检索" variant="subtle" color="gray" disabled={!selected}
      onClick={async () => { await context.save("views", { id: selected, remove: true }); setSelected(null); }}><IconTrash size={14} /></ActionIcon>
  </div>;
}

export function BookmarkLibrary({ opened, onClose, onOpenEvent, onOpenSession }) {
  const context = useContext(LibraryContext);
  const items = context?.library.bookmarks || [];
  return <Drawer opened={opened} onClose={onClose} title="消息书签" position="right" size="lg">
    <div className={styles.root}>
      {!items.length ? <p className={styles.muted}>暂无消息书签</p> : null}
      {items.map((item) => <section className={styles.bookmark} key={item.id}>
        <button className={styles.link} onClick={() => { onClose(); onOpenEvent({ eventId: item.eventId }); }}>{item.label || "消息"}</button>
        <small>{formatFullDateTime(item.time)}</small>
        <Group gap="xs"><Button variant="subtle" size="xs" onClick={() => { onClose(); onOpenSession(item.sessionId); }}>打开会话</Button>
          <ActionIcon variant="subtle" color="gray" title="删除书签" aria-label="删除书签" onClick={() => context.save("bookmarks", { id: item.id, remove: true })}><IconTrash size={14} /></ActionIcon></Group>
      </section>)}
    </div>
  </Drawer>;
}
