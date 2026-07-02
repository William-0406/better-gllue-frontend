import { Button } from 'animal-island-ui';
import { X } from 'lucide-react';
import { textValue } from '../utils/display';

export interface DetailSection<T> {
  title: string;
  fields: Array<{ label: string; value: (item: T) => React.ReactNode }>;
}

interface DetailsDrawerProps<T> {
  title: string;
  item: T | null;
  sections: DetailSection<T>[];
  actions?: React.ReactNode;
  onClose: () => void;
}

export function DetailsDrawer<T>({ title, item, sections, actions, onClose }: DetailsDrawerProps<T>) {
  if (!item) return null;

  return (
    <div className="drawer-layer">
      <button className="drawer-backdrop" onClick={onClose} aria-label="关闭详情" />
      <aside className="details-drawer">
        <div className="drawer-header">
          <div>
            <span>只读详情</span>
            <h2>{title}</h2>
          </div>
          <Button size="small" icon={<X size={16} />} onClick={onClose} />
        </div>
        {actions ? <div className="drawer-actions">{actions}</div> : null}
        <div className="drawer-body">
          {sections.map((section) => (
            <section className="drawer-section" key={section.title}>
              <h3>{section.title}</h3>
              <div className="drawer-field-grid">
                {section.fields.map((field) => {
                  const value = field.value(item);
                  return (
                    <div className="drawer-field" key={field.label}>
                      <span>{field.label}</span>
                      <strong>{typeof value === 'string' || typeof value === 'number' ? textValue(value) : value || '未填写'}</strong>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}
