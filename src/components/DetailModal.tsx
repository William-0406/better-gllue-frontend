import { Button, Modal } from 'animal-island-ui';

interface DetailModalProps<T> {
  title: string;
  item: T | null;
  fields: Array<{ label: string; value: (item: T) => React.ReactNode }>;
  onClose: () => void;
}

export function DetailModal<T>({ title, item, fields, onClose }: DetailModalProps<T>) {
  return (
    <Modal
      open={!!item}
      title={title}
      width={680}
      typewriter={false}
      onClose={onClose}
      footer={
        <div className="modal-footer">
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary">仅预览</Button>
        </div>
      }
    >
      {item ? (
        <div className="detail-grid">
          {fields.map((field) => (
            <div className="detail-row" key={field.label}>
              <span>{field.label}</span>
              <strong>{field.value(item) || '未填写'}</strong>
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
