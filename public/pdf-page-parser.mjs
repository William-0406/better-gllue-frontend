import { parsePdfResume, renderPdfToImages } from './pdf-parser.mjs';

window.__glluePdfParserReady = true;
window.postMessage({ source: 'gllue-pdf-parser-ready' }, '*');

const DEFAULT_OCR_BASE = 'http://__ENHANCE_HOST__';

window.addEventListener('message', async (event) => {
  if (event.source === window && event.data?.source === 'gllue-pdf-parser-ping') {
    window.postMessage({ source: 'gllue-pdf-parser-ready' }, '*');
    return;
  }
  // 扫描件：在页面层渲染成图片并直接调 OCR，只把识别出的文字回传，避免大图跨世界传递。
  if (event.source === window && event.data?.source === 'gllue-pdf-render-request') {
    const { id, buffer, workerSrc, baseUrl } = event.data;
    try {
      const images = await renderPdfToImages(buffer, workerSrc, { maxPages: 8 });
      const api = (baseUrl || DEFAULT_OCR_BASE).replace(/\/+$/, '');
      const resp = await fetch(`${api}/ocr/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      });
      let text = '';
      if (resp.ok) {
        const data = await resp.json();
        text = data && data.ok ? String(data.text || '') : '';
      }
      window.postMessage({ source: 'gllue-pdf-render-response', id, ok: true, text }, '*');
    } catch (error) {
      console.error('[gllue-OCR] 扫描件 OCR 失败 ->', error);
      window.postMessage(
        {
          source: 'gllue-pdf-render-response',
          id,
          ok: false,
          error: error instanceof Error ? error.message : '扫描件 OCR 失败。',
        },
        '*',
      );
    }
    return;
  }
  if (event.source !== window || event.data?.source !== 'gllue-pdf-parse-request') return;
  const { id, buffer, workerSrc } = event.data;
  try {
    const text = await parsePdfResume(buffer, workerSrc);
    window.postMessage({ source: 'gllue-pdf-parse-response', id, ok: true, text }, '*');
  } catch (error) {
    // 文字解析失败（扫描件 / 异常 PDF）也回退空文本，让上层走图片 OCR。
    window.postMessage({ source: 'gllue-pdf-parse-response', id, ok: true, text: '' }, '*');
  }
});
