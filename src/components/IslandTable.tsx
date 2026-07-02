import { Button, Card, Input } from 'animal-island-ui';
import { ChevronLeft, ChevronRight, RefreshCcw, Search } from 'lucide-react';

export interface IslandColumn<T> {
  key: string;
  title: string;
  render: (row: T) => React.ReactNode;
  width?: string;
}

interface IslandTableProps<T> {
  title: string;
  rows: T[];
  columns: IslandColumn<T>[];
  loading?: boolean;
  page: number;
  totalPages: number;
  total: number;
  fromMock?: boolean;
  query?: string;
  toolbar?: React.ReactNode;
  onPageChange: (page: number) => void;
  onQueryChange?: (query: string) => void;
  onRefresh?: () => void;
}

export function IslandTable<T>({ title, rows, columns, loading, page, totalPages, total, fromMock, query = '', toolbar, onPageChange, onQueryChange, onRefresh }: IslandTableProps<T>) {
  return (
    <Card className="island-table-card">
      <div className="table-toolbar">
        <div>
          <h2>{title}</h2>
          <p>{fromMock ? '预览数据' : `共 ${total} 条记录`}</p>
        </div>
        <div className="pager">
          {onRefresh ? <Button size="small" icon={<RefreshCcw size={16} />} onClick={onRefresh}>刷新</Button> : null}
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

      <div className="table-shell">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={{ width: column.width }}>
                  {column.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="empty-cell">
                  数据加载中...
                </td>
              </tr>
            ) : rows.length ? (
              rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key}>{column.render(row)}</td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="empty-cell">
                  暂无数据
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
