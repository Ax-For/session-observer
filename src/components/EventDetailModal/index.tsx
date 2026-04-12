import { Modal, Button, Space } from 'antd';
import { useApp } from '../../store/context';
import type { Event } from '../../types';

interface EventDetailModalProps {
  event: Event | null;
  index: number;
  total: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

function highlightJson(json: string): string {
  return json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
    .replace(/: (\d+)/g, ': <span class="json-number">$1</span>')
    .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
    .replace(/: (null)/g, ': <span class="json-null">$1</span>');
}

export default function EventDetailModal({ event, index, total, onNavigate, onClose }: EventDetailModalProps) {
  const { dispatch } = useApp();

  if (!event) return null;

  const raw = event.raw || event;
  const jsonStr = JSON.stringify(raw, null, 2);

  return (
    <Modal
      open={!!event}
      title="日志详情"
      onCancel={onClose}
      footer={null}
      width="80vw"
      styles={{ body: { maxHeight: '70vh', overflow: 'auto', padding: 0 } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--ant-color-border)' }}>
        <Space>
          <Button
            size="small"
            disabled={index <= 0}
            onClick={() => onNavigate(index - 1)}
          >
            ↑ 上一条
          </Button>
          <span style={{ fontSize: 12, color: 'var(--ant-color-text-secondary)' }}>
            {index + 1} / {total}
          </span>
          <Button
            size="small"
            disabled={index >= total - 1}
            onClick={() => onNavigate(index + 1)}
          >
            ↓ 下一条
          </Button>
        </Space>
        <Space>
          <Button
            size="small"
            onClick={() => {
              navigator.clipboard.writeText(jsonStr);
            }}
          >
            复制 JSON
          </Button>
          <Button size="small" onClick={onClose}>关闭</Button>
        </Space>
      </div>
      <pre
        style={{
          margin: 0,
          padding: 16,
          fontSize: 13,
          lineHeight: 1.56,
          color: 'var(--ant-color-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: "'IBM Plex Mono', monospace",
        }}
        dangerouslySetInnerHTML={{ __html: highlightJson(jsonStr) }}
      />
    </Modal>
  );
}
