import axios from 'axios';
import apiMap from '../data/api-map.json';
import type { ApiMapEntry, Candidate, ClientCompany, FacetFields, GlobalSearchResult, GllueDataModule, GllueExportSnapshot, GllueListResponse, JobOrder, KpiWorkflowSummary, ListFilters, MappingCandidate, MappingProject, MappingSearchInput, ModuleKey, PipelineSubmission, SavedSearch, TodoItem } from '../types/gllue';
import type { ResumeIdentity } from './resumeParser';
import { matchResumeWithEnhance, upsertCandidateSummaries } from './enhanceApi';
import { mockCandidates, mockClients, mockJobs } from './mockData';

const client = axios.create({
  baseURL: '',
  timeout: 12000,
  withCredentials: true,
});

const map = apiMap as unknown as ApiMapEntry[];

const moduleNames: Record<ModuleKey, string> = {
  dashboard: '首页 Dashboard',
  candidates: '人才',
  clients: '公司',
  jobs: '项目',
  mapping: 'Mapping',
  leaderboard: '推荐榜',
  projectMap: '项目图谱',
};

function findApi(api: string, moduleKey: ModuleKey) {
  return map.find((entry) => entry.api === api && entry.modules.includes(moduleNames[moduleKey])) ?? map.find((entry) => entry.api === api);
}

function paramsFor(api: string, moduleKey: ModuleKey, page: number, pageSize: number, filters?: Partial<ListFilters>) {
  const entry = findApi(api, moduleKey);
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry?.request_params?.query ?? {})) {
    if (value !== undefined && value !== null) query[key] = String(value);
  }
  if (moduleKey === 'clients' && api === '/rest/client/list') {
    query.gql = 'type__eq=client';
    query.ordering = '-id';
    delete query.savedSearchId;
    delete query.suffix;
  }
  if (filters?.sort) query.ordering = filters.sort;
  if (filters?.keyword) query.keyword = filters.keyword;
  if (filters?.city) query.city = filters.city;
  if (filters?.company) query.company = filters.company;
  if (filters?.status) query.status = filters.status;
  if (filters?.owner) query.owner = filters.owner;
  if (filters?.dateFrom) query.date_from = filters.dateFrom;
  if (filters?.dateTo) query.date_to = filters.dateTo;
  const offset = String(Math.max(0, (page - 1) * pageSize));

  return {
    ...query,
    paginate_by: String(pageSize),
    iDisplayStart: offset,
    start: offset,
    page: String(page),
  };
}

function normalizeList<T>(data: unknown): GllueListResponse<T> {
  if (data && typeof data === 'object') {
    const obj = data as Partial<GllueListResponse<T>>;
    if (Array.isArray(obj.list)) {
      return {
        list: obj.list,
        count: Number(obj.count ?? obj.list.length),
        current: Number(obj.current ?? 1),
        pages: Number(obj.pages ?? 1),
      };
    }
    if (Array.isArray((obj as { results?: T[] }).results)) {
      const results = (obj as { results: T[]; count?: number }).results;
      return { list: results, count: Number((obj as { count?: number }).count ?? results.length) };
    }
  }
  return { list: [], count: 0 };
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function firstText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!value || typeof value !== 'object') return undefined;
  const objectValue = value as Record<string, unknown>;
  return firstText(objectValue.content) || firstText(objectValue.note) || firstText(objectValue.all_content);
}

function textValue(value: unknown, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return textValue(obj.name ?? obj.__name__ ?? obj.value ?? obj.chineseName ?? obj.englishName, fallback);
  }
  return fallback;
}

function candidateNoteText(item: Candidate): string | undefined {
  const directNote = firstText(item.note);
  if (directNote) return directNote;
  if (Array.isArray(item.note_set)) {
    const note = item.note_set.map((entry) => firstText(entry)).find(Boolean);
    if (note) return note;
  }
  if (item.note_set && typeof item.note_set === 'object') {
    const note = Object.values(item.note_set).map((entry) => firstText(entry)).find(Boolean);
    if (note) return note;
  }
  return undefined;
}

function candidateActivityDate(item: Candidate) {
  return item.noteDate || item.lastContactDate || item.dateAdded;
}

function candidateName(item: Candidate) {
  return item.chineseName || item.englishName || item.__name__ || `候选人 #${item.id}`;
}

function candidateCompany(item: Candidate) {
  return item.company?.name || item.company?.__name__ || item.candidateexperience_set?.[0]?.client?.name || item.candidateexperience_set?.[0]?.client?.__name__;
}

function candidateTitle(item: Candidate) {
  return item.title || item.candidateexperience_set?.[0]?.title;
}

function normalizePhone(value: unknown) {
  return String(value || '').replace(/[^\d]/g, '').replace(/^86/, '');
}

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value: unknown) {
  return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function candidatePhones(item: Candidate) {
  const record = item as Candidate & { mobile2?: string; phone?: string; phone1?: string; phone2?: string; tel?: string };
  return [record.mobile, record.mobile1, record.mobile2, record.phone, record.phone1, record.phone2, record.tel].map(normalizePhone).filter(Boolean);
}

function candidateEmails(item: Candidate) {
  const record = item as Candidate & { email1?: string; email2?: string; email3?: string };
  return [record.email, record.email1, record.email2, record.email3].map(normalizeEmail).filter(Boolean);
}

function hasExactContactMatch(item: Candidate, identity: Pick<ResumeIdentity, 'phones' | 'emails'>) {
  const phones = new Set(identity.phones.map(normalizePhone).filter(Boolean));
  const emails = new Set(identity.emails.map(normalizeEmail).filter(Boolean));
  return candidatePhones(item).some((phone) => phones.has(phone)) || candidateEmails(item).some((email) => emails.has(email));
}

function hasExactNameMatch(item: Candidate, name: string | undefined) {
  const expected = normalizeName(name);
  return Boolean(expected && normalizeName(candidateName(item)) === expected);
}

function clientName(item: ClientCompany) {
  return item.name || item.company_name || item.__name__ || `公司 #${item.id}`;
}

function cityName(city: ClientCompany['city'] | JobOrder['city']) {
  return typeof city === 'object' ? city.name || city.__name__ : city ? String(city) : '';
}

function jobName(item: JobOrder) {
  return item.jobTitle || item.__name__ || `项目 #${item.id}`;
}

function jobClient(item: JobOrder) {
  return item.client?.name || item.client?.__name__;
}

async function getList<T>(api: string, moduleKey: ModuleKey, page: number, pageSize: number, fallback: T[], filters?: Partial<ListFilters>) {
  try {
    const response = await client.get(api, {
      params: paramsFor(api, moduleKey, page, pageSize, filters),
    });
    const normalized = normalizeList<T>(response.data);
    if (!normalized.list.length) {
      return { ...normalized, list: fallback, count: Math.max(normalized.count, fallback.length), fromMock: true };
    }
    return { ...normalized, fromMock: false };
  } catch (error) {
    return { list: fallback, count: fallback.length, current: page, pages: 1, fromMock: true };
  }
}

async function getDetail<T>(api: string, id: number) {
  const candidates = [api, `${api.replace(/\/$/, '')}/get`, `${api.replace(/\/$/, '')}/detail`];
  for (const endpoint of candidates) {
    try {
      const response = await client.get(endpoint, { params: { id } });
      if (response.data) return response.data as T;
    } catch {
      // Keep probing known read-only detail endpoint shapes.
    }
  }
  return null;
}

async function getMaybeList<T>(api: string, params: Record<string, string>, fallback: T[] = []) {
  try {
    const response = await client.get(api, { params });
    const normalized = normalizeList<T>(response.data);
    if (normalized.list.length) return { ...normalized, fromMock: false };
    if (fallback.length) return { ...normalized, list: fallback, count: fallback.length, fromMock: true };
    return { ...normalized, fromMock: false };
  } catch {
    return { list: fallback, count: fallback.length, fromMock: true };
  }
}

async function fetchCandidateImportRows(queries: string[], pageSize: number) {
  if (!queries.length) return { list: [] as Candidate[], count: 0, fromMock: false };

  const demandKeys = JSON.stringify(['company', 'avatar', 'addedBy', 'owner', 'lastUpdateBy', 'candidateexperience_set']);
  const responses = await Promise.allSettled(
    queries.map((keyword) =>
      client.get('/rest/candidate/list', {
        params: {
          keyword,
          gql: 'type=candidate&source=gllue',
          demandKeys,
          ordering: '-lastUpdateDate',
          paginate_by: String(pageSize),
          page: '1',
        },
      }),
    ),
  );

  const rows = new Map<number, Candidate>();
  responses.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    normalizeList<Candidate>(result.value.data).list.forEach((item) => rows.set(item.id, item));
  });

  const list = Array.from(rows.values()).slice(0, pageSize);
  const details = await Promise.all(list.map((item) => getDetail<Candidate>('/rest/candidate/detail', item.id)));
  const detailMap = new Map(details.filter(Boolean).map((item) => [item!.id, item!]));

  return {
    list: list.map((item) => ({ ...item, ...detailMap.get(item.id) })),
    count: rows.size,
    fromMock: responses.every((result) => result.status === 'rejected'),
  };
}

function splitMappingKeywords(value: string[] | string | undefined) {
  const source = Array.isArray(value) ? value.join(' ') : value || '';
  return Array.from(new Set(source.split(/[\s,，;；、|/]+/).map((item) => item.trim()).filter(Boolean))).slice(0, 12);
}

function candidateExperiencesForMapping(item: Candidate) {
  const experiences = [
    { company: textValue(candidateCompany(item), ''), title: textValue(candidateTitle(item), ''), isCurrent: true },
    ...(item.candidateexperience_set || []).map((experience) => ({
      company: textValue(experience.client, ''),
      title: textValue(experience.title, ''),
      isCurrent: experience.is_current,
    })),
  ];
  const seen = new Set<string>();
  return experiences.filter((experience) => {
    const company = textValue(experience.company, '');
    const title = textValue(experience.title, '');
    const key = `${normalizeName(company)}|${normalizeName(title)}`;
    if ((!company && !title) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function noteEntries(item: Candidate) {
  if (Array.isArray(item.note_set)) return item.note_set;
  if (item.note_set && typeof item.note_set === 'object') return Object.values(item.note_set);
  return [];
}

function mappingRecentNote(item: Candidate) {
  const entries = noteEntries(item)
    .map((entry) => ({
      text: textValue(entry.content || entry.note, ''),
      date: entry.lastUpdateDate || entry.dateAdded,
      consultant: textValue(entry.user, '') || textValue(entry.addedBy, ''),
    }))
    .filter((entry) => entry.text);
  entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const direct = candidateNoteText(item);
  return entries[0] || {
    text: direct || '',
    date: item.noteDate || item.lastContactDate || item.lastUpdateDate || item.dateAdded || '',
    consultant: '',
  };
}

function mappingConsultant(item: Candidate, noteConsultant = '') {
  return noteConsultant || textValue(item.lastUpdateBy, '') || textValue(item.owner, '') || textValue(item.addedBy, '') || '未记录';
}

function inferMappingLevel2(parts: string[]) {
  const haystack = parts.join(' ').toLowerCase();
  if (/hrbp|人力资源|组织发展|招聘|talent|od|coe|ssc|hr/.test(haystack)) return '人力资源 / 招聘线';
  if (/商业化|销售|客户|大客户|渠道|市场|增长|business|sales|marketing/.test(haystack)) return '商业化 / 市场销售线';
  if (/产品|用户|策略|运营|内容|平台|product|operation/.test(haystack)) return '产品 / 运营线';
  if (/技术|研发|算法|数据|工程|架构|后端|前端|测试|tech|engineer|data/.test(haystack)) return '技术 / 数据线';
  if (/财务|法务|采购|行政|内控|审计/.test(haystack)) return '职能支持线';
  return '待确认';
}

function inferMappingLevel3(parts: string[], fallbackTitle: string) {
  const haystack = parts.join(' ').toLowerCase();
  if (/负责人|总监|head|director|vp|leader|lead|负责人/.test(haystack)) return '负责人 / 管理岗';
  if (/hrbp/.test(haystack)) return 'HRBP';
  if (/招聘|recruit/.test(haystack)) return '招聘团队';
  if (/组织发展|od/.test(haystack)) return '组织发展';
  if (/产品/.test(haystack)) return '产品团队';
  if (/运营/.test(haystack)) return '运营团队';
  if (/销售|大客户|商务|bd/.test(haystack)) return '销售 / BD 团队';
  if (/算法|数据/.test(haystack)) return '算法 / 数据团队';
  if (/研发|工程|后端|前端/.test(haystack)) return '研发团队';
  return fallbackTitle || '待确认岗位族';
}

function mappingConfidence(level2: string, level3: string, noteText: string): MappingCandidate['confidence'] {
  if (level2 !== '待确认' && level3 !== '待确认岗位族' && noteText) return '高';
  if (level2 !== '待确认' || level3 !== '待确认岗位族') return '中';
  return '低';
}

async function fetchMappingCandidateRows(queries: string[], pageSize: number) {
  if (!queries.length) return { list: [] as Candidate[], rawRows: 0, fromMock: false, queries: 0 };
  const demandKeys = JSON.stringify(['company', 'avatar', 'addedBy', 'owner', 'lastUpdateBy', 'candidateexperience_set']);
  const responses = await Promise.allSettled(
    queries.map((keyword) =>
      client.get('/rest/candidate/list', {
        params: {
          keyword,
          gql: 'type=candidate&source=gllue',
          demandKeys,
          ordering: '-lastUpdateDate',
          paginate_by: String(pageSize),
          page: '1',
        },
      }),
    ),
  );
  const rows = new Map<number, Candidate>();
  let rawRows = 0;
  responses.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    const normalized = normalizeList<Candidate>(result.value.data).list;
    rawRows += normalized.length;
    normalized.forEach((item) => rows.set(item.id, { ...rows.get(item.id), ...item }));
  });
  return {
    list: Array.from(rows.values()).slice(0, pageSize * 2),
    rawRows,
    fromMock: responses.every((result) => result.status === 'rejected'),
    queries: queries.length,
  };
}

async function getMappingProject(input: MappingSearchInput): Promise<MappingProject> {
  const targetCompany = input.targetCompany.trim();
  const keywords = splitMappingKeywords(input.keywords);
  const roleFocus = input.roleFocus?.trim();
  const querySeeds = Array.from(new Set([
    targetCompany,
    ...keywords.map((keyword) => `${targetCompany} ${keyword}`),
    ...(roleFocus ? [`${targetCompany} ${roleFocus}`] : []),
    ...keywords,
  ].map((item) => item.trim()).filter(Boolean))).slice(0, 14);
  const rowsResult = await fetchMappingCandidateRows(querySeeds, 18);
  const details = await Promise.all(rowsResult.list.map((item) => getDetail<Candidate>('/rest/candidate/detail', item.id)));
  const detailMap = new Map(details.filter(Boolean).map((item) => [item!.id, item!]));
  const mergedRows = rowsResult.list.map((item) => ({ ...item, ...detailMap.get(item.id) }));
  const submissions = await Promise.all(
    mergedRows.map((item) =>
      getMaybeList<PipelineSubmission>('/rest/jobsubmission/list', {
        gql: `candidate__id__eq=${item.id}`,
        ordering: '-id',
        paginate_by: '8',
        page: '1',
      }).catch(() => ({ list: [] as PipelineSubmission[], count: 0, fromMock: false })),
    ),
  );

  const candidates = mergedRows.map<MappingCandidate>((item, index) => {
    const experiences = candidateExperiencesForMapping(item);
    const note = mappingRecentNote(item);
    const parts = [
      candidateName(item),
      candidateCompany(item),
      candidateTitle(item),
      note.text,
      ...experiences.flatMap((experience) => [experience.company, experience.title]),
      ...keywords,
      roleFocus,
    ].map((part) => textValue(part, ''));
    const level2 = inferMappingLevel2(parts);
    const level3 = inferMappingLevel3(parts, textValue(candidateTitle(item), '待确认岗位族'));
    const sourceSignals = Array.from(new Set([
      targetCompany && parts.some((part) => normalizeName(part).includes(normalizeName(targetCompany))) ? `公司：${targetCompany}` : '',
      ...keywords.filter((keyword) => parts.some((part) => normalizeName(part).includes(normalizeName(keyword)))).map((keyword) => `关键词：${keyword}`),
      note.text ? '最近备注' : '',
      experiences.length ? '工作经历' : '',
      submissions[index]?.list.length ? '项目流程' : '',
    ].filter(Boolean)));
    return {
      id: item.id,
      name: candidateName(item),
      currentCompany: textValue(candidateCompany(item), '未记录'),
      title: textValue(candidateTitle(item), '未记录'),
      experiences,
      recentNoteText: note.text || '暂无备注摘要',
      recentNoteDate: textValue(note.date, '未记录'),
      consultant: mappingConsultant(item, note.consultant),
      lastUpdateDate: textValue(item.lastUpdateDate || item.lastContactDate || item.dateAdded, '未记录'),
      detailHash: `#candidate/detail?id=${item.id}`,
      sourceSignals,
      suggestedLevel2: level2,
      suggestedLevel3: level3,
      confidence: mappingConfidence(level2, level3, note.text),
      nextAction: level2 === '待确认' ? '电话/备注确认所属团队' : '人工确认层级并补充汇报关系',
      submissions: (submissions[index]?.list || []).map((submission) => ({
        id: submission.id,
        projectName: textValue(submission.joborder?.jobTitle || submission.joborder?.__name__, '未记录项目'),
        companyName: textValue(submission.joborder?.client?.name || submission.joborder?.client?.__name__, '未记录客户'),
        status: textValue(submission.jobsubmission_status?.value || submission.jobsubmission_status?.__name__ || submission.jobsubmission_status?.code, '未记录'),
        updatedAt: textValue(submission.lastUpdateDate || submission.dateAdded, '未记录'),
      })),
    };
  });

  const groupMap = new Map<string, number[]>();
  candidates.forEach((candidate) => {
    const key = `${candidate.suggestedLevel2}|||${candidate.suggestedLevel3}`;
    groupMap.set(key, [...(groupMap.get(key) || []), candidate.id]);
  });
  const structure = Array.from(groupMap.entries()).map(([key, candidateIds]) => {
    const [level2, level3] = key.split('|||');
    return { level1: targetCompany || '目标公司', level2, level3, candidateIds };
  });
  const gaps = [
    candidates.some((item) => /hrbp/i.test(`${item.title} ${item.suggestedLevel3}`)) ? '' : '缺 HRBP 负责人或核心成员线索',
    candidates.some((item) => /招聘|recruit/i.test(`${item.title} ${item.suggestedLevel3}`)) ? '' : '缺招聘团队负责人或成员线索',
    candidates.some((item) => item.suggestedLevel2 === '待确认') ? '部分候选人所属部门待确认' : '',
    candidates.length < 12 ? '候选人样本偏少，建议补充脉脉/电话寻访线索' : '',
  ].filter(Boolean);

  return {
    id: `mapping-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    targetCompany: targetCompany || '未命名目标公司',
    keywords,
    roleFocus,
    fromMock: rowsResult.fromMock,
    stats: {
      queries: rowsResult.queries,
      rawRows: rowsResult.rawRows,
      uniqueCandidates: rowsResult.list.length,
      withDetails: detailMap.size,
    },
    structure,
    candidates,
    gaps,
  };
}

async function fetchAllPages<T>(api: string, params: Record<string, string>, maxPages = 300, pageSize = 100) {
  const rows = new Map<number, T & { id: number }>();
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await client.get(api, {
      params: {
        ...params,
        paginate_by: String(pageSize),
        page: String(page),
        start: String((page - 1) * pageSize),
        iDisplayStart: String((page - 1) * pageSize),
      },
    });
    const normalized = normalizeList<T & { id: number }>(response.data).list;
    normalized.forEach((item) => rows.set(item.id, { ...rows.get(item.id), ...item }));
    if (normalized.length < pageSize) break;
  }
  return Array.from(rows.values());
}

async function mapInChunks<T, R>(items: T[], size: number, mapper: (item: T) => Promise<R | null>) {
  const results: R[] = [];
  let failures = 0;
  for (let index = 0; index < items.length; index += size) {
    const chunk = items.slice(index, index + size);
    const settled = await Promise.allSettled(chunk.map(mapper));
    settled.forEach((result) => {
      if (result.status === 'fulfilled' && result.value) results.push(result.value);
      else failures += 1;
    });
  }
  return { results, failures };
}

async function exportReadonlySnapshot(): Promise<GllueExportSnapshot> {
  const candidateDemandKeys = JSON.stringify(['company', 'avatar', 'addedBy', 'owner', 'lastUpdateBy', 'candidateexperience_set']);
  const [candidates, clients, jobs, submissions, todos] = await Promise.all([
    fetchAllPages<Candidate>('/rest/candidate/list', {
      gql: 'type=candidate&source=gllue',
      demandKeys: candidateDemandKeys,
      ordering: '-lastUpdateDate',
    }),
    fetchAllPages<ClientCompany>('/rest/client/list', {
      gql: 'type__eq=client',
      ordering: '-id',
    }),
    fetchAllPages<JobOrder>('/rest/joborder/list', {
      ordering: '-lastUpdateDate',
    }),
    fetchAllPages<PipelineSubmission>('/rest/jobsubmission/list', {
      ordering: '-id',
    }),
    fetchAllPages<TodoItem>('/rest/todo/list', {
      ordering: '-start_date',
    }, 80),
  ]);
  const detailResult = await mapInChunks(candidates, 6, (candidate) => getDetail<Candidate>('/rest/candidate/detail', candidate.id));
  return {
    id: `gllue-export-${Date.now()}`,
    generatedAt: new Date().toISOString(),
    source: 'gllue-readonly-browser',
    stats: {
      candidates: candidates.length,
      candidateDetails: detailResult.results.length,
      clients: clients.length,
      jobs: jobs.length,
      submissions: submissions.length,
      todos: todos.length,
      failedCandidateDetails: detailResult.failures,
    },
    data: {
      candidates,
      candidateDetails: detailResult.results,
      clients,
      jobs,
      submissions,
      todos,
    },
  };
}

// 谷露原生查重接口：POST /rest/candidate/check，按邮箱/手机精确查，
// 返回 { status, data: <候选人> }。与谷露新增页"重复数据"提示完全一致。
async function checkCandidateDuplicate(field: 'email' | 'mobile', value: string): Promise<Candidate | null> {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const body = new URLSearchParams();
    body.set(field, trimmed);
    const response = await client.post('/rest/candidate/check', body.toString(), {
      params: { _v: Math.random().toString(16).slice(2, 12) },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    });
    const payload = response.data as { status?: boolean; data?: Candidate } | undefined;
    if (payload?.status && payload.data && payload.data.id) return payload.data;
    return null;
  } catch {
    return null;
  }
}

async function getCandidateImportMatches(identity: ResumeIdentity, pageSize = 8) {
  // 优先用谷露原生查重接口 /rest/candidate/check（按邮箱/手机精确命中），与谷露页面"重复数据"一致。
  const directHits = await Promise.all([
    ...identity.emails.map((email) => checkCandidateDuplicate('email', email)),
    ...identity.phones.map((phone) => checkCandidateDuplicate('mobile', phone)),
  ]);
  const directById = new Map<number, Candidate>();
  directHits.forEach((hit) => {
    if (hit && hit.id) directById.set(hit.id, hit);
  });
  if (directById.size) {
    const list = Array.from(directById.values()).slice(0, pageSize);
    void upsertCandidateSummaries(list);
    return { list, count: directById.size, fromMock: false };
  }

  const enhancedMatches = await matchResumeWithEnhance(identity);
  if (enhancedMatches?.length) {
    return {
      list: enhancedMatches.slice(0, pageSize),
      count: enhancedMatches.length,
      fromMock: false,
    };
  }

  const strongQueries = Array.from(new Set([...identity.phones, ...identity.emails].map((signal) => signal.trim()).filter((signal) => signal.length >= 5))).slice(0, 6);
  const strongResult = await fetchCandidateImportRows(strongQueries, pageSize);
  const strongMatches = strongResult.list.filter((item) => hasExactContactMatch(item, identity));
  void upsertCandidateSummaries(strongResult.list);
  const weakName = identity.nameFromContent || identity.nameFromFilename || identity.name;
  if (strongMatches.length || identity.phones.length || identity.emails.length || !weakName) {
    return {
      ...strongResult,
      list: strongMatches.slice(0, pageSize),
      count: strongMatches.length,
    };
  }

  const weakResult = await fetchCandidateImportRows([weakName], pageSize);
  const weakMatches = weakResult.list.filter((item) => hasExactNameMatch(item, weakName));
  void upsertCandidateSummaries(weakResult.list);
  return {
    ...weakResult,
    list: weakMatches.slice(0, pageSize),
    count: weakMatches.length,
  };
}

interface KpiReportCell {
  value?: number;
  link_detail?: string | null;
}

interface KpiReportResponse {
  data?: Record<string, Record<string, KpiReportCell>>;
}

type ClientInterviewRecord = {
  id: number;
  date?: string;
  dateAdded?: string;
  lastUpdateDate?: string;
  user?: number | { chineseName?: string; __name__?: string };
  jobsubmission?: PipelineSubmission;
};

function parseGllueListLink(link: string) {
  const hash = link.split('#')[1] || link;
  const [route, query = ''] = hash.split('?');
  return {
    api: `/rest/${route.replace(/^\/+/, '')}`,
    params: Object.fromEntries(new URLSearchParams(query)),
  };
}

function normalizeKpiWorkflowRecord(record: PipelineSubmission | ClientInterviewRecord, type: 'cvsent' | 'clientinterview'): PipelineSubmission {
  if (type === 'clientinterview' && 'jobsubmission' in record && record.jobsubmission) {
    return {
      ...record.jobsubmission,
      detail: {
        name: '客户面试',
        external_type: 'clientinterview',
        target: {
          date: record.date,
          dateAdded: record.dateAdded,
          user: record.user,
        },
      },
      lastUpdateDate: record.lastUpdateDate ?? record.jobsubmission.lastUpdateDate,
    };
  }
  return record as PipelineSubmission;
}

async function getKpiDetailList(link: string | null | undefined, type: 'cvsent' | 'clientinterview', pageSize = 12) {
  if (!link) return { list: [], count: 0, fromMock: false };
  const { api, params } = parseGllueListLink(link);
  const response = await client.get(api, {
    params: {
      ...params,
      ordering: '-id',
      paginate_by: String(pageSize),
      page: '1',
    },
  });
  const normalized = normalizeList<PipelineSubmission | ClientInterviewRecord>(response.data);
  return {
    list: normalized.list.map((item) => normalizeKpiWorkflowRecord(item, type)),
    count: normalized.count,
    current: normalized.current,
    pages: normalized.pages,
    fromMock: false,
  };
}

async function getWeeklyKpiWorkflows(pageSize = 12): Promise<KpiWorkflowSummary> {
  const fallback = async (): Promise<KpiWorkflowSummary> => {
    const [recommended, interviews] = await Promise.all([gllueApi.getWeeklyRecommended(1, pageSize), gllueApi.getWeeklyInterviews(1, pageSize)]);
    return { fromMock: recommended.fromMock || interviews.fromMock, recommended, interviews };
  };

  try {
    const response = await client.get<KpiReportResponse>('/rest/reporttemplate/report', {
      params: {
        config_name: '',
        daterange__this_week: '',
        datetype: 'date',
        filter_basic: '',
        gql: 'user__status__s=Active&user={{user.id}}',
        groupby_x: 'fields',
        groupby_y: 'user__id',
        groupby_z: '',
        score_config_name: '',
        suffix: 'o_1be072aesotm1qfudlv1vse55c1',
        suffix_user_id: '-1',
        type: 'kpi',
      },
    });
    const row = Object.values(response.data.data ?? {})[0];
    if (!row) return fallback();
    const [recommended, interviews] = await Promise.all([
      getKpiDetailList(row.workflow_cvsent?.link_detail, 'cvsent', pageSize),
      getKpiDetailList(row.workflow_clientinterview?.link_detail, 'clientinterview', pageSize),
    ]);
    return {
      fromMock: false,
      recommended: { ...recommended, count: Number(row.workflow_cvsent?.value ?? recommended.count) },
      interviews: { ...interviews, count: Number(row.workflow_clientinterview?.value ?? interviews.count) },
    };
  } catch {
    return fallback();
  }
}

async function getGlobalSearch(keyword: string, pageSize = 5): Promise<GlobalSearchResult[]> {
  const query = keyword.trim();
  if (!query) return [];

  const [candidates, clients, jobs] = await Promise.all([
    getList<Candidate>('/rest/candidate/list', 'candidates', 1, pageSize, mockCandidates, { keyword: query }),
    getList<ClientCompany>('/rest/client/list', 'clients', 1, pageSize, mockClients, { keyword: query }),
    getList<JobOrder>('/rest/joborder/list', 'jobs', 1, pageSize, mockJobs, { keyword: query }),
  ]);

  return [
    ...candidates.list.slice(0, pageSize).map<GlobalSearchResult>((item) => ({
      id: item.id,
      kind: 'candidate',
      title: candidateName(item),
      subtitle: [candidateCompany(item), item.title || item.candidateexperience_set?.[0]?.title].filter(Boolean).join(' · '),
      meta: [item.locations?.[0]?.name || item.locations?.[0]?.__name__, item.lastContactDate || item.dateAdded].filter(Boolean).join(' · '),
      hash: `#candidate/detail?id=${item.id}`,
      fromMock: candidates.fromMock,
    })),
    ...clients.list.slice(0, pageSize).map<GlobalSearchResult>((item) => ({
      id: item.id,
      kind: 'client',
      title: clientName(item),
      subtitle: [item.industry?.name || item.industry?.__name__, cityName(item.city)].filter(Boolean).join(' · '),
      meta: [typeof item.bd === 'object' ? item.bd.chineseName || item.bd.__name__ : item.bd ? String(item.bd) : '', item.lastContactDate || item.lastUpdateDate].filter(Boolean).join(' · '),
      hash: `#client/detail?id=${item.id}`,
      fromMock: clients.fromMock,
    })),
    ...jobs.list.slice(0, pageSize).map<GlobalSearchResult>((item) => ({
      id: item.id,
      kind: 'job',
      title: jobName(item),
      subtitle: [jobClient(item), item.jobStatus?.value || item.jobStatus?.__name__ || item.jobStatus?.code].filter(Boolean).join(' · '),
      meta: [`推荐 ${item.cvsent_count?.value ?? 0}`, `面试 ${item.clientinterview_count?.value ?? 0}`, item.lastOperationFlowDateTime || item.lastUpdateDate].filter(Boolean).join(' · '),
      hash: `#joborder/detail?id=${item.id}`,
      fromMock: jobs.fromMock,
    })),
  ];
}

function moduleToDataModule(module: ModuleKey): GllueDataModule {
  if (module === 'clients') return 'client';
  if (module === 'jobs') return 'joborder';
  return 'candidate';
}

export const gllueApi = {
  apiMap: map,
  getCandidates: (page = 1, pageSize = 10, filters?: Partial<ListFilters>) => getList<Candidate>('/rest/candidate/list', 'candidates', page, pageSize, mockCandidates, filters),
  getClients: (page = 1, pageSize = 10, filters?: Partial<ListFilters>) => getList<ClientCompany>('/rest/client/list', 'clients', page, pageSize, mockClients, filters),
  getJobs: (page = 1, pageSize = 10, filters?: Partial<ListFilters>) => getList<JobOrder>('/rest/joborder/list', 'jobs', page, pageSize, mockJobs, filters),
  getCandidateDetail: (id: number) => getDetail<Candidate>('/rest/candidate/detail', id),
  getCandidateImportMatches,
  getClientDetail: (id: number) => getDetail<ClientCompany>('/rest/client/detail', id),
  getJobDetail: (id: number) => getDetail<JobOrder>('/rest/joborder/detail', id),
  getFacetFields: (module: ModuleKey) => client.get<FacetFields>(`/rest/${moduleToDataModule(module)}/facet/fields`).then((response) => response.data).catch(() => null),
  getSavedSearches: (module: ModuleKey) =>
    client
      .get<GllueListResponse<SavedSearch>>('/rest/queryfilter/list', { params: { type: moduleToDataModule(module), paginate_by: 50 } })
      .then((response) => normalizeList<SavedSearch>(response.data).list)
      .catch(() => []),
  getTodos: (page = 1, pageSize = 8) =>
    getMaybeList<TodoItem>('/rest/todo/list', {
      gql: 'todouser_set__user__eq={{user.id}}&start_date__this_week&done__eq',
      ordering: 'start_date',
      paginate_by: String(pageSize),
      page: String(page),
    }),
  getPipeline: (page = 1, pageSize = 8) =>
    getMaybeList<PipelineSubmission>('/rest/jobsubmission/list', {
      gql: 'joborder__jobStatus__eq=Live&_hide_spec_id=1',
      ordering: '-lastUpdateDate',
      paginate_by: String(pageSize),
      page: String(page),
    }),
  getCandidateSubmissions: (candidateId: number, pageSize = 12) =>
    getMaybeList<PipelineSubmission>('/rest/jobsubmission/list', {
      gql: `candidate__id__eq=${candidateId}`,
      ordering: '-id',
      paginate_by: String(pageSize),
      page: '1',
    }),
  getJobSubmissions: (jobId: number, pageSize = 12) =>
    getMaybeList<PipelineSubmission>('/rest/jobsubmission/list', {
      gql: `joborder__id=${jobId}`,
      ordering: '-id',
      paginate_by: String(pageSize),
      page: '1',
    }),
  getWeeklyRecommended: (page = 1, pageSize = 12) =>
    getMaybeList<PipelineSubmission>('/rest/jobsubmission/list', {
      gql: 'joborder__jobStatus__eq=Live&_hide_spec_id=1&jobsubmission_status_kanban=cvsent&cvsent_set__user__eq={{user.id}}&cvsent_set__date__this_week',
      ordering: '-lastUpdateDate',
      paginate_by: String(pageSize),
      page: String(page),
    }),
  getWeeklyInterviews: (page = 1, pageSize = 12) =>
    getMaybeList<PipelineSubmission>('/rest/jobsubmission/list', {
      gql: 'clientinterview_set__date__this_week&jobsubmission_status__current=clientinterview,offersign&candidate__owner__eq={{user.id}}',
      ordering: '-lastUpdateDate',
      paginate_by: String(pageSize),
      page: String(page),
    }),
  getWeeklyKpiWorkflows,
  getGlobalSearch,
  getMappingProject,
  exportReadonlySnapshot,
  getTodayCandidates: async (limit = 300) => {
    const today = localDateKey();
    const notedTodayContacts = new Map<number, Candidate>();
    const todayContacts = new Map<number, Candidate>();
    let hasLiveResponse = false;
    let rowsScanned = 0;
    const demandKeys = JSON.stringify(['company', 'avatar', 'addedBy', 'owner']);

    const queryVariants: Array<Record<string, string | number>> = [
      { gql: 'type=candidate&source=gllue', ordering: '-lastContactDate' },
      { gql: 'type=candidate&source=gllue', ordering: '-id', savedSearchId: '23815' },
      { gql: 'owner__eq=%7B%7Buser.id%7D%7D&type=candidate&source=gllue', ordering: '-lastContactDate', savedSearchId: '23815' },
    ];

    for (const variant of queryVariants) {
      for (let page = 1; page <= 20 && notedTodayContacts.size < limit; page += 1) {
        let rows: Candidate[] = [];
        try {
          const response = await client.get<GllueListResponse<Candidate>>('/rest/candidate/list', {
            params: { ...variant, demandKeys, paginate_by: 50, page },
          });
          rows = normalizeList<Candidate>(response.data).list;
          rowsScanned += rows.length;
          hasLiveResponse = true;
        } catch {
          break;
        }
        const todayRows = rows.filter((item) => String(candidateActivityDate(item) || '').slice(0, 10) === today);
        todayRows.forEach((item) => todayContacts.set(item.id, item));
        todayRows
          .filter((item) => candidateNoteText(item) || Number(item.note_count ?? item.candidate__note_count ?? 0) > 0)
          .forEach((item) => notedTodayContacts.set(item.id, { ...item, today_note_text: candidateNoteText(item) }));
        const hasOlderRows = rows.some((item) => {
          const date = String(candidateActivityDate(item) || '').slice(0, 10);
          return Boolean(date) && date < today;
        });
        if (!rows.length || hasOlderRows) break;
      }
    }

    if (!hasLiveResponse) {
      return { list: mockCandidates, count: mockCandidates.length, fromMock: true };
    }

    console.info('[GllueShell] today candidate source', {
      date: today,
      todayContacts: todayContacts.size,
      notedTodayContacts: notedTodayContacts.size,
      variants: queryVariants.length,
      rowsScanned,
    });

    if (notedTodayContacts.size) {
      return { list: Array.from(notedTodayContacts.values()).slice(0, limit), count: notedTodayContacts.size, fromMock: false };
    }

    return {
      list: Array.from(todayContacts.values())
        .slice(0, limit)
        .map((item) => ({ ...item, today_note_text: '今日有联系记录，列表接口未返回备注正文' })),
      count: todayContacts.size,
      fromMock: false,
    };
  },
};

export function getModuleApis(moduleKey: ModuleKey) {
  return map.filter((entry) => entry.modules.includes(moduleNames[moduleKey]));
}
