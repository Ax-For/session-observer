import { Card } from 'antd';
import { useApp } from '../../store/context';
import { fmtTokenHuman, fmtNum } from '../../utils/formatters';

function TokenCard() {
  const { state } = useApp();
  const tokenTotal = { input: 0, output: 0, total: 0, cachedInput: 0, reasoningOutput: 0 };
  for (const s of state.sessions) {
    if (s.aggregateToken) {
      tokenTotal.input += s.aggregateToken.input || 0;
      tokenTotal.output += s.aggregateToken.output || 0;
      tokenTotal.total += s.aggregateToken.total || 0;
      tokenTotal.cachedInput += s.aggregateToken.cachedInput || 0;
      tokenTotal.reasoningOutput += s.aggregateToken.reasoningOutput || 0;
    }
  }

  return (
    <Card size="small" title="Token 使用">
      <div className="token-summary">
        <div className="token-row"><span className="token-label">输入</span><span className="token-value">{fmtTokenHuman(tokenTotal.input)}</span></div>
        <div className="token-row"><span className="token-label">输出</span><span className="token-value">{fmtTokenHuman(tokenTotal.output)}</span></div>
        <div className="token-row"><span className="token-label">总计</span><span className="token-value token-total">{fmtTokenHuman(tokenTotal.total)}</span></div>
        <div className="token-row"><span className="token-label">缓存</span><span className="token-value">{fmtTokenHuman(tokenTotal.cachedInput)}</span></div>
        <div className="token-row"><span className="token-label">推理</span><span className="token-value">{fmtTokenHuman(tokenTotal.reasoningOutput)}</span></div>
      </div>
    </Card>
  );
}

function TypeBarsCard() {
  const { state } = useApp();
  const typeCounts: Record<string, number> = {};
  for (const e of state.events) {
    typeCounts[e.callType] = (typeCounts[e.callType] || 0) + 1;
  }
  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const max = sorted.length > 0 ? sorted[0][1] : 1;

  const typeColorMap: Record<string, string> = {
    Prompt: '#e0c080', User: '#e0c080', Agent: '#8bb4e0',
    Tool_Call: '#b5a8d4', Tool_Result: '#b0a8d8',
    Token_Usage: '#8fd4a8', Thinking: '#c0a0e0', Raw: '#d0a870',
  };

  return (
    <Card size="small" title="事件类型分布">
      <div className="type-bars">
        {sorted.map(([type, count]) => (
          <div key={type} className="type-bar-row">
            <span className="type-bar-label">{type}</span>
            <div className="type-bar-track">
              <div className="type-bar-fill" style={{ width: `${(count / max) * 100}%`, background: typeColorMap[type] || '#999' }} />
            </div>
            <span className="type-bar-count">{fmtNum(count)}</span>
          </div>
        ))}
        {sorted.length === 0 && <div style={{ color: 'var(--ant-color-text-secondary)', fontSize: 12 }}>无数据</div>}
      </div>
    </Card>
  );
}

function ModelListCard() {
  const { state } = useApp();
  const modelCounts: Record<string, number> = {};
  for (const s of state.sessions) {
    for (const m of s.models || []) {
      modelCounts[m] = (modelCounts[m] || 0) + 1;
    }
  }
  const sorted = Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <Card size="small" title="模型分布">
      <div className="model-list">
        {sorted.map(([model, count]) => (
          <div key={model} className="model-item">
            <span className="model-name">{model}</span>
            <span className="model-count">{fmtNum(count)}</span>
          </div>
        ))}
        {sorted.length === 0 && <div style={{ color: 'var(--ant-color-text-secondary)', fontSize: 12 }}>无数据</div>}
      </div>
    </Card>
  );
}

function PlatformBarsCard() {
  const { state } = useApp();
  const codexSessions = state.sessions.filter((s) => s.sourceType === 'codex');
  const claudeSessions = state.sessions.filter((s) => s.sourceType === 'claude');
  const codexModels = [...new Set(codexSessions.flatMap((s) => s.models || []))];
  const claudeModels = [...new Set(claudeSessions.flatMap((s) => s.models || []))];
  const codexEvents = state.events.filter((e) => e.sourceType === 'codex').length;
  const claudeEvents = state.events.filter((e) => e.sourceType === 'claude').length;

  return (
    <Card size="small" title="平台分布">
      <div className="platform-bars">
        <div className="platform-bar">
          <div className="platform-bar-fill codex">
            <span className="platform-bar-value">{codexSessions.length}</span>
          </div>
          <span className="platform-bar-sessions">{codexSessions.length} 会话</span>
          <span className="platform-label">Codex</span>
          <span className="platform-bar-meta">{fmtNum(codexEvents)} 事件 · {state.codexVersion}</span>
          <span className="platform-bar-models">{codexModels.length > 0 ? codexModels.join(', ') : '-'}</span>
        </div>
        <div className="platform-bar">
          <div className="platform-bar-fill claude">
            <span className="platform-bar-value">{claudeSessions.length}</span>
          </div>
          <span className="platform-bar-sessions">{claudeSessions.length} 会话</span>
          <span className="platform-label">Claude Code</span>
          <span className="platform-bar-meta">{fmtNum(claudeEvents)} 事件 · {state.claudeVersion}</span>
          <span className="platform-bar-models">{claudeModels.length > 0 ? claudeModels.join(', ') : '-'}</span>
        </div>
      </div>
    </Card>
  );
}

function CountsCard() {
  const { state } = useApp();
  return (
    <Card size="small" title="数量统计">
      <div className="count-grid">
        <div className="count-item"><span className="count-label">总事件</span><span className="count-value">{fmtNum(state.totalVisible)}</span></div>
        <div className="count-item"><span className="count-label">匹配事件</span><span className="count-value">{fmtNum(state.totalMatching)}</span></div>
        <div className="count-item"><span className="count-label">会话数</span><span className="count-value">{fmtNum(state.sessions.length)}</span></div>
        <div className="count-item"><span className="count-label">已加载</span><span className="count-value">{fmtNum(state.events.length)}</span></div>
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { state, dispatch } = useApp();

  return (
    <section className={`dashboard ${state.dashboardCollapsed ? 'collapsed' : ''}`}>
      <div className="dash-header">
        <div className="dash-header-left">
          <button className="dash-collapse-btn" onClick={() => dispatch({ type: 'SET_DASHBOARD_COLLAPSED', payload: !state.dashboardCollapsed })}>
            {state.dashboardCollapsed ? '(+)' : '(-)'}
          </button>
          <span className="dash-title">统计概览</span>
        </div>
        <span className="dash-scope">{state.selectedSessionId ? `Session: ${state.selectedSessionId.slice(0, 12)}` : '全部会话'}</span>
      </div>
      {!state.dashboardCollapsed && (
        <div className="dash-grid">
          <TokenCard />
          <TypeBarsCard />
          <ModelListCard />
          <PlatformBarsCard />
          <CountsCard />
        </div>
      )}
    </section>
  );
}
