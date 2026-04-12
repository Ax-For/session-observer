import { Button, Space, Upload, message } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useApp } from '../../store/context';
import { parseJsonlFile, exportFilteredEvents } from '../../utils/export';
import type { Event } from '../../types';

export default function TopBar() {
  const { state, dispatch } = useApp();

  const handleImport = async (files: FileList | null) => {
    if (!files) return;
    const allEvents: Event[] = [];
    for (const file of Array.from(files)) {
      try {
        const events = await parseJsonlFile(file);
        allEvents.push(...events);
      } catch {
        message.error(`解析失败: ${file.name}`);
      }
    }
    if (allEvents.length > 0) {
      dispatch({ type: 'SET_DATA_SOURCE', payload: 'local' });
      dispatch({ type: 'SET_LOCAL_EVENTS', payload: allEvents });
      message.success(`已导入 ${allEvents.length} 条事件（本地模式）`);
    }
  };

  const handleExport = () => {
    const events = state.dataSource === 'local' ? state.localEvents : state.events;
    exportFilteredEvents(events);
  };

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-logo">SO</span>
        <h1>Session Observer</h1>
        <span className="topbar-status">
          {state.dataSource === 'local'
            ? `本地模式 · ${state.localEvents.length} 条事件`
            : '就绪'}
        </span>
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
          <Button
            size="small"
            onClick={() => window.dispatchEvent(new CustomEvent('so:refresh'))}
          >
            刷新
          </Button>
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
          <Button size="small" onClick={handleExport}>导出</Button>
          <Upload
            showUploadList={false}
            beforeUpload={(file) => {
              const dt = new DataTransfer();
              dt.items.add(file);
              handleImport(dt.files);
              return false;
            }}
            accept=".jsonl,.log,.txt"
            multiple
          >
            <Button size="small" icon={<UploadOutlined />}>导入</Button>
          </Upload>
        </Space>
      </div>
    </header>
  );
}
