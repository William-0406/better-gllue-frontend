import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile, appendFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const port = Number(process.env.PORT || 3000);
const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
const storePath = join(dataDir, 'candidates.json');
const projectsStorePath = join(dataDir, 'projects.json');
const diagnosticsPath = join(dataDir, 'diagnostics.log');
const extensionZipPath = join(dataDir, 'extension.zip');

const defaultStore = { candidates: [], updatedAt: null };
const defaultProjectsStore = { projects: [], updatedAt: null };

// 百度 OCR 配置（密钥仅从环境变量读取，不写入代码 / 不进 git）。
const baiduOcrApiKey = process.env.BAIDU_OCR_API_KEY || '';
const baiduOcrSecretKey = process.env.BAIDU_OCR_SECRET_KEY || '';
const baiduOcrEnabled = Boolean(baiduOcrApiKey && baiduOcrSecretKey);
// accurate_basic = 高精度版（默认，扫描件更稳）；如想用便宜的标准版，设 BAIDU_OCR_API=general_basic。
const baiduOcrApi = process.env.BAIDU_OCR_API || 'accurate_basic';
const maxOcrPages = Number(process.env.OCR_MAX_PAGES || 8);
let baiduTokenCache = { token: '', expiresAt: 0 };

async function getBaiduToken() {
  const now = Date.now();
  if (baiduTokenCache.token && baiduTokenCache.expiresAt > now + 60000) return baiduTokenCache.token;
  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(baiduOcrApiKey)}&client_secret=${encodeURIComponent(baiduOcrSecretKey)}`;
  const response = await fetch(url, { method: 'POST' });
  const data = await response.json();
  if (!data.access_token) throw new Error(data.error_description || 'Baidu token error');
  // token 默认有效期 30 天，这里按返回的 expires_in 缓存。
  baiduTokenCache = { token: data.access_token, expiresAt: now + Number(data.expires_in || 2592000) * 1000 };
  return baiduTokenCache.token;
}

async function baiduOcrImage(imageBase64) {
  const token = await getBaiduToken();
  const endpoint = `https://aip.baidubce.com/rest/2.0/ocr/v1/${baiduOcrApi}?access_token=${encodeURIComponent(token)}`;
  const body = new URLSearchParams();
  body.set('image', imageBase64);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await response.json();
  if (data.error_code) throw new Error(`Baidu OCR ${data.error_code}: ${data.error_msg || ''}`.trim());
  return Array.isArray(data.words_result) ? data.words_result.map((item) => item.words).join('\n') : '';
}

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return text(value.name ?? value.__name__ ?? value.value ?? value.chineseName ?? value.englishName);
  return '';
}

function normalize(value) {
  const compact = text(value).replace(/\s+/g, '').toLowerCase();
  const aliases = [
    ['阿里巴巴', '阿里'],
    ['alibaba', '阿里'],
    ['腾讯科技', '腾讯'],
    ['tencent', '腾讯'],
    ['字节跳动', '字节'],
    ['bytedance', '字节'],
    ['java开发工程师', 'java'],
    ['java工程师', 'java'],
    ['后端开发', '后端'],
    ['服务端开发', '后端'],
    ['backend', '后端'],
    ['产品经理', '产品'],
  ];
  return aliases.reduce((next, [from, to]) => next.replaceAll(from, to), compact);
}

function includesEither(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

function candidateName(item) {
  return text(item.name || item.chineseName || item.englishName || item.__name__) || `人才 #${item.id}`;
}

function candidateExperiences(item) {
  const base = [
    { company: item.company, title: item.title },
    ...(Array.isArray(item.experiences) ? item.experiences : []),
  ];
  const seen = new Set();
  return base
    .map((experience) => ({ company: text(experience.company), title: text(experience.title) }))
    .filter((experience) => {
      const key = `${normalize(experience.company)}|${normalize(experience.title)}`;
      if ((!experience.company && !experience.title) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function profileExperiences(profile) {
  const experiences = Array.isArray(profile.experiences) && profile.experiences.length
    ? profile.experiences
    : [{ company: profile.company, title: profile.title }];
  return experiences
    .map((experience) => ({ company: text(experience.company), title: text(experience.title) }))
    .filter((experience) => experience.company || experience.title)
    .slice(0, 3);
}

function experienceText(experience) {
  return [experience.company, experience.title].filter(Boolean).join(' / ');
}

async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultStore, ...parsed, candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [] };
  } catch {
    return { ...defaultStore };
  }
}

async function saveStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(store, null, 2));
}

// ---- 项目图谱（知识图谱功能的数据源）----
// 谷露 joborder 名字大量是 undefined，不适合直接拿来做图谱，所以这里单独维护一份轻量、
// 顾问手动录入的“在招项目”数据：公司 / 职位 / base 地点 / 状态 / 负责顾问 / 备注。
// 只读展示 + 手动增删改，不碰谷露、不存谷露 cookie。
async function ensureProjectsStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(projectsStorePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultProjectsStore, ...parsed, projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
  } catch {
    return { ...defaultProjectsStore };
  }
}

async function saveProjectsStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(projectsStorePath, JSON.stringify(store, null, 2));
}

function toOwnerList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

// partial=true 时只保留“确实传了”的字段（用于 PATCH 局部更新），
// 未出现的字段返回 undefined，调用方用 {...existing, ...sanitized} 合并，不会把没传的字段清空。
function sanitizeProject(raw, { partial = false } = {}) {
  const has = (key) => Object.prototype.hasOwnProperty.call(raw || {}, key);
  const out = {};
  if (!partial || has('company')) out.company = text(raw.company);
  if (!partial || has('title')) out.title = text(raw.title);
  if (!partial || has('location')) out.location = text(raw.location);
  if (!partial || has('status')) out.status = raw.status === '已结束' ? '已结束' : '进行中';
  if (!partial || has('owners')) out.owners = toOwnerList(raw.owners);
  if (!partial || has('source')) out.source = raw.source === 'imported' ? 'imported' : 'manual';
  if (!partial || has('notes')) out.notes = text(raw.notes).slice(0, 500);
  return out;
}

function nextProjectId(store) {
  return store.projects.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function sanitizeCandidate(raw) {
  const id = Number(raw?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    name: text(raw.name),
    chineseName: text(raw.chineseName),
    englishName: text(raw.englishName),
    company: text(raw.company),
    title: text(raw.title),
    experiences: Array.isArray(raw.experiences)
      ? raw.experiences.slice(0, 8).map((item) => ({ company: text(item.company), title: text(item.title) })).filter((item) => item.company || item.title)
      : [],
    phoneHashes: Array.isArray(raw.phoneHashes) ? raw.phoneHashes.map(text).filter(Boolean) : [],
    emailHashes: Array.isArray(raw.emailHashes) ? raw.emailHashes.map(text).filter(Boolean) : [],
    lastUpdateDate: text(raw.lastUpdateDate),
    recentNoteDate: text(raw.recentNoteDate),
    recentNoteText: text(raw.recentNoteText).slice(0, 180),
    consultant: text(raw.consultant),
    updatedAt: new Date().toISOString(),
  };
}

function scoreMaimai(profile, candidate) {
  let best = null;
  profileExperiences(profile).forEach((maimaiExperience, index) => {
    candidateExperiences(candidate).forEach((candidateExperience) => {
      const companyMatch = includesEither(candidateExperience.company, maimaiExperience.company);
      const titleMatch = includesEither(candidateExperience.title, maimaiExperience.title);
      if (!companyMatch || !titleMatch) return;
      let score = 80;
      if (index === 0) score += 8;
      if (includesEither(candidateName(candidate), profile.name)) score += 10;
      const next = {
        score,
        reason: `命中：第 ${index + 1} 段工作 / 公司+title`,
        matchedExperience: experienceText(maimaiExperience),
      };
      if (!best || next.score > best.score) best = next;
    });
  });
  return best;
}

function scoreResume(identity, candidate) {
  const phoneHashes = new Set(Array.isArray(identity.phoneHashes) ? identity.phoneHashes.map(text).filter(Boolean) : []);
  const emailHashes = new Set(Array.isArray(identity.emailHashes) ? identity.emailHashes.map(text).filter(Boolean) : []);
  const candidatePhoneHashes = Array.isArray(candidate.phoneHashes) ? candidate.phoneHashes : [];
  const candidateEmailHashes = Array.isArray(candidate.emailHashes) ? candidate.emailHashes : [];
  if (candidatePhoneHashes.some((hash) => phoneHashes.has(hash))) {
    return { score: 100, reason: '手机号精确命中' };
  }
  if (candidateEmailHashes.some((hash) => emailHashes.has(hash))) {
    return { score: 100, reason: '邮箱精确命中' };
  }
  if (!phoneHashes.size && !emailHashes.size && includesEither(candidateName(candidate), identity.name)) {
    return { score: 68, reason: '姓名重复' };
  }
  return null;
}

function toMatchCandidate(candidate, match) {
  return {
    id: candidate.id,
    name: candidateName(candidate),
    company: text(candidate.company),
    title: text(candidate.title),
    lastUpdateDate: text(candidate.lastUpdateDate),
    recentNoteDate: text(candidate.recentNoteDate),
    recentNoteText: text(candidate.recentNoteText),
    consultant: text(candidate.consultant),
    matchedExperience: match.matchedExperience,
    matchReason: match.reason,
    score: match.score,
  };
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function send(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(html);
}

function publicBaseUrl(request) {
  const host = request.headers.host || `127.0.0.1:${port}`;
  return `http://${host}`;
}

async function extensionAvailable() {
  try {
    const file = await stat(extensionZipPath);
    return file.isFile() && file.size > 0;
  } catch {
    return false;
  }
}

function downloadPage(request, hasExtension) {
  const baseUrl = publicBaseUrl(request);
  const downloadUrl = `${baseUrl}/download/extension.zip`;
  const healthUrl = `${baseUrl}/health`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>更好的谷露前端</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    body { margin: 0; background: #f6f8fb; color: #1f2937; }
    main { max-width: 860px; margin: 0 auto; padding: 48px 22px; }
    h1 { margin: 0 0 10px; font-size: 34px; letter-spacing: 0; }
    p { line-height: 1.7; color: #4b5563; }
    .panel { margin-top: 22px; padding: 22px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, .06); }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 18px; }
    a.button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 16px; border-radius: 8px; background: #1677ff; color: white; text-decoration: none; font-weight: 700; }
    a.button.secondary { background: #eef2ff; color: #3730a3; }
    a.button.disabled { pointer-events: none; background: #d1d5db; color: #6b7280; }
    ol { padding-left: 22px; line-height: 1.8; color: #374151; }
    code { padding: 2px 6px; border-radius: 5px; background: #f3f4f6; }
    .status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; background: ${hasExtension ? '#dcfce7' : '#fef3c7'}; color: ${hasExtension ? '#166534' : '#92400e'}; font-weight: 700; }
    .faq { display: grid; gap: 12px; }
    details { border: 1px solid #e5e7eb; border-radius: 8px; background: #fbfdff; }
    summary { cursor: pointer; padding: 14px 16px; color: #111827; font-weight: 800; }
    details p { margin: 0; padding: 0 16px 16px; }
  </style>
</head>
<body>
  <main>
    <h1>更好的谷露前端</h1>
    <p>团队内部使用的谷露 CRM 美化插件。插件只读展示谷露数据，写操作仍回到谷露原页面完成。</p>
    <div class="panel">
      <span class="status">${hasExtension ? '安装包已就绪' : '安装包还未上传'}</span>
      <div class="actions">
        <a class="button ${hasExtension ? '' : 'disabled'}" href="${downloadUrl}">下载插件 zip</a>
        <a class="button secondary" href="${healthUrl}">服务状态</a>
      </div>
    </div>
    <div class="panel">
      <h2>Edge / Chrome 安装</h2>
      <ol>
        <li>下载 zip 并解压。</li>
        <li>打开 <code>edge://extensions/</code> 或 <code>chrome://extensions/</code>。</li>
        <li>开启开发者模式。</li>
        <li>选择“加载已解压的扩展程序”。</li>
        <li>选择解压后的 <code>dist-extension</code> 文件夹。</li>
      </ol>
      <p>Mac 也一样安装，只是下载目录通常在 <code>/Users/用户名/Downloads</code>。</p>
    </div>
    <div class="panel">
      <h2>常见问题</h2>
      <div class="faq">
        <details open>
          <summary>加载扩展时应该选择哪个文件夹？</summary>
          <p>先把 zip 解压，然后选择解压出来的 <code>dist-extension</code> 文件夹。不要选择 zip 文件本身，也不要选择外层下载目录。</p>
        </details>
        <details>
          <summary>安装新版前要不要删除旧版？</summary>
          <p>建议在扩展管理页先移除旧版，再加载新版 <code>dist-extension</code>。如果不移除，也至少点击旧扩展卡片上的“重新加载”。</p>
        </details>
        <details>
          <summary>为什么浏览器提示“不安全”？</summary>
          <p>当前页面使用 HTTP 和 IP 地址访问，所以浏览器会提示“不安全”。这是下载页提示，不影响插件在谷露里的只读使用。后续绑定域名和 HTTPS 后会消失。</p>
        </details>
        <details>
          <summary>为什么下载有点慢？</summary>
          <p>服务器带宽是 2Mbps，下载速度大约 200-250KB/s 属于正常。安装包约 9MB，通常几十秒可以下完。</p>
        </details>
        <details>
          <summary>点插件“开启”没反应怎么办？</summary>
          <p>先确认当前页面是你们的谷露地址，并且已经登录谷露。然后在扩展管理页点击“重新加载”，回到谷露页面刷新后再试。</p>
        </details>
        <details>
          <summary>脉脉查重为什么第一次慢或没命中？</summary>
          <p>增强索引需要逐步同步。可以在谷露插件首页点击“同步查重索引”，或者先让插件回退谷露实时查重，查过的人才摘要会补进索引。</p>
        </details>
        <details>
          <summary>这个插件会不会改写谷露数据？</summary>
          <p>不会。插件只读展示谷露数据；新增、推荐、导入等写操作仍回到谷露原页面完成。</p>
        </details>
        <details>
          <summary>Mac 能不能用？</summary>
          <p>可以。Chrome 和 Edge 的安装方式一样：解压 zip，打开扩展页，开启开发者模式，加载 <code>dist-extension</code> 文件夹。</p>
        </details>
      </div>
    </div>
  </main>
</body>
</html>`;
}

async function handle(request, response) {
  if (request.method === 'OPTIONS') return send(response, 204, {});
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/download')) {
    return sendHtml(response, 200, downloadPage(request, await extensionAvailable()));
  }

  if (request.method === 'GET' && url.pathname === '/download/extension.zip') {
    if (!(await extensionAvailable())) {
      return send(response, 404, { ok: false, error: 'Extension package has not been uploaded.' });
    }
    response.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="gllue-ui-shell-extension.zip"',
      'Access-Control-Allow-Origin': '*',
    });
    return createReadStream(extensionZipPath).pipe(response);
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    const store = await ensureStore();
    return send(response, 200, {
      ok: true,
      version: '0.1.0',
      candidates: store.candidates.length,
      updatedAt: store.updatedAt,
      extensionAvailable: await extensionAvailable(),
      extensionLatestVersion: '1.0.0',
    });
  }

  if (request.method === 'GET' && url.pathname === '/config') {
    return send(response, 200, {
      ok: true,
      version: '0.1.0',
      extensionLatestVersion: '1.0.0',
      extensionDownloadUrl: `${publicBaseUrl(request)}/download/extension.zip`,
      extensionHomeUrl: `${publicBaseUrl(request)}/download`,
      features: {
        candidateIndex: true,
        maimaiMatch: true,
        resumeMatch: true,
        diagnostics: true,
        ocr: baiduOcrEnabled,
        projectMap: true,
      },
      rulesVersion: '2026-06-02.1',
    });
  }

  if (request.method === 'GET' && url.pathname === '/projects') {
    const store = await ensureProjectsStore();
    return send(response, 200, { ok: true, count: store.projects.length, projects: store.projects, updatedAt: store.updatedAt });
  }

  if (request.method === 'POST' && url.pathname === '/projects') {
    const body = await readBody(request);
    const sanitized = sanitizeProject(body);
    if (!sanitized.company && !sanitized.title) {
      return send(response, 400, { ok: false, error: '公司和职位至少填一个。' });
    }
    const store = await ensureProjectsStore();
    const now = new Date().toISOString();
    const project = { id: nextProjectId(store), ...sanitized, createdAt: now, updatedAt: now };
    store.projects.push(project);
    store.updatedAt = now;
    await saveProjectsStore(store);
    return send(response, 200, { ok: true, project });
  }

  const projectIdMatch = url.pathname.match(/^\/projects\/(\d+)$/);
  if (projectIdMatch && (request.method === 'PATCH' || request.method === 'DELETE')) {
    const id = Number(projectIdMatch[1]);
    const store = await ensureProjectsStore();
    const index = store.projects.findIndex((item) => Number(item.id) === id);
    if (index === -1) return send(response, 404, { ok: false, error: '项目不存在。' });

    if (request.method === 'DELETE') {
      const [removed] = store.projects.splice(index, 1);
      store.updatedAt = new Date().toISOString();
      await saveProjectsStore(store);
      return send(response, 200, { ok: true, project: removed });
    }

    // PATCH：任意顾问都能改任意项目（团队数据本来就互相可见），只做字段合并。
    const body = await readBody(request);
    const sanitized = sanitizeProject(body, { partial: true });
    const now = new Date().toISOString();
    const updated = { ...store.projects[index], ...sanitized, id, updatedAt: now };
    store.projects[index] = updated;
    store.updatedAt = now;
    await saveProjectsStore(store);
    return send(response, 200, { ok: true, project: updated });
  }

  if (request.method === 'POST' && url.pathname === '/index/candidates/upsert') {
    const body = await readBody(request);
    const incoming = Array.isArray(body.candidates) ? body.candidates.map(sanitizeCandidate).filter(Boolean) : [];
    const store = await ensureStore();
    const byId = new Map(store.candidates.map((item) => [item.id, item]));
    incoming.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
    const next = { candidates: Array.from(byId.values()), updatedAt: new Date().toISOString() };
    await saveStore(next);
    return send(response, 200, { ok: true, count: next.candidates.length, upserted: incoming.length });
  }

  if (request.method === 'POST' && url.pathname === '/match/maimai') {
    const body = await readBody(request);
    const store = await ensureStore();
    const profile = body.profile || body;
    const candidates = store.candidates
      .flatMap((candidate) => {
        const match = scoreMaimai(profile, candidate);
        return match ? [toMatchCandidate(candidate, match)] : [];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return send(response, 200, {
      status: candidates.length ? 'matched' : 'not_found',
      profile,
      candidates,
      source: 'enhance-api',
    });
  }

  if (request.method === 'POST' && url.pathname === '/match/resume') {
    const body = await readBody(request);
    const identity = body.identity || body;
    const store = await ensureStore();
    const candidates = store.candidates
      .flatMap((candidate) => {
        const match = scoreResume(identity, candidate);
        return match ? [toMatchCandidate(candidate, match)] : [];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return send(response, 200, {
      status: candidates.length ? 'matched' : 'not_found',
      candidates,
      source: 'enhance-api',
    });
  }

  if (request.method === 'POST' && url.pathname === '/ocr/image') {
    if (!baiduOcrEnabled) {
      return send(response, 503, { ok: false, error: 'OCR 未配置（缺少 BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY）。' });
    }
    const body = await readBody(request);
    const rawImages = Array.isArray(body.images) ? body.images : body.image ? [body.image] : [];
    const images = rawImages
      .slice(0, maxOcrPages)
      .map((img) => String(img || '').replace(/^data:image\/\w+;base64,/, '').trim())
      .filter(Boolean);
    if (!images.length) return send(response, 400, { ok: false, error: '没有可识别的图片。' });
    const texts = [];
    for (const image of images) {
      texts.push(await baiduOcrImage(image));
    }
    return send(response, 200, { ok: true, text: texts.join('\n').trim(), pages: images.length, api: baiduOcrApi });
  }

  if (request.method === 'POST' && url.pathname === '/diagnostics') {
    const body = await readBody(request);
    await mkdir(dataDir, { recursive: true });
    await appendFile(diagnosticsPath, `${JSON.stringify({ ...body, receivedAt: new Date().toISOString() })}\n`);
    return send(response, 200, { ok: true });
  }

  return send(response, 404, { ok: false, error: 'Not found' });
}

createServer((request, response) => {
  handle(request, response).catch((error) => {
    send(response, 500, { ok: false, error: error instanceof Error ? error.message : 'Server error' });
  });
}).listen(port, () => {
  console.log(`gllue-enhance-api listening on ${port}`);
});
