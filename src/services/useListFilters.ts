import { useMemo, useState } from 'react';
import type { ListFilters } from '../types/gllue';
import { dateOnly, includesKeyword, textValue } from '../utils/display';

export const emptyFilters: ListFilters = {
  keyword: '',
  city: '',
  company: '',
  status: '',
  owner: '',
  dateFrom: '',
  dateTo: '',
  sort: '',
};

function afterDate(value: unknown, min: string) {
  if (!min) return true;
  const date = dateOnly(value);
  return date === '未记录' || date >= min;
}

function beforeDate(value: unknown, max: string) {
  if (!max) return true;
  const date = dateOnly(value);
  return date === '未记录' || date <= `${max} 23:59`;
}

export function useListFilters<T>(
  rows: T[],
  accessors: {
    keyword: (row: T) => unknown[];
    city?: (row: T) => unknown;
    company?: (row: T) => unknown;
    status?: (row: T) => unknown;
    owner?: (row: T) => unknown;
    date?: (row: T) => unknown;
    sorters?: Record<string, (a: T, b: T) => number>;
  },
) {
  const [filters, setFilters] = useState<ListFilters>(emptyFilters);

  const filteredRows = useMemo(() => {
    const result = rows.filter((row) => {
      if (!includesKeyword(accessors.keyword(row), filters.keyword)) return false;
      if (filters.city && !textValue(accessors.city?.(row), '').includes(filters.city)) return false;
      if (filters.company && !textValue(accessors.company?.(row), '').includes(filters.company)) return false;
      if (filters.status && !textValue(accessors.status?.(row), '').includes(filters.status)) return false;
      if (filters.owner && !textValue(accessors.owner?.(row), '').includes(filters.owner)) return false;
      if (!afterDate(accessors.date?.(row), filters.dateFrom)) return false;
      if (!beforeDate(accessors.date?.(row), filters.dateTo)) return false;
      return true;
    });
    const sorter = filters.sort ? accessors.sorters?.[filters.sort] : undefined;
    return sorter ? [...result].sort(sorter) : result;
  }, [accessors, filters, rows]);

  return {
    filters,
    setFilters,
    filteredRows,
    resetFilters: () => setFilters(emptyFilters),
  };
}
