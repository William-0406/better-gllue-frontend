import { GlobalWorkerOptions, getDocument } from './pdf.mjs';

export async function parsePdfResume(data, workerSrc) {
  GlobalWorkerOptions.workerSrc = workerSrc;
  const task = getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const pages = Math.min(pdf.numPages, 8);
  const chunks = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return chunks.join('\n');
}

// 扫描件 / 图片版 PDF 没有文字层，渲染成 JPEG 图片交给服务器 OCR。
export async function renderPdfToImages(data, workerSrc, options = {}) {
  GlobalWorkerOptions.workerSrc = workerSrc;
  const maxPages = options.maxPages || 8;
  const maxSide = options.maxSide || 2400;
  const task = getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  const pages = Math.min(pdf.numPages, maxPages);
  const images = [];
  for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const longest = Math.max(base.width, base.height) || 1;
    let scale = maxSide / longest;
    if (!Number.isFinite(scale) || scale <= 0) scale = 1.5;
    scale = Math.min(scale, 3);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    let quality = options.quality || 0.85;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > 3600000 && quality > 0.4) {
      quality -= 0.15;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    images.push(dataUrl);
  }
  return images;
}
