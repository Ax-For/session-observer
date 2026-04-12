import { useState, useEffect, useCallback } from 'react';
import { Button, Input, Select, Checkbox, Space, Modal, message, Empty, Collapse, CollapseProps } from 'antd';
import { useApp } from '../../store/context';
import { api } from '../../api/client';
import { fmtNum, fmtTokenHuman, formatShanghaiTime } from '../../utils/formatters';
import type { Session } from '../../types';

export default function SessionsView() {
  const { state, dispatch } = useApp();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [platform, setPlatform] = useState('');
  const [namedOnly, setNamedOnly] = useState(false);
  const [expandedCwds, setExpandedCwds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setLoading(true);
    try {
      const data = await api.fetchSessions();
      dispatch({ type: 'SET_SESSION_MGMT_DATA', payload: data.groups });
    } catch (err) {
      console.error('Failed to load sessions:', err);
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

  const handleRename = useCallback((session: Session) => {
    Modal.confirm({
      title: '重命名会话',
      content: (
        <Input
          id="rename-input"
          defaultValue={session.sessionTitle || ''}
          placeholder="输入新名称"
          size="large"
        />
      ),
      onOk: async () => {
        const newName = (document.getElementById('rename-input') as HTMLInputElement)?.value;
        if (!newName) return;
        try {
          await api.renameSession(session.sessionId, newName);
          message.success('重命名成功');
          loadSessions();
        } catch {
          message.error('重命名失败');
        }
      },
    });
  }, []);

  const handleDelete = useCallback((session: Session) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除会话 "${session.sessionTitle || session.fallbackTitle}" 吗？此操作不可撤销。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await api.deleteSession(session.sessionId);
          message.success('删除成功');
          loadSessions();
        } catch {
          message.error('删除失败');
        }
      },
    });
  }, []);

  const handleBatchDelete = useCallback(async () => {
    if (state.selectedSessionIds.size === 0) return;
    Modal.confirm({
      title: '批量删除',
      content: `确定要删除 ${state.selectedSessionIds.size} 个会话吗？此操作不可撤销。`,
      okType: 'danger',
      onOk: async () => {
        try {
          await api.batchDeleteSessions([...state.selectedSessionIds]);
          message.success('批量删除成功');
          dispatch({ type: 'SET_ALL_SESSIONS_SELECTED', payload: false });
          loadSessions();
        } catch {
          message.error('批量删除失败');
        }
      },
    });
  }, [state.selectedSessionIds]);

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
            <>
              <Button danger onClick={handleBatchDelete}>
                批量删除 ({state.selectedSessionIds.size})
              </Button>
            </>
          )}
        </Space>
      </div>

      {!state.sessionMgmtData ? (
        <div style={{ padding: 80, textAlign: 'center' }}>
          <Empty description="暂无会话数据" />
        </div>
      ) : filteredGroups.length === 0 ? (
        <div style={{ padding: 80, textAlign: 'center' }}>
          <Empty description="无匹配会话" />
        </div>
      ) : (
        <div className="session-groups">
          {filteredGroups.map(({ cwd, sessions }) => {
            const isExpanded = expandedCwds.has(cwd);
            return (
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
                        <span className={`chip chip-platform chip-${s.sourceType}`}>
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
                        <Button size="small" onClick={() => handleRename(s)}>重命名</Button>
                        <Button size="small" danger onClick={() => handleDelete(s)}>删除</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
