import { Button, Card, Input, Select } from 'animal-island-ui';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { ListFilters } from '../types/gllue';

interface AdvancedFiltersProps {
  value: ListFilters;
  sortOptions: Array<{ label: string; key: string }>;
  onChange: (value: ListFilters) => void;
  onReset: () => void;
}

export function AdvancedFilters({ value, sortOptions, onChange, onReset }: AdvancedFiltersProps) {
  const patch = (next: Partial<ListFilters>) => onChange({ ...value, ...next });

  return (
    <Card className="advanced-filter-card">
      <div className="advanced-filter-title">
        <SlidersHorizontal size={18} />
        <strong>高级筛选</strong>
      </div>
      <div className="advanced-filter-grid">
        <Input placeholder="关键词" value={value.keyword} onChange={(event) => patch({ keyword: event.target.value })} />
        <Input placeholder="城市" value={value.city} onChange={(event) => patch({ city: event.target.value })} />
        <Input placeholder="公司 / 客户" value={value.company} onChange={(event) => patch({ company: event.target.value })} />
        <Input placeholder="状态 / 来源" value={value.status} onChange={(event) => patch({ status: event.target.value })} />
        <Input placeholder="负责人" value={value.owner} onChange={(event) => patch({ owner: event.target.value })} />
        <Input type="date" value={value.dateFrom} onChange={(event) => patch({ dateFrom: event.target.value })} />
        <Input type="date" value={value.dateTo} onChange={(event) => patch({ dateTo: event.target.value })} />
        <Select placeholder="排序" value={value.sort} options={[{ label: '默认排序', key: '' }, ...sortOptions]} onChange={(next) => patch({ sort: next })} />
      </div>
      <div className="advanced-filter-actions">
        <Button size="small" icon={<RotateCcw size={15} />} onClick={onReset}>
          清空筛选
        </Button>
      </div>
    </Card>
  );
}
