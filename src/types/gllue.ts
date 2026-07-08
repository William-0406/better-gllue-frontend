export type ModuleKey = 'dashboard' | 'candidates' | 'clients' | 'jobs' | 'mapping' | 'leaderboard' | 'projectMap';
export type GllueDataModule = 'candidate' | 'client' | 'joborder';
export type SearchResultKind = 'candidate' | 'client' | 'job';

export interface ApiMapEntry {
  api: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | string;
  modules: string[];
  request_params?: {
    query?: Record<string, string>;
    body?: unknown;
    body_type?: string | null;
  };
  response_json_shape?: unknown;
  response_example?: unknown;
  requires_cookie?: boolean;
  requires_authorization_header?: boolean;
  requires_token_header?: boolean;
}

export interface GllueListResponse<T> {
  count: number;
  list: T[];
  current?: number;
  pages?: number;
  type?: string;
}

export interface GllueMaybeListResponse<T> extends GllueListResponse<T> {
  fromMock?: boolean;
}

export interface Candidate {
  id: number;
  __name__?: string;
  chineseName?: string;
  englishName?: string;
  company?: { name?: string; __name__?: string; id?: number };
  title?: string;
  mobile?: string;
  mobile1?: string;
  mobile2?: string;
  phone?: string;
  phone1?: string;
  phone2?: string;
  email?: string;
  email1?: string;
  email2?: string;
  email3?: string;
  work_years?: number;
  dateAdded?: string;
  source?: { value?: string; __name__?: string };
  locations?: Array<{ name?: string; __name__?: string }>;
  candidateexperience_set?: Array<{
    title?: string;
    client?: { name?: string; __name__?: string };
    is_current?: boolean;
  }>;
  note_set?:
    | Array<{ content?: string; note?: string; dateAdded?: string; lastUpdateDate?: string; user?: number | { chineseName?: string; __name__?: string }; addedBy?: number | { chineseName?: string; __name__?: string } }>
    | Record<string, { content?: string; note?: string; dateAdded?: string; lastUpdateDate?: string; user?: number | { chineseName?: string; __name__?: string }; addedBy?: number | { chineseName?: string; __name__?: string } }>;
  note?: string | { content?: string; note?: string };
  noteDate?: string | null;
  note_count?: number;
  candidate__note_count?: number;
  today_note_text?: string;
  attachment_count?: number;
  lastContactDate?: string;
  lastUpdateDate?: string;
  lastUpdateBy?: number | { chineseName?: string; __name__?: string };
  addedBy?: number | { chineseName?: string; __name__?: string };
  owner?: number | { chineseName?: string; __name__?: string };
  tags?: Array<{ name?: string; __name__?: string }>;
}

export interface ClientCompany {
  id: number;
  name?: string;
  company_name?: string;
  __name__?: string;
  city?: { name?: string; __name__?: string } | number;
  industry?: { name?: string; __name__?: string };
  type?: { value?: string; __name__?: string };
  bd?: number | { chineseName?: string; __name__?: string };
  dateAdded?: string;
  lastContactDate?: string | null;
  lastUpdateDate?: string;
}

export interface JobOrder {
  id: number;
  jobTitle?: string;
  __name__?: string;
  client?: ClientCompany;
  city?: { name?: string; __name__?: string } | number;
  jobStatus?: { value?: string; __name__?: string; code?: string };
  openDate?: string;
  closeDate?: string | null;
  dateAdded?: string;
  lastUpdateDate?: string;
  lastOperationFlowDateTime?: string;
  cvsent_count?: { value?: number };
  clientinterview_count?: { value?: number };
  offer_count?: { value?: number };
  joborderuser_set?: Array<{ user?: { chineseName?: string; __name__?: string } }>;
  jobsubmission_count?: Array<{ name?: string; value?: number; link?: string }>;
  citys?: Array<{ name?: string; __name__?: string }>;
  livedays?: number;
}

export interface TodoItem {
  id: number;
  subject?: string;
  title?: string;
  type?: { value?: string; __name__?: string };
  start_date?: string;
  done?: boolean;
  object_repr?: string;
  __name__?: string;
}

export interface PipelineSubmission {
  id: number;
  candidate?: Candidate;
  joborder?: JobOrder;
  jobsubmission_status?: { value?: string; __name__?: string; code?: string };
  lastUpdateDate?: string;
  dateAdded?: string;
  detail?: {
    name?: string;
    external_type?: string;
    target?: {
      date?: string;
      dateAdded?: string;
      user?: number | { chineseName?: string; __name__?: string };
    };
  };
  __name__?: string;
}

export interface KpiWorkflowSummary {
  fromMock?: boolean;
  recommended: GllueMaybeListResponse<PipelineSubmission>;
  interviews: GllueMaybeListResponse<PipelineSubmission>;
}

export interface SavedSearch {
  id: number | string;
  name?: string;
  __name__?: string;
  type?: string;
}

export interface FacetFields {
  fields?: unknown[];
  [key: string]: unknown;
}

export interface ListFilters {
  keyword: string;
  city: string;
  company: string;
  status: string;
  owner: string;
  dateFrom: string;
  dateTo: string;
  sort: string;
}

export interface DashboardMetric {
  label: string;
  value: number | string;
  tone: 'blue' | 'green' | 'yellow' | 'pink';
  hint: string;
}

export interface PageState<T> {
  rows: T[];
  loading: boolean;
  error?: string;
  total: number;
  page: number;
  pageSize: number;
  fromMock: boolean;
}

export interface GlobalSearchResult {
  id: number;
  kind: SearchResultKind;
  title: string;
  subtitle: string;
  meta: string;
  hash: string;
  fromMock?: boolean;
}

export interface PendingRecommendation {
  id: string;
  source: 'candidate' | 'job';
  candidateId?: number;
  candidateName?: string;
  jobId?: number;
  jobName?: string;
  companyName?: string;
  startedAt: string;
  expiresAt: string;
  snapshot: {
    count: number;
    reliable: boolean;
    submissionIds: number[];
  };
}

export interface RecommendationReward {
  id: string;
  title: string;
  message: string;
  candidateName?: string;
  jobName?: string;
  companyName?: string;
  rewardedAt: string;
  submissionId?: number;
}

export interface RecommendationStats {
  todayCount: number;
  totalCount: number;
  streakDays: number;
  lastRewardAt?: string;
  recentRewards: RecommendationReward[];
}

export interface MaimaiProfile {
  name?: string;
  company?: string;
  title?: string;
  experiences?: Array<{ company?: string; title?: string }>;
  education?: string;
  age?: string;
  // 脉脉个别页面会露出联系方式（如已交换/已实名场景），抓到就带上；浮窗里可手动改。
  mobile?: string;
  email?: string;
  sourceUrl: string;
}

// 顾问（谷露用户）。用于主页"关注顾问"模块的多选。
export interface Consultant {
  id: number;
  name: string;
  active: boolean;
  teamId?: number;
  teamName?: string;
}

// 当前登录用户（用于按团队软性收窄顾问选择）。
export interface CurrentUser {
  id?: number;
  teamId?: number;
  teamName?: string;
}

// 顾问近一个月推荐（cvsent）的人选一行。
export interface ConsultantRecommendation {
  submissionId: number;
  candidateId?: number;
  candidateName: string;
  company: string;
  title: string;
  date: string;
  consultantId: number;
  consultantName: string;
}

export interface CandidateMatchResult {
  status: 'matched' | 'not_found' | 'unknown';
  profile: MaimaiProfile;
  candidates: Array<{
    id: number;
    name: string;
    company?: string;
    title?: string;
    lastUpdateDate?: string;
    recentNoteDate?: string;
    recentNoteText?: string;
    consultant?: string;
    matchedExperience?: string;
    matchReason?: string;
    score: number;
    tier?: 'strong' | 'likely' | 'homonym';
  }>;
  error?: string;
}

export interface MappingSearchInput {
  targetCompany: string;
  keywords: string[];
  roleFocus?: string;
}

export interface MappingExperience {
  company: string;
  title: string;
  isCurrent?: boolean;
}

export interface MappingCandidate {
  id: number;
  name: string;
  currentCompany: string;
  title: string;
  experiences: MappingExperience[];
  recentNoteText: string;
  recentNoteDate: string;
  consultant: string;
  lastUpdateDate: string;
  detailHash: string;
  sourceSignals: string[];
  suggestedLevel2: string;
  suggestedLevel3: string;
  confidence: '高' | '中' | '低';
  nextAction: string;
  submissions: Array<{
    id: number;
    projectName: string;
    companyName: string;
    status: string;
    updatedAt: string;
  }>;
}

export interface MappingProject {
  id: string;
  generatedAt: string;
  targetCompany: string;
  keywords: string[];
  roleFocus?: string;
  fromMock: boolean;
  stats: {
    queries: number;
    rawRows: number;
    uniqueCandidates: number;
    withDetails: number;
  };
  structure: Array<{
    level1: string;
    level2: string;
    level3: string;
    candidateIds: number[];
  }>;
  candidates: MappingCandidate[];
  gaps: string[];
}

// 项目图谱（在招项目）：顾问手动维护，不来自谷露 joborder（名字大量是 undefined，参考 §5/§7 交接手册）。
// 存在 enhance server 的 projects.json 里，全员可增删改。
export type TeamProjectStatus = '进行中' | '已结束';

export interface TeamProject {
  id: number;
  company: string;
  title: string;
  location: string;
  status: TeamProjectStatus;
  owners: string[];
  source: 'manual' | 'imported';
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type TeamProjectInput = {
  company: string;
  title: string;
  location: string;
  status?: TeamProjectStatus;
  owners?: string[];
  notes?: string;
};

export interface GllueExportSnapshot {
  id: string;
  generatedAt: string;
  source: 'gllue-readonly-browser';
  stats: {
    candidates: number;
    candidateDetails: number;
    clients: number;
    jobs: number;
    submissions: number;
    todos: number;
    failedCandidateDetails: number;
  };
  data: {
    candidates: Candidate[];
    candidateDetails: Candidate[];
    clients: ClientCompany[];
    jobs: JobOrder[];
    submissions: PipelineSubmission[];
    todos: TodoItem[];
  };
}
