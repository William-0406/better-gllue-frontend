import { Button } from 'animal-island-ui';
import { LayoutGrid, Table2 } from 'lucide-react';

export type ViewMode = 'table' | 'cards';

interface ViewToggleProps {
  value: ViewMode;
  onChange: (value: ViewMode) => void;
}

export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div className="view-toggle">
      <Button size="small" type={value === 'table' ? 'primary' : 'default'} icon={<Table2 size={15} />} onClick={() => onChange('table')}>
        表格
      </Button>
      <Button size="small" type={value === 'cards' ? 'primary' : 'default'} icon={<LayoutGrid size={15} />} onClick={() => onChange('cards')}>
        卡片
      </Button>
    </div>
  );
}
