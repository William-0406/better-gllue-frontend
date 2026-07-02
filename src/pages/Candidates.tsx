import { Button } from 'animal-island-ui';
import { ExternalLink, Eye, FileJson, FilePenLine, Send } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { ActionHandoffModal } from '../components/ActionHandoffModal';
import { AdvancedFilters } from '../components/AdvancedFilters';
import { DetailModal } from '../components/DetailModal';
import { DetailsDrawer, DetailSection } from '../components/DetailsDrawer';
import { IslandColumn, IslandTable } from '../components/IslandTable';
import { OriginalGllueLink } from '../components/OriginalGllueLink';
import { RecordCardGrid } from '../components/RecordCardGrid';
import { StatusTag } from '../components/StatusTag';
import { ViewMode, ViewToggle } from '../components/ViewToggle';
import { gllueApi } from '../services/api';
import { startRecommendationHandoff } from '../services/recommendationRewards';
import { useListFilters } from '../services/useListFilters';
import { usePagedList } from '../services/usePagedList';
import type { Candidate } from '../types/gllue';
import { dateOnly, textValue } from '../utils/display';
import { candidateDetail, openGllueHash } from '../utils/gllueLinks';

const nameOf = (item: Candidate) => item.chineseName || item.englishName || `候选人 #${item.id}`;
const companyOf = (item: Candidate) => item.company?.name || item.company?.__name__;
const titleOf = (item: Candidate) => item.title || item.candidateexperience_set?.[0]?.title;
const cityOf = (item: Candidate) => item.locations?.[0]?.name || item.locations?.[0]?.__name__;
const sourceOf = (item: Candidate) => item.source?.value || item.source?.__name__;
const ownerOf = (item: Candidate) => (typeof item.owner === 'object' ? item.owner.chineseName || item.owner.__name__ : item.owner ? String(item.owner) : '');

export function Candidates() {
  const loader = useCallback((page: number, pageSize: number) => gllueApi.getCandidates(page, pageSize), []);
  const state = usePagedList<Candidate>(loader, 10);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [raw, setRaw] = useState<Candidate | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [handoff, setHandoff] = useState<{ title: string; description: string; target: Candidate } | null>(null);
  const accessors = useMemo(
    () => ({
      keyword: (item: Candidate) => [nameOf(item), companyOf(item), titleOf(item), cityOf(item), sourceOf(item)],
      city: cityOf,
      company: companyOf,
      status: sourceOf,
      owner: ownerOf,
      date: (item: Candidate) => item.dateAdded,
      sorters: {
        newest: (a: Candidate, b: Candidate) => String(b.dateAdded || '').localeCompare(String(a.dateAdded || '')),
        oldest: (a: Candidate, b: Candidate) => String(a.dateAdded || '').localeCompare(String(b.dateAdded || '')),
        name: (a: Candidate, b: Candidate) => nameOf(a).localeCompare(nameOf(b), 'zh-Hans-CN'),
      },
    }),
    [],
  );
  const { filters, filteredRows, setFilters, resetFilters } = useListFilters(state.rows, accessors);

  const openRecommendationHandoff = async (target: Candidate) => {
    await startRecommendationHandoff({
      source: 'candidate',
      candidateId: target.id,
      candidateName: nameOf(target),
      companyName: companyOf(target),
    });
    setHandoff(null);
    openGllueHash(candidateDetail(target.id));
  };

  const columns: Array<IslandColumn<Candidate>> = [
    { key: 'name', title: '姓名', render: (row) => <strong>{nameOf(row)}</strong>, width: '15%' },
    { key: 'company', title: '公司', render: (row) => textValue(companyOf(row)) },
    { key: 'title', title: '职位', render: (row) => textValue(titleOf(row)) },
    { key: 'city', title: '城市', render: (row) => textValue(cityOf(row)) },
    { key: 'years', title: '年限', render: (row) => (row.work_years ? `${row.work_years} 年` : '未填写'), width: '90px' },
    { key: 'added', title: '添加日期', render: (row) => dateOnly(row.dateAdded), width: '120px' },
    { key: 'status', title: '来源', render: (row) => <StatusTag tone="sky">{textValue(sourceOf(row), '人才库')}</StatusTag> },
    {
      key: 'actions',
      title: '操作',
      render: (row) => (
        <div className="row-actions">
          <Button size="small" icon={<Eye size={14} />} onClick={() => setSelected(row)}>
            查看
          </Button>
          <OriginalGllueLink hash={candidateDetail(row.id)} label="谷露打开" />
          <Button size="small" icon={<FilePenLine size={14} />} onClick={() => openGllueHash(candidateDetail(row.id))}>
            编辑
          </Button>
          <Button size="small" icon={<FileJson size={14} />} onClick={() => setRaw(row)}>
            JSON
          </Button>
          <Button size="small" type="primary" icon={<Send size={14} />} onClick={() => setHandoff({ title: '推荐到项目', description: '请在谷露原页面完成项目选择、流程阶段和推荐说明。', target: row })}>
            推荐
          </Button>
        </div>
      ),
      width: '320px',
    },
  ];

  const drawerSections: DetailSection<Candidate>[] = [
    {
      title: '基本信息',
      fields: [
        { label: '姓名', value: nameOf },
        { label: '当前公司', value: (item) => companyOf(item) },
        { label: '当前职位', value: (item) => titleOf(item) },
        { label: '城市', value: (item) => cityOf(item) },
        { label: '工作年限', value: (item) => (item.work_years ? `${item.work_years} 年` : undefined) },
        { label: '负责人', value: ownerOf },
        { label: '来源', value: (item) => sourceOf(item) },
        { label: '添加时间', value: (item) => dateOnly(item.dateAdded) },
      ],
    },
    {
      title: '经历',
      fields: [
        {
          label: '最近经历',
          value: (item) =>
            item.candidateexperience_set?.slice(0, 3).map((experience) => `${experience.client?.name || experience.client?.__name__ || '未填写公司'} · ${experience.title || '未填写职位'}`).join('\n'),
        },
      ],
    },
    {
      title: '备注与附件',
      fields: [
        { label: '备注', value: (item) => (Array.isArray(item.note_set) ? item.note_set.map((note) => note.content || note.note).filter(Boolean).slice(0, 3).join('\n') : undefined) },
        { label: '附件数', value: (item) => item.attachment_count ?? 0 },
        { label: '最近联系', value: (item) => dateOnly(item.lastContactDate) },
      ],
    },
    {
      title: '项目流程记录',
      fields: [
        { label: '标签', value: (item) => item.tags?.map((tag) => tag.name || tag.__name__).filter(Boolean).join('、') },
        { label: '后续操作', value: () => '推荐、加入项目、备注等操作请前往谷露原页面完成。' },
      ],
    },
  ];

  const query = filters.keyword;
  const toolbar = <ViewToggle value={viewMode} onChange={setViewMode} />;

  return (
    <>
      <AdvancedFilters value={filters} sortOptions={[{ key: 'newest', label: '最新添加' }, { key: 'oldest', label: '最早添加' }, { key: 'name', label: '姓名排序' }]} onChange={setFilters} onReset={resetFilters} />
      {viewMode === 'table' ? (
        <IslandTable title="人才列表" rows={filteredRows} columns={columns} loading={state.loading} page={state.page} total={state.total} totalPages={state.totalPages} fromMock={state.fromMock} query={query} toolbar={toolbar} onQueryChange={(keyword) => setFilters({ ...filters, keyword })} onRefresh={state.refresh} onPageChange={state.setPage} />
      ) : (
        <RecordCardGrid title="人才卡片" rows={filteredRows} loading={state.loading} page={state.page} total={state.total} totalPages={state.totalPages} fromMock={state.fromMock} query={query} toolbar={toolbar} onQueryChange={(keyword) => setFilters({ ...filters, keyword })} onRefresh={state.refresh} onPageChange={state.setPage} renderCard={(row) => (
          <div className="record-card">
            <div className="record-card-head">
              <strong>{nameOf(row)}</strong>
              <StatusTag tone="sky">{textValue(sourceOf(row), '人才库')}</StatusTag>
            </div>
            <p>{textValue(titleOf(row), '未填写职位')}</p>
            <span>{textValue(companyOf(row), '未填写公司')}</span>
            <div className="record-card-meta">
              <span>{textValue(cityOf(row), '城市未知')}</span>
              <span>{row.work_years ? `${row.work_years} 年` : '年限未知'}</span>
              <span>{dateOnly(row.dateAdded)}</span>
            </div>
            <div className="row-actions">
              <Button size="small" icon={<Eye size={14} />} onClick={() => setSelected(row)}>查看</Button>
              <Button size="small" icon={<ExternalLink size={14} />} onClick={() => openGllueHash(candidateDetail(row.id))}>谷露打开</Button>
              <Button size="small" type="primary" icon={<Send size={14} />} onClick={() => setHandoff({ title: '推荐到项目', description: '请在谷露原页面完成项目选择、流程阶段和推荐说明。', target: row })}>推荐</Button>
            </div>
          </div>
        )} />
      )}
      <DetailsDrawer
        title={selected ? nameOf(selected) : '人才详情'}
        item={selected}
        onClose={() => setSelected(null)}
        sections={drawerSections}
        actions={selected ? (
          <>
            <OriginalGllueLink hash={candidateDetail(selected.id)} label="谷露打开" />
            <Button icon={<FilePenLine size={16} />} onClick={() => openGllueHash(candidateDetail(selected.id))}>去谷露编辑</Button>
          </>
        ) : null}
      />
      <DetailModal title="原始 JSON" item={raw} onClose={() => setRaw(null)} fields={[{ label: '数据', value: (item) => <pre className="json-preview">{JSON.stringify(item, null, 2)}</pre> }]} />
      <ActionHandoffModal
        open={!!handoff}
        title={handoff?.title ?? ''}
        description={handoff?.description ?? ''}
        targetLabel={handoff ? nameOf(handoff.target) : ''}
        onClose={() => setHandoff(null)}
        onOpenOriginal={() => {
          if (handoff) return openRecommendationHandoff(handoff.target);
          return undefined;
        }}
      />
    </>
  );
}
