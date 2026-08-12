import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const siteUrl = 'https://firefly1984982452.github.io/doc-read/';
const excludedNames = new Set(['demo.md', 'pdd.md', '《1》.md']);
const excludedPrefixes = ['docs/templates/'];

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(fullPath);
  }
  return files;
}

function publicMarkdown(relative) {
  return relative.startsWith('docs/') &&
    !excludedNames.has(path.basename(relative)) &&
    !excludedPrefixes.some((prefix) => relative.startsWith(prefix));
}

function titleFrom(markdown, fallback) {
  return markdown.match(/^#\s+(.+)$/m)?.[1].replace(/[*_`]/g, '').trim() || fallback;
}

function routeFor(relative) {
  return relative.replace(/\.md$/, '');
}

const markdownFiles = (await walk(path.join(root, 'docs')))
  .map((file) => path.relative(root, file).split(path.sep).join('/'))
  .filter(publicMarkdown)
  .sort((a, b) => a.localeCompare(b, 'zh-CN'));

const searchPaths = ['/', ...markdownFiles.map((file) => `/${file}`)];
await fs.mkdir(path.join(root, 'assets/js'), { recursive: true });
await fs.writeFile(
  path.join(root, 'assets/js/search-paths.js'),
  `// 此文件由 npm run generate 自动生成，请勿手动编辑。\nwindow.DOC_READ_SEARCH_PATHS = ${JSON.stringify(searchPaths, null, 2)};\n`,
  'utf8'
);

const readingYears = [];
for (let year = 2018; year <= new Date().getFullYear(); year += 1) {
  const yearFile = path.join(root, `docs/years/${year}.md`);
  try {
    const markdown = await fs.readFile(yearFile, 'utf8');
    const months = Array(12).fill(0);
    let currentMonth = null;
    let entries = 0;
    for (const line of markdown.split('\n')) {
      const monthMatch = line.match(new RegExp(`${year}-(\\d{1,2})(?!\\d)`));
      if (monthMatch) currentMonth = Number(monthMatch[1]);
      if (/^\s*-\s+.*\]\(\/docs\//.test(line)) {
        entries += 1;
        if (currentMonth >= 1 && currentMonth <= 12) months[currentMonth - 1] += 1;
      }
    }
    const wordSection = markdown.match(/^##\s+(?:总)?字数\s*$([\s\S]*?)(?=^##\s|^-\s|\z)/m)?.[1] || '';
    const equation = wordSection.match(/([\d+]+)(?:\s*=\s*(\d+)\s*万字?)?/);
    const wordWan = equation
      ? Number(equation[2] || equation[1].split('+').reduce((sum, value) => sum + Number(value || 0), 0))
      : null;
    readingYears.push({ year, entries, wordWan, months });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await fs.writeFile(
  path.join(root, 'assets/js/reading-data.js'),
  `// 此文件由 npm run generate 根据 docs/years 自动生成，请勿手动编辑。\nwindow.DOC_READ_STATS = ${JSON.stringify({ years: readingYears }, null, 2)};\n`,
  'utf8'
);

const noteFiles = markdownFiles.filter((file) =>
  file.startsWith('docs/read/') || file.startsWith('docs/read-history/')
);
const catalogItems = [];
for (const relative of noteFiles) {
  const markdown = await fs.readFile(path.join(root, relative), 'utf8');
  catalogItems.push({
    title: titleFrom(markdown, path.basename(relative, '.md')),
    path: `/${relative}`
  });
}

const catalog = [
  '# 完整书目索引',
  '',
  `共收录 ${catalogItems.length} 篇阅读笔记。此页由脚本自动生成，按标题排序；查找具体内容时也可以使用左侧全文搜索。`,
  '',
  ...catalogItems
    .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
    .map((item) => `- [${item.title}](${item.path})`),
  ''
].join('\n');
await fs.writeFile(path.join(root, 'docs/catalog.md'), catalog, 'utf8');

const routes = ['', 'docs/latest.md', 'docs/library.md', 'docs/catalog.md', ...markdownFiles];
const uniqueRoutes = [...new Set(routes)];
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...uniqueRoutes.map((route) => `  <url><loc>${siteUrl}${encodeURI(route)}</loc></url>`),
  '</urlset>',
  ''
].join('\n');
await fs.writeFile(path.join(root, 'sitemap.xml'), sitemap, 'utf8');

console.log(`Generated search index (${searchPaths.length} paths), reading statistics (${readingYears.length} years), catalog (${catalogItems.length} notes), and sitemap (${uniqueRoutes.length} routes).`);
