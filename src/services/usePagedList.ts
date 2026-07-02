import { useEffect, useState } from 'react';
import type { PageState } from '../types/gllue';

export function usePagedList<T>(loader: (page: number, pageSize: number) => Promise<{ list: T[]; count: number; fromMock: boolean }>, pageSize = 10) {
  const [state, setState] = useState<PageState<T>>({
    rows: [],
    loading: true,
    total: 0,
    page: 1,
    pageSize,
    fromMock: false,
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: undefined }));
    loader(state.page, state.pageSize)
      .then((result) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          rows: result.list,
          total: result.count,
          loading: false,
          fromMock: result.fromMock,
        }));
      })
      .catch((error) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : '数据加载失败',
        }));
      });
    return () => {
      active = false;
    };
  }, [loader, state.page, state.pageSize, reloadKey]);

  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const setPage = (page: number) => setState((current) => ({ ...current, page: Math.min(Math.max(1, page), totalPages) }));
  const refresh = () => setReloadKey((current) => current + 1);

  return { ...state, totalPages, setPage, refresh };
}
