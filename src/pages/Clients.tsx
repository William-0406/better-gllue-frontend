import { Button } from 'animal-island-ui';
import { ExternalLink, Eye, FileJson, FilePenLine, Handshake } from 'lucide-react';
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
import { useListFilters } from '../services/useListFilters';
import { usePagedList } from '../services/usePagedList';
import type { ClientCompany } from '../types/gllue';
import { dateOnly, textValue } from '../utils/display';
import { clientDetail, openGllueHash } from '../utils/gllueLinks';

const companyName = (item: ClientCompany) => item.name || item.company_name || item.__name__ || `公司 #${item.id}`;
const cityName = (city: ClientCompany['city']) => (typeof city === 'object' ? city.name || city.__name__ : city ? String(city) : '');
const industryOf = (item: ClientCompany) => item.industry?.name || item.industry?.__name__;
const typeOf = (item: ClientCompany) => item.type?.value || item.type?.__name__;
const bdOf = (item: ClientCompany) => (typeof item.bd === 'object' ? item.bd.chineseName || item.bd.__name__ : item.bd ? String(item.bd) : '');

export function Clients() {
  const loader = useCallback((page: number, pageSize: number) => gllueApi.getClients(page, pageSize), []);
  const state = usePagedList<ClientCompany>(loader, 10);
  const [selected, setSelected] = useState<ClientCompany | null>(null);
  const [raw, setRaw] = useState<ClientCompany | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [handoff, setHandoff] = useState<{ title: string; description: string; target: ClientCompany } | null>(null);
  const accessors = useMemo(
    () => ({
      keyword: (item: ClientCompany) => [companyName(item), cityName(item.city), industryOf(item), typeOf(item), bdOf(item)],
      city: (item: ClientCompany) => cityName(item.city),
      company: companyName,
      status: typeOf,
      owner: bdOf,
      date: (item: ClientCompany) => item.lastUpdateDate || item.dateAdded,
      sorters: {
        newest: (a: ClientCompany, b: ClientCompany) => String(b.lastUpdateDate || b.dateAdded || '').localeCompare(String(a.lastUpdateDate || a.dateAdded || '')),
        oldest: (a: ClientCompany, b: ClientCompany) => String(a.lastUpdateDate || a.dateAdded || '').localeCompare(String(b.lastUpdateDate || b.dateAdded || '')),
        name: (a: ClientCompany, b: ClientCompany) => companyName(a).localeCompare(companyName(b), 'zh-Hans-CN'),
      },
    }),
    [],
  );
  const { filters, filteredRows, setFilters, resetFilters } = useListFilters(state.rows, accessors);

  const columns: Array<IslandColumn<ClientCompany>> = [
    { key: 'id', title: 'ID', render: (row) => row.id, width: '80px' },
    { key: 'name', title: '公司名称', render: (row) => <strong>{companyName(row)}</strong> },
    { key: 'city', title: '城市', render: (row) => textValue(cityName(row.city)) },
    { key: 'industry', title: '行业', render: (row) => textValue(industryOf(row)) },
    { key: 'type', title: '类型', render: (row) => <StatusTag tone="mint">{textValue(typeOf(row), '客户')}</StatusTag> },
    { key: 'bd', title: '负责人', render: (row) => textValue(bdOf(row)) },
    {
      key: 'actions',
      title: '操作',
      render: (row) => (
        <div className="row-actions">
          <Button size="small" icon={<Eye size={14} />} onClick={() => setSelected(row)}>
            查看
          </Button>
          <OriginalGllueLink hash={clientDetail(row.id)} label="谷露打开" />
          <Button size="small" icon={<FilePenLine size={14} />} onClick={() => openGllueHash(clientDetail(row.id))}>
            编辑
          </Button>
          <Button size="small" icon={<FileJson size={14} />} onClick={() => setRaw(row)}>
            JSON
          </Button>
          <Button size="small" type="primary" icon={<Handshake size={14} />} onClick={() => setHandoff({ title: '客户跟进', description: '请在谷露原页面完成备注、任务、邮件和联系人维护。', target: row })}>
            跟进
          </Button>
        </div>
      ),
      width: '320px',
    },
  ];

  const drawerSections: DetailSection<ClientCompany>[] = [
    {
      title: '基本信息',
      fields: [
        { label: '公司', value: companyName },
        { label: '城市', value: (item) => cityName(item.city) },
        { label: '行业', value: industryOf },
        { label: '类型', value: typeOf },
        { label: 'BD/负责人', value: bdOf },
        { label: '创建时间', value: (item) => dateOnly(item.dateAdded) },
        { label: '更新时间', value: (item) => dateOnly(item.lastUpdateDate) },
        { label: '最近联系', value: (item) => dateOnly(item.lastContactDate || undefined) },
      ],
    },
    {
      title: '联系人与跟进',
      fields: [
        { label: '联系人', value: () => '前往谷露原页面查看联系人和通讯记录。' },
        { label: '跟进', value: () => '备注、任务和邮件请在谷露原页面完成。' },
      ],
    },
    {
      title: '项目与合同',
      fields: [
        { label: '项目', value: () => '查看该客户下的项目记录。' },
        { label: '合同/回款', value: () => '前往谷露原页面查看合同与回款。' },
      ],
    },
  ];

  const query = filters.keyword;
  const toolbar = <ViewToggle value={viewMode} onChange={setViewMode} />;

  return (
    <>
      <AdvancedFilters value={filters} sortOptions={[{ key: 'newest', label: '最近更新' }, { key: 'oldest', label: '最早更新' }, { key: 'name', label: '公司名称' }]} onChange={setFilters} onReset={resetFilters} />
      {viewMode === 'table' ? (
        <IslandTable title="公司列表" rows={filteredRows} columns={columns} loading={state.loading} page={state.page} total={state.total} totalPages={state.totalPages} fromMock={state.fromMock} query={query} toolbar={toolbar} onQueryChange={(keyword) => setFilters({ ...filters, keyword })} onRefresh={state.refresh} onPageChange={state.setPage} />
      ) : (
        <RecordCardGrid title="公司卡片" rows={filteredRows} loading={state.loading} page={state.page} total={state.total} totalPages={state.totalPages} fromMock={state.fromMock} query={query} toolbar={toolbar} onQueryChange={(keyword) => setFilters({ ...filters, keyword })} onRefresh={state.refresh} onPageChange={state.setPage} renderCard={(row) => (
          <div className="record-card">
            <div className="record-card-head">
              <strong>{companyName(row)}</strong>
              <StatusTag tone="mint">{textValue(typeOf(row), '客户')}</StatusTag>
            </div>
            <p>{textValue(industryOf(row), '行业未填写')}</p>
            <span>{textValue(cityName(row.city), '城市未填写')}</span>
            <div className="record-card-meta">
              <span>最近联系：{dateOnly(row.lastContactDate || undefined)}</span>
              <span>更新：{dateOnly(row.lastUpdateDate)}</span>
            </div>
            <div className="row-actions">
              <Button size="small" icon={<Eye size={14} />} onClick={() => setSelected(row)}>查看</Button>
              <Button size="small" icon={<ExternalLink size={14} />} onClick={() => openGllueHash(clientDetail(row.id))}>谷露打开</Button>
              <Button size="small" type="primary" icon={<Handshake size={14} />} onClick={() => setHandoff({ title: '客户跟进', description: '请在谷露原页面完成备注、任务、邮件和联系人维护。', target: row })}>跟进</Button>
            </div>
          </div>
        )} />
      )}
      <DetailsDrawer
        title={selected ? companyName(selected) : '公司详情'}
        item={selected}
        onClose={() => setSelected(null)}
        sections={drawerSections}
        actions={selected ? (
          <>
            <OriginalGllueLink hash={clientDetail(selected.id)} label="谷露打开" />
            <Button icon={<FilePenLine size={16} />} onClick={() => openGllueHash(clientDetail(selected.id))}>去谷露跟进</Button>
          </>
        ) : null}
      />
      <DetailModal title="原始 JSON" item={raw} onClose={() => setRaw(null)} fields={[{ label: '数据', value: (item) => <pre className="json-preview">{JSON.stringify(item, null, 2)}</pre> }]} />
      <ActionHandoffModal
        open={!!handoff}
        title={handoff?.title ?? ''}
        description={handoff?.description ?? ''}
        targetLabel={handoff ? companyName(handoff.target) : ''}
        onClose={() => setHandoff(null)}
        onOpenOriginal={() => {
          if (handoff) openGllueHash(clientDetail(handoff.target.id));
        }}
      />
    </>
  );
}
