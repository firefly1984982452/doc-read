function cleanInlineMarkdown(value) {
  return String(value || '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstHeading(markdown) {
  return String(markdown || '')
    .split(/\r?\n/)
    .map(line => line.match(/^#\s+(.+?)\s*$/)?.[1])
    .find(Boolean);
}

export function extractArticleTitle(markdown, fallback = '阅读笔记') {
  return cleanInlineMarkdown(firstHeading(markdown) || fallback) || '阅读笔记';
}

export function safeFolderName(value, fallback = '阅读笔记') {
  const cleaned = String(value || fallback)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\:]/g, ' ')
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim() || fallback;
  return Array.from(cleaned).slice(0, 86).join('');
}

export function planScreenshotPositions(contentHeight, pageHeight = 960) {
  const height = Math.max(0, Math.ceil(Number(contentHeight) || 0));
  const viewport = Math.max(1, Math.ceil(Number(pageHeight) || 960));
  if (height <= viewport) return [0];
  const finalY = height - viewport;
  // A tiny overflow is normally the article's bottom breathing room. Avoid a
  // second image that would repeat almost the entire first screen.
  if (finalY <= Math.min(120, Math.round(viewport * 0.12))) return [0];
  const intervals = Math.max(1, Math.ceil(finalY / viewport));
  return Array.from({ length: intervals + 1 }, (_, index) => (
    index === intervals ? finalY : Math.round((finalY * index) / intervals)
  ));
}
