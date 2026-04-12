import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useApp } from './store/context';
import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import FilterPanel from './components/FilterPanel';
import Dashboard from './components/Dashboard';
import StreamView from './views/StreamView';
import SessionsView from './views/SessionsView';

// Sentry-inspired dark theme
const darkAlgorithm = theme.darkAlgorithm;

// Custom theme tokens mapped from existing styles.css
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

  return (
    <ConfigProvider
      locale={zhCN}
      theme={state.theme === 'dark' ? darkTheme : lightTheme}
    >
      <div className="workspace">
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
