import { Button, Card, Input } from 'animal-island-ui';
import { ChevronLeft, ChevronRight, RefreshCcw, Search } from 'lucide-react';

interface RecordCardGridProps<T> {
  title: string;
  rows: T[];
  loading?: boolean;
  page: number;
  totalPages: number;
  total: number;
  fromMock?: boolean;
  query?: string;
  toolbar?: React.ReactNode;
  renderCard: (row: T) => React.ReactNode;
  onPageChange: (page: number) => void;
  onQueryChange?: (query: string) => void;
  onRefresh?: () => void;
}

export function RecordCardGrid<T>({ title, rows, loading, page, totalPages, total, fromMock, query = '', toolbar, renderCard, onPageChange, onQueryChange, onRefresh }: RecordCardGridProps<T>) {
  return (
    <Card className="record-grid-card">
      <div className="table-toolbar">
        <div>
          <h2>{title}</h2>
          <p>{fromMock ? '预览数据' : `共 ${total} 条记录`}</p>
        </div>
        <div className="pager">
          {onRefresh ? (
            <Button size="small" icon={<RefreshCcw size={16} />} onClick={onRefresh}>
              刷新
            </Button>
          ) : null}
          <Button size="small" icon={<ChevronLeft size={16} />} disabled={page <= 1} onClick={() => onPageChange(page - 1)} />
          <span>
            {page} / {totalPages}
          </span>
          <Button size="small" icon={<ChevronRight size={16} />} disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} />
        </div>
      </div>
      {(onQueryChange || toolbar) && (
        <div className="table-filterbar">
          {onQueryChange ? <Input prefix={<Search size={16} />} placeholder="搜索当前页姓名、公司、职位、城市" value={query} onChange={(event) => onQueryChange(event.target.value)} /> : null}
          <div className="table-filter-actions">{toolbar}</div>
        </div>
      )}
      {loading ? (
        <div className="empty-cell">正在整理卡片...</div>
      ) : rows.length ? (
        <div className="record-grid">{rows.map((row, index) => <div key={index}>{renderCard(row)}</div>)}</div>
      ) : (
        <div className="empty-cell">暂无数据</div>
      )}
    </Card>
  );
}
