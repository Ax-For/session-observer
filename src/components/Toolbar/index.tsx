import { Button, Space, Tabs } from 'antd';
import { useApp } from '../../store/context';

export default function Toolbar() {
  const { state, dispatch } = useApp();

  return (
    <nav className="toolbar">
      <Tabs
        size="small"
        activeKey={state.activeTab}
        onChange={(key) => dispatch({ type: 'SET_ACTIVE_TAB', payload: key as 'stream' | 'sessions' })}
        items={[
          { key: 'stream', label: '事件流' },
          { key: 'sessions', label: '会话' },
        ]}
      />
      <Button
        size="small"
        type={state.filterPanelOpen ? 'primary' : 'default'}
        onClick={() => dispatch({ type: 'SET_FILTER_PANEL', payload: !state.filterPanelOpen })}
      >
        筛选 {state.filterPanelOpen ? '▴' : '▾'}
      </Button>
      <div className="toolbar-quick">
        <Space size="small">
          <Button
            size="small"
            type={state.quickFilter === 'all' ? 'primary' : 'default'}
            onClick={() => dispatch({ type: 'SET_QUICK_FILTER', payload: 'all' })}
          >
            全部
          </Button>
          <Button
            size="small"
            type={state.quickFilter === 'alert' ? 'primary' : 'default'}
            onClick={() => dispatch({ type: 'SET_QUICK_FILTER', payload: 'alert' })}
          >
            异常
          </Button>
          <Button
            size="small"
            type={state.quickFilter === 'high_token' ? 'primary' : 'default'}
            onClick={() => dispatch({ type: 'SET_QUICK_FILTER', payload: 'high_token' })}
          >
            高 Token
          </Button>
        </Space>
      </div>
    </nav>
  );
}
