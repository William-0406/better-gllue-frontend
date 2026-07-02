import { matchMaimaiWithEnhance, upsertCandidateSummaries } from '../services/enhanceApi';
import type { Candidate } from '../types/gllue';
import { GLLUE_HOST, GLLUE_ORIGIN } from '../config';

const STORAGE_KEY = 'gllueShellEnabled';
const originalTabIds = new Set<number>();

type MaimaiProfile = {
  name?: string;
  company?: string;
  title?: string;
  experiences?: Array<{ company?: string; title?: string }>;
  education?: string;
  age?: string;
  sourceUrl: string;
};

type CandidateRecord = {
  id: number;
  name?: string;
  fullName?: string;
  candidateName?: string;
  __name__?: string;
  chineseName?: string;
  englishName?: string;
  company?: { name?: string; __name__?: string };
  currentCompany?: string | { name?: string; __name__?: string };
  current_company?: string | { name?: string; __name__?: string };
  position?: string;
  jobTitle?: string;
  title?: string;
  candidateexperience_set?: Array<{ title?: string; client?: { name?: string; __name__?: string } }>;
  note_set?: Array<{ content?: string; note?: string; dateAdded?: string; lastUpdateDate?: string; user?: number | { chineseName?: string; __name__?: string }; addedBy?: number | { chineseName?: string; __name__?: string } }> | Record<string, { content?: string; note?: string; dateAdded?: string; lastUpdateDate?: string; user?: number | { chineseName?: string; __name__?: string }; addedBy?: number | { chineseName?: string; __name__?: string } }>;
  note?: string | { content?: string; note?: string };
  noteDate?: string | null;
  lastContactDate?: string;
  lastUpdateDate?: string;
  dateAdded?: string;
  lastUpdateBy?: number | { chineseName?: string; __name__?: string };
  addedBy?: number | { chineseName?: string; __name__?: string };
  owner?: number | { chineseName?: string; __name__?: string };
  candidateeducation_set?: Array<{ school?: { name?: string; __name__?: string } | string; school_name?: string }>;
  first_school?: string;
};

type GllueListResponse<T> = {
  list?: T[];
  results?: T[];
  count?: number;
};

type ExperienceMatch = {
  score: number;
  reason: string;
  matchedExperience: string;
  tier: 'strong' | 'likely' | 'homonym';
};

type ShellRuntimeMessage =
  | { type: 'GLLUE_SHELL_TOGGLE' }
  | { type: 'GLLUE_SHELL_SET_ENABLED'; enabled: boolean }
  | { type: 'GLLUE_SHELL_STATUS'; enabled: boolean }
  | { type: 'GLLUE_SHELL_OPEN_ORIGINAL'; url: string }
  | { type: 'GLLUE_SHELL_SHOULD_BYPASS' }
  | { type: 'MAIMAI_CHECK_PROFILE'; profile: MaimaiProfile }
  | { type: 'MAIMAI_CAPTURE_PROFILE_LINK' }
  | { type: 'MAIMAI_CREATE_CANDIDATE'; profile: MaimaiProfile };

// 在页面主世界里执行（由 chrome.scripting 序列化注入）：脉脉招聘版"前往公开档案"
// 的目标 URL 是点击瞬间用 window.open 生成的，DOM 里始终不存在。这里临时劫持
// window.open / <a>.click 把弹窗吞掉，程序化点一下按钮，只截获 URL 不真开新页。
function capturePublicProfileLinkInPage() {
  return new Promise<string>((resolve) => {
    const nodes = Array.from(document.querySelectorAll('*'))
      .filter((node) => /公开档案/.test(node.textContent || '') && (node.textContent || '').length < 30);
    const target = nodes[nodes.length - 1];
    if (!(target instanceof HTMLElement)) {
      resolve('');
      return;
    }
    const captured: string[] = [];
    const origOpen = window.open;
    const origClick = HTMLAnchorElement.prototype.click;
    window.open = function (url?: string | URL) { captured.push(String(url)); return null; } as typeof window.open;
    HTMLAnchorElement.prototype.click = function () { captured.push(this.href); };
    try {
      target.click();
    } catch {
      // 点击报错也要走到恢复逻辑。
    }
    window.setTimeout(() => {
      window.open = origOpen;
      HTMLAnchorElement.prototype.click = origClick;
      resolve(captured.find((url) => /dstu=\d{5,}/.test(url)) || '');
    }, 1600);
  });
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return textValue(objectValue.name ?? objectValue.__name__ ?? objectValue.value ?? objectValue.chineseName ?? objectValue.englishName);
  }
  return '';
}

function normalizeList<T>(data: unknown): T[] {
  if (!data || typeof data !== 'object') return [];
  const response = data as GllueListResponse<T>;
  if (Array.isArray(response.list)) return response.list;
  if (Array.isArray(response.results)) return response.results;
  return [];
}

function candidateName(item: CandidateRecord) {
  return item.chineseName || item.englishName || item.name || item.fullName || item.candidateName || item.__name__ || `人才 #${item.id}`;
}

function candidateCompany(item: CandidateRecord) {
  return textValue(item.company)
    || textValue(item.currentCompany)
    || textValue(item.current_company)
    || item.candidateexperience_set?.[0]?.client?.name
    || item.candidateexperience_set?.[0]?.client?.__name__;
}

function candidateTitle(item: CandidateRecord) {
  return item.title || item.position || item.jobTitle || item.candidateexperience_set?.[0]?.title;
}

function candidateExperiences(item: CandidateRecord) {
  const experiences = [
    { company: candidateCompany(item), title: candidateTitle(item) },
    ...(item.candidateexperience_set || []).map((experience) => ({
      company: experience.client?.name || experience.client?.__name__,
      title: experience.title,
    })),
  ];
  const seen = new Set<string>();
  return experiences.filter((experience) => {
    const company = textValue(experience.company);
    const title = textValue(experience.title);
    const key = `${normalizeForCompare(company)}|${normalizeForCompare(title)}`;
    if ((!company && !title) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function userName(value: CandidateRecord['addedBy'] | CandidateRecord['owner'] | CandidateRecord['lastUpdateBy']) {
  return typeof value === 'object' ? value.chineseName || value.__name__ || '' : '';
}

function firstText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const objectValue = value as Record<string, unknown>;
  return firstText(objectValue.content) || firstText(objectValue.note) || firstText(objectValue.all_content);
}

function recentNote(item: CandidateRecord) {
  const entries = Array.isArray(item.note_set)
    ? item.note_set
    : item.note_set && typeof item.note_set === 'object'
      ? Object.values(item.note_set)
      : [];
  const notes = entries
    .map((entry) => ({
      text: firstText(entry),
      date: entry.lastUpdateDate || entry.dateAdded,
      consultant: userName(entry.user) || userName(entry.addedBy),
    }))
    .filter((entry) => entry.text);
  notes.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const direct = firstText(item.note);
  return notes[0] || {
    text: direct,
    date: item.noteDate || item.lastContactDate || item.lastUpdateDate || item.dateAdded,
    consultant: '',
  };
}

function normalizeForCompare(value: string | undefined) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function includesEither(left: string | undefined, right: string | undefined) {
  const a = normalizeForCompare(left);
  const b = normalizeForCompare(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

// title 归一化：去掉常见职级/修饰词，让"Java开发工程师"与"Java工程师"能对上。
function normalizeTitle(value: string | undefined) {
  return normalizeForCompare(value).replace(/高级|资深|初级|中级|首席|主任|senior|junior|lead|principal|staff|开发/g, '');
}

function titleSim(a: string | undefined, b: string | undefined) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  return Boolean(na && nb && (na.includes(nb) || nb.includes(na)));
}

function candidateSchools(item: CandidateRecord) {
  const schools: string[] = [];
  (item.candidateeducation_set || []).forEach((edu) => {
    const school = textValue(edu.school) || textValue(edu.school_name);
    if (school) schools.push(school);
  });
  if (item.first_school) schools.push(textValue(item.first_school));
  return schools;
}

function profileExperiences(profile: MaimaiProfile) {
  const experiences = profile.experiences?.length ? profile.experiences : [{ company: profile.company, title: profile.title }];
  return experiences
    .map((experience) => ({ company: textValue(experience.company), title: textValue(experience.title) }))
    .filter((experience) => experience.company || experience.title)
    .slice(0, 3);
}

function experienceText(experience: { company?: string; title?: string }) {
  return [experience.company, experience.title].filter(Boolean).join(' / ');
}

// 分级匹配：脉脉拿不到手机/邮箱/谷露ID，无法精确查重，故用 姓名+公司+title+学校 做分级，
// 强命中 / 疑似 / 同名 三档，把判断权交给顾问，最大限度不漏（跳槽的人也能被抓成"疑似"）。
function scoreCandidate(profile: MaimaiProfile, candidate: CandidateRecord): ExperienceMatch | null {
  const nameMatch = includesEither(candidateName(candidate), profile.name);
  let companyMatch = false;
  let titleMatch = false;
  let strongExpText = '';
  profileExperiences(profile).forEach((maimaiExperience) => {
    candidateExperiences(candidate).forEach((candidateExperience) => {
      const cM = includesEither(candidateExperience.company, maimaiExperience.company);
      const tM = titleSim(candidateExperience.title, maimaiExperience.title);
      if (cM) companyMatch = true;
      if (tM) titleMatch = true;
      if (cM && tM && !strongExpText) strongExpText = experienceText(maimaiExperience);
    });
  });
  const schoolMatch = candidateSchools(candidate).some((school) => includesEither(school, profile.education));

  if (nameMatch && strongExpText) {
    return { score: 95, tier: 'strong', reason: '姓名 + 公司&title 都命中', matchedExperience: strongExpText };
  }
  const corroborators = [companyMatch ? '公司' : '', titleMatch ? 'title' : '', schoolMatch ? '同校' : ''].filter(Boolean);
  if (nameMatch && corroborators.length) {
    return { score: 75, tier: 'likely', reason: `姓名一致 + ${corroborators.join('/')}吻合`, matchedExperience: strongExpText };
  }
  if (strongExpText && !nameMatch) {
    return { score: 70, tier: 'likely', reason: '公司&title 都命中（姓名未对上，或英文名/曾用名）', matchedExperience: strongExpText };
  }
  // 仅姓名一致、公司/title/学校全对不上：几乎可以肯定是重名的不同人，直接丢弃不展示，
  // 避免噪音（结果因此判为"未发现在库记录"，顾问可直接建档）。
  return null;
}

async function fetchGllueJson(path: string, params: Record<string, string>) {
  const url = new URL(path, GLLUE_ORIGIN);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url.toString(), {
    credentials: 'include',
    headers: {
      Accept: 'application/json, text/plain, */*',
    },
  });
  if (!response.ok) throw new Error(`谷露接口返回 ${response.status}`);
  return response.json();
}

async function getCandidateDetail(id: number) {
  const endpoints = ['/rest/candidate/detail', '/rest/candidate/detail/get', '/rest/candidate/detail/detail'];
  for (const endpoint of endpoints) {
    try {
      const data = await fetchGllueJson(endpoint, { id: String(id) });
      if (data) return data as CandidateRecord;
    } catch {
      // Keep probing read-only detail endpoint variants.
    }
  }
  return null;
}

// 谷露的新建/编辑都走 /rest/candidate/add，body 是单字段 data=<JSON>，无 id=新建、
// 有 id=编辑。实测该实例请求头不带 CSRF token、cookie 里也没有 csrftoken，故直接
// form-urlencoded 提交即可。这是本扩展唯一的写操作，仅在顾问手动点"建档"时触发。
async function postCandidateAdd(data: Record<string, unknown>) {
  const body = new URLSearchParams({ data: JSON.stringify(data) });
  const response = await fetch(new URL('/rest/candidate/add', GLLUE_ORIGIN).toString(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  });
  if (!response.ok) throw new Error(`谷露新建接口返回 ${response.status}`);
  return response.json().catch(() => ({}));
}

// 从脉脉抓到的 profile 构造最小人才档案。dstu 档案链接同时写入"个人主页"字段和
// 第一段经历的描述里（双保险，两者都能被查重全文检索命中）。owner 不传，由谷露
// 默认归属当前登录顾问；建档后前端会打开该人才页让顾问补全（备注、教育等）。
function buildCandidatePayload(profile: MaimaiProfile) {
  const name = textValue(profile.name);
  const link = canonicalMaimaiLinkFromUrl(profile.sourceUrl);
  const linkNote = link ? `脉脉档案：${link}` : '';
  const eduText = textValue(profile.education);
  const experiences = profileExperiences(profile).map((experience, index) => ({
    title: experience.title || '',
    client: { name: experience.company || '' },
    description: index === 0 ? [linkNote, eduText ? `学历：${eduText}` : ''].filter(Boolean).join('\n') : '',
    is_current: index === 0 ? 1 : 0,
    start: '',
    end: null,
  })).filter((experience) => experience.title || experience.client.name);

  // 中文名 / 英文名分流：纯字母走 englishName，否则走 chineseName。
  const isEnglish = /^[A-Za-z][A-Za-z.\s]*$/.test(name);
  return {
    chineseName: isEnglish ? '' : name,
    englishName: isEnglish ? name : '',
    // 默认建成 Cold Call（脉脉查重时顾问还没拿到电话/邮箱，属于 cold call 阶段）。
    // 新增表单里"人才类型"radio 即 type 字段：候选人=candidate / 联系人=contact /
    // Cold Call=coldcall。record_type 随 type 同步（实测建候选人时两者一致）。
    type: 'coldcall',
    record_type: 'coldcall',
    candidateexperience_set: experiences,
    candidateeducation_set: [],
    note_set: {},
    gllueextpersonal_website: link,
  };
}

function canonicalMaimaiLinkFromUrl(sourceUrl: string) {
  const dstu = maimaiDstu(sourceUrl);
  return dstu ? `https://maimai.cn/profile/detail?dstu=${dstu}` : '';
}

async function createCandidateFromMaimai(profile: MaimaiProfile) {
  if (!textValue(profile.name) && !profileExperiences(profile).length) {
    return { ok: false, error: '缺少姓名和工作经历，无法建档。' };
  }
  try {
    const result = await postCandidateAdd(buildCandidatePayload(profile));
    // 返回结构不确定：深挖任意层级的 id 字段；挖不到就按姓名回查刚建的记录（取最新一条）。
    // 这样不依赖猜字段名，也彻底避免"误报失败→顾问重复建档"（谷露记录删不掉，重复代价高）。
    let id = deepFindId(result);
    if (!id) id = await findJustCreatedId(profile);
    if (!id) return { ok: false, error: '已提交建档，但未能确认人才 ID，请回谷露搜索该姓名确认（勿重复创建）。' };
    return { ok: true, id, url: `${GLLUE_ORIGIN}/crm?gllue_shell=off#candidate/detail?id=${id}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '建档失败，请稍后重试。' };
  }
}

// 从任意形状的返回里找候选人主键：优先 id/pk/candidate_id 等键，取第一个合理的数字。
function deepFindId(value: unknown, depth = 0): number | undefined {
  if (!value || typeof value !== 'object' || depth > 4) return undefined;
  const obj = value as Record<string, unknown>;
  for (const key of ['id', 'pk', 'candidate_id', 'candidateId']) {
    const v = obj[key];
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
    if (Number.isInteger(n) && n > 0) return n;
  }
  for (const key of ['data', 'candidate', 'result', 'object', 'record']) {
    const found = deepFindId(obj[key], depth + 1);
    if (found) return found;
  }
  return undefined;
}

// 兜底：按姓名回查最新记录（刚建的一定是最大 id）。带公司则要求公司也对得上，
// 避免同名撞车拿错 id。
async function findJustCreatedId(profile: MaimaiProfile) {
  const name = textValue(profile.name);
  if (!name) return undefined;
  try {
    const rows = await searchCandidateRows(`keyword__and=${encodeURIComponent(name)}`);
    const company = textValue(profileExperiences(profile)[0]?.company);
    const sorted = rows.slice().sort((a, b) => b.id - a.id);
    const matched = company
      ? sorted.find((row) => includesEither(candidateCompany(row), company)) || sorted[0]
      : sorted[0];
    return matched?.id;
  } catch {
    return undefined;
  }
}

async function searchCandidateRows(gql: string) {
  const data = await fetchGllueJson('/rest/candidate/list', {
    gql,
    demandKeys: JSON.stringify(['company', 'avatar', 'addedBy', 'owner', 'lastUpdateBy', 'candidateexperience_set']),
    ordering: '-id',
    paginate_by: '20',
    page: '1',
  });
  return normalizeList<CandidateRecord>(data);
}

function maimaiDstu(sourceUrl: string) {
  try {
    const dstu = new URL(sourceUrl).searchParams.get('dstu') || '';
    return /^\d{5,}$/.test(dstu) ? dstu : '';
  } catch {
    return '';
  }
}

// 链接精确查重：脉脉公开档案 URL（/profile/detail?dstu=...）里的 dstu 是这个用户的
// 稳定 ID。只要顾问把档案链接存进过谷露（备注/主页等任意可检索文本字段），按
// "dstu=ID" 全文检索就是唯一命中，可靠度高于任何姓名+经历的模糊匹配——与团队
// "存猎聘链接查猎聘"是同一套打法。查不到返回 null，落回增强服务/模糊分级。
async function matchByMaimaiLink(profile: MaimaiProfile) {
  const dstu = maimaiDstu(profile.sourceUrl);
  if (!dstu) return null;
  try {
    let rows = await searchCandidateRows(`keyword__and=${encodeURIComponent(`dstu=${dstu}`)}`);
    let bare = false;
    if (!rows.length) {
      // 谷露的关键字检索可能对 "dstu=" 里的等号分词，退一步搜纯数字 ID。
      rows = await searchCandidateRows(`keyword__and=${encodeURIComponent(dstu)}`);
      bare = true;
    }
    rows = rows.slice(0, 5);
    if (!rows.length) return null;
    const details = await Promise.all(rows.map((item) => getCandidateDetail(item.id)));
    const detailMap = new Map(details.filter(Boolean).map((item) => [item!.id, item!]));
    // 纯数字检索（bare）极易撞上手机号/QQ号等无关长数字，仅保留姓名也对得上的记录，
    // 其余全部丢弃——避免把重名甚至完全不相关的人当成"疑似"制造噪音。带 "dstu=" 前缀
    // 的命中本身就够精确，全部保留为强命中。bare 全被过滤掉时返回 null，落回模糊分级。
    const candidates = rows
      .map((item) => ({ detail: { ...item, ...detailMap.get(item.id) } }))
      .filter(({ detail }) => !bare || includesEither(candidateName(detail), profile.name))
      .map(({ detail }) => {
        const note = recentNote(detail);
        return {
          id: detail.id,
          name: candidateName(detail),
          company: candidateCompany(detail),
          title: candidateTitle(detail),
          lastUpdateDate: detail.lastUpdateDate || detail.lastContactDate || detail.dateAdded,
          recentNoteDate: note.date,
          recentNoteText: note.text,
          consultant: note.consultant || userName(detail.lastUpdateBy) || userName(detail.owner) || userName(detail.addedBy),
          matchedExperience: '',
          matchReason: bare
            ? `谷露记录含脉脉ID ${dstu} 且姓名一致（高度疑似同一人）`
            : `谷露记录中存有该脉脉档案链接（dstu=${dstu} 精确命中）`,
          score: bare ? 90 : 100,
          tier: 'strong' as const,
        };
      })
      .slice(0, 3);
    if (!candidates.length) return null;
    return { status: 'matched' as const, profile, candidates };
  } catch {
    // 链接检索失败（未登录/断网等）不致命，落回增强服务/模糊分级，由它们统一报错。
    return null;
  }
}

async function checkMaimaiProfile(profile: MaimaiProfile) {
  const linkMatched = await matchByMaimaiLink(profile);
  if (linkMatched) return linkMatched;
  const enhanced = await matchMaimaiWithEnhance(profile);
  if (enhanced) return enhanced;

  const name = textValue(profile.name);
  const experiences = profileExperiences(profile);
  if (!name && !experiences.length) {
    return { status: 'unknown', profile, candidates: [], error: '未识别到姓名或工作经历，无法查重。' };
  }

  // 用谷露的 keyword__and 字段过滤（等价于 UI"关键字 等于"），这个会真正按名字过滤；
  // keyword= URL 参数不按名字过滤、会返回全库导致漏判。以姓名为主键，无姓名时退回公司/title。
  const searchTerms = Array.from(new Set([
    name,
    ...(!name ? experiences.flatMap((experience) => [experience.company, experience.title]) : []),
  ].map((item) => textValue(item).trim()).filter(Boolean)));
  const merged = new Map<number, CandidateRecord>();
  let okTerms = 0;
  let authFailed = false;

  for (const term of searchTerms) {
    try {
      const rows = await searchCandidateRows(`keyword__and=${encodeURIComponent(term)}`);
      okTerms += 1;
      rows.forEach((item) => merged.set(item.id, { ...merged.get(item.id), ...item }));
    } catch (error) {
      // 记录失败原因：401/403 多半是没登录谷露，其它多半是连不上内网。
      if (/\b40[13]\b/.test(error instanceof Error ? error.message : '')) authFailed = true;
    }
  }

  // 所有搜索都失败（一个都没成功）说明是谷露那头连不上/没登录，而不是"查无此人"，
  // 明确提示，避免让人误以为候选人库里真的没有这个人。
  if (searchTerms.length && okTerms === 0) {
    return {
      status: 'unknown',
      profile,
      candidates: [],
      error: authFailed
        ? `连接谷露失败：请确认已登录谷露（${GLLUE_HOST}）后重试。`
        : '连不上谷露：请确认在公司网络内、或增强服务可用后重试。',
    };
  }

  const rows = Array.from(merged.values()).slice(0, 20);
  const details = await Promise.all(rows.map((item) => getCandidateDetail(item.id)));
  const detailMap = new Map(details.filter(Boolean).map((item) => [item!.id, item!]));
  const indexedRows = rows.map((item) => ({ ...item, ...detailMap.get(item.id) }));
  void upsertCandidateSummaries(indexedRows as unknown as Candidate[]);
  const scored = rows
    .flatMap((item) => {
      const detail = { ...item, ...detailMap.get(item.id) };
      const match = scoreCandidate(profile, detail);
      return match ? [{ item: detail, match }] : [];
    })
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 3);
  const candidates = scored.map(({ item, match }) => {
    const detail = item;
    const note = recentNote(detail);
    return {
      id: detail.id,
      name: candidateName(detail),
      company: candidateCompany(detail),
      title: candidateTitle(detail),
      lastUpdateDate: detail.lastUpdateDate || detail.lastContactDate || detail.dateAdded,
      recentNoteDate: note.date,
      recentNoteText: note.text,
      consultant: note.consultant || userName(detail.lastUpdateBy) || userName(detail.owner) || userName(detail.addedBy),
      matchedExperience: match.matchedExperience,
      matchReason: match.reason,
      score: match.score,
      tier: match.tier,
    };
  });

  return {
    status: candidates.length ? 'matched' : 'not_found',
    profile,
    candidates,
  };
}

async function updateBadge(tabId: number | undefined, enabled: boolean) {
  await chrome.action.setBadgeText({ tabId, text: enabled ? 'ON' : '' });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#80d5bb' });
  await chrome.action.setTitle({ tabId, title: enabled ? '关闭更好的谷露前端' : '开启更好的谷露前端' });
}

function withoutBypassParam(url: string) {
  try {
    const next = new URL(url);
    next.searchParams.delete('gllue_shell');
    return next.toString();
  } catch {
    return url;
  }
}

function isGllueUrl(url: string | undefined) {
  try {
    return Boolean(url && new URL(url).hostname === GLLUE_HOST);
  } catch {
    return false;
  }
}

async function injectShell(tabId: number) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css'],
    });
  } catch {
    // CSS may already be present after a declarative content-script injection.
  }
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
}

async function isShellContentLoaded(tabId: number) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean((globalThis as typeof globalThis & { __gllueShellContentLoaded?: boolean }).__gllueShellContentLoaded),
    });
    return Boolean(result[0]?.result);
  } catch {
    return false;
  }
}

async function ensureShellContent(tabId: number, enabled?: boolean) {
  if (!(await isShellContentLoaded(tabId))) {
    await injectShell(tabId);
  }
  if (typeof enabled === 'boolean') {
    await chrome.tabs.sendMessage(tabId, { type: 'GLLUE_SHELL_SET_ENABLED', enabled } satisfies ShellRuntimeMessage).catch(() => undefined);
  }
}

async function syncOpenGllueTabs() {
  const values = await chrome.storage.local.get(STORAGE_KEY);
  const enabled = Boolean(values[STORAGE_KEY]);
  const tabs = await chrome.tabs.query({ url: [`http://${GLLUE_HOST}/*`, `https://${GLLUE_HOST}/*`] });
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || originalTabIds.has(tab.id)) return;
      await updateBadge(tab.id, enabled);
      await ensureShellContent(tab.id, enabled).catch(() => undefined);
    }),
  );
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.get(STORAGE_KEY).then((values) => {
    if (typeof values[STORAGE_KEY] !== 'boolean') {
      return chrome.storage.local.set({ [STORAGE_KEY]: false }).then(syncOpenGllueTabs);
    }
    return syncOpenGllueTabs();
  });
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id || !isGllueUrl(tab.url)) return;
  const tabId = tab.id;
  chrome.tabs.sendMessage(tab.id, { type: 'GLLUE_SHELL_TOGGLE' } satisfies ShellRuntimeMessage).catch(() => {
    void chrome.storage.local.get(STORAGE_KEY).then((values) => {
      const enabled = !Boolean(values[STORAGE_KEY]);
      return chrome.storage.local.set({ [STORAGE_KEY]: enabled }).then(() => {
        void updateBadge(tabId, enabled);
        if (enabled) {
          const nextUrl = withoutBypassParam(tab.url ?? '');
          if (nextUrl && nextUrl !== tab.url) {
            chrome.tabs.update(tabId, { url: nextUrl });
          } else {
            injectShell(tabId).catch(() => chrome.tabs.reload(tabId));
          }
        } else {
          chrome.tabs.reload(tabId);
        }
      });
    });
  });
});

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  const message = rawMessage as ShellRuntimeMessage;
  if (message.type === 'GLLUE_SHELL_STATUS') {
    void updateBadge(sender.tab?.id, message.enabled);
    return false;
  }
  if (message.type === 'GLLUE_SHELL_OPEN_ORIGINAL') {
    chrome.tabs.create({ url: message.url, active: true }, (tab) => {
      if (tab.id) {
        originalTabIds.add(tab.id);
        void updateBadge(tab.id, false);
      }
      sendResponse({ ok: true, tabId: tab.id });
    });
    return true;
  }
  if (message.type === 'GLLUE_SHELL_SHOULD_BYPASS') {
    sendResponse({ bypass: Boolean(sender.tab?.id && originalTabIds.has(sender.tab.id)) });
    return false;
  }
  if (message.type === 'MAIMAI_CAPTURE_PROFILE_LINK') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ url: '' });
      return false;
    }
    chrome.scripting
      .executeScript({ target: { tabId }, world: 'MAIN', func: capturePublicProfileLinkInPage })
      .then((results) => sendResponse({ url: String(results?.[0]?.result || '') }))
      .catch(() => sendResponse({ url: '' }));
    return true;
  }
  if (message.type === 'MAIMAI_CREATE_CANDIDATE') {
    createCandidateFromMaimai(message.profile)
      .then((result) => sendResponse(result))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '建档失败。' }));
    return true;
  }
  if (message.type === 'MAIMAI_CHECK_PROFILE') {
    checkMaimaiProfile(message.profile)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          result: {
            status: 'unknown',
            profile: message.profile,
            candidates: [],
            error: error instanceof Error ? error.message : '无法确认，请稍后重试或回谷露搜索。',
          },
        }),
      );
    return true;
  }
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !isGllueUrl(tab.url)) return;
  if (originalTabIds.has(tabId)) {
    void updateBadge(tabId, false);
    return;
  }
  void chrome.storage.local.get(STORAGE_KEY).then((values) => {
    const enabled = Boolean(values[STORAGE_KEY]);
    void updateBadge(tabId, enabled);
    void ensureShellContent(tabId, enabled);
  });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: '#80d5bb' });
  void syncOpenGllueTabs();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  originalTabIds.delete(tabId);
});
