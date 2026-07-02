import axios from 'axios';
import { rankConsultantCounts, type LeaderboardEntry, type RawConsultantCount } from './leaderboardRank';

export { rankConsultantCounts };
export type { LeaderboardEntry, RawConsultantCount } from './leaderboardRank';

// 顾问排行榜（反推）：谷露 KPI 报表受权限限制（只能看自己），但底层列表是全队可见的。
// 于是对每个顾问、每个周期发一个只读 count 请求（paginate_by=1），客户端拼出全队排行榜。
//
// 两种指标：
//   简历推荐 recommendations：GET /rest/jobsubmission/list
//       ?gql=cvsent_set__user__eq=<id>&cvsent_set__date__<周期> → { count }
//     另附"推荐后面试"：?gql=clientinterview_set__user__eq=<id>&clientinterview_set__date__<周期>
//   新增候选人 newCandidates：GET /rest/candidate/list
//       ?gql=dateAdded__<周期>&addedBy__eq=<id> → { count }
// 顾问名单：GET /rest/user/list?demandKeys=[...]&ordering=englishName&paginate_by=50&page=N
// 周期 token：this_month/last_month/this_quarter/last_quarter（谷露原生相对日期）。

const client = axios.create({
  baseURL: '',
  timeout: 15000,
  withCredentials: true,
  // 谷露自家前端的 AJAX 都带这个头；部分接口（如 user/list）缺它会 404。
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

// user/list 的路径斜杠约定不确定：优先不带斜杠（与 candidate/list 一致），带斜杠兜底。
const USER_LIST_PATHS = ['/rest/user/list', '/rest/user/list/'];

// 已知自身 id 兜底（ZZ Zhang，来自谷露请求里的 _v_user=1309）。
const FALLBACK_SELF_USER_ID = 1309;

export type LeaderboardPeriod = 'week' | 'month' | 'quarter';
export type LeaderboardMetric = 'recommendations' | 'newCandidates';

export const METRIC_LABELS: Record<LeaderboardMetric, string> = {
  recommendations: '简历推荐',
  newCandidates: '新增候选人',
};

interface PeriodTokens {
  current: string;
  previous: string;
  currentLabel: string;
  previousLabel: string;
}

const PERIOD_TOKENS: Record<LeaderboardPeriod, PeriodTokens> = {
  week: { current: 'this_week', previous: 'last_week', currentLabel: '本周', previousLabel: '上周' },
  month: { current: 'this_month', previous: 'last_month', currentLabel: '本月', previousLabel: '上月' },
  quarter: { current: 'this_quarter', previous: 'last_quarter', currentLabel: '本季', previousLabel: '上季' },
};

export interface ConsultantUser {
  id: number;
  name: string;
  team?: string;
  email?: string;
}

export interface ConsultantLeaderboard {
  period: LeaderboardPeriod;
  metric: LeaderboardMetric;
  metricLabel: string;
  currentLabel: string;
  previousLabel: string;
  /** 是否带"推荐后面试"列（仅推荐指标）。 */
  hasInterviews: boolean;
  totalInterviews: number;
  generatedAt: string;
  selfUserId: number | null;
  selfRank: number | null;
  totalCurrent: number;
  totalConsultants: number;
  entries: LeaderboardEntry[];
  fromMock: boolean;
}

// ---------- 网络层 ----------

function readCookie(name: string): string {
  if (typeof document === 'undefined') return '';
  const escaped = name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
  const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

function nameOf(value: unknown): string {
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return String(obj.__name__ ?? obj.chineseName ?? obj.englishName ?? obj.name ?? '');
  }
  return value == null ? '' : String(value);
}

interface RawUser {
  id: number;
  __name__?: string;
  chineseName?: string;
  englishName?: string;
  team?: unknown;
  email?: string;
  leaveDate?: string | null;
}

// 解析出能用的 user/list 路径（首次成功后记住）。
let resolvedUserListPath: string | null = null;

async function getUserListPage(params: Record<string, string | number>) {
  if (resolvedUserListPath) {
    return client.get(resolvedUserListPath, { params });
  }
  let lastError: unknown;
  for (const path of USER_LIST_PATHS) {
    try {
      const response = await client.get(path, { params });
      const data = response.data as { list?: unknown };
      if (data && Array.isArray(data.list)) {
        resolvedUserListPath = path;
        return response;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('user/list 接口不可用');
}

/** 拉全部在职用户（翻页），离职(leaveDate 非空)的剔除。 */
export async function fetchConsultants(): Promise<ConsultantUser[]> {
  const demandKeys = JSON.stringify(['__name__', 'chineseName', 'englishName', 'team', 'email', 'leaveDate', 'status']);
  const users = new Map<number, ConsultantUser>();
  for (let page = 1; page <= 12; page += 1) {
    const response = await getUserListPage({ demandKeys, ordering: 'englishName', paginate_by: 50, page });
    const data = response.data as { list?: RawUser[]; pages?: number };
    const list = Array.isArray(data.list) ? data.list : [];
    for (const user of list) {
      if (!user || !user.id) continue;
      if (user.leaveDate) continue; // 离职跳过
      const name = nameOf(user.__name__ || user.chineseName || user.englishName) || ('用户 ' + user.id);
      users.set(user.id, {
        id: user.id,
        name,
        team: nameOf(user.team) || undefined,
        email: user.email ? String(user.email).trim().toLowerCase() : undefined,
      });
    }
    if (!data.pages || page >= data.pages || list.length < 50) break;
  }
  return Array.from(users.values());
}

async function countByGql(api: string, gql: string): Promise<number> {
  const response = await client.get(api, { params: { gql, paginate_by: 1, page: 1 } });
  return Number((response.data as { count?: number })?.count ?? 0);
}

/** 某顾问在某周期内的主指标计数。 */
function countMetric(userId: number, periodToken: string, metric: LeaderboardMetric): Promise<number> {
  if (metric === 'recommendations') {
    // 简历推荐：该顾问在该周期内产生的 cvsent（推荐）事件数，不论流程当前走到哪一步。
    return countByGql('/rest/jobsubmission/list', 'cvsent_set__user__eq=' + userId + '&cvsent_set__date__' + periodToken);
  }
  // 新增候选人：该顾问在该周期内录入的候选人数。
  return countByGql('/rest/candidate/list', 'dateAdded__' + periodToken + '&addedBy__eq=' + userId);
}

/** 某顾问在某周期内的"推荐后面试"数（clientinterview 事件）。
 *  口径与现有"本周面试"卡一致：按候选人拥有者(candidate__owner)归属 + 面试发生在该周期。
 *  （clientinterview_set__user 谷露不认，会恒为 0，故用 owner 维度。）
 */
function countInterviews(userId: number, periodToken: string): Promise<number> {
  return countByGql('/rest/jobsubmission/list', 'clientinterview_set__date__' + periodToken + '&candidate__owner__eq=' + userId);
}

/** 并发池：分批并发执行，避免一次性打太多请求。 */
async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const settled = await Promise.allSettled(items.slice(i, i + size).map(fn));
    settled.forEach((result) => {
      if (result.status === 'fulfilled') out.push(result.value);
    });
  }
  return out;
}

// ---------- 缓存（同一周期+指标 30 分钟内不重复打全队请求） ----------

const CACHE_TTL_MS = 30 * 60 * 1000;
const memoryCache = new Map<string, { at: number; data: ConsultantLeaderboard }>();

// 改了统计口径就 +1，自动让旧缓存失效。
const CACHE_VERSION = 'v2-interview-owner';
function cacheKey(period: LeaderboardPeriod, metric: LeaderboardMetric) {
  return 'gllue-leaderboard-' + CACHE_VERSION + '-' + metric + '-' + period;
}

function readCache(period: LeaderboardPeriod, metric: LeaderboardMetric): ConsultantLeaderboard | null {
  const key = cacheKey(period, metric);
  const mem = memoryCache.get(key);
  if (mem && Date.now() - mem.at < CACHE_TTL_MS) return mem.data;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: ConsultantLeaderboard };
    if (Date.now() - parsed.at < CACHE_TTL_MS) {
      memoryCache.set(key, parsed);
      return parsed.data;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeCache(period: LeaderboardPeriod, metric: LeaderboardMetric, data: ConsultantLeaderboard) {
  const key = cacheKey(period, metric);
  const entry = { at: Date.now(), data };
  memoryCache.set(key, entry);
  try {
    sessionStorage.setItem(key, JSON.stringify(entry));
  } catch {
    /* 容量满则忽略 */
  }
}

/** 构建某周期+指标的全队排行榜（带缓存；force=true 强制刷新）。 */
export async function buildConsultantLeaderboard(
  period: LeaderboardPeriod = 'month',
  metric: LeaderboardMetric = 'recommendations',
  force = false,
): Promise<ConsultantLeaderboard> {
  if (!force) {
    const cached = readCache(period, metric);
    if (cached) return cached;
  }
  const tokens = PERIOD_TOKENS[period];
  const consultants = await fetchConsultants();
  const withInterviews = metric === 'recommendations';

  const selfEmail = (readCookie('email') || '').trim().toLowerCase();
  const selfMatch = selfEmail ? consultants.find((item) => item.email && item.email === selfEmail) : undefined;
  const selfUserId = selfMatch ? selfMatch.id : FALLBACK_SELF_USER_ID;

  const counts = await mapPool(consultants, 8, async (consultant) => {
    const [current, previous, interviews] = await Promise.all([
      countMetric(consultant.id, tokens.current, metric).catch(() => 0),
      countMetric(consultant.id, tokens.previous, metric).catch(() => 0),
      withInterviews ? countInterviews(consultant.id, tokens.current).catch(() => 0) : Promise.resolve(undefined),
    ]);
    return {
      id: consultant.id,
      name: consultant.name,
      team: consultant.team,
      current,
      previous,
      interviews: interviews as number | undefined,
    } as RawConsultantCount;
  });

  const entries = rankConsultantCounts(counts, selfUserId);
  const result: ConsultantLeaderboard = {
    period,
    metric,
    metricLabel: METRIC_LABELS[metric],
    currentLabel: tokens.currentLabel,
    previousLabel: tokens.previousLabel,
    hasInterviews: withInterviews,
    totalInterviews: withInterviews ? entries.reduce((sum, entry) => sum + (entry.interviews ?? 0), 0) : 0,
    generatedAt: new Date().toISOString(),
    selfUserId,
    selfRank: entries.find((entry) => entry.isSelf)?.rank ?? null,
    totalCurrent: entries.reduce((sum, entry) => sum + entry.current, 0),
    totalConsultants: entries.length,
    entries,
    fromMock: false,
  };
  writeCache(period, metric, result);
  return result;
}
