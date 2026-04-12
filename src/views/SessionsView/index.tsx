import { useState, useCallback } from 'react';
import { Button, Space, Input, Select, Checkbox, message } from 'antd';
import { useApp } from '../../store/context';
import { api } from '../../api/client';
import RenameModal, { DeleteModal, BatchDeleteModal } from '../../components/Modals';
import { fmtNum, fmtTokenHuman, formatShanghaiTime } from '../../utils/formatters';
import type { Session } from '../../types';

export default function SessionsView() {
  const { state, dispatch } = useApp();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [namedOnly, setNamedOnly] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Session | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [showBatchDelete, setShowBatchDelete] = useState(false);

  async function loadSessions() {
    setLoading(true);
    try {
      const data = await api.fetchSessions();
      dispatch({ type: 'SET_SESSION_MGMT_DATA', payload: data.groups });
    } catch {
      message.error('加载会话失败');
    } finally {
      setLoading(false);
    }
  }

  const filteredGroups = (() => {
    if (!state.sessionMgmtData) return [];
    return Object.entries(state.sessionMgmtData)
      .map(([cwd, sessions]) => {
        let filtered = sessions;
        if (platform) filtered = filtered.filter((s) => s.sourceType === platform);
        if (namedOnly) filtered = filtered.filter((s) => s.sessionTitle);
        if (search) {
          const q = search.toLowerCase();
          filtered = filtered.filter((s) =>
            (s.sessionTitle || '').toLowerCase().includes(q) ||
            s.cwd.toLowerCase().includes(q) ||
            s.sessionId.toLowerCase().includes(q)
          );
        }
        return { cwd, sessions: filtered };
      })
      .filter((g) => g.sessions.length > 0);
  })();

  const handleBatchDelete = async () => {
    if (state.selectedSessionIds.size === 0) return;
    setShowBatchDelete(true);
  };

  const confirmBatchDelete = async () => {
    try {
      await api.batchDeleteSessions([...state.selectedSessionIds]);
      message.success(`已删除 ${state.selectedSessionIds.size} 个会话`);
      dispatch({ type: 'SET_ALL_SESSIONS_SELECTED', payload: false });
      loadSessions();
    } catch {
      message.error('批量删除失败');
    }
    setShowBatchDelete(false);
  };

  const allSelected = state.sessions.length > 0 && state.selectedSessionIds.size === state.sessions.length;

  return (
    <div className="session-mgmt">
      <div className="session-mgmt-toolbar">
        <Space wrap>
          <Input
            placeholder="搜索会话名称 / cwd / session ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260 }}
            allowClear
          />
          <Select
            placeholder="平台"
            value={platform || undefined}
            onChange={(v) => setPlatform(v || '')}
            style={{ width: 120 }}
            allowClear
            options={[
              { label: 'Codex', value: 'codex' },
              { label: 'Claude Code', value: 'claude' },
            ]}
          />
          <Checkbox checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)}>
            仅显示已命名
          </Checkbox>
          <Button onClick={loadSessions} loading={loading}>刷新列表</Button>
          {state.selectedSessionIds.size > 0 && (
            <Button danger onClick={handleBatchDelete}>
              批量删除 ({state.selectedSessionIds.size})
            </Button>
          )}
        </Space>
      </div>

      {!state.sessionMgmtData ? (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
          加载会话数据中...
        </div>
      ) : filteredGroups.length === 0 ? (
        <div style={{ padding: 80, textAlign: 'center', color: 'var(--ant-color-text-secondary)' }}>
          无匹配会话
        </div>
      ) : (
        <div className="session-groups">
          {filteredGroups.map(({ cwd, sessions }) => (
            <div key={cwd} className="session-group">
              <div className="group-header">
                <span className="group-cwd-icon">📁</span>
                <span className="group-cwd">{cwd}</span>
                <span className="group-count">{sessions.length} 个会话</span>
              </div>
              <div className="group-sessions">
                {sessions.map((s) => (
                  <div key={s.sessionId} className="session-card">
                    <span className="card-platform">
                      <span className={`chip-platform chip-${s.sourceType}`}>
                        {s.sourceType === 'claude' ? 'CC' : s.sourceType === 'codex' ? 'CX' : '?'}
                      </span>
                    </span>
                    <div className="card-info">
                      <div className="card-title-row">
                        <span className="card-title">{s.sessionTitle || s.fallbackTitle || '未命名'}</span>
                      </div>
                      <div className="card-meta">
                        <span>事件 {fmtNum(s.count)}</span>
                        {s.aggregateToken?.total && <span>Token {fmtTokenHuman(s.aggregateToken.total)}</span>}
                        <span>最近 {s.latest ? formatShanghaiTime(s.latest) : '-'}</span>
                        <span>{s.sessionId.slice(0, 12)}...</span>
                      </div>
                    </div>
                    <div className="card-actions">
                      <Button size="small" onClick={() => setRenameTarget(s)}>重命名</Button>
                      <Button size="small" danger onClick={() => setDeleteTarget(s)}>删除</Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {renameTarget && (
        <RenameModal
          sessionId={renameTarget.sessionId}
          currentName={renameTarget.sessionTitle || renameTarget.fallbackTitle}
          onClose={() => setRenameTarget(null)}
          onSuccess={() => { setRenameTarget(null); loadSessions(); }}
        />
      )}

      {deleteTarget && (
        <DeleteModal
          sessionId={deleteTarget.sessionId}
          name={deleteTarget.sessionTitle || deleteTarget.fallbackTitle}
          onClose={() => setDeleteTarget(null)}
          onSuccess={() => { setDeleteTarget(null); loadSessions(); }}
        />
      )}

      {showBatchDelete && (
        <BatchDeleteModal
          sessionIds={[...state.selectedSessionIds]}
          onClose={() => setShowBatchDelete(false)}
          onSuccess={() => loadSessions()}
        />
      )}
    </div>
  );
}
