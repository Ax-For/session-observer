import { useState, useEffect, useCallback } from 'react';
import { Button, Space, Input, Select, Checkbox, message, Tooltip, Modal } from 'antd';
import { CopyOutlined, EyeOutlined, FileTextOutlined } from '@ant-design/icons';
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
  const [viewSession, setViewSession] = useState<Session | null>(null);
  const [showConvPanel, setShowConvPanel] = useState(false);

  useEffect(() => {
    loadSessions();
  }, []);

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
    // Build session data from either sessionMgmtData (local) or state.sessions (server)
    const sessionMap: Record<string, Session[]> = {};
    const source = state.sessionMgmtData || {};
    if (Object.keys(source).length > 0) {
      Object.assign(sessionMap, source);
    } else if (state.sessions.length > 0) {
      for (const s of state.sessions) {
        const cwd = s.cwd || 'unknown';
        if (!sessionMap[cwd]) sessionMap[cwd] = [];
        sessionMap[cwd].push(s);
      }
    }
    if (Object.keys(sessionMap).length === 0) return [];
    return Object.entries(sessionMap)
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
                      <Tooltip title="查看会话详情"><Button size="small" icon={<EyeOutlined />} onClick={() => setViewSession(s)} /></Tooltip>
                      <Tooltip title="复制 Session ID"><Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(s.sessionId); message.success('已复制'); }} /></Tooltip>
                      <Tooltip title="查看会话内容"><Button size="small" icon={<FileTextOutlined />} onClick={() => { setViewSession(s); setShowConvPanel(true); }} /></Tooltip>
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

      {viewSession && (
        <Modal
          open={!!viewSession}
          title="会话详情"
          onCancel={() => setViewSession(null)}
          footer={[
            <Button key="close" onClick={() => setViewSession(null)}>关闭</Button>,
          ]}
          width={600}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div><strong>平台：</strong>{viewSession.sourceType === 'claude' ? 'Claude Code' : 'Codex'}</div>
            <div><strong>会话数：</strong>{viewSession.count}</div>
            <div><strong>模型：</strong>{viewSession.models?.join(', ') || '-'}</div>
            {viewSession.aggregateToken?.total && <div><strong>Token：</strong>{fmtTokenHuman(viewSession.aggregateToken.total)}</div>}
            <div style={{ gridColumn: '1 / -1' }}><strong>Session ID：</strong><code>{viewSession.sessionId}</code></div>
            <div style={{ gridColumn: '1 / -1' }}><strong>名称：</strong>{viewSession.sessionTitle || viewSession.fallbackTitle || '-'}</div>
            <div style={{ gridColumn: '1 / -1' }}><strong>目录：</strong><code>{viewSession.cwd}</code></div>
            <div><strong>最近活跃：</strong>{viewSession.latest ? formatShanghaiTime(viewSession.latest) : '-'}</div>
          </div>
        </Modal>
      )}
    </div>
  );
}
