import { Modal, Button, Space, message } from 'antd';
import { useApp } from '../../store/context';
import { api } from '../../api/client';

export default function RenameModal({ sessionId, currentName, onClose, onSuccess }: {
  sessionId: string;
  currentName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const handleOk = async () => {
    const input = document.getElementById('rename-input') as HTMLInputElement;
    const newName = input?.value?.trim();
    if (!newName) return;
    try {
      await api.renameSession(sessionId, newName);
      message.success('重命名成功');
      onSuccess();
      onClose();
    } catch {
      message.error('重命名失败');
    }
  };

  return (
    <Modal
      open={!!sessionId}
      title="重命名会话"
      onOk={handleOk}
      onCancel={onClose}
    >
      <input
        id="rename-input"
        type="text"
        defaultValue={currentName}
        placeholder="输入新名称"
        style={{
          width: '100%',
          padding: '8px 12px',
          fontSize: 16,
          border: '1px solid var(--ant-color-border)',
          borderRadius: 6,
          background: 'var(--ant-color-bg-container)',
          color: 'var(--ant-color-text)',
          marginTop: 8,
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') handleOk(); }}
      />
    </Modal>
  );
}

export function DeleteModal({ sessionId, name, onClose, onSuccess }: {
  sessionId: string;
  name: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const handleOk = async () => {
    try {
      await api.deleteSession(sessionId);
      message.success('删除成功');
      onSuccess();
      onClose();
    } catch {
      message.error('删除失败');
    }
  };

  return (
    <Modal
      open={!!sessionId}
      title="确认删除"
      onOk={handleOk}
      onCancel={onClose}
      okText="删除"
      okType="danger"
      cancelText="取消"
    >
      <p style={{ color: 'var(--ant-color-text-secondary)' }}>
        确定要删除会话 "{name}" 吗？此操作不可撤销。
      </p>
    </Modal>
  );
}

export function BatchDeleteModal({ sessionIds, onClose, onSuccess }: {
  sessionIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const handleOk = async () => {
    try {
      await api.batchDeleteSessions(sessionIds);
      message.success(`已删除 ${sessionIds.length} 个会话`);
      onSuccess();
      onClose();
    } catch {
      message.error('批量删除失败');
    }
  };

  return (
    <Modal
      open={sessionIds.length > 0}
      title="批量删除"
      onOk={handleOk}
      onCancel={onClose}
      okText="确认删除"
      okType="danger"
      cancelText="取消"
    >
      <p style={{ color: 'var(--ant-color-text-secondary)' }}>
        确定要删除以下 {sessionIds.length} 个会话吗？此操作不可撤销。
      </p>
    </Modal>
  );
}
