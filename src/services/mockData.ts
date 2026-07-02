import type { Candidate, ClientCompany, DashboardMetric, JobOrder } from '../types/gllue';

export const mockCandidates: Candidate[] = [
  {
    id: 4552444,
    chineseName: '张子璇',
    company: { name: '智象未来(AI 创业公司)' },
    title: 'AIGC 产品',
    work_years: 5,
    dateAdded: '2026-05-14 15:37',
    source: { value: '手工录入' },
    locations: [{ name: '上海' }],
  },
  {
    id: 4552301,
    chineseName: '宋春晓',
    company: { name: '广州网易计算机系统有限公司' },
    title: '资深文案策划',
    work_years: 7,
    dateAdded: '2026-05-14 10:37',
    source: { value: '手工录入' },
    locations: [{ name: '广州' }],
  },
  {
    id: 4548694,
    chineseName: '马潇涵',
    company: { name: '深圳市禅游科技股份有限公司' },
    title: '游戏发行组长',
    work_years: 8,
    dateAdded: '2026-04-22 19:19',
    source: { value: '人才库' },
    locations: [{ name: '深圳' }],
  },
];

export const mockClients: ClientCompany[] = [
  {
    id: 3206907,
    name: '智象未来(AI 创业公司)',
    city: { name: '上海' },
    industry: { name: '人工智能' },
    type: { value: '客户' },
    lastContactDate: '2026-05-14',
  },
  {
    id: 209263,
    name: '广州网易计算机系统有限公司',
    city: { name: '广州' },
    industry: { name: '游戏' },
    type: { value: '客户' },
    lastContactDate: '2026-05-12',
  },
  {
    id: 3893,
    name: '腾讯',
    city: { name: '深圳' },
    industry: { name: '互联网' },
    type: { value: '客户' },
    lastContactDate: '2026-04-29',
  },
];

export const mockJobs: JobOrder[] = [
  {
    id: 7710,
    jobTitle: '猫箱',
    client: { name: '远景能源集团总部', id: 1 },
    jobStatus: { value: 'Live', code: 'Live' },
    cvsent_count: { value: 15 },
    clientinterview_count: { value: 1 },
    lastOperationFlowDateTime: '2026-05-14 16:17',
  },
  {
    id: 7788,
    jobTitle: 'Vivix',
    client: { name: '远景科技集团', id: 2 },
    jobStatus: { value: 'Live', code: 'Live' },
    cvsent_count: { value: 24 },
    clientinterview_count: { value: 12 },
    lastOperationFlowDateTime: '2026-05-13 10:37',
  },
  {
    id: 8136,
    jobTitle: '智元机器人',
    client: { name: '远景能源集团总部', id: 1 },
    jobStatus: { value: 'Live', code: 'Live' },
    cvsent_count: { value: 5 },
    clientinterview_count: { value: 1 },
    lastOperationFlowDateTime: '2026-05-07 11:26',
  },
];

export const mockMetrics: DashboardMetric[] = [
  { label: '我的人才', value: 141, tone: 'blue', hint: '已纳入当前顾问视图' },
  { label: '客户公司', value: 38, tone: 'green', hint: '含客户与潜在客户' },
  { label: '进展项目', value: 20, tone: 'yellow', hint: 'Live 项目优先展示' },
  { label: '待处理流程', value: 55, tone: 'pink', hint: '来自 Dashboard 与消息提醒' },
];
