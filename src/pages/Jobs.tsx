import { Button } from 'animal-island-ui';
import { ExternalLink, Eye, FileJson, FilePenLine, UserPlus } from 'lucide-react';
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
import type { JobOrder } from '../types/gllue';
import { dateOnly, textValue } from '../utils/display';
import { jobDetail, openGllueHash } from '../utils/gllueLinks';

const jobName = (item: JobOrder) => item.jobTitle || item.__name__ || `项目 #${item.id}`;
const clientOf = (item: JobOrder) => item.client?.name || item.client?.__name__;
const statusOf = (item: JobOrder) => item.jobStatus?.value || item.jobStatus?.__name__ || item.jobStatus?.code;
const cityOf = (item: JobOrder) => item.citys?.[0]?.name || item.citys?.[0]?.__name__ || (typeof item.city === 'object' ? item.city.name || item.city.__name__ : item.city ? String(item.city) : '');
const ownerOf = (item: JobOrder) => item.joborderuser_set?.map((member) => member.user?.chineseName || member.user?.__name__).filter(Boolean).join('、');

export function Jobs() {
  const loader = useCallback((page: number, pageSize: number) => gllueApi.getJobs(page, pageSize), []);
  const state = usePagedList<JobOrder>(loader, 10);
  const [selected, setSelected] = useState<JobOrder | null>(null);
  const [raw, setRaw] = useState<JobOrder | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [handoff, setHandoff] = useState<{ title: string; description: string; target: JobOrder } | null>(null);
  const accessors = useMemo(
    () => ({
      keyword: (item: JobOrder) => [jobName(item), clientOf(item), statusOf(item), cityOf(item), ownerOf(item)],
      city: cityOf,
      company: clientOf,
      status: statusOf,
      owner: ownerOf,
      date: (item: JobOrder) => item.lastOperationFlowDateTime || item.lastUpdateDate || item.openDate,
      sorters: {
        newest: (a: JobOrder, b: JobOrder) => String(b.lastOperationFlowDateTime || b.lastUpdateDate || b.openDate || '').localeCompare(String(a.lastOperationFlowDateTime || a.lastUpdateDate || a.openDate || '')),
        oldest: (a: JobOrder, b: JobOrder) => String(a.lastOperationFlowDateTime || a.lastUpdateDate || a.openDate || '').localeCompare(String(b.lastOperationFlowDateTime || b.lastUpdateDate || b.openDate || '')),
        name: (a: JobOrder, b: JobOrder) => jobName(a).localeCompare(jobName(b), 'zh-Hans-CN'),
      },
    }),
    [],
  );
  const { filters, filteredRows, setFilters, resetFilters } = useListFilters(state.rows, accessors);

  const openRecommendationHandoff = async (target: JobOrder) => {
    await startRecommendationHandoff({
      source: 'job',
      jobId: target.id,
      jobName: jobName(target),
      companyName: clientOf(target),
    });
    setHandoff(null);
    openGllueHash(jobDetail(target.id));
  };

  const columns: Array<IslandColumn<JobOrder>> = [
    { key: 'id', title: 'ID', render: (row) => row.id, width: '90px' },
    { key: 'title', title: '项目名称', render: (row) => <strong>{jobName(row)}</strong> },
    { key: 'client', title: '客户公司', render: (row) => textValue(clientOf(row)) },
    { key: 'cv', title: '简历推荐', render: (row) => row.cvsent_count?.value ?? 0, width: '100px' },
    { key: 'interview', title: '客户面试', render: (row) => row.clientinterview_count?.value ?? 0, width: '100px' },
    { key: 'status', title: '状态', render: (row) => <StatusTag tone="sun">{textValue(statusOf(row), 'Live')}</StatusTag> },
    {
      key: 'actions',
      title: '操作',
      render: (row) => (
        <div className="row-actions">
          <Button size="small" icon={<Eye size={14} />} onClick={() => setSelected(row)}>
            查看
          </Button>
          <OriginalGllueLink hash={jobDetail(row.id)} label="谷露打开" />
          <Button size="small" icon={<FilePenLine size={14} />} onClick={() => openGllueHash(jobDetail(row.id))}>
            编辑
          </Button>
          <Button size="small" icon={<FileJson size={14} />} onClick={() => setRaw(row)}>
            JSON
          </Button>
          <Button size="small" type="primary" icon={<UserPlus size={14} />} onClick={() => setHandoff({ title: '加入人才', description: '请在谷露原项目页完成候选人选择、流程阶段和推荐材料。', target: row })}>
            加人才
          </Button>
        </div>
      ),
      width: '320px',
    },
  ];

  const drawerSections: DetailSection<JobOrder>[] = [
    {
      title: '基本信息',
      fields: [
        { label: '项目', value: jobName },
        { label: '客户公司', value: clientOf },
        { label: '状态', value: statusOf },
        { label: '城市', value: cityOf },
        { label: '开放日期', value: (item) => dateOnly(item.openDate) },
        { label: '进展天数', value: (item) => (item.livedays ? `${item.livedays} 天` : undefined) },
        { label: '最近操作', value: (item) => dateOnly(item.lastOperationFlowDateTime || item.lastUpdateDate) },
      ],
    },
    {
      title: 'Pipeline 统计',
      fields: [
        { label: '简历推荐', value: (item) => item.cvsent_count?.value ?? 0 },
        { label: '客户面试', value: (item) => item.clientinterview_count?.value ?? 0 },
        { label: 'Offer', value: (item) => item.offer_count?.value ?? 0 },
        { label: '流程分布', value: (item) => item.jobsubmission_count?.map((stage) => `${stage.name || '未命名'}：${stage.value ?? 0}`).join('\n') },
      ],
    },
    {
      title: '团队与最近操作',
      fields: [
        { label: '负责顾问', value: ownerOf },
        { label: '后续操作', value: () => '加入候选人、修改项目、推进流程请前往谷露原页面完成。' },
      ],
    },
  ];

  const query = filters.keyword;
  const toolbar = <ViewToggle value={viewMode} onChange={setViewMode} />;

  return (
    <>
      <AdvancedFilters value={filters} sortOptions={[{ key: 'newest', label: '最近操作' }, { key: 'oldest', label: '最早操作' }, { key: 'name', label: '项目名称' }]} onChange={setFilters} onReset={resetFilters} />
      {viewMode === 'table' ? (
        <IslandTable title="项目列表" rows={filteredRows} columns={columns} loading={state.loading} page={state.page} total={state.total} totalPages={state.totalPages} fromMock={state.fromMock} query={query} toolbar={toolbar} onQueryChange={(keyword) => setFilters({ ...filters, keyword })} onRefresh={state.refresh} onPageChange={state.setPage} />
      ) : (
        <RecordCardGrid title="项目卡片" rows={filteredRows} loading={state.loading} page={state.page} total={state.total} totalPages={state.totalPages} fromMock={state.fromMock} query={query} toolbar={toolbar} onQueryChange={(keyword) => setFilters({ ...filters, keyword })} onRefresh={state.refresh} onPageChange={state.setPage} renderCard={(row) => (
          <div className="record-card">
            <div className="record-card-head">
              <strong>{jobName(row)}</strong>
              <StatusTag tone="sun">{textValue(statusOf(row), 'Live')}</StatusTag>
            </div>
            <p>{textValue(clientOf(row), '客户公司未填写')}</p>
            <div className="record-card-meta">
              <span>推荐：{row.cvsent_count?.value ?? 0}</span>
              <span>面试：{row.clientinterview_count?.value ?? 0}</span>
              <span>{dateOnly(row.lastOperationFlowDateTime || row.lastUpdateDate)}</span>
            </div>
            <div className="row-actions">
              <Button size="small" icon={<Eye size={14} />} onClick={() => setSelected(row)}>查看</Button>
              <Button size="small" icon={<ExternalLink size={14} />} onClick={() => openGllueHash(jobDetail(row.id))}>谷露打开</Button>
              <Button size="small" type="primary" icon={<UserPlus size={14} />} onClick={() => setHandoff({ title: '加入人才', description: '请在谷露原项目页完成候选人选择、流程阶段和推荐材料。', target: row })}>加人才</Button>
            </div>
          </div>
        )} />
      )}
      <DetailsDrawer
        title={selected ? jobName(selected) : '项目详情'}
        item={selected}
        onClose={() => setSelected(null)}
        sections={drawerSections}
        actions={selected ? (
          <>
            <OriginalGllueLink hash={jobDetail(selected.id)} label="谷露打开" />
            <Button icon={<FilePenLine size={16} />} onClick={() => openGllueHash(jobDetail(selected.id))}>去谷露编辑</Button>
          </>
        ) : null}
      />
      <DetailModal title="原始 JSON" item={raw} onClose={() => setRaw(null)} fields={[{ label: '数据', value: (item) => <pre className="json-preview">{JSON.stringify(item, null, 2)}</pre> }]} />
      <ActionHandoffModal
        open={!!handoff}
        title={handoff?.title ?? ''}
        description={handoff?.description ?? ''}
        targetLabel={handoff ? jobName(handoff.target) : ''}
        onClose={() => setHandoff(null)}
        onOpenOriginal={() => {
          if (handoff) return openRecommendationHandoff(handoff.target);
          return undefined;
        }}
      />
    </>
  );
}
