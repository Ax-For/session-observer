import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useApp } from './store/context';
import { useUrlState } from './hooks/useUrlState';
import { useAutoRefresh } from './hooks/useAutoRefresh';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import FilterPanel from './components/FilterPanel';
import Dashboard from './components/Dashboard';
import StreamView from './views/StreamView';
import SessionsView from './views/SessionsView';

const darkAlgorithm = theme.darkAlgorithm;

const lightTheme = {
  token: {
    colorPrimary: '#2f6fba',
    colorBgLayout: '#e8edf4',
    colorBgContainer: '#f4f8fd',
    colorBgElevated: '#ffffff',
    colorText: '#112033',
    colorTextSecondary: '#51627b',
    colorBorder: '#c8d4e3',
    borderRadius: 8,
    fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
};

const darkTheme = {
  token: {
    colorPrimary: '#8b7cc8',
    colorBgLayout: '#0d0914',
    colorBgContainer: '#130e1f',
    colorBgElevated: '#1a1428',
    colorText: '#e5e1f0',
    colorTextSecondary: '#8a809e',
    colorBorder: '#2a2040',
    borderRadius: 8,
    fontFamily: "'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  algorithm: darkAlgorithm,
};

function AppContent() {
  const { state } = useApp();

  // Initialize hooks
  useUrlState();
  useAutoRefresh();
  useKeyboardShortcuts();

  return (
    <ConfigProvider
      locale={zhCN}
      theme={state.theme === 'dark' ? darkTheme : lightTheme}
    >
      <div className="workspace" data-theme={state.theme}>
        <TopBar />
        <Toolbar />
        <FilterPanel />
        <Dashboard />
        {state.activeTab === 'stream' ? <StreamView /> : <SessionsView />}
      </div>
    </ConfigProvider>
  );
}

export default function App() {
  return <AppContent />;
}
