import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from 'animal-island-ui';
import { ChevronDown, Search, Send, Users, X } from 'lucide-react';
import { StatusTag } from './StatusTag';
import { gllueApi } from '../services/api';
import type { Consultant, ConsultantRecommendation, CurrentUser } from '../types/gllue';
import { openGllueHash } from '../utils/gllueLinks';

const STORAGE_KEY = 'gllue-shell-followed-consultants';
const WINDOW_DAYS = 30;

function loadFollowedIds(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

function dateShort(value: string) {
  return value ? value.slice(0, 16) : '时间未记录';
}

export function ConsultantTracker() {
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [loadingConsultants, setLoadingConsultants] = useState(true);
  const [followedIds, setFollowedIds] = useState<number[]>(loadFollowedIds);
  const [rows, setRows] = useState<ConsultantRecommendation[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [currentUser, setCurrentUser] = useState<CurrentUser>({});
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([gllueApi.getConsultants(), gllueApi.getCurrentUser()]).then(([list, me]) => {
      if (!active) return;
      setConsultants(list);
      setCurrentUser(me);
      setLoadingConsultants(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const followed = useMemo(() => consultants.filter((c) => followedIds.includes(c.id)), [consultants, followedIds]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(followedIds));
  }, [followedIds]);

  useEffect(() => {
    if (!followed.length) {
      setRows([]);
      return;
    }
    let active = true;
    setLoadingRows(true);
    gllueApi.getConsultantRecommendations(followed, WINDOW_DAYS).then((list) => {
      if (!active) return;
      setRows(list);
      setLoadingRows(false);
    });
    return () => {
      active = false;
    };
  }, [followed]);

  // 点击面板外关闭下拉
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [pickerOpen]);

  const toggle = (id: number) => setFollowedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 只显示当前登录用户同团队的顾问（拿不到团队时才退回全部，避免空列表无法使用）。
  // 注意这是界面层限制，非权限强制（客户端可绕过，真限制需在谷露后台配数据权限）。
  const sameTeamOnly = Boolean(currentUser.teamId);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return consultants.filter((c) => {
      if (sameTeamOnly && c.teamId !== currentUser.teamId) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [consultants, search, sameTeamOnly, currentUser.teamId]);

  // 按顾问分组，每个关注的顾问一个方块。
  const grouped = useMemo(() => {
    const map = new Map<number, ConsultantRecommendation[]>();
    followed.forEach((c) => map.set(c.id, []));
    rows.forEach((row) => {
      const arr = map.get(row.consultantId);
      if (arr) arr.push(row);
    });
    return map;
  }, [followed, rows]);

  return (
    <Card className="api-preview-card">
      <div className="section-heading">
        <div>
          <h2>关注顾问 · 近一个月推荐</h2>
          <p>跟踪所选顾问近 {WINDOW_DAYS} 天推荐给客户的人选（姓名 / 公司 / 职位 / 时间）。</p>
        </div>
        <StatusTag tone="sky">{followed.length ? `已关注 ${followed.length} 人` : '未选择'}</StatusTag>
      </div>

      <div className="consultant-picker" ref={pickerRef}>
        <button className="consultant-picker-toggle" onClick={() => setPickerOpen((v) => !v)}>
          <Users size={16} />
          <span>{followed.length ? followed.map((c) => c.name).join('、') : '选择要关注的顾问'}</span>
          <ChevronDown size={16} />
        </button>
        {pickerOpen ? (
          <div className="consultant-picker-panel">
            <div className="consultant-picker-search">
              <Search size={14} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索顾问姓名" autoFocus />
            </div>
            {currentUser.teamId ? (
              <div className="consultant-picker-scope">
                <span>仅显示本团队{currentUser.teamName ? `（${currentUser.teamName}）` : ''}</span>
              </div>
            ) : null}
            <div className="consultant-picker-list">
              {loadingConsultants ? (
                <div className="consultant-picker-empty">加载顾问列表…</div>
              ) : filtered.length ? (
                filtered.map((c) => (
                  <label className="consultant-picker-item" key={c.id}>
                    <input type="checkbox" checked={followedIds.includes(c.id)} onChange={() => toggle(c.id)} />
                    <span>{c.name}</span>
                  </label>
                ))
              ) : (
                <div className="consultant-picker-empty">没有匹配的顾问</div>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {followed.length ? (
        <div className="consultant-chips">
          {followed.map((c) => (
            <button className="consultant-chip" key={c.id} onClick={() => toggle(c.id)} title="取消关注">
              {c.name}
              <X size={12} />
            </button>
          ))}
        </div>
      ) : null}

      {!followed.length ? (
        <div className="consultant-rec-empty">先选择要关注的顾问，这里会为每个顾问显示一个方块，列出其近一个月推荐的人选。</div>
      ) : (
        <div className="weekly-kpi-grid">
          {followed.map((consultant, index) => {
            const list = grouped.get(consultant.id) || [];
            return (
              <div className={`weekly-kpi-panel ${index % 2 === 0 ? 'weekly-kpi-panel--mint' : 'weekly-kpi-panel--sky'}`} key={consultant.id}>
                <div className="weekly-kpi-title">
                  <div>
                    <span>{consultant.name}</span>
                    <strong>{loadingRows ? '…' : list.length}</strong>
                  </div>
                  <Send size={22} />
                </div>
                <div className="weekly-kpi-list">
                  {loadingRows ? (
                    <div className="weekly-kpi-empty">加载中…</div>
                  ) : list.length ? (
                    list.map((row) => (
                      <button
                        key={`${row.submissionId}-${row.candidateId ?? ''}-${row.date}`}
                        className="weekly-kpi-row"
                        onClick={() => openGllueHash(row.candidateId ? `#candidate/detail?id=${row.candidateId}` : `#jobsubmission/detail?id=${row.submissionId}`)}
                      >
                        <span className="weekly-kpi-name">{row.candidateName}</span>
                        <span className="weekly-kpi-project">{[row.company, row.title].filter(Boolean).join(' · ')}</span>
                        <time>{dateShort(row.date)}</time>
                      </button>
                    ))
                  ) : (
                    <div className="weekly-kpi-empty">近一个月暂无推荐</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
