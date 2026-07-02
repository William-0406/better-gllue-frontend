import { Button } from 'animal-island-ui';
import { BriefcaseBusiness, Building2, ExternalLink, Search, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { gllueApi } from '../services/api';
import type { GlobalSearchResult, SearchResultKind } from '../types/gllue';
import { openGllueHash } from '../utils/gllueLinks';

const kindConfig: Record<SearchResultKind, { label: string; icon: React.ReactNode }> = {
  candidate: { label: '人才', icon: <UsersRound size={15} /> },
  client: { label: '公司', icon: <Building2 size={15} /> },
  job: { label: '项目', icon: <BriefcaseBusiness size={15} /> },
};

export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const normalizedQuery = query.trim();

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (normalizedQuery.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      gllueApi
        .getGlobalSearch(normalizedQuery, 4)
        .then((items) => {
          if (!controller.signal.aborted) setResults(items);
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 260);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [normalizedQuery]);

  const grouped = useMemo(
    () =>
      results.reduce<Record<SearchResultKind, GlobalSearchResult[]>>(
        (acc, item) => {
          acc[item.kind].push(item);
          return acc;
        },
        { candidate: [], client: [], job: [] },
      ),
    [results],
  );

  const openResult = (item: GlobalSearchResult) => {
    setOpen(false);
    openGllueHash(item.hash);
  };

  return (
    <div className="global-search" ref={containerRef}>
      <div className="global-search-box">
        <Search size={17} />
        <input value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} placeholder="搜索人才 / 公司 / 项目" />
        {query ? (
          <button className="global-search-clear" type="button" aria-label="清空搜索" onClick={() => { setQuery(''); setResults([]); }}>
            <X size={15} />
          </button>
        ) : null}
      </div>
      {open && (normalizedQuery.length >= 2 || results.length > 0) ? (
        <div className="global-search-popover">
          {loading ? <div className="global-search-state">正在搜索...</div> : null}
          {!loading && normalizedQuery.length >= 2 && !results.length ? <div className="global-search-state">没有找到匹配记录</div> : null}
          {(['candidate', 'client', 'job'] as SearchResultKind[]).map((kind) =>
            grouped[kind].length ? (
              <section key={kind} className="global-search-section">
                <div className="global-search-section-title">
                  {kindConfig[kind].icon}
                  <span>{kindConfig[kind].label}</span>
                </div>
                {grouped[kind].map((item) => (
                  <button key={`${item.kind}-${item.id}`} className="global-search-result" type="button" onClick={() => openResult(item)}>
                    <span>
                      <strong>{item.title}</strong>
                      <small>{item.subtitle || '暂无摘要'}</small>
                    </span>
                    <em>{item.meta || (item.fromMock ? '示例数据' : '谷露记录')}</em>
                    <ExternalLink size={15} />
                  </button>
                ))}
              </section>
            ) : null,
          )}
          {results.length ? (
            <div className="global-search-footer">
              <Button size="small" icon={<ExternalLink size={14} />} onClick={() => openGllueHash('#search')}>
                去谷露高级搜索
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
