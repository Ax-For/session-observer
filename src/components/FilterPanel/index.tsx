import { Collapse, Input, Select, Button, Space } from 'antd';
import { useApp } from '../../store/context';

export default function FilterPanel() {
  const { state, dispatch } = useApp();

  if (!state.filterPanelOpen) return null;

  return (
    <section className="filter-panel">
      <div className="filter-row">
        <Input placeholder="搜索内容 / session / tool / call_id" allowClear style={{ flex: 1, minWidth: 200 }} />
        <Select placeholder="模型" allowClear style={{ width: 140 }} options={state.meta.models.map((m: string) => ({ label: m, value: m }))} />
        <Select placeholder="类型" allowClear style={{ width: 120 }} options={state.meta.types.map((t: string) => ({ label: t, value: t }))} />
        <Select placeholder="平台" allowClear style={{ width: 120 }} options={state.meta.platforms.map((p: string) => ({ label: p, value: p }))} />
      </div>
      <div className="filter-row">
        <Space>
          <Button size="small">重置</Button>
          <Button size="small" danger>清空</Button>
        </Space>
      </div>
    </section>
  );
}
