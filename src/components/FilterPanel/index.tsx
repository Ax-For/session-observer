import { Input, Select, Button, Space } from 'antd';
import { useApp } from '../../store/context';

export default function FilterPanel() {
  const { state, dispatch } = useApp();

  if (!state.filterPanelOpen) return null;

  return (
    <section className="filter-panel">
      <div className="filter-row">
        <Input id="filter-search" placeholder="搜索内容 / session / tool / call_id" allowClear style={{ flex: 1, minWidth: 200 }} />
        <Select id="filter-model" placeholder="模型" allowClear style={{ width: 140 }} options={state.meta.models.map((m: string) => ({ label: m, value: m }))} />
        <Select id="filter-type" placeholder="类型" allowClear style={{ width: 120 }} options={state.meta.types.map((t: string) => ({ label: t, value: t }))} />
        <Select id="filter-platform" placeholder="平台" allowClear style={{ width: 120 }} options={state.meta.platforms.map((p: string) => ({ label: p, value: p }))} />
      </div>
      <div className="filter-row">
        <Select id="filter-sort" defaultValue="desc" style={{ width: 140 }} options={[
          { label: '↓ 最新在前', value: 'desc' },
          { label: '↑ 最早在前', value: 'asc' },
        ]} />
        <Space>
          <Button size="small">重置</Button>
          <Button size="small" danger>清空</Button>
        </Space>
      </div>
    </section>
  );
}
