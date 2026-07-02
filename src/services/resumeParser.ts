import mammoth from 'mammoth';
import { getEnhanceBaseUrl } from './enhanceApi';

export interface ResumeIdentity {
  name?: string;
  nameFromContent?: string;
  nameFromFilename?: string;
  confidence: 'high' | 'medium' | 'low';
  phones: string[];
  emails: string[];
  signals: string[];
  textLength: number;
  sourceType: string;
}

const ignoredNameLines = new Set(['个人简历', '简历', '求职简历', '候选人简历', '教育经历', '工作经历', '项目经历', '联系方式', '基本信息', '自我评价', '个人信息']);
const noisyNamePattern = /公司|科技|网络|集团|股份|有限|产品|运营|设计|市场|销售|经理|总监|工程师|专家|顾问|招聘|猎头|电话|手机|邮箱|地址|学历|学校|专业|本科|硕士|博士|大专|项目|经历|技能|求职|岗位|职位/i;
let pdfBridgeReady = false;

function compactText(text: string) {
  return text.replace(/\u0000/g, ' ').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

async function parsePdf(file: File) {
  const maybeChrome = globalThis as typeof globalThis & { chrome?: { runtime?: { getURL?: (value: string) => string } } };
  const bridgeUrl = maybeChrome.chrome?.runtime?.getURL?.('pdf-page-parser.mjs') || '/pdf-page-parser.mjs';
  const workerSrc = maybeChrome.chrome?.runtime?.getURL?.('pdf.worker.mjs') || '/pdf.worker.mjs';
  const buffer = await file.arrayBuffer();
  const text = await parsePdfInPage(buffer, bridgeUrl, workerSrc);
  if (text.trim()) return text;

  // 没有文字层 = 扫描件 / 图片版：让页面层桥接渲染并直接调 OCR，
  // 只回传识别出的文字，避免把大图(可能上 MB)跨世界传回内容脚本导致失败。
  const baseUrl = await getEnhanceBaseUrl();
  const renderBuffer = await file.arrayBuffer();
  const ocrText = await ocrPdfInPage(renderBuffer, bridgeUrl, workerSrc, baseUrl);
  if (!ocrText.trim()) {
    throw new Error('扫描件 OCR 未识别到文字，请确认增强服务已开启 OCR，或换一份更清晰的简历。');
  }
  return ocrText;
}

function ocrPdfInPage(buffer: ArrayBuffer, bridgeUrl: string, workerSrc: string, baseUrl: string) {
  return ensurePdfBridge(bridgeUrl).then(
    () =>
      new Promise<string>((resolve, reject) => {
        const id = `gllue-pdf-render-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const timeout = window.setTimeout(() => {
          window.removeEventListener('message', onMessage);
          reject(new Error('扫描件 OCR 超时，请换一份简历重试。'));
        }, 60000);

        function onMessage(event: MessageEvent) {
          if (event.source !== window || event.data?.source !== 'gllue-pdf-render-response' || event.data.id !== id) return;
          window.clearTimeout(timeout);
          window.removeEventListener('message', onMessage);
          if (event.data.ok) {
            resolve(String(event.data.text || ''));
          } else {
            reject(new Error(String(event.data.error || '扫描件 OCR 失败。')));
          }
        }

        window.addEventListener('message', onMessage);
        window.postMessage({ source: 'gllue-pdf-render-request', id, buffer, workerSrc, baseUrl }, '*', [buffer]);
      }),
  );
}

function ensurePdfBridge(bridgeUrl: string) {
  if (pdfBridgeReady) return Promise.resolve();
  const id = 'gllue-pdf-page-parser';
  return new Promise<void>((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onReady);
      reject(new Error('PDF 解析器加载超时，请刷新后重试。'));
    }, 10000);

    function done() {
      pdfBridgeReady = true;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onReady);
      resolve();
    }

    function onReady(event: MessageEvent) {
      if (event.source === window && event.data?.source === 'gllue-pdf-parser-ready') done();
    }

    window.addEventListener('message', onReady);
    if (existing) {
      window.postMessage({ source: 'gllue-pdf-parser-ping' }, '*');
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.type = 'module';
    script.src = bridgeUrl;
    script.addEventListener('error', () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onReady);
      reject(new Error('PDF 解析器加载失败，请刷新后重试。'));
    });
    (document.head || document.documentElement).appendChild(script);
  });
}

async function parsePdfInPage(buffer: ArrayBuffer, bridgeUrl: string, workerSrc: string) {
  await ensurePdfBridge(bridgeUrl);
  return new Promise<string>((resolve, reject) => {
    const id = `gllue-pdf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('PDF 解析超时，请换一份简历重试。'));
    }, 20000);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.data?.source !== 'gllue-pdf-parse-response' || event.data.id !== id) return;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (event.data.ok) {
        resolve(String(event.data.text || ''));
      } else {
        reject(new Error(String(event.data.error || 'PDF 解析失败。')));
      }
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'gllue-pdf-parse-request', id, buffer, workerSrc }, '*', [buffer]);
  });
}

async function parseDocx(file: File) {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value;
}

async function parsePlain(file: File) {
  return file.text();
}

function filenameName(fileName: string) {
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .replace(/简历|resume|cv|候选人|猎聘|boss直聘|智联|前程无忧/gi, ' ')
    .replace(/[()[\]（）【】_\-+,.，。]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chinese = base.match(/[\u4e00-\u9fa5]{2,4}/)?.[0];
  if (chinese && !ignoredNameLines.has(chinese)) return chinese;
  const english = base.match(/[A-Za-z]+(?:\s+[A-Za-z]+){1,2}/)?.[0];
  return english;
}

function isPlausibleName(value: string | undefined) {
  const name = String(value || '').trim();
  if (!name || ignoredNameLines.has(name) || noisyNamePattern.test(name)) return false;
  return /^[\u4e00-\u9fa5]{2,4}$/.test(name) || /^[A-Za-z]+(?:\s+[A-Za-z]+){1,2}$/.test(name);
}

function extractName(text: string, fileName: string) {
  const named = text.match(/(?:姓名|Name)\s*[:：]\s*([\u4e00-\u9fa5]{2,4}|[A-Za-z][A-Za-z\s]{1,30})/i)?.[1]?.trim();
  if (isPlausibleName(named)) return { nameFromContent: named };

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40);

  const chineseLine = lines.find((line) => isPlausibleName(line));
  if (chineseLine) return { nameFromContent: chineseLine };

  const chineseInLine = lines.map((line) => line.match(/^([\u4e00-\u9fa5]{2,4})(?:\s|$)/)?.[1]).find(isPlausibleName);
  if (chineseInLine) return { nameFromContent: chineseInLine };

  const englishLine = lines.find((line) => /^[A-Za-z]+(?:\s+[A-Za-z]+){1,2}$/.test(line) && line.length <= 32);
  if (isPlausibleName(englishLine)) return { nameFromContent: englishLine };
  const nameFromFilename = filenameName(fileName);
  return { nameFromFilename: isPlausibleName(nameFromFilename) ? nameFromFilename : undefined };
}

function extractPhones(text: string) {
  const matches = text.match(/(?:\+?86[-\s]?)?1[3-9]\d[-\s]?\d{4}[-\s]?\d{4}/g) || [];
  return unique(matches.map((item) => item.replace(/[^\d]/g, '').replace(/^86/, '')));
}

function extractEmails(text: string) {
  return unique(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
}

export async function parseResumeIdentity(file: File): Promise<ResumeIdentity> {
  const lower = file.name.toLowerCase();
  const type = file.type || lower.split('.').pop() || 'unknown';
  let rawText = '';

  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    rawText = await parsePdf(file);
  } else if (lower.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    rawText = await parseDocx(file);
  } else if (lower.endsWith('.txt') || lower.endsWith('.html') || lower.endsWith('.htm') || file.type.startsWith('text/')) {
    rawText = await parsePlain(file);
  } else {
    throw new Error('暂不支持这个简历格式，请选择 PDF、DOCX、TXT 或 HTML 文件。');
  }

  const text = compactText(rawText);
  const phones = extractPhones(text);
  const emails = extractEmails(text);
  const { nameFromContent, nameFromFilename } = extractName(text, file.name);
  const name = nameFromContent || nameFromFilename;
  const confidence = phones.length || emails.length ? 'high' : nameFromContent ? 'medium' : 'low';
  const signals = unique([...phones, ...emails, nameFromContent || nameFromFilename]);

  return {
    name,
    nameFromContent,
    nameFromFilename,
    confidence,
    phones,
    emails,
    signals,
    textLength: text.length,
    sourceType: type,
  };
}
