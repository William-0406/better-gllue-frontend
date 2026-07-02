import { Button, Modal } from 'animal-island-ui';
import { ExternalLink } from 'lucide-react';

interface ActionHandoffModalProps {
  open: boolean;
  title: string;
  description: string;
  targetLabel: string;
  onClose: () => void;
  onOpenOriginal: () => void | Promise<void>;
}

export function ActionHandoffModal({ open, title, description, targetLabel, onClose, onOpenOriginal }: ActionHandoffModalProps) {
  return (
    <Modal
      open={open}
      title={title}
      width={560}
      typewriter={false}
      onClose={onClose}
      footer={
        <div className="modal-footer">
          <Button onClick={onClose}>先不处理</Button>
          <Button type="primary" icon={<ExternalLink size={16} />} onClick={onOpenOriginal}>
            去谷露完成
          </Button>
        </div>
      }
    >
      <div className="handoff-panel">
        <strong>{targetLabel}</strong>
        <p>{description}</p>
        <span>为了避免误写真实业务数据，这里先交接到谷露原流程执行保存、推荐、加入项目等操作。</span>
      </div>
    </Modal>
  );
}
