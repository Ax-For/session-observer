import { Button, Space } from 'antd';
import { useApp } from '../../store/context';

export default function TopBar() {
  const { state, dispatch } = useApp();

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-logo">SO</span>
        <h1>Session Observer</h1>
        <span className="topbar-status">就绪</span>
      </div>
      <div className="topbar-actions">
        <Space size="small">
          <Button
            size="small"
            type={state.autoRefreshEnabled ? 'primary' : 'default'}
            onClick={() => dispatch({ type: 'SET_AUTO_REFRESH', payload: !state.autoRefreshEnabled })}
          >
            {state.autoRefreshEnabled ? '停止自动刷新' : '自动刷新'}
          </Button>
          <Button size="small">刷新</Button>
          <Button
            size="small"
            type={state.viewMode === 'raw' ? 'primary' : 'default'}
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: state.viewMode === 'raw' ? 'observe' : 'raw' })}
          >
            {state.viewMode === 'raw' ? '观测模式' : '原始模式'}
          </Button>
          <Button
            size="small"
            onClick={() => dispatch({ type: 'SET_THEME', payload: state.theme === 'dark' ? 'light' : 'dark' })}
          >
            {state.theme === 'dark' ? '白天模式' : '夜间模式'}
          </Button>
          <Button
            size="small"
            onClick={() => dispatch({ type: 'SET_DENSITY', payload: state.density === 'compact' ? 'cozy' : 'compact' })}
          >
            {state.density === 'compact' ? '舒展视图' : '紧凑视图'}
          </Button>
          <Button size="small">?</Button>
          <Button size="small">导出</Button>
          <Button size="small">导入</Button>
        </Space>
      </div>
    </header>
  );
}
