import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBookMetadata, noteMetadata, parseLibraryPreferences, parseYear } from './lib/reading-data.mjs';
import { typoRules } from './lib/typo-rules.mjs';

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

function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\]\([^)]+\)/g, ']')
    .replace(/[\[\]]/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^[#>*+\-\d.)\s]+/gm, '')
    .replace(/[`*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const markdownFiles = (await walk(path.join(root, 'docs')))
  .map((file) => path.relative(root, file).split(path.sep).join('/'))
  .filter(publicMarkdown)
  .sort((a, b) => a.localeCompare(b, 'zh-CN'));

await fs.mkdir(path.join(root, 'assets/js'), { recursive: true });
await fs.mkdir(path.join(root, 'assets/data'), { recursive: true });
const serializedTypoRules = JSON.stringify(typoRules);
await fs.writeFile(path.join(root, 'assets/data/typo-rules.json'), `${serializedTypoRules}\n`, 'utf8');
await fs.writeFile(
  path.join(root, 'assets/data/typo-rules.js'),
  `(function (global) { global.DOC_READ_TYPO_RULES = ${serializedTypoRules}; }(window));\n`,
  'utf8'
);
await Promise.all([
  'assets/js/reading-data.js',
  'assets/js/reading-years.js',
  'assets/js/search-index.js'
].map((file) => fs.rm(path.join(root, file), { force: true })));
await fs.rm(path.join(root, 'assets/js/search-chunks'), { recursive: true, force: true });
const vendorFiles = [
  ['node_modules/docsify/lib/themes/vue.css', 'assets/vendor/docsify/vue.css'],
  ['node_modules/docsify/lib/docsify.min.js', 'assets/vendor/docsify/docsify.min.js'],
  ['node_modules/docsify/lib/plugins/zoom-image.min.js', 'assets/vendor/docsify/zoom-image.min.js'],
  ['node_modules/docsify-pagination/dist/docsify-pagination.min.js', 'assets/vendor/docsify/docsify-pagination.min.js'],
  ['node_modules/docsify-count/dist/countable.min.js', 'assets/vendor/docsify/countable.min.js']
];
for (const [source, destination] of vendorFiles) {
  const destinationPath = path.join(root, destination);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(path.join(root, source), destinationPath);
}

const noteFiles = markdownFiles.filter((file) =>
  file.startsWith('docs/read/') || file.startsWith('docs/read-history/')
);
const libraryMarkdown = await fs.readFile(path.join(root, 'docs/library.md'), 'utf8');
const libraryPreferences = parseLibraryPreferences(libraryMarkdown);
const noteSources = [];
const catalogItems = [];
const searchItems = [];
for (const relative of noteFiles) {
  const markdown = await fs.readFile(path.join(root, relative), 'utf8');
  const metadata = noteMetadata(markdown, relative, libraryPreferences);
  noteSources.push(metadata);
  catalogItems.push({ title: metadata.title, path: `/${relative}` });
  searchItems.push({ title: metadata.title, path: metadata.path, text: plainText(markdown) });
}

for (const relative of markdownFiles.filter((file) => !noteFiles.includes(file))) {
  const markdown = await fs.readFile(path.join(root, relative), 'utf8');
  searchItems.push({
    title: titleFrom(markdown, path.basename(relative, '.md')),
    path: `/${relative.replace(/\.md$/, '')}`,
    text: plainText(markdown)
  });
}

const searchChunkDirectory = path.join(root, 'assets/data/search-chunks');
await fs.rm(searchChunkDirectory, { recursive: true, force: true });
await fs.mkdir(searchChunkDirectory, { recursive: true });
const searchChunks = [];
let currentSearchChunk = [];
let currentSearchChunkSize = 0;
for (const item of searchItems) {
  const itemSize = JSON.stringify(item).length;
  if (currentSearchChunk.length && currentSearchChunkSize + itemSize > 60000) {
    searchChunks.push(currentSearchChunk);
    currentSearchChunk = [];
    currentSearchChunkSize = 0;
  }
  currentSearchChunk.push(item);
  currentSearchChunkSize += itemSize;
}
if (currentSearchChunk.length) searchChunks.push(currentSearchChunk);

await fs.writeFile(
  path.join(root, 'assets/data/search-index.json'),
  `${JSON.stringify({
    chunkCount: searchChunks.length,
    items: searchItems.map(({ title, path: itemPath }) => ({ title, path: itemPath }))
  })}\n`,
  'utf8'
);
await Promise.all(searchChunks.map((items, index) => fs.writeFile(
  path.join(searchChunkDirectory, `${index}.json`),
  `${JSON.stringify(items)}\n`,
  'utf8'
)));

const yearFiles = markdownFiles
  .filter((file) => /^docs\/years\/\d{4}\.md$/.test(file))
  .sort();
const years = [];
for (const relative of yearFiles) {
  const year = Number(path.basename(relative, '.md'));
  const markdown = await fs.readFile(path.join(root, relative), 'utf8');
  years.push(parseYear(markdown, year, libraryPreferences));
}
const books = buildBookMetadata(noteSources, years);
await fs.writeFile(
  path.join(root, 'assets/data/reading-data.json'),
  `${JSON.stringify({ years, books })}\n`,
  'utf8'
);
await fs.writeFile(
  path.join(root, 'assets/data/book-metadata.json'),
  `${JSON.stringify(books)}\n`,
  'utf8'
);
await fs.writeFile(
  path.join(root, 'assets/data/reading-years.json'),
  `${JSON.stringify(years.map(({ year }) => year))}\n`,
  'utf8'
);

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

const versionedAssets = [
  'assets/css/blog.css',
  'assets/data/typo-rules.js',
  'assets/js/resource-loader.js',
  'assets/js/archive-nav.js',
  'assets/js/route-loader.js',
  'assets/js/search.js'
];
const versionSourceAssets = [
  ...versionedAssets,
  'assets/data/reading-data.json',
  'assets/data/reading-years.json',
  'assets/data/book-metadata.json',
  'assets/data/typo-rules.json',
  'assets/js/reading-dashboard.js',
  'assets/data/search-index.json',
  'assets/js/wechat-copy.js',
  'assets/js/typo-checker.js',
  'assets/js/section-fold.js',
  ...searchChunks.map((_, index) => `assets/data/search-chunks/${index}.json`)
];
const versionSource = await Promise.all(versionSourceAssets.map((asset) => fs.readFile(path.join(root, asset))));
const buildVersion = createHash('sha256').update(Buffer.concat(versionSource)).digest('hex').slice(0, 10);
const indexPath = path.join(root, 'index.html');
let indexHtml = await fs.readFile(indexPath, 'utf8');
for (const asset of versionedAssets) {
  const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  indexHtml = indexHtml.replace(new RegExp(`(\\./${escaped})(?:\\?v=[^"']+)?`, 'g'), `$1?v=${buildVersion}`);
}
indexHtml = indexHtml.replace(/window\.DOC_READ_BUILD\s*=\s*['"][^'"]*['"]/, `window.DOC_READ_BUILD = '${buildVersion}'`);
await fs.writeFile(indexPath, indexHtml, 'utf8');

console.log(`Generated local vendor assets, split search index (${searchItems.length} pages in ${searchChunks.length} chunks), reading data (${years.length} years), book metadata (${books.length} books), catalog (${catalogItems.length} notes), sitemap (${uniqueRoutes.length} routes), and asset version ${buildVersion}.`);
