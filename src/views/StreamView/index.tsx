import { useEffect, useRef, useCallback, useState } from 'react';
import { Empty, Button } from 'antd';
import { FixedSizeList as List, ListOnScrollProps } from 'react-window';
import { useApp } from '../../store/context';
import { api } from '../../api/client';
import EventDetailModal from '../../components/EventDetailModal';
import type { Event } from '../../types';

interface EventRowProps {
  index: number;
  style: React.CSSProperties;
  data: {
    events: Event[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    onOpenDetail: (index: number) => void;
  };
}

function EventRow({ index, style, data }: EventRowProps) {
  const event = data.events[index];
  const isActive = index === data.selectedIndex;

  return (
    <div
      style={style}
      className={`event-row ${isActive ? 'active' : ''}`}
      onClick={() => data.onSelect(index)}
      onDoubleClick={() => data.onOpenDetail(index)}
    >
      <span className="event-time">{new Date(event.time).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
      <span className={`event-type event-type-${event.callType.toLowerCase()}`}>{event.callType}</span>
      {event.sourceType && (
        <span className={`event-platform event-platform-${event.sourceType}`}>
          {event.sourceType === 'claude' ? 'CC' : event.sourceType === 'codex' ? 'CX' : event.sourceType}
        </span>
      )}
      <span className="event-model">{event.model}</span>
      <span className="event-session">{event.sessionId.slice(0, 8)}</span>
      <span className="event-summary">{event.summary}</span>
      {event.tokenUsage?.total != null && (
        <span className="event-token">Tok {Math.round(event.tokenUsage.total / 1000)}k</span>
      )}
    </div>
  );
}

const ROW_HEIGHT = 48;

export default function StreamView() {
  const { state, dispatch } = useApp();
  const listRef = useRef<List>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const [listHeight, setListHeight] = useState(400);

  // Measure container height
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setListHeight(containerRef.current.clientHeight);
      }
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [state.filtered.length]);

  useEffect(() => {
    loadData();
  }, []);

  // Listen for refresh and auto-refresh events
  useEffect(() => {
    const handleRefresh = async () => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        const data = await api.fetchEvents({ limit: state.pageLimit, order: 'desc', mode: state.viewMode });
        dispatch({
          type: 'SET_EVENTS',
          payload: {
            events: data.events,
            sessions: data.sessions,
            meta: data.meta,
            claudeVersion: data.claudeVersion,
            codexVersion: data.codexVersion,
            totalVisible: data.totalVisible,
            totalMatching: data.totalMatching,
            hasMore: data.page.hasMore,
          },
        });
      } catch (err) {
        console.error('Failed to load events:', err);
      } finally {
        loadingRef.current = false;
      }
    };

    window.addEventListener('so:refresh', handleRefresh);
    window.addEventListener('so:auto-refresh', handleRefresh);
    return () => {
      window.removeEventListener('so:refresh', handleRefresh);
      window.removeEventListener('so:auto-refresh', handleRefresh);
    };
  }, [state.pageLimit, state.viewMode]);

  async function loadData() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const data = await api.fetchEvents({ limit: state.pageLimit, order: 'desc', mode: state.viewMode });
      dispatch({
        type: 'SET_EVENTS',
        payload: {
          events: data.events,
          sessions: data.sessions,
          meta: data.meta,
          claudeVersion: data.claudeVersion,
          codexVersion: data.codexVersion,
          totalVisible: data.totalVisible,
          totalMatching: data.totalMatching,
          hasMore: data.page.hasMore,
        },
      });
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      loadingRef.current = false;
    }
  }

  const handleSelect = useCallback((index: number) => {
    dispatch({ type: 'SET_SELECTED_ROW', payload: index });
  }, [dispatch]);

  const handleOpenDetail = useCallback((index: number) => {
    dispatch({
      type: 'SET_DETAIL_MODAL',
      payload: { event: state.filtered[index], index },
    });
  }, [dispatch, state.filtered]);

  const handleLoadMore = async () => {
    if (loadingRef.current || !state.hasMore) return;
    loadingRef.current = true;
    try {
      const data = await api.fetchEvents({
        offset: state.pageOffset + state.pageLimit,
        limit: state.pageLimit,
        order: 'desc',
        mode: state.viewMode,
      });
      if (data.events.length > 0) {
        dispatch({
          type: 'APPEND_EVENTS',
          payload: {
            events: data.events,
            hasMore: data.page.hasMore,
            offset: data.page.offset,
          },
        });
      }
    } catch (err) {
      console.error('Failed to load more events:', err);
    } finally {
      loadingRef.current = false;
    }
  };

  // Scroll to selected row
  useEffect(() => {
    if (state.selectedRowIndex >= 0 && listRef.current) {
      listRef.current.scrollToItem(state.selectedRowIndex, 'smart');
    }
  }, [state.selectedRowIndex]);

  // Re-measure on data change
  useEffect(() => {
    if (containerRef.current) {
      setListHeight(containerRef.current.clientHeight);
    }
  }, [state.filtered.length, state.activeTab]);

  if (state.events.length === 0 && !loadingRef.current) {
    return (
      <section className="content-grid" style={{ '--session-pane-width': `${state.sessionPaneWidth}px` } as React.CSSProperties}>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center', padding: 80 }}>
          <Empty description="暂无数据" />
        </div>
      </section>
    );
  }

  return (
    <section className="content-grid" style={{ '--session-pane-width': `${state.sessionPaneWidth}px` } as React.CSSProperties}>
      <aside className="session-pane">
        <div className="pane-head">
          <h2>Session 分组</h2>
          <Button size="small" onClick={() => dispatch({ type: 'SET_SELECTED_SESSION', payload: '' })}>全部</Button>
        </div>
        <div className="session-list">
          {state.sessions.slice(0, 20).map((s) => (
            <div
              key={s.sessionId}
              className={`session-item ${state.selectedSessionId === s.sessionId ? 'active' : ''}`}
              onClick={() => dispatch({ type: 'SET_SELECTED_SESSION', payload: s.sessionId })}
            >
              <div className="session-title-row">
                <span className={`session-icon session-icon-${s.sourceType}`}>
                  {s.sourceType === 'claude' ? 'CC' : s.sourceType === 'codex' ? 'CX' : '?'}
                </span>
                <span className="sname">{s.sessionTitle || s.fallbackTitle || '未命名'}</span>
                <span className="session-meta">{s.count} · {s.latest ? new Date(s.latest).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' }) : ''}</span>
              </div>
              <div className="session-detail-row">
                <span className="sid">{s.sessionId.slice(0, 12)}...</span>
                <span className="cwd-line" title={s.cwd}>{s.cwd.split('/').slice(-4).join('/')}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>
      <div
        className="resize-handle"
        onMouseDown={(e) => {
          const startX = e.clientX;
          const startWidth = state.sessionPaneWidth;
          const handleMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            dispatch({ type: 'SET_SESSION_PANE_WIDTH', payload: Math.max(200, Math.min(600, startWidth + delta)) });
          };
          const handleUp = () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
          };
          window.addEventListener('mousemove', handleMove);
          window.addEventListener('mouseup', handleUp);
        }}
      />
      <div className="main-pane">
        <div className="table-wrap">
          <div className="stream-head">
            <span>事件流</span>
            <span>{state.filtered.length} / {state.totalMatching}</span>
          </div>
          {state.filtered.length > 0 ? (
            <>
              <div ref={containerRef} className="log-stream" style={{ flex: 1, minHeight: 0 }}>
                <List
                  ref={listRef}
                  height={Math.max(100, listHeight)}
                  itemCount={state.filtered.length}
                  itemSize={ROW_HEIGHT}
                  width="100%"
                  itemData={{
                    events: state.filtered,
                    selectedIndex: state.selectedRowIndex,
                    onSelect: handleSelect,
                    onOpenDetail: handleOpenDetail,
                  }}
                >
                  {EventRow}
                </List>
              </div>
              {state.hasMore && (
                <div className="stream-footer">
                  <Button onClick={handleLoadMore} loading={loadingRef.current}>
                    加载更多 ({state.events.length}/{state.totalMatching})
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="empty">无匹配数据</div>
          )}
        </div>
      </div>
      <EventDetailModal
        event={state.detailModalEvent}
        index={state.detailModalIndex}
        total={state.filtered.length}
        onNavigate={(idx) => dispatch({ type: 'SET_DETAIL_MODAL', payload: { event: state.filtered[idx], index: idx } })}
        onClose={() => dispatch({ type: 'SET_DETAIL_MODAL', payload: { event: null, index: -1 } })}
      />
    </section>
  );
}
