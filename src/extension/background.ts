import { matchMaimaiWithEnhance, upsertCandidateSummaries } from '../services/enhanceApi';
import type { Candidate } from '../types/gllue';
import { GLLUE_HOST, GLLUE_ORIGIN, REPORT_GITEE_OWNER, REPORT_GITEE_REPO, REPORT_GITEE_TOKEN, REPORT_GITEE_BRANCH } from '../config';

const STORAGE_KEY = 'gllueShellEnabled';
const originalTabIds = new Set<number>();

type MaimaiProfile = {
  name?: string;
  company?: string;
  title?: string;
  experiences?: Array<{ company?: string; title?: string }>;
  education?: string;
  age?: string;
  mobile?: string;
  email?: string;
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
  | { type: 'MAIMAI_START_SNIFFER' }
  | { type: 'MAIMAI_ENRICH_RESUME'; profile: MaimaiProfile; candidateId: number }
  | { type: 'MAIMAI_CREATE_CANDIDATE'; profile: MaimaiProfile };

// 谷露 /rest/file/upload（to_extractor=true）解析出的简历结构。字段可能缺失，全部可选。
type ResumeExtractExperience = {
  title?: string;
  description?: string;
  is_current?: boolean | number | null;
  start?: string | null;
  end?: string | null;
  client?: { id?: number; name?: string } | null;
};
type ResumeExtractEducation = {
  school?: string;
  degree?: string;
  major?: string;
  is_current?: boolean | number | null;
  start?: string | null;
  end?: string | null;
};
type ResumeExtract = {
  chineseName?: string | null;
  englishName?: string | null;
  mobile?: string | null;
  email?: string | null;
  built_in_self_assessment?: string | null;
  candidateexperience_set?: ResumeExtractExperience[];
  candidateeducation_set?: ResumeExtractEducation[];
};

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
    // 截到带 dstu 的链接立即返回，1.6 秒只是上限。
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const url = captured.find((item) => /dstu=\d{5,}/.test(item)) || '';
      if (!url && Date.now() - startedAt < 1600) return;
      window.clearInterval(timer);
      window.open = origOpen;
      HTMLAnchorElement.prototype.click = origClick;
      resolve(url);
    }, 120);
  });
}

// 【临时调试工具】在页面主世界里装一个网络嗅探器，把页面自己发出的 fetch/XHR 全部
// 记录下来，并画一个右上角悬浮层展示。脉脉有反调试（一开 devtools 就刷新），但从主世界
// 注入脚本页面无法察觉，所以用它来摸「下载在线简历」的接口，无需打开 F12。
// 摸清接口后这个函数和相关按钮/消息应删除。
function installNetworkSnifferInPage() {
  type SniffEntry = {
    kind: string;
    method: string;
    url: string;
    body: string;
    status: string | number;
    resp: string;
    t: number;
  };
  const w = window as unknown as {
    __gllueSniffInstalled?: boolean;
    __gllueSniff?: SniffEntry[];
    fetch: typeof fetch;
  };
  const OVERLAY_ID = 'gllue-sniff-overlay';
  if (w.__gllueSniffInstalled) {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.style.display = existing.style.display === 'none' ? 'flex' : 'none';
    return;
  }
  w.__gllueSniffInstalled = true;
  const log: SniffEntry[] = [];
  w.__gllueSniff = log;
  // 只关心的关键词：命中的请求高亮到顶部，方便一眼找到「下载在线简历」那条。
  const KEY = /(resume|cv|pdf|download|file|attach|doc|export|online|简历|下载|附件|导出)/i;

  let showAll = false;
  let overlay: HTMLElement | null = null;
  let listEl: HTMLElement | null = null;

  const esc = (s: string) =>
    String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText =
      'position:fixed;top:12px;right:12px;width:440px;max-height:70vh;z-index:2147483647;' +
      'background:#0b1020;color:#e6edf3;font:12px/1.5 monospace;border:1px solid #30416b;' +
      'border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.5);display:flex;flex-direction:column;';
    const header = document.createElement('div');
    header.style.cssText =
      'display:flex;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid #30416b;';
    header.innerHTML =
      '<strong style="flex:1">🔍 谷露抓包</strong>' +
      '<button data-act="all" style="cursor:pointer">全部/关键</button>' +
      '<button data-act="copy" style="cursor:pointer">复制全部</button>' +
      '<button data-act="clear" style="cursor:pointer">清空</button>' +
      '<button data-act="hide" style="cursor:pointer">×</button>';
    listEl = document.createElement('div');
    listEl.style.cssText = 'overflow:auto;padding:6px 8px;';
    overlay.appendChild(header);
    overlay.appendChild(listEl);
    document.body.appendChild(overlay);
    header.addEventListener('click', (ev) => {
      const act = (ev.target as HTMLElement).getAttribute('data-act');
      if (act === 'all') { showAll = !showAll; render(); }
      else if (act === 'clear') { log.length = 0; render(); }
      else if (act === 'hide') { if (overlay) overlay.style.display = 'none'; }
      else if (act === 'copy') {
        const text = JSON.stringify(log, null, 2);
        navigator.clipboard?.writeText(text).then(
          () => { const b = ev.target as HTMLElement; const o = b.textContent; b.textContent = '已复制✓'; setTimeout(() => { b.textContent = o; }, 1200); },
          () => { window.prompt('复制失败，手动全选复制：', text); },
        );
      }
    });
  }

  function render() {
    if (!overlay) buildOverlay();
    if (!listEl) return;
    const rows = log
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => showAll || KEY.test(e.url) || KEY.test(e.body) || KEY.test(String(e.resp)))
      .slice(-80)
      .reverse();
    listEl.innerHTML = rows
      .map(({ e }) => {
        const hit = KEY.test(e.url) || KEY.test(e.body) || KEY.test(String(e.resp));
        const border = hit ? '#f0b429' : '#30416b';
        return (
          `<div style="margin:4px 0;padding:5px 6px;border-left:3px solid ${border};background:#141b30;border-radius:4px;word-break:break-all;">` +
          `<div><b style="color:#7ee787">${esc(e.method)}</b> <span style="color:#9aa">${esc(String(e.status))}</span> ${esc(e.kind)}</div>` +
          `<div style="color:#79c0ff">${esc(e.url)}</div>` +
          (e.body ? `<div style="color:#ffa657">body: ${esc(e.body)}</div>` : '') +
          (e.resp ? `<div style="color:#8b949e">resp: ${esc(String(e.resp).slice(0, 240))}</div>` : '') +
          `</div>`
        );
      })
      .join('') || '<div style="color:#8b949e">还没抓到请求。去点脉脉「下载在线简历」…</div>';
  }

  function pushEntry(e: SniffEntry) {
    log.push(e);
    render();
  }

  // patch fetch
  const origFetch = w.fetch.bind(window);
  w.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url || String(input);
    const method = (init && init.method) || (input instanceof Request ? input.method : 'GET') || 'GET';
    const body = init && init.body ? String(init.body).slice(0, 600) : '';
    const entry: SniffEntry = { kind: 'fetch', method, url, body, status: '', resp: '', t: Date.now() };
    pushEntry(entry);
    return origFetch(input, init).then((res) => {
      entry.status = res.status;
      res.clone().text().then((t) => { entry.resp = t.slice(0, 800); render(); }).catch(() => undefined);
      return res;
    });
  } as typeof fetch;

  // patch XHR
  const XHR = XMLHttpRequest.prototype as XMLHttpRequest & {
    open: (...a: unknown[]) => void;
    send: (...a: unknown[]) => void;
  };
  const OrigOpen = XHR.open;
  const OrigSend = XHR.send;
  XHR.open = function (this: XMLHttpRequest & { __sniff?: SniffEntry }, method: string, url: string) {
    this.__sniff = { kind: 'xhr', method: String(method), url: String(url), body: '', status: '', resp: '', t: Date.now() };
    // eslint-disable-next-line prefer-rest-params
    return OrigOpen.apply(this, arguments as unknown as unknown[]);
  } as never;
  XHR.send = function (this: XMLHttpRequest & { __sniff?: SniffEntry }, body?: unknown) {
    const e = this.__sniff;
    if (e) {
      e.body = body ? String(body).slice(0, 600) : '';
      pushEntry(e);
      this.addEventListener('load', () => {
        e.status = this.status;
        try { e.resp = String(this.responseText || '').slice(0, 800); } catch { e.resp = '[non-text]'; }
        render();
      });
    }
    // eslint-disable-next-line prefer-rest-params
    return OrigSend.apply(this, arguments as unknown as unknown[]);
  } as never;

  // 下载/新开标签往往不走 fetch/XHR，而是 window.open / <a download href> / location 跳转，
  // 这里一并拦截，才能看到真正的简历文件 URL。
  const logNav = (kind: string, url: string) => {
    if (!url || url === 'undefined' || url.startsWith('javascript:')) return;
    pushEntry({ kind, method: 'NAV', url: String(url), body: '', status: '', resp: '', t: Date.now() });
  };

  const origOpen = window.open;
  window.open = function (url?: string | URL) {
    logNav('window.open', String(url ?? ''));
    // eslint-disable-next-line prefer-rest-params
    return origOpen.apply(window, arguments as unknown as [] );
  } as typeof window.open;

  const OrigAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    logNav(this.hasAttribute('download') ? 'a.download' : 'a.click', this.href);
    return OrigAnchorClick.call(this);
  };

  const OrigFormSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    logNav('form.submit', this.action);
    return OrigFormSubmit.call(this);
  };

  // 真实用户点击：冒泡到 document 前捕获路径里的 <a>，记录其 href（download 链接常靠原生点击触发）。
  document.addEventListener(
    'click',
    (ev) => {
      const path = (ev.composedPath && ev.composedPath()) || [];
      for (const node of path) {
        if (node instanceof HTMLAnchorElement && node.href) {
          logNav(node.hasAttribute('download') ? 'click>a.download' : 'click>a', node.href);
          break;
        }
      }
    },
    true,
  );

  // 有些「下载」是把服务端返回的字节在前端拼成 blob 再下载：这一步会调 createObjectURL，
  // 记下来能反推是哪个 fetch/XHR 的响应变成了文件。
  const origCreateURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj: Blob | MediaSource) {
    const url = origCreateURL(obj as Blob);
    let info = '';
    try {
      const b = obj as Blob;
      if (b && typeof b.size === 'number') info = ` [${b.type || 'blob'} ${b.size}B]`;
    } catch { info = ''; }
    logNav('createObjectURL', url + info);
    return url;
  } as typeof URL.createObjectURL;

  // 有些「下载/预览」是往页面塞 <iframe src> 或动态插 <a href>：用 MutationObserver 监视新增节点。
  try {
    const mo = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach((n) => {
          if (n instanceof HTMLIFrameElement && n.src) logNav('iframe.src', n.src);
          else if (n instanceof HTMLAnchorElement && n.href && (n.hasAttribute('download') || /\.pdf|resume|download|file/i.test(n.href))) {
            logNav('dom>a', n.href);
          }
        });
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch { /* ignore */ }

  render();
}

// 在页面主世界执行：脉脉「下载在线简历」点击瞬间才用 window.open / <a>.click 生成
// 带 trackable_token 的 print_pdf URL（DOM 里平时不存在），且脉脉有反调试无法用
// devtools。这里临时劫持 window.open / <a>.click 吞掉弹窗，程序化点一下下载按钮，
// 只截获 print_pdf URL 不真开新页。与 capturePublicProfileLinkInPage 同一套打法。
function captureResumePdfUrlInPage() {
  return new Promise<string>((resolve) => {
    // 排除扩展自己注入的浮窗/嗅探层——补全时浮窗状态文字含「在线简历」，曾被误点。
    const isOurs = (node: Element) =>
      !!node.closest('#gllue-maimai-check-card, #gllue-sniff-overlay');
    const all = Array.from(document.querySelectorAll('*')).filter((node) => {
      if (isOurs(node)) return false;
      const t = (node.textContent || '').trim();
      return /下载在线简历|下载简历|在线简历/.test(t) && t.length < 24;
    });
    // 取最"里层"的匹配节点：过滤掉还包含其他匹配节点的外层容器，避免点到大 div。
    const leaves = all.filter((node) => !all.some((other) => other !== node && node.contains(other)));
    // 优先精确「下载在线简历」，避免命中页面其他含「在线简历」的文字（如筛选项「有附件简历」旁的说明等）。
    const exact = leaves.filter((node) => /下载在线简历/.test((node.textContent || '').trim()));
    const pool = exact.length ? exact : leaves;
    const target = pool[pool.length - 1] || all[all.length - 1];
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
    // 截到 print_pdf URL 立即返回，2.2 秒只是上限。
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const url = captured.find((item) => /print_pdf/.test(item)) || '';
      if (!url && Date.now() - startedAt < 2200) return;
      window.clearInterval(timer);
      window.open = origOpen;
      HTMLAnchorElement.prototype.click = origClick;
      resolve(url);
    }, 120);
  });
}

// 在页面主世界执行：探测详情里的「附件简历」卡片。附件简历通常比在线简历信息全，
// 若存在且是近 2 年内上传的，就劫持 window.open/a.click 点它的「下载」截获文件 URL。
// 返回 status：ok=已截获 / none=无附件 / old=附件太旧 / nobtn=没找到下载按钮 /
// nourl=点了但没截到 URL（如走 blob: 下载）。除 ok 外都回落到在线简历。
function captureAttachmentPdfUrlInPage() {
  return new Promise<{ status: string; url?: string; filename?: string; date?: string }>((resolve) => {
    const isOurs = (node: Element) => !!node.closest('#gllue-maimai-check-card, #gllue-sniff-overlay');
    // 附件卡片特征：同一小块里既有 "xxx.pdf/doc" 文件名又有 "X月X日 上传" 日期。
    const all = Array.from(document.querySelectorAll('*')).filter((node) => {
      if (isOurs(node)) return false;
      const t = (node.textContent || '').trim();
      return /\.(pdf|docx?)/i.test(t) && /上传/.test(t) && t.length < 200;
    });
    const leaves = all.filter((node) => !all.some((other) => other !== node && node.contains(other)));
    const block = leaves[leaves.length - 1];
    if (!(block instanceof HTMLElement)) {
      resolve({ status: 'none' });
      return;
    }
    const blockText = (block.textContent || '').trim();
    const dateMatch = blockText.match(/(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*上传/);
    if (!dateMatch) {
      resolve({ status: 'none' });
      return;
    }
    // 脉脉当年上传的不显示年份，只有往年才带 "XXXX年"。
    const year = dateMatch[1] ? Number(dateMatch[1]) : new Date().getFullYear();
    const uploaded = new Date(year, Number(dateMatch[2]) - 1, Number(dateMatch[3]));
    const date = `${year}-${dateMatch[2]}-${dateMatch[3]}`;
    if (Date.now() - uploaded.getTime() > 2 * 365 * 24 * 3600 * 1000) {
      resolve({ status: 'old', date });
      return;
    }
    const filenameMatch = blockText.match(/[^\s，,、|]+\.(?:pdf|docx?)/i);
    // 「下载」按钮可能在卡片容器外层的操作区，最多向上找 4 层。只认全等于"下载"
    // 的节点，不会误点「下载在线简历」。
    let download: Element | undefined;
    let scope: HTMLElement | null = block;
    for (let i = 0; i < 4 && scope && !download; i += 1) {
      download = Array.from(scope.querySelectorAll('*')).find(
        (node) => !isOurs(node) && (node.textContent || '').trim() === '下载',
      );
      scope = scope.parentElement;
    }
    if (!(download instanceof HTMLElement)) {
      resolve({ status: 'nobtn', date });
      return;
    }
    const captured: string[] = [];
    const origOpen = window.open;
    const origClick = HTMLAnchorElement.prototype.click;
    window.open = function (url?: string | URL) { captured.push(String(url || '')); return null; } as typeof window.open;
    HTMLAnchorElement.prototype.click = function () { captured.push(this.href); };
    try {
      download.click();
    } catch {
      // 点击报错也要走到恢复逻辑。
    }
    // 截到 URL 立即返回，2.2 秒只是上限——大多数时候点击瞬间就有了，不用干等。
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const url = captured.find((item) => /^https?:\/\//.test(item)) || '';
      if (!url && Date.now() - startedAt < 2200) return;
      window.clearInterval(timer);
      window.open = origOpen;
      HTMLAnchorElement.prototype.click = origClick;
      resolve(url
        ? { status: 'ok', url, filename: filenameMatch ? filenameMatch[0] : undefined, date }
        : { status: 'nourl', date });
    }, 120);
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

// 从形状不确定的响应里挖出 id 匹配的人才记录：detail 端点可能直接返回记录，
// 也可能包一层 {status,data}/{result} 等壳，甚至返回列表。只认 id 对得上的。
function unwrapCandidateRecord(data: unknown, id: number, depth = 0): CandidateRecord | null {
  if (!data || typeof data !== 'object' || depth > 3) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = unwrapCandidateRecord(item, id, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = data as Record<string, unknown>;
  if (Number(record.id) === id) return record as unknown as CandidateRecord;
  for (const key of ['data', 'result', 'results', 'candidate', 'detail', 'list']) {
    const found = unwrapCandidateRecord(record[key], id, depth + 1);
    if (found) return found;
  }
  return null;
}

// 简历补全合并时要用到的字段，走 list 端点兜底时显式要全。
const DETAIL_DEMAND_KEYS = [
  'chineseName', 'englishName', 'mobile', 'email', 'attachments',
  'built_in_self_assessment', 'gllueextpersonal_website',
  'candidateexperience_set', 'candidateeducation_set',
  'company', 'avatar', 'addedBy', 'owner', 'lastUpdateBy',
];

// 实测（谷露编辑表单同款请求）：GET /rest/candidate/<id> 直接返回完整记录，
// 经历/教育带子记录 id、description、start/end。旧的 /rest/candidate/detail*
// 三个探测端点全是 404，从来没成功过，已删。
async function getCandidateDetail(id: number) {
  try {
    const record = unwrapCandidateRecord(await fetchGllueJson(`/rest/candidate/${id}`, {}), id);
    if (record) return record;
  } catch {
    // 落到 list 兜底。
  }
  // 兜底：走已验证可用的 list 端点，按 id 过滤 + 显式 demandKeys 拿合并所需字段。
  try {
    const data = await fetchGllueJson('/rest/candidate/list', {
      gql: `id__eq=${id}`,
      demandKeys: JSON.stringify(DETAIL_DEMAND_KEYS),
      paginate_by: '2',
      page: '1',
    });
    const record = unwrapCandidateRecord(data, id);
    if (record) return record;
  } catch {
    // 都失败则返回 null，由调用方决定是否中止（简历补全会放弃回填保护数据）。
  }
  return null;
}

// 实测（谷露编辑表单同款请求）：GET /rest/file/list/candidate/<id> 返回该人才的
// 附件数组（含 id/tag/active）。人才记录本身不带 attachments 字段，必须走这里。
// 拉失败时返回 null（区别于"确实没有附件"的空数组），调用方据此中止以免覆盖。
async function getCandidateAttachmentIds(id: number): Promise<string[] | null> {
  try {
    const data = await fetchGllueJson(`/rest/file/list/candidate/${id}`, {});
    const list = Array.isArray(data) ? data : (data && typeof data === 'object' ? (data as { list?: unknown[] }).list : null);
    if (!Array.isArray(list)) return null;
    return list
      .filter((item) => item && typeof item === 'object' && (item as { active?: boolean }).active !== false)
      .map((item) => String((item as { id?: number }).id ?? ''))
      .filter(Boolean);
  } catch {
    return null;
  }
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

// ===== 脉脉在线简历 → 谷露上传解析 → 回填人才 =====

// 本地 @types/chrome 版本较旧，ScriptInjection 类型上没有 world 字段（运行时
// Chrome/Edge 均支持 MAIN world）。统一走这个辅助函数做类型收窄。
function executeScriptInMainWorld<T>(tabId: number, func: () => T) {
  return chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
  } as unknown as Parameters<typeof chrome.scripting.executeScript>[0]) as Promise<Array<{ result?: Awaited<T> }>>;
}

// 主世界模拟点击「下载在线简历」，截获 print_pdf URL。
async function captureResumePdfUrl(tabId: number): Promise<string> {
  try {
    const results = await executeScriptInMainWorld(tabId, captureResumePdfUrlInPage);
    return String(results?.[0]?.result || '');
  } catch {
    return '';
  }
}

// 拉取脉脉 print_pdf 生成的 PDF 字节。带 cookie（同 maimai.cn 域）。
async function fetchResumePdf(pdfUrl: string): Promise<Blob> {
  const response = await fetch(pdfUrl, { credentials: 'include' });
  if (!response.ok) throw new Error(`简历下载返回 ${response.status}`);
  const blob = await response.blob();
  // print_pdf 偶尔会返回一个很小的错误页而非 PDF：用大小 + 魔数做兜底校验。
  if (blob.size < 1024) throw new Error('简历文件异常（过小），可能该候选人无在线简历');
  // 魔数校验：只认 PDF(%PDF) / docx(PK) / doc(D0 CF)。下载到 HTML 错误页之类的
  // 直接报错，让上层走下一级兜底，不要把垃圾传进谷露。
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  const isOle = head[0] === 0xd0 && head[1] === 0xcf;
  if (!isPdf && !isZip && !isOle) throw new Error('下载到的不是有效的简历文件（可能是网页或错误页）');
  return blob;
}

// 上传到谷露并触发解析（to_extractor=true）。响应 data[0] 里直接带 extract + 附件 id。
async function uploadResumeToGllue(blob: Blob, filename: string): Promise<{ attachmentId: number; extract: ResumeExtract }> {
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('data', JSON.stringify({ type: 'candidate', to_extractor: true, tag: 'Original CV' }));
  const response = await fetch(new URL('/rest/file/upload', GLLUE_ORIGIN).toString(), {
    method: 'POST',
    credentials: 'include',
    // 不手动设 Content-Type：交给浏览器带上 multipart boundary。
    headers: {
      Accept: 'application/json, text/plain, */*',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: form,
  });
  if (!response.ok) throw new Error(`简历上传返回 ${response.status}`);
  const json = await response.json().catch(() => null) as { data?: Array<{ id?: number; extract?: ResumeExtract }> } | null;
  const entry = json?.data?.[0];
  if (!entry || !entry.id) throw new Error('简历上传响应异常（无附件 id）');
  return { attachmentId: entry.id, extract: entry.extract || {} };
}

function toIsCurrent(value: boolean | number | null | undefined): number {
  return value ? 1 : 0;
}

// 从详情记录里把附件 id 收集成字符串数组。detail 返回的 attachments 形状不确定
// （可能是 "1,2" 字符串、数字、对象数组），全部兼容。
function collectAttachmentIds(value: unknown): string[] {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'string') return value.split(',').map((part) => part.trim()).filter(Boolean);
  if (typeof value === 'number') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => collectAttachmentIds(item));
  if (typeof value === 'object') {
    const id = (value as Record<string, unknown>).id;
    return id === null || id === undefined ? [] : [String(id)];
  }
  return [];
}

// 实测：/rest/candidate/add 带 id 时，「发了的字段整体替换、没发的字段保留」。
// 所以经历/教育/附件必须先拿当前记录合并再发，否则原有数据会被简历解析结果覆盖。
// 合并原则：原有的一律保留（含子记录 id，服务端按 id 更新而非重建）；简历解析
// 只补原来没有的段落/字段。
function buildCandidateFromExtract(
  extract: ResumeExtract,
  attachmentId: number,
  existing: CandidateRecord,
  existingAttachmentIds: string[],
  profile: MaimaiProfile,
) {
  const existingRaw = existing as unknown as Record<string, unknown>;

  // 建档时会写一条"占位经历"（描述带「脉脉档案：<链接>」和「学历：」、无起止日期，
  // 用作查重锚点）。简历解析成功后它就是冗余脏数据——真实经历由解析结果提供，
  // dstu 链接在"个人网站"字段仍在、查重照样命中——所以这里把它过滤掉。必须在
  // 算去重 key 之前过滤：否则解析出的同公司经历会先被占位条目"去重"掉，再删占位
  // 就把这段经历弄丢了。解析结果为空时占位保留（还没有更好的数据，别删锚点）。
  const parsedHasExperiences = (extract.candidateexperience_set || []).some(
    (exp) => exp.title || (exp.client && exp.client.name),
  );
  const isPlaceholderExperience = (exp: Record<string, unknown>) =>
    /脉脉档案：/.test(textValue(exp.description)) && !textValue(exp.start);
  // —— 经历：原有的原样发回（保留 id/description 等所有字段），解析结果按
  // 「公司+起始年月」（无起始时退回「公司+title」）去重后追加。
  const existingExperiences = ((existingRaw.candidateexperience_set as Array<Record<string, unknown>> | undefined) || [])
    .filter((exp) => !parsedHasExperiences || !isPlaceholderExperience(exp));
  const expKeys = new Set<string>();
  const expKey = (company: string, title: string, start: unknown) => {
    const c = normalizeForCompare(company);
    const s = String(start || '').slice(0, 7);
    return s ? `${c}|${s}` : `${c}|t:${normalizeForCompare(title)}`;
  };
  existingExperiences.forEach((exp) => {
    const company = textValue((exp.client as Record<string, unknown>)?.name)
      || textValue((exp.client as Record<string, unknown>)?.__name__)
      || textValue(exp.client);
    const title = textValue(exp.title);
    // 同一段经历登记两种 key：带起始年月的和不带的，解析结果命中任一即视为重复。
    expKeys.add(expKey(company, title, exp.start));
    expKeys.add(expKey(company, title, ''));
  });
  const newExperiences = (extract.candidateexperience_set || [])
    .map((exp) => ({
      title: exp.title || '',
      description: exp.description || '',
      is_current: toIsCurrent(exp.is_current),
      client: exp.client && (exp.client.id || exp.client.name)
        ? { ...(exp.client.id ? { id: exp.client.id } : {}), name: exp.client.name || '' }
        : { name: '' },
      start: exp.start || '',
      end: exp.end || null,
      lang: 'default',
    }))
    .filter((exp) => (exp.title || exp.client.name)
      && !expKeys.has(expKey(exp.client.name, exp.title, exp.start))
      && !expKeys.has(expKey(exp.client.name, exp.title, '')));

  // —— 教育：同理，按「学校+学位」去重追加。
  const existingEducation = (existingRaw.candidateeducation_set as Array<Record<string, unknown>> | undefined) || [];
  const eduKey = (school: string, degree: string) => `${normalizeForCompare(school)}|${normalizeForCompare(degree)}`;
  const eduKeys = new Set(existingEducation.map((edu) => eduKey(
    textValue(edu.school) || textValue(edu.school_name),
    textValue(edu.degree),
  )));
  const newEducation = (extract.candidateeducation_set || [])
    .map((edu) => ({
      school: edu.school || '',
      degree: edu.degree || '',
      major: edu.major || '',
      is_current: toIsCurrent(edu.is_current),
      start: edu.start || '',
      end: edu.end || null,
      lang: 'default',
    }))
    .filter((edu) => edu.school && !eduKeys.has(eduKey(edu.school, edu.degree)));

  // —— 附件：原有 id 全带上（来自 /rest/file/list/candidate/<id>），追加本次上传的。
  const attachmentIds = [...existingAttachmentIds, ...collectAttachmentIds(existingRaw.attachments)]
    .filter((value, index, arr) => arr.indexOf(value) === index);
  if (!attachmentIds.includes(String(attachmentId))) attachmentIds.push(String(attachmentId));

  const rawName = textValue(extract.chineseName) || textValue(profile.name);
  const isEnglish = /^[A-Za-z][A-Za-z.\s]*$/.test(rawName);
  const link = canonicalMaimaiLinkFromUrl(profile.sourceUrl);

  const payload: Record<string, unknown> = {
    id: existing.id,
    attachments: attachmentIds.join(','),
    candidateexperience_set: [...existingExperiences, ...newExperiences],
    candidateeducation_set: [...existingEducation, ...newEducation],
  };
  // 标量字段一律「原有为空才补」，不覆盖库里已有的值。
  const existingChinese = textValue(existingRaw.chineseName);
  const existingEnglish = textValue(existingRaw.englishName);
  if (!existingChinese && !existingEnglish) {
    payload.chineseName = isEnglish ? '' : rawName;
    payload.englishName = isEnglish ? rawName : textValue(extract.englishName);
  }
  if (!textValue(existingRaw.built_in_self_assessment) && textValue(extract.built_in_self_assessment)) {
    payload.built_in_self_assessment = textValue(extract.built_in_self_assessment);
  }
  // 联系方式来源优先级：简历解析 > 浮窗抓取/手动填；且仅在库里为空时才补。
  const newMobile = textValue(extract.mobile) || textValue(profile.mobile);
  const newEmail = textValue(extract.email) || textValue(profile.email);
  if (!textValue(existingRaw.mobile) && newMobile) payload.mobile = newMobile;
  if (!textValue(existingRaw.email) && newEmail) payload.email = newEmail;
  if (!textValue(existingRaw.gllueextpersonal_website) && link) payload.gllueextpersonal_website = link;
  return payload;
}

// 获取简历文件：优先「附件简历」（信息通常更全，但要近 2 年内上传的才算新鲜），
// 拿不到或太旧则退回「在线简历」。任一环节失败都尽量落到下一级，两级全失败才抛错。
type EnrichProgressReporter = (percent: number, text: string) => void;

async function acquireResumeBlob(tabId: number, name: string, report: EnrichProgressReporter): Promise<{ blob: Blob; filename: string; source: 'attachment' | 'online' }> {
  try {
    report(25, '正在探测附件简历…');
    const results = await executeScriptInMainWorld(tabId, captureAttachmentPdfUrlInPage);
    const attachment = results?.[0]?.result;
    if (attachment && attachment.status === 'ok' && attachment.url) {
      try {
        report(40, '发现近两年的附件简历，正在下载…');
        const blob = await fetchResumePdf(attachment.url);
        return { blob, filename: attachment.filename || `${name}-附件简历.pdf`, source: 'attachment' };
      } catch {
        // 附件下载失败（如 CDN 域不可达），退回在线简历。
      }
    }
  } catch {
    // 附件探测失败不致命，退回在线简历。
  }
  report(40, '正在截获在线简历下载链接…');
  const pdfUrl = await captureResumePdfUrl(tabId);
  if (!pdfUrl) throw new Error('未能获取简历：无近两年的附件简历，也未截获到在线简历链接（该候选人可能没有在线简历）。');
  report(50, '正在下载在线简历…');
  const blob = await fetchResumePdf(pdfUrl);
  return { blob, filename: `${name}-在线简历.pdf`, source: 'online' };
}

// 解析结果算不算"空"：姓名、经历、教育全无就是没解析出来（典型原因：图片型/
// 扫描件 PDF，谷露解析器只认文字层）。
function extractIsEmpty(extract: ResumeExtract) {
  return !textValue(extract.chineseName)
    && !(extract.candidateexperience_set || []).length
    && !(extract.candidateeducation_set || []).length;
}

// 编排：拉当前人才详情/附件 → 获取简历（附件简历优先）→ 上传解析 → 合并回填。
// 拿不到详情就中止：宁可不补全，也不能把已有资料整体覆盖掉。
async function enrichCandidateWithResume(tabId: number, profile: MaimaiProfile, candidateId: number) {
  // 阶段进度推给浮窗（content script 收 MAIMAI_ENRICH_PROGRESS 更新进度条）。
  // 标签页收不到（如已关）也无所谓，静默忽略。
  const report: EnrichProgressReporter = (percent, text) => {
    void chrome.tabs.sendMessage(tabId, { type: 'MAIMAI_ENRICH_PROGRESS', percent, text }).catch(() => undefined);
  };
  try {
    report(8, '正在读取谷露人才当前资料…');
    const [existing, existingAttachmentIds] = await Promise.all([
      getCandidateDetail(candidateId),
      getCandidateAttachmentIds(candidateId),
    ]);
    if (!existing || !existing.id) {
      return { ok: false as const, error: '未能读取人才当前资料，已放弃回填（避免覆盖已有信息）。可打开人才页手动上传简历。' };
    }
    if (existingAttachmentIds === null) {
      return { ok: false as const, error: '未能读取人才现有附件列表，已放弃回填（避免覆盖已有简历）。可打开人才页手动上传简历。' };
    }
    const name = textValue(profile.name) || `候选人${candidateId}`;
    const first = await acquireResumeBlob(tabId, name, report);
    report(65, '简历已获取，正在上传谷露解析…');
    let { attachmentId, extract } = await uploadResumeToGllue(first.blob, first.filename);
    const uploadedIds = [String(attachmentId)];
    // 附件简历上传成功但解析为空（多半是图片型/扫描件）：再用在线简历跑一次解析。
    // 两份文件都留在附件里（都是真简历），字段回填用能解析出来的那份。
    if (extractIsEmpty(extract) && first.source === 'attachment') {
      try {
        report(72, '附件简历未能解析（可能是图片版），改用在线简历再试…');
        const pdfUrl = await captureResumePdfUrl(tabId);
        if (pdfUrl) {
          const blob = await fetchResumePdf(pdfUrl);
          const second = await uploadResumeToGllue(blob, `${name}-在线简历.pdf`);
          uploadedIds.push(String(second.attachmentId));
          if (!extractIsEmpty(second.extract)) {
            attachmentId = second.attachmentId;
            extract = second.extract;
          }
        }
      } catch {
        // 在线简历兜底也失败：附件已挂上，字段就不回填了。
      }
    }
    report(85, '解析完成，正在合并回填人才资料…');
    const mergedAttachmentIds = [...existingAttachmentIds, ...uploadedIds.filter((id) => id !== String(attachmentId))];
    await postCandidateAdd(buildCandidateFromExtract(extract, attachmentId, existing, mergedAttachmentIds, profile));
    report(100, '补全完成。');
    const filled = (extract.candidateexperience_set?.length || 0) + (extract.candidateeducation_set?.length || 0);
    return { ok: true as const, attachmentId, filled };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : '简历补全失败。' };
  }
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
  const payload: Record<string, unknown> = {
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
  // 浮窗里抓到/手动填的联系方式，建档时一并写入。
  if (textValue(profile.mobile)) payload.mobile = textValue(profile.mobile);
  if (textValue(profile.email)) payload.email = textValue(profile.email);
  return payload;
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

function digitsOnly(value: unknown) {
  return String(value ?? '').replace(/\D+/g, '');
}

// 联系方式精确查重：手机号/邮箱是最准的身份键，浮窗里抓到或顾问手动填了就优先用。
// 查询走两路（字段过滤 + 全文检索）取并集，但最终只认"记录的手机/邮箱字段确实
// 等于该值"的命中——防止字段过滤语法不被支持时退化成全库、或号码只是出现在
// 备注文本里的误命中。
async function matchByContact(profile: MaimaiProfile) {
  const mobile = digitsOnly(profile.mobile);
  const email = textValue(profile.email).toLowerCase();
  if (mobile.length < 11 && !email) return null;
  try {
    const merged = new Map<number, CandidateRecord>();
    const collect = async (gql: string) => {
      try {
        (await searchCandidateRows(gql)).forEach((row) => merged.set(row.id, row));
      } catch { /* 单路查询失败不致命 */ }
    };
    if (mobile.length >= 11) {
      await collect(`mobile__eq=${encodeURIComponent(mobile)}`);
      await collect(`keyword__and=${encodeURIComponent(mobile)}`);
    }
    if (email) {
      await collect(`email__eq=${encodeURIComponent(email)}`);
      await collect(`keyword__and=${encodeURIComponent(email)}`);
    }
    const rows = Array.from(merged.values()).slice(0, 8);
    if (!rows.length) return null;
    const details = await Promise.all(rows.map((item) => getCandidateDetail(item.id)));
    const detailMap = new Map(details.filter(Boolean).map((item) => [item!.id, item!]));
    const candidates = rows
      .map((item) => ({ ...item, ...detailMap.get(item.id) }))
      .map((detail) => {
        const raw = detail as unknown as Record<string, unknown>;
        // 库里手机可能带 +86/分隔符，比对只看数字且允许前缀（endsWith）。
        const mobileHit = mobile.length >= 11 && ['mobile', 'mobile1', 'mobile2', 'phone'].some((key) => {
          const digits = digitsOnly(raw[key]);
          return digits.length >= 11 && (digits === mobile || digits.endsWith(mobile));
        });
        const emailHit = Boolean(email) && ['email', 'email1', 'email2'].some(
          (key) => textValue(raw[key]).toLowerCase() === email,
        );
        return { detail, mobileHit, emailHit };
      })
      .filter(({ mobileHit, emailHit }) => mobileHit || emailHit)
      .map(({ detail, mobileHit, emailHit }) => {
        const note = recentNote(detail);
        const hitText = [mobileHit ? '手机号' : '', emailHit ? '邮箱' : ''].filter(Boolean).join('+');
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
          matchReason: `${hitText}精确命中（联系方式一致，可靠度最高）`,
          score: 100,
          tier: 'strong' as const,
        };
      })
      .slice(0, 3);
    if (!candidates.length) return null;
    return { status: 'matched' as const, profile, candidates };
  } catch {
    // 联系方式检索失败不致命，落回链接/增强/模糊分级。
    return null;
  }
}

async function checkMaimaiProfile(profile: MaimaiProfile) {
  // 优先级：联系方式（手机/邮箱）精确 > dstu 链接精确 > 增强服务 > 模糊分级。
  const contactMatched = await matchByContact(profile);
  if (contactMatched) return contactMatched;
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
    executeScriptInMainWorld(tabId, capturePublicProfileLinkInPage)
      .then((results) => sendResponse({ url: String(results?.[0]?.result || '') }))
      .catch(() => sendResponse({ url: '' }));
    return true;
  }
  if (message.type === 'MAIMAI_START_SNIFFER') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false });
      return false;
    }
    executeScriptInMainWorld(tabId, installNetworkSnifferInPage)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === 'MAIMAI_ENRICH_RESUME') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: '无法定位脉脉标签页。' });
      return false;
    }
    enrichCandidateWithResume(tabId, message.profile, message.candidateId)
      .then((result) => sendResponse(result))
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : '简历补全失败。' }));
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

// ===== 安装签到（插件侧） =====
// 每天往 Gitee 私库 reports/ 写一条「谁在用哪个版本」，发布者用《查看安装情况.ps1》汇总。
// 与 updater.ps1 的机器签到互补：插件签到随自动更新到位（老机器不用重装脚本），
// 且能报出谷露登录顾问的名字。上报失败静默忽略，绝不影响正常功能。
const REPORT_OWNER = REPORT_GITEE_OWNER;
const REPORT_REPO = REPORT_GITEE_REPO;
const REPORT_TOKEN = REPORT_GITEE_TOKEN;
const REPORT_BRANCH = REPORT_GITEE_BRANCH;
const REPORT_ALARM = 'gllue-ext-report';
const REPORT_STATE_KEY = 'gllueExtReportState';
const REPORT_INSTALL_ID_KEY = 'gllueExtInstallId';

// 谷露没有 /rest/user/current，用 owner__eq={{user.id}} 反查当前登录顾问（同 api.ts 的做法）。
async function getReporterIdentity(): Promise<{ id: string; label: string }> {
  try {
    const data = await fetchGllueJson('/rest/candidate/list', {
      gql: 'owner__eq={{user.id}}',
      demandKeys: JSON.stringify(['owner']),
      paginate_by: '1',
      page: '1',
    }) as GllueListResponse<{ owner?: { id?: number; chineseName?: string; englishName?: string; __name__?: string } }>;
    const owner = (data.list || data.results || [])[0]?.owner;
    if (owner && typeof owner === 'object' && owner.id) {
      const label = owner.chineseName || owner.__name__ || owner.englishName || `顾问${owner.id}`;
      return { id: `user${owner.id}`, label };
    }
  } catch { /* 没登录谷露/断网，用匿名安装 ID 兜底 */ }
  const stored = await chrome.storage.local.get(REPORT_INSTALL_ID_KEY);
  let installId = stored[REPORT_INSTALL_ID_KEY] as string | undefined;
  if (!installId) {
    installId = Math.random().toString(36).slice(2, 10);
    await chrome.storage.local.set({ [REPORT_INSTALL_ID_KEY]: installId });
  }
  return { id: `anon-${installId}`, label: `未登录谷露-${installId}` };
}

function utf8ToBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

async function reportInstall() {
  if (!REPORT_TOKEN || !REPORT_OWNER || !REPORT_REPO) return;
  try {
    const version = chrome.runtime.getManifest().version;
    const now = new Date();
    const two = (n: number) => String(n).padStart(2, '0');
    const timeText = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
    const today = timeText.slice(0, 10);
    const state = await chrome.storage.local.get(REPORT_STATE_KEY);
    const prev = state[REPORT_STATE_KEY] as { day?: string; version?: string } | undefined;
    if (prev?.day === today && prev?.version === version) return; // 今天已报过同版本
    const who = await getReporterIdentity();
    const path = encodeURIComponent(`reports/ext-${who.id}.json`);
    const base = `https://gitee.com/api/v5/repos/${REPORT_OWNER}/${REPORT_REPO}/contents/${path}`;
    const content = utf8ToBase64(JSON.stringify({
      machine: `${who.label}（插件）`,
      user: who.label,
      version,
      time: timeText,
    }));
    let sha: string | undefined;
    try {
      const head = await fetch(`${base}?ref=${REPORT_BRANCH}&access_token=${REPORT_TOKEN}`);
      if (head.ok) sha = ((await head.json()) as { sha?: string }).sha;
    } catch { /* 当作文件不存在 */ }
    const response = await fetch(base, {
      method: sha ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: REPORT_TOKEN,
        branch: REPORT_BRANCH,
        content,
        message: `report: ext-${who.id} v${version}`,
        ...(sha ? { sha } : {}),
      }),
    });
    if (response.ok) {
      await chrome.storage.local.set({ [REPORT_STATE_KEY]: { day: today, version } });
    }
  } catch { /* 静默：下个闹钟周期再试 */ }
}

// alarms 能唤醒 MV3 service worker：装好后 3 分钟首报，之后每 6 小时检查一次（当天报过即跳过）。
chrome.alarms.create(REPORT_ALARM, { delayInMinutes: 3, periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REPORT_ALARM) void reportInstall();
});
