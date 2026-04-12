import { Card, Space, Button } from 'antd';
import { useApp } from '../../store/context';
import { fmtTokenHuman, fmtNum } from '../../utils/formatters';

function TokenCard() {
  const { state } = useApp();
  // Calculate token totals from sessions
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
          <Button
            size="small"
            onClick={() => dispatch({ type: 'SET_DASHBOARD_COLLAPSED', payload: !state.dashboardCollapsed })}
          >
            {state.dashboardCollapsed ? '(+)' : '(-)'}
          </Button>
          <span className="dash-title">统计概览</span>
        </div>
        <span className="dash-scope">{state.selectedSessionId ? `Session: ${state.selectedSessionId.slice(0, 12)}` : '全部会话'}</span>
      </div>
      {!state.dashboardCollapsed && (
        <div className="dash-grid">
          <TokenCard />
          <Card size="small" title="事件类型分布">
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>即将实现</div>
          </Card>
          <Card size="small" title="模型分布">
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>即将实现</div>
          </Card>
          <Card size="small" title="平台分布">
            <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>即将实现</div>
          </Card>
          <CountsCard />
        </div>
      )}
    </section>
  );
}
