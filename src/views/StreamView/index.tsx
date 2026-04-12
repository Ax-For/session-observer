import { useEffect } from 'react';
import type { Event } from '../../types';
import { Empty, Spin } from 'antd';
import { useApp } from '../../store/context';
import { api } from '../../api/client';

export default function StreamView() {
  const { state, dispatch } = useApp();

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
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
    }
  }

  if (state.events.length === 0) {
    return (
      <section className="content-grid">
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center', padding: 80 }}>
          <Empty description="暂无数据" />
        </div>
      </section>
    );
  }

  return (
    <section className="content-grid">
      <aside className="session-pane">
        <div className="pane-head">
          <h2>Session 分组</h2>
        </div>
        <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>
          即将实现
        </div>
      </aside>
      <div className="resize-handle" />
      <div className="main-pane">
        <div className="table-wrap">
          <div className="stream-head">
            <span>事件流</span>
            <span>已加载 {state.events.length} / 共 {state.totalMatching}</span>
          </div>
          <div className="log-stream">
            {state.filtered.map((event: Event, idx: number) => (
              <div key={idx} className="log-row-placeholder" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
                <code style={{ fontSize: 12 }}>
                  [{event.callType}] {event.model} — {event.summary.slice(0, 80)}
                </code>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
