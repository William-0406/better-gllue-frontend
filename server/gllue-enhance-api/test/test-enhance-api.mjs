// 增强 API 自动化测试：启动服务器（内存里），逐个接口断言。
// 运行：node test/test-enhance-api.mjs   （或 npm test）
// 不需要浏览器 / 谷露登录 / 百度密钥。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = process.env.TEST_PORT || '3987';
const base = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), 'enhance-test-'));

// 必须在 import server 之前设好环境变量（server.js 在加载时就读取）。
process.env.PORT = PORT;
process.env.DATA_DIR = dataDir;
delete process.env.BAIDU_OCR_API_KEY;
delete process.env.BAIDU_OCR_SECRET_KEY;

await import('../src/server.js');

let passed = 0;
let failed = 0;
const fails = [];
function check(name, cond) {
  if (cond) { passed += 1; console.log('  ✓', name); }
  else { failed += 1; fails.push(name); console.error('  ✗', name); }
}
async function api(path, init) {
  const res = await fetch(`${base}${path}`, init);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}
async function waitReady() {
  for (let i = 0; i < 50; i += 1) {
    try { const r = await fetch(`${base}/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

await waitReady();

try {
  // --- health / config ---
  const health = await api('/health');
  check('health 返回 ok', health.body?.ok === true);

  const config = await api('/config');
  check('config 列出 features', config.body?.features && typeof config.body.features === 'object');
  check('未配置密钥时 ocr=false', config.body?.features?.ocr === false);

  // --- 灌入一个候选人索引 ---
  const seed = {
    candidates: [{
      id: 1,
      name: '张三',
      company: '阿里巴巴',
      title: 'Java开发工程师',
      experiences: [{ company: '腾讯科技', title: '后端开发' }],
      phoneHashes: ['PHONE_HASH_1'],
      emailHashes: ['EMAIL_HASH_1'],
    }],
  };
  const up = await api('/index/candidates/upsert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(seed) });
  check('upsert 成功', up.body?.ok === true && up.body.upserted === 1);

  // 同 id 再 upsert，总数不应增加（去重）
  const up2 = await api('/index/candidates/upsert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(seed) });
  check('同 id 重复 upsert 不增总数', up2.body?.count === 1);

  // --- 脉脉匹配：公司+title 都命中（含别名归一化 阿里巴巴->阿里 / java工程师->java）---
  const m1 = await api('/match/maimai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { name: '张三', company: '阿里', title: 'java' } }) });
  check('脉脉：公司+title 命中', m1.body?.status === 'matched' && m1.body.candidates?.[0]?.id === 1);

  // 只有公司、没有 title -> 不算强命中
  const m2 = await api('/match/maimai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { name: '张三', company: '阿里', title: '完全无关职位XYZ' } }) });
  check('脉脉：只匹配公司不命中', m2.body?.status === 'not_found');

  // 公司不匹配 -> 不命中
  const m3 = await api('/match/maimai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { name: '张三', company: '不存在的公司ABC', title: 'java' } }) });
  check('脉脉：公司不匹配则不命中', m3.body?.status === 'not_found');

  // --- 简历匹配：手机号 / 邮箱精确命中，姓名重复 ---
  const r1 = await api('/match/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: { phoneHashes: ['PHONE_HASH_1'] } }) });
  check('简历：手机号精确命中 score=100', r1.body?.status === 'matched' && r1.body.candidates?.[0]?.score === 100);

  const r2 = await api('/match/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: { emailHashes: ['EMAIL_HASH_1'] } }) });
  check('简历：邮箱精确命中 score=100', r2.body?.status === 'matched' && r2.body.candidates?.[0]?.score === 100);

  const r3 = await api('/match/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: { name: '张三' } }) });
  check('简历：仅姓名 -> 姓名重复 score=68', r3.body?.status === 'matched' && r3.body.candidates?.[0]?.score === 68);

  const r4 = await api('/match/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: { phoneHashes: ['NOPE'] } }) });
  check('简历：手机号不命中 -> not_found', r4.body?.status === 'not_found');

  // --- OCR 接口：未配置密钥应 503 ---
  const ocr = await api('/ocr/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: ['x'] }) });
  check('OCR：未配置密钥返回 503', ocr.status === 503);

  // --- 项目图谱：/projects CRUD（顾问手动维护的在招项目，不读谷露 joborder）---
  const emptyProjects = await api('/projects');
  check('项目：初始列表为空', emptyProjects.body?.ok === true && emptyProjects.body.count === 0);

  const badCreate = await api('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: '上海' }) });
  check('项目：公司职位都缺失时新增 400', badCreate.status === 400);

  const createRes = await api('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ company: '字节跳动', title: '高级后端工程师', location: '上海', owners: ['张三', '李四'], notes: '急招' }),
  });
  check('项目：新增成功且分配 id', createRes.body?.ok === true && createRes.body.project?.id === 1);
  check('项目：新增默认状态为进行中', createRes.body?.project?.status === '进行中');
  const projectId = createRes.body.project.id;

  const listAfterCreate = await api('/projects');
  check('项目：新增后列表 count=1', listAfterCreate.body?.count === 1);

  const patchRes = await api(`/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: '已结束' }),
  });
  check('项目：PATCH 只更新传入字段，公司名不变', patchRes.body?.project?.company === '字节跳动');
  check('项目：PATCH 更新状态为已结束', patchRes.body?.project?.status === '已结束');

  const patchMissing = await api('/projects/9999', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: '已结束' }) });
  check('项目：PATCH 不存在的 id 返回 404', patchMissing.status === 404);

  const deleteRes = await api(`/projects/${projectId}`, { method: 'DELETE' });
  check('项目：删除成功', deleteRes.body?.ok === true && deleteRes.body.project?.id === projectId);

  const listAfterDelete = await api('/projects');
  check('项目：删除后列表为空', listAfterDelete.body?.count === 0);

  // --- 未知路径 404 ---
  const nf = await api('/this/does/not/exist');
  check('未知路径返回 404', nf.status === 404);
} catch (error) {
  failed += 1;
  fails.push(`异常：${error.message}`);
  console.error('  ✗ 测试过程中抛异常:', error);
}

rmSync(dataDir, { recursive: true, force: true });
console.log(`\n通过 ${passed} 项，失败 ${failed} 项。`);
if (failed) { console.error('失败用例:', fails.join(' | ')); process.exit(1); }
console.log('全部通过 ✅');
process.exit(0);
