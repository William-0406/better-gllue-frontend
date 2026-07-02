import type { CandidateMatchResult, MaimaiProfile } from '../types/gllue';
import { GLLUE_BASE } from '../config';

const PANEL_ID = 'gllue-maimai-check-card';
const STYLE_ID = 'gllue-maimai-check-style';
const POSITION_KEY = 'gllueMaimaiPanelPosition';
const MINIMIZED_KEY = 'gllueMaimaiPanelMinimized';
const PANEL_WIDTH = 188;
const DEFAULT_POSITION = { left: 8, top: 220 };

type PanelMode = 'idle' | 'loading' | 'result' | 'unknown' | 'confirm' | 'creating' | 'created';
type PanelPosition = { left: number; top: number };

let currentProfile: MaimaiProfile | null = null;
let currentResult: CandidateMatchResult | null = null;
let currentError = '';
let currentMode: PanelMode = 'idle';
let lastFingerprint = '';
let debounceTimer: number | undefined;
let panelPosition: PanelPosition = { ...DEFAULT_POSITION };
let positionLoaded = false;
let dragging = false;
let suppressOrbClick = false;
let isMinimized = true;

function text(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function blockText(value: string | null | undefined) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitLines(source: string) {
  return blockText(source)
    .split(/[\n\r]| {2,}| · | ｜ | \| /)
    .map(text)
    .filter((line) => line.length >= 2 && line.length <= 80);
}

function isNoiseLine(value: string | undefined) {
  const line = text(value);
  if (!line) return true;
  return /员工推广|职位访客|访客|推荐|搜索|从结果中筛选|智能筛选|TA有|教育经历|期望偏好|人才档案|职位记录|招聘动态|关注行情|近期有动向|公开求职意向|近期未查看|近期未沟通/.test(line);
}

function isLikelyName(value: string | undefined) {
  const name = text(value);
  if (!name || isNoiseLine(name)) return false;
  // 排除学校 / 城市 / 学历 / 性别 / 公司等明显不是姓名的词（避免把"湘潭大学"当名字），
  // 以及公开档案页左侧导航项（动态/招聘/主页等短词恰好是 2-4 个汉字）。
  if (/大学|学院|学校|高中|中专|职业技|公司|集团|科技|有限|脉脉|登录|不限职位|好友|博士|硕士|本科|大专|MBA|EMBA|北京|上海|深圳|广州|杭州|成都|南京|武汉|苏州|西安|天津|重庆|男|女|返回|动态|招聘|聊天|通知|主页|品牌号|企业号|商业服务|点评|职位/.test(name)) return false;
  // 中文名 2-4 字，或英文名（可带 1-2 个空格的姓）。
  return /^[一-龥]{2,4}$/.test(name) || /^[A-Za-z][A-Za-z.]*(?: [A-Za-z.]+){0,2}$/.test(name);
}

function lastMatch(source: string, pattern: RegExp) {
  const matches = Array.from(source.matchAll(pattern)).map((match) => text(match[1]));
  const filtered = matches.filter(Boolean);
  return filtered[filtered.length - 1];
}

function recruitTalentSections() {
  // 脉脉招聘企业版不止"人才搜索"（/ent/v*/recruit/talents）一种页面：
  // 已投递、沟通、储备等页面同样会展示完整"人才档案"详情。所以 URL 只粗筛
  // 到企业版路径，是否真的在看某个候选人交给下面的"人才档案"内容锚点判断，
  // 抓取逻辑（实名/活跃标记定位姓名、日期行锚定工作经历）不变，不影响准确率。
  const path = window.location.pathname;
  if (!/\/ent\//.test(path) && !/recruit|talent/i.test(path)) return null;
  const bodyText = blockText(document.body.innerText);
  const tabIndex = bodyText.indexOf('人才档案');
  if (tabIndex < 0) return null;

  const headerText = bodyText.slice(Math.max(0, tabIndex - 520), tabIndex);
  const workStart = bodyText.indexOf('工作经历', tabIndex);
  if (workStart < 0) return { headerText, workText: '' };

  const workEnd = ['教育经历', '项目经历', '展开', 'TA有', '相关推荐', '备注 (', '备注（', '备注(', '消息']
    .map((marker) => bodyText.indexOf(marker, workStart + 10))
    .filter((index) => index > workStart)
    .sort((a, b) => a - b)[0];
  return {
    headerText,
    workText: bodyText.slice(workStart, workEnd || workStart + 700),
    bodyText,
    layout: 'ent' as const,
  };
}

// 脉脉个人公开档案页（maimai.cn/profile/detail?dstu=...）。从招聘版"前往公开档案"
// 跳转过来的就是这种页面。它的价值：URL 里的 dstu 是这个人的稳定 ID，可用于精确查重。
function profileDetailSections() {
  const { pathname, search } = window.location;
  if (!/\/profile\/detail/.test(pathname) && !/[?&]dstu=\d/.test(search)) return null;
  const bodyText = blockText(document.body.innerText);
  const workStart = bodyText.indexOf('工作经历');
  if (workStart < 0) return null;
  // 姓名区在"返回"和"工作经历"之间；从"返回"起切，把左侧导航（动态/招聘/主页…）切掉。
  const backIndex = bodyText.indexOf('返回');
  const headerStart = backIndex >= 0 && backIndex < workStart ? backIndex + 2 : Math.max(0, workStart - 400);
  const workEnd = ['教育经历', '她的标签', '他的标签', 'TA的标签', '职业标签', '自我介绍', '个人成就', '资料完整度']
    .map((marker) => bodyText.indexOf(marker, workStart + 10))
    .filter((index) => index > workStart)
    .sort((a, b) => a - b)[0];
  return {
    headerText: bodyText.slice(headerStart, workStart),
    workText: bodyText.slice(workStart, workEnd || workStart + 700),
    bodyText,
    layout: 'profile' as const,
  };
}

function pickName(headerText: string) {
  // 优先：紧挨"实名/活跃/在线"标记前的名字（最可能是档案主人，支持中英文名）。
  const strong = Array.from(headerText.matchAll(/([一-龥]{2,4}|[A-Za-z][A-Za-z.]*(?: [A-Za-z.]+){0,2})\s*(?:已实名|未实名|实名|今日活跃|近\d[^ \n]*活跃|在线)/g))
    .map((match) => text(match[1]))
    .filter(isLikelyName);
  if (strong.length) return strong[strong.length - 1];
  // 兜底：单独成行的名字。只在最靠近“人才档案”的尾段里找（档案主人的名字就在这附近），
  // 避免把页面上方导航、或“相关推荐/访客”里别人的名字误当成档案主人。
  const tail = headerText.slice(-200);
  const loose = Array.from(tail.matchAll(/(?:^|\n)\s*([一-龥]{2,4}|[A-Za-z][A-Za-z.]*(?: [A-Za-z.]+){0,2})\s*(?:\n|$)/g))
    .map((match) => text(match[1]))
    .filter(isLikelyName);
  return loose[loose.length - 1];
}

function pickAge(headerText: string) {
  return lastMatch(headerText, /(?:^|\s|\|)(\d{2}岁)(?:\s|\||$)/g);
}

function pickEducation(headerText: string) {
  return lastMatch(headerText, /(?:^|\s|\|)(博士|硕士|本科|大专|高中|中专|MBA|EMBA)(?:\s|\||$)/g);
}

function isDateLine(value: string | undefined) {
  const line = text(value);
  return /^\d{4}/.test(line) || /至今|至/.test(line);
}

// 严格日期行：必须以四位年份开头（避免把含"至"的职责描述误判为日期）。
function isWorkDate(value: string | undefined) {
  return /^\d{4}[\s\-./年]/.test(text(value));
}

// 判断一行更像"公司名"还是"职位名"，用于纠正两种布局的行序差异。
const COMPANYISH = /公司|集团|股份|有限|银行|保险|证券|基金|研究院|研究所|事务所|工作室|大学|学院|医院|中心|厂|Inc\.?|Ltd\.?|LLC|Corp|Group|Technologies|Consulting/i;

function pickExperiences(workText: string, layout: 'ent' | 'profile' = 'ent') {
  const lines = splitLines(workText).filter((line) => !isNoiseLine(line));
  const start = lines.findIndex((line) => line === '工作经历');
  const candidates = lines.slice(start >= 0 ? start + 1 : 0);
  const experiences: Array<{ company?: string; title?: string }> = [];
  const seen = new Set<string>();

  // 以日期行为锚点。两种布局行序相反：
  //   招聘版（ent）：公司 / 职位 / 日期；公开档案页（profile）：职位 / 公司 / 日期。
  // 先按布局默认取，再用"哪行更像公司名"纠偏（描述与标签在日期之后，自然被跳过）。
  for (let i = 0; i < candidates.length && experiences.length < 3; i += 1) {
    if (!isWorkDate(candidates[i])) continue;
    const prev1 = i - 1 >= 0 && !isWorkDate(candidates[i - 1]) ? text(candidates[i - 1]) : '';
    const prev2 = i - 2 >= 0 && !isWorkDate(candidates[i - 2]) ? text(candidates[i - 2]) : '';
    let company = layout === 'profile' ? prev1 : prev2;
    let title = layout === 'profile' ? prev2 : prev1;
    if (company && title && !COMPANYISH.test(company) && COMPANYISH.test(title)) {
      [company, title] = [title, company];
    }
    if (!company && !title) continue;
    const key = `${company}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    experiences.push({ company, title });
  }

  // 兜底：万一页面结构异常、一个日期都没匹配到，退回"取前两行"。
  if (!experiences.length && candidates.length) {
    const company = text(candidates[0]);
    const title = candidates[1] && !isWorkDate(candidates[1]) ? text(candidates[1]) : '';
    if (company || title) experiences.push({ company, title });
  }

  return experiences;
}

// 从"教育经历"区抓学校名；学历没在头部读到时也从这里兜底。
// education 组合成"学校 · 学历"——后台按学校对谷露 candidateeducation_set 匹配，
// 学校是比学历强得多的佐证信号。
function pickSchoolEducation(bodyText: string, headerDegree: string) {
  const eduIndex = bodyText.indexOf('教育经历');
  let school = '';
  let degree = headerDegree;
  if (eduIndex >= 0) {
    const eduLines = splitLines(bodyText.slice(eduIndex + 4, eduIndex + 300));
    school = eduLines.find((line) => /大学|学院|学校|University|College|Institute/i.test(line) && line.length <= 30) || '';
    if (!degree) {
      const degreeLine = eduLines.find((line) => /博士|硕士|本科|大专|MBA|EMBA/.test(line));
      degree = text(degreeLine?.match(/博士|硕士|本科|大专|MBA|EMBA/)?.[0]);
    }
  }
  return [school, degree].filter(Boolean).join(' · ');
}

export function extractMaimaiProfileFromPage(): MaimaiProfile | null {
  if (!document.body || /\/article\//.test(window.location.pathname)) return null;
  const sections = recruitTalentSections() || profileDetailSections();
  if (!sections) return null;

  const name = pickName(sections.headerText);
  const experiences = pickExperiences(sections.workText, sections.layout);
  if (!name && !experiences.length) return null;
  const firstExperience = experiences[0] || {};
  // sourceUrl 只用当前页 URL（公开档案页本身就带 dstu；招聘版不带）。招聘版的 dstu
  // 链接不在被动抓取里扫 DOM（那样每周期扫全页、结果还随页面 DOM 抖动，会导致指纹
  // 反复变→面板抽风），改由查重时 ensureProfileLink 用后台截获，稳定且更可靠。
  return {
    name,
    company: firstExperience.company,
    title: firstExperience.title,
    experiences,
    education: pickSchoolEducation(sections.bodyText, text(pickEducation(sections.headerText))),
    age: text(pickAge(sections.headerText)),
    sourceUrl: window.location.href,
  };
}

// 公开档案 URL 里的 dstu 是脉脉用户的稳定 ID；带 token 的原始链接会过期/泄露来源，
// 统一收敛成规范链接再展示/入库。
export function canonicalMaimaiLink(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const dstu = url.searchParams.get('dstu') || '';
    if (/^\d{5,}$/.test(dstu)) return `https://maimai.cn/profile/detail?dstu=${dstu}`;
  } catch {
    // 非法 URL 时视为没有稳定链接。
  }
  return '';
}

// 指纹只认稳定身份字段（姓名/经历/学历/年龄）+ dstu（有就用，没有忽略）。
// 不直接用 sourceUrl：招聘版 URL 带 trackable_token 等易变参数，会让指纹无谓变化、
// 触发面板重置（抽风）。dstu 才是真正的身份标识。
function fingerprint(profile: MaimaiProfile | null) {
  if (!profile) return '';
  const experiences = (profile.experiences || []).map((item) => `${item.company || ''}/${item.title || ''}`).join('|');
  const dstu = canonicalMaimaiLink(profile.sourceUrl);
  return [profile.name, profile.company, profile.title, experiences, profile.education, profile.age, dstu].map(text).join('|');
}

function escapeHtml(value: string | undefined) {
  return text(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));
}

function dateOnly(value: string | undefined) {
  return value ? value.slice(0, 16) : '未记录';
}

function clampPosition(position: PanelPosition) {
  const maxLeft = Math.max(8, window.innerWidth - PANEL_WIDTH - 16);
  const maxTop = Math.max(8, window.innerHeight - 180);
  return {
    left: Math.min(Math.max(8, position.left), maxLeft),
    top: Math.min(Math.max(8, position.top), maxTop),
  };
}

function applyPanelPosition(panel: HTMLElement) {
  const next = clampPosition(panelPosition);
  panel.style.left = `${next.left}px`;
  panel.style.top = `${next.top}px`;
}

async function loadPanelPosition() {
  if (positionLoaded) return;
  positionLoaded = true;
  try {
    const values = await chrome.storage.local.get(POSITION_KEY);
    const stored = values[POSITION_KEY] as Partial<PanelPosition> | undefined;
    if (typeof stored?.left === 'number' && typeof stored?.top === 'number') {
      panelPosition = clampPosition({ left: stored.left, top: stored.top });
    }
  } catch {
    try {
      const stored = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null') as Partial<PanelPosition> | null;
      if (typeof stored?.left === 'number' && typeof stored?.top === 'number') {
        panelPosition = clampPosition({ left: stored.left, top: stored.top });
      }
    } catch {
      panelPosition = { ...DEFAULT_POSITION };
    }
  }
  try {
    const values = await chrome.storage.local.get(MINIMIZED_KEY);
    // 没存过 = 第一次用：默认展开，方便新手发现这个面板；用户手动收起后才记住 minimized。
    isMinimized = values[MINIMIZED_KEY] === true;
  } catch {
    isMinimized = localStorage.getItem(MINIMIZED_KEY) === 'true';
  }
}

function savePanelPosition() {
  const next = clampPosition(panelPosition);
  panelPosition = next;
  try {
    void chrome.storage.local.set({ [POSITION_KEY]: next });
  } catch {
    localStorage.setItem(POSITION_KEY, JSON.stringify(next));
  }
}

function resetPanelPosition() {
  panelPosition = { ...DEFAULT_POSITION };
  savePanelPosition();
  const panel = document.getElementById(PANEL_ID);
  if (panel) applyPanelPosition(panel);
}

function saveMinimizedState() {
  try {
    void chrome.storage.local.set({ [MINIMIZED_KEY]: isMinimized });
  } catch {
    localStorage.setItem(MINIMIZED_KEY, String(isMinimized));
  }
}

function setMinimized(next: boolean) {
  isMinimized = next;
  saveMinimizedState();
  renderPanel();
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      z-index: 2147483646;
      width: ${PANEL_WIDTH}px;
      max-width: calc(100vw - 12px);
      max-height: calc(100vh - 20px);
      font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
      color: #5f4b33;
      border: 1px solid rgba(114, 93, 66, 0.14);
      border-top: 4px solid #76bd83;
      border-radius: 16px;
      background: rgba(255, 251, 238, 0.97);
      box-shadow: 0 6px 0 rgba(114, 93, 66, 0.10), 0 14px 26px rgba(58, 43, 25, 0.18);
      overflow: hidden;
    }
    #${PANEL_ID}.is-minimized {
      width: 46px;
      height: 46px;
      max-width: 46px;
      max-height: 46px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      box-shadow: 0 8px 18px rgba(58, 43, 25, 0.18);
      cursor: grab;
    }
    #${PANEL_ID}.is-minimized:active { cursor: grabbing; }
    #${PANEL_ID} * { box-sizing: border-box; }
    .gllue-mm-orb {
      display: grid;
      place-items: center;
      width: 46px;
      height: 46px;
      border: 0;
      border-radius: 999px;
      color: #fff8df;
      background: #76bd83;
      box-shadow: 0 4px 0 rgba(114, 93, 66, 0.16);
      cursor: pointer;
      font-size: 19px;
      font-weight: 900;
    }
    .gllue-mm-drag {
      display: grid;
      grid-template-columns: 30px minmax(0, 1fr);
      gap: 7px;
      align-items: center;
      padding: 8px 8px 6px;
      cursor: grab;
      user-select: none;
    }
    .gllue-mm-drag:active { cursor: grabbing; }
    .gllue-mm-icon {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 11px;
      color: #fff8df;
      background: #76bd83;
      font-size: 16px;
      font-weight: 900;
      box-shadow: 0 3px 0 rgba(114, 93, 66, 0.14);
    }
    .gllue-mm-title { min-width: 0; padding-right: 35px; }
    .gllue-mm-title strong,
    .gllue-mm-title span {
      display: block;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .gllue-mm-title strong { font-size: 14px; line-height: 1.16; }
    .gllue-mm-title span { margin-top: 2px; color: #7a664b; font-size: 11px; font-weight: 800; }
    .gllue-mm-reset {
      position: absolute;
      top: 8px;
      right: 8px;
      height: 22px;
      padding: 0 7px;
      border: 0;
      border-radius: 999px;
      color: #7a664b;
      background: rgba(242, 230, 200, 0.82);
      cursor: pointer;
      font-size: 11px;
      font-weight: 900;
    }
    .gllue-mm-collapse {
      position: absolute;
      top: 8px;
      right: 48px;
      width: 22px;
      height: 22px;
      border: 0;
      border-radius: 999px;
      color: #7a664b;
      background: rgba(242, 230, 200, 0.82);
      cursor: pointer;
      font-size: 13px;
      font-weight: 900;
      line-height: 1;
    }
    .gllue-mm-body {
      display: grid;
      gap: 6px;
      padding: 0 8px 9px;
      overflow: auto;
      max-height: calc(100vh - 96px);
    }
    .gllue-mm-fields {
      display: grid;
      grid-template-columns: 1fr;
      gap: 5px;
    }
    .gllue-mm-field {
      min-width: 0;
      padding: 5px 7px;
      border: 1px solid rgba(114, 93, 66, 0.12);
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.66);
    }
    .gllue-mm-field small,
    .gllue-mm-field b {
      display: block;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .gllue-mm-field small { color: #8a765b; font-size: 10px; font-weight: 900; }
    .gllue-mm-field b { margin-top: 1px; color: #4f3e2b; font-size: 12px; }
    .gllue-mm-field.is-wide { grid-column: auto; }
    .gllue-mm-status {
      padding: 7px 8px;
      border-radius: 11px;
      background: #d7f4e9;
      color: #267465;
      font-size: 12px;
      font-weight: 900;
    }
    .gllue-mm-status.is-unknown { color: #9b4050; background: #ffe5d9; }
    .gllue-mm-status.is-empty { color: #6f5a39; background: #f2e6c8; }
    .gllue-mm-match {
      display: grid;
      gap: 6px;
      padding: 7px;
      border: 1px solid rgba(114, 93, 66, 0.12);
      border-radius: 11px;
      background: rgba(255, 255, 255, 0.68);
    }
    .gllue-mm-match b { font-size: 14px; }
    .gllue-mm-match small { color: #7a664b; font-weight: 800; }
    .gllue-mm-note {
      max-height: 56px;
      overflow: auto;
      margin: 0;
      padding: 7px 8px;
      border-radius: 10px;
      background: rgba(255, 248, 223, 0.86);
      color: #4f3e2b;
      font-size: 12px;
      line-height: 1.45;
    }
    .gllue-mm-actions { display: flex; justify-content: flex-end; gap: 6px; }
    .gllue-mm-actions button {
      min-height: 30px;
      height: auto;
      padding: 5px 9px;
      border: 1px solid rgba(114, 93, 66, 0.2);
      border-radius: 999px;
      color: #5f4b33;
      background: #fff8df;
      box-shadow: 0 3px 0 rgba(114, 93, 66, 0.14);
      cursor: pointer;
      font-weight: 900;
    }
    .gllue-mm-check {
      width: 100%;
      height: 34px;
      border: 0;
      border-radius: 999px;
      color: #fffaf0;
      background: #76bd83;
      box-shadow: 0 4px 0 rgba(114, 93, 66, 0.16);
      cursor: pointer;
      font-weight: 900;
    }
    .gllue-mm-check:disabled {
      cursor: not-allowed;
      color: #8a765b;
      background: #f2e6c8;
      box-shadow: none;
    }
    .gllue-mm-create {
      width: 100%;
      height: 34px;
      margin-top: 2px;
      border: 0;
      border-radius: 999px;
      color: #fffaf0;
      background: #e0913c;
      box-shadow: 0 4px 0 rgba(114, 93, 66, 0.16);
      cursor: pointer;
      font-weight: 900;
    }
    .gllue-mm-confirm {
      display: grid;
      gap: 5px;
      padding: 7px;
      border: 1px solid rgba(224, 145, 60, 0.4);
      border-radius: 11px;
      background: rgba(255, 248, 223, 0.86);
    }
    .gllue-mm-confirm small { display: block; color: #8a765b; font-size: 10px; font-weight: 900; }
    .gllue-mm-confirm b { display: block; margin-top: 1px; color: #4f3e2b; font-size: 12px; word-break: break-all; }
    .gllue-mm-confirm-actions { display: flex; gap: 6px; }
    .gllue-mm-confirm-actions button {
      flex: 1;
      height: 34px;
      border: 0;
      border-radius: 999px;
      cursor: pointer;
      font-weight: 900;
    }
    .gllue-mm-cancel { color: #5f4b33; background: #f2e6c8; }
    .gllue-mm-confirm-btn { color: #fffaf0; background: #e0913c; box-shadow: 0 4px 0 rgba(114, 93, 66, 0.16); }
  `;
  document.documentElement.appendChild(style);
}

// 只在查无在库记录时出现：把当前脉脉候选人建成谷露最小档案。这是唯一的写操作，
// 需要有姓名或工作经历才可点。
function createButton(profile: MaimaiProfile | null) {
  const canCreate = profile && (text(profile.name) || hasWorkSignal(profile));
  if (!canCreate) return '';
  return `<button class="gllue-mm-create" type="button">在谷露新建该人才</button>`;
}

function field(label: string, value: string | undefined, wide = false) {
  return `<div class="gllue-mm-field${wide ? ' is-wide' : ''}"><small>${escapeHtml(label)}</small><b>${escapeHtml(value || '未读取到')}</b></div>`;
}

function renderFields(profile: MaimaiProfile | null) {
  const experiences = (profile?.experiences?.length ? profile.experiences : [{ company: profile?.company, title: profile?.title }])
    .filter((item) => item.company || item.title)
    .slice(0, 3);
  return `
    <div class="gllue-mm-fields">
      ${field('姓名', profile?.name)}
      ${field('年龄', profile?.age)}
      ${field('学历', profile?.education)}
      ${experiences.length ? experiences.map((item, index) => field(`工作 ${index + 1}`, [item.company, item.title].filter(Boolean).join(' / '), true)).join('') : field('最近工作', undefined, true)}
    </div>
  `;
}

function hasWorkSignal(profile: MaimaiProfile | null) {
  return Boolean((profile?.experiences?.length ? profile.experiences : [{ company: profile?.company, title: profile?.title }]).some((item) => item.company && item.title));
}

function resultBody() {
  const profile = currentResult?.profile || currentProfile;
  if (currentMode === 'loading') {
    return `${renderFields(profile)}<div class="gllue-mm-status is-empty">正在只读查询谷露人才库...</div>`;
  }
  if (currentMode === 'unknown') {
    return `${renderFields(profile)}<div class="gllue-mm-status is-unknown">${escapeHtml(currentError || '请先打开人才详情。')}</div>`;
  }
  if (currentMode === 'result' && currentResult?.status === 'matched') {
    const candidates = currentResult.candidates.slice(0, 3);
    const tierMeta = (tier?: string) =>
      tier === 'strong'
        ? { text: '强命中', color: '#166534', bg: '#dcfce7' }
        : tier === 'likely'
          ? { text: '疑似', color: '#92400e', bg: '#fef3c7' }
          : { text: '同名', color: '#9b4050', bg: '#ffe5d9' };
    const cards = candidates
      .map((candidate) => {
        const meta = tierMeta(candidate.tier);
        return `
      <div class="gllue-mm-match">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
          <span style="padding:1px 7px;border-radius:999px;font-size:10px;font-weight:900;color:${meta.color};background:${meta.bg};">${meta.text}</span>
          <b>${escapeHtml(candidate.name)}</b>
        </div>
        <small>${escapeHtml([candidate.company, candidate.title].filter(Boolean).join(' / ') || '公司职位未记录')}</small>
        <small>${escapeHtml(candidate.matchReason || '')}</small>
        ${candidate.matchedExperience ? `<small>${escapeHtml(`脉脉：${candidate.matchedExperience}`)}</small>` : ''}
        <small>最近更新：${escapeHtml(dateOnly(candidate.lastUpdateDate))}　顾问：${escapeHtml(candidate.consultant || '未记录')}</small>
        <p class="gllue-mm-note">${escapeHtml(candidate.recentNoteText || '暂无备注正文')}</p>
        <div class="gllue-mm-actions"><button type="button" data-gllue-candidate="${candidate.id}">打开谷露人才</button></div>
      </div>`;
      })
      .join('');
    const hasStrong = candidates.some((candidate) => candidate.tier === 'strong');
    const hint = hasStrong ? '发现强命中的在库人才，建议先看备注。' : '发现疑似/同名记录，请人工确认是否同一人。';
    // 没有强命中时（全是疑似/同名，很可能只是重名的不同人），也提供建档入口：
    // 顾问确认过这些都不是同一人后，可直接新建。有强命中则不给按钮，避免建重复。
    const createBlock = hasStrong ? '' : createButton(profile);
    return `${renderFields(profile)}<div class="gllue-mm-status">${hint}</div>${cards}${createBlock}`;
  }
  if (currentMode === 'result' && currentResult?.status === 'not_found') {
    const checked = (currentResult.profile.experiences || []).slice(0, 3).filter((item) => item.company || item.title).length;
    return `${renderFields(profile)}<div class="gllue-mm-status is-empty">未发现明显在库记录，已检查 ${checked || 1} 段工作经历。</div>${createButton(profile)}`;
  }
  if (currentMode === 'confirm') {
    // 落库前的确认预览：把即将写入谷露的字段原样列出，顾问确认后才真正创建，
    // 避免误建/脏数据污染人才库。
    const link = profile ? canonicalMaimaiLink(profile.sourceUrl) : '';
    return `
      ${renderFields(profile)}
      <div class="gllue-mm-status is-empty">将按以下内容在谷露新建人才，确认无误后创建：</div>
      <div class="gllue-mm-confirm">
        <div><small>姓名</small><b>${escapeHtml(profile?.name || '（空）')}</b></div>
        <div><small>公司 / 职位</small><b>${escapeHtml([profile?.company, profile?.title].filter(Boolean).join(' / ') || '（空）')}</b></div>
        <div><small>学历</small><b>${escapeHtml(profile?.education || '（空）')}</b></div>
        <div><small>脉脉链接</small><b>${escapeHtml(link || '（本页未取到，将不写入链接）')}</b></div>
      </div>
      <div class="gllue-mm-confirm-actions">
        <button class="gllue-mm-cancel" type="button">取消</button>
        <button class="gllue-mm-confirm-btn" type="button">确认创建</button>
      </div>
    `;
  }
  if (currentMode === 'creating') {
    return `${renderFields(profile)}<div class="gllue-mm-status is-empty">正在谷露新建人才...</div>`;
  }
  if (currentMode === 'created') {
    return `${renderFields(profile)}<div class="gllue-mm-status">已在谷露新建人才，正在打开人才页补全资料。</div>`;
  }
  return `
    ${renderFields(currentProfile)}
    <button class="gllue-mm-check" type="button" ${hasWorkSignal(currentProfile) ? '' : 'disabled'}>查谷露在库</button>
    <div class="gllue-mm-status is-empty">${hasWorkSignal(currentProfile) ? '按姓名 + 经历/学校分级查重（强命中 / 疑似 / 同名）。' : '请在脉脉“人才详情页”打开某个候选人后再使用。'}</div>
  `;
}

let lastRenderedHtml = '';

function renderPanel() {
  ensureStyle();
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = PANEL_ID;
    document.body.appendChild(panel);
    lastRenderedHtml = '';
  }
  let html = '';
  if (isMinimized) {
    html = `<button class="gllue-mm-orb" type="button" title="展开谷露查重">查</button>`;
  } else {
    const title = currentProfile?.name ? `查 ${currentProfile.name}` : '查谷露在库';
    const subtitle = currentProfile ? [currentProfile.company, currentProfile.title].filter(Boolean).join(' / ') || '等待工作经历' : '拖动浮窗可移动';
    html = `
    <div class="gllue-mm-drag">
      <span class="gllue-mm-icon">查</span>
      <span class="gllue-mm-title">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(subtitle)}</span>
      </span>
    </div>
    <button class="gllue-mm-collapse" type="button" title="收起">×</button>
    <button class="gllue-mm-reset" type="button">重置</button>
    <div class="gllue-mm-body">${resultBody()}</div>
  `;
  }
  // 内容没变就不重写 innerHTML：定时器/页面变动会频繁触发本函数，无脑重写会把
  // 面板滚动位置清零（滚一下就跳回顶部）、还会不停打断用户操作（"抽搐"）。
  if (html !== lastRenderedHtml) {
    panel.innerHTML = html;
    lastRenderedHtml = html;
    wirePanelEvents(panel);
  }
  panel.classList.toggle('is-minimized', isMinimized);
  applyPanelPosition(panel);
}

function wirePanelEvents(panel: HTMLElement) {
  panel.querySelector('.gllue-mm-orb')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (suppressOrbClick) {
      suppressOrbClick = false;
      return;
    }
    setMinimized(false);
  });
  panel.querySelector('.gllue-mm-collapse')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setMinimized(true);
  });
  panel.querySelector('.gllue-mm-reset')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    resetPanelPosition();
  });
  panel.querySelector('.gllue-mm-check')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    handleManualCheck();
  });
  panel.querySelector('.gllue-mm-create')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // 不直接创建：先进确认预览，顾问核对后才落库。
    currentMode = 'confirm';
    lastRenderedHtml = '';
    renderPanel();
  });
  panel.querySelector('.gllue-mm-cancel')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    currentMode = 'result';
    lastRenderedHtml = '';
    renderPanel();
  });
  panel.querySelector('.gllue-mm-confirm-btn')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void handleCreateCandidate();
  });
  // querySelectorAll：结果有多张候选卡片时，每张的"打开谷露人才"都要绑事件
  // （之前用 querySelector 只绑了第一张，第二/三张点了没反应）。
  panel.querySelectorAll('[data-gllue-candidate]').forEach((button) => {
    button.addEventListener('click', (event) => {
      const target = event.currentTarget as HTMLElement;
      const id = target.dataset.gllueCandidate;
      if (!id) return;
      const url = `${GLLUE_BASE}?gllue_shell=off#candidate/detail?id=${id}`;
      chrome.runtime.sendMessage({ type: 'GLLUE_SHELL_OPEN_ORIGINAL', url }).catch(() => window.open(url, '_blank', 'noopener,noreferrer'));
    });
  });
  const handle = (panel.querySelector('.gllue-mm-drag') || panel.querySelector('.gllue-mm-orb')) as HTMLElement | null;
  handle?.addEventListener('pointerdown', (event) => {
    const targetButton = (event.target as HTMLElement).closest('button');
    if (targetButton && !targetButton.classList.contains('gllue-mm-orb')) return;
    dragging = true;
    suppressOrbClick = false;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = { ...panelPosition };
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      if (!dragging) return;
      if (Math.abs(moveEvent.clientX - startX) > 4 || Math.abs(moveEvent.clientY - startY) > 4) {
        suppressOrbClick = true;
      }
      panelPosition = clampPosition({
        left: start.left + moveEvent.clientX - startX,
        top: start.top + moveEvent.clientY - startY,
      });
      applyPanelPosition(panel);
    };
    const up = () => {
      dragging = false;
      savePanelPosition();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

async function checkProfile(profile: MaimaiProfile) {
  currentMode = 'loading';
  currentResult = null;
  currentError = '';
  renderPanel();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'MAIMAI_CHECK_PROFILE', profile }) as { ok?: boolean; result?: CandidateMatchResult };
    currentResult = response.result || { status: 'unknown', profile, candidates: [], error: '无法确认，请稍后重试或回谷露搜索。' };
    currentMode = currentResult.status === 'unknown' ? 'unknown' : 'result';
    currentError = currentResult.error || '';
  } catch (error) {
    currentResult = { status: 'unknown', profile, candidates: [], error: error instanceof Error ? error.message : '无法确认，请稍后重试或回谷露搜索。' };
    currentMode = 'unknown';
    currentError = currentResult.error || '';
  }
  renderPanel();
}

// 招聘版 DOM 里没有档案链接（点击瞬间才生成），查重前让 background 到主世界
// 模拟点一下"前往公开档案"并截获 URL（弹窗被吞掉，不会真开新页）。
// 按 姓名+公司 缓存，同一候选人反复查重不重复模拟点击。
let capturedLinkCache = { key: '', link: '' };

async function ensureProfileLink(profile: MaimaiProfile): Promise<MaimaiProfile> {
  if (canonicalMaimaiLink(profile.sourceUrl)) return profile;
  const key = [profile.name, profile.company].map(text).join('|');
  if (capturedLinkCache.key === key && capturedLinkCache.link) {
    return { ...profile, sourceUrl: capturedLinkCache.link };
  }
  try {
    const response = await chrome.runtime.sendMessage({ type: 'MAIMAI_CAPTURE_PROFILE_LINK' }) as { url?: string };
    const link = canonicalMaimaiLink(response?.url || '');
    if (link) {
      capturedLinkCache = { key, link };
      return { ...profile, sourceUrl: link };
    }
  } catch {
    // 截获失败不影响查重，落回模糊分级。
  }
  return profile;
}

async function handleCreateCandidate() {
  const profile = currentProfile;
  if (!profile) return;
  currentMode = 'creating';
  lastRenderedHtml = '';
  renderPanel();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'MAIMAI_CREATE_CANDIDATE', profile }) as { ok?: boolean; id?: number; url?: string; error?: string };
    if (response?.ok && response.url) {
      currentMode = 'created';
      lastRenderedHtml = '';
      renderPanel();
      // 打开新建人才的谷露页，让顾问补全备注/教育等（原生页写操作更可靠）。
      chrome.runtime.sendMessage({ type: 'GLLUE_SHELL_OPEN_ORIGINAL', url: response.url }).catch(() => window.open(response.url, '_blank', 'noopener,noreferrer'));
    } else {
      currentMode = 'unknown';
      currentError = response?.error || '建档失败，请回谷露手动新建。';
      lastRenderedHtml = '';
      renderPanel();
    }
  } catch (error) {
    currentMode = 'unknown';
    currentError = error instanceof Error ? error.message : '建档失败，请回谷露手动新建。';
    lastRenderedHtml = '';
    renderPanel();
  }
}

function handleManualCheck() {
  const profile = extractMaimaiProfileFromPage();
  if (!profile || !hasWorkSignal(profile)) {
    currentProfile = profile;
    currentMode = 'unknown';
    currentError = '未读取到可查重的公司和 title，请先点开脉脉人才详情。';
    currentResult = null;
    renderPanel();
    return;
  }
  currentProfile = profile;
  // 指纹永远按"页面原样抓取"计算：后台巡检重抓的 profile 不带截获的 dstu 链接，
  // 若这里换成带链接的指纹，巡检会误判"换人了"而把查重结果清掉。
  lastFingerprint = fingerprint(profile);
  currentMode = 'loading';
  currentResult = null;
  currentError = '';
  renderPanel();
  void (async () => {
    const withLink = await ensureProfileLink(profile);
    currentProfile = withLink;
    await checkProfile(withLink);
  })();
}

function scheduleCheck() {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    if (dragging) return;
    const profile = extractMaimaiProfileFromPage();
    const nextFingerprint = fingerprint(profile);
    if (nextFingerprint !== lastFingerprint) {
      lastFingerprint = nextFingerprint;
      currentProfile = profile;
      currentResult = null;
      currentError = '';
      currentMode = 'idle';
    }
    renderPanel();
  }, 700);
}

void loadPanelPosition().then(scheduleCheck);
// 面板自己的 DOM 变动不算"页面变化"，否则渲染→观察到变动→再渲染会自激循环。
const observer = new MutationObserver((mutations) => {
  const external = mutations.some((mutation) => {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
    return !target?.closest(`#${PANEL_ID}`);
  });
  if (external) scheduleCheck();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('click', scheduleCheck, true);
window.addEventListener('resize', () => {
  panelPosition = clampPosition(panelPosition);
  savePanelPosition();
  const panel = document.getElementById(PANEL_ID);
  if (panel) applyPanelPosition(panel);
});
window.setInterval(scheduleCheck, 1800);
window.addEventListener('popstate', scheduleCheck);
