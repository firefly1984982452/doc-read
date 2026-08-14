import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBookMetadata, noteMetadata, parseLibraryPreferences, parseYear } from './lib/reading-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'reports']);
const ignoredFiles = new Set(['docs/demo.md']);
const excludedPublicNames = new Set(['demo.md', 'pdd.md', '《1》.md']);

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const allFiles = await walk(root);
const textFiles = allFiles.filter((file) => /\.(md|html)$/.test(file));
const errors = [];
const warnings = [];

for (const file of textFiles) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  if (ignoredFiles.has(relative)) continue;
  const contents = await fs.readFile(file, 'utf8');
  const lines = contents.split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\]\((\/[^)#?]+)(?:[?#][^)]*)?\)/g)) {
      const linked = decodeURI(match[1]).replace(/^\//, '');
      const target = path.join(root, linked);
      const candidates = [target, `${target}.md`, path.join(target, 'README.md')];
      const exists = candidates.some((candidate) => allFiles.includes(candidate));
      if (!exists) errors.push(`${relative}:${index + 1} missing ${match[1]}`);
    }
  });
}

const readingFiles = textFiles.filter((file) => {
  const relative = path.relative(root, file).split(path.sep).join('/');
  return /^docs\/(?:read|read-history)\/.+\.md$/.test(relative) && !excludedPublicNames.has(path.basename(relative));
});

for (const file of readingFiles) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const contents = await fs.readFile(file, 'utf8');
  const h1Count = contents.split('\n').filter((line) => /^#\s+/.test(line)).length;
  if (h1Count === 0) errors.push(`${relative} must contain a level-one heading`);
  if (h1Count > 1) warnings.push(`${relative} contains ${h1Count} level-one headings; keep the legacy structure unless intentionally reorganizing it`);
  if (!/^date:\s*\d{4}-\d{2}-\d{2}/mi.test(contents)) warnings.push(`${relative} has no standard date metadata`);
}

const libraryMarkdown = await fs.readFile(path.join(root, 'docs/library.md'), 'utf8');
const libraryPreferences = parseLibraryPreferences(libraryMarkdown);
const parsedYears = [];
for (const file of allFiles.filter((item) => /^\d{4}\.md$/.test(path.basename(item)) && path.dirname(item) === path.join(root, 'docs/years'))) {
  const year = Number(path.basename(file, '.md'));
  const relative = path.relative(root, file).split(path.sep).join('/');
  try {
    const parsed = parseYear(await fs.readFile(file, 'utf8'), year, libraryPreferences);
    parsedYears.push(parsed);
    if (!parsed.records.length) errors.push(`${relative} contains no readable book records`);
    if (typeof parsed.wordWan !== 'number') errors.push(`${relative} has no readable annual word total`);
    if (typeof parsed.calculatedWordWan === 'number' && parsed.wordWan !== parsed.calculatedWordWan) {
      errors.push(`${relative} declares ${parsed.wordWan}万字 but monthly data totals ${parsed.calculatedWordWan}万字`);
    }
  } catch (error) {
    errors.push(`${relative} cannot be parsed: ${error.message}`);
  }
}

let genericAltCount = 0;
for (const file of textFiles.filter((item) => item.endsWith('.md'))) {
  const contents = await fs.readFile(file, 'utf8');
  for (const match of contents.matchAll(/!\[([^\]]*)\]\([^)]+\)/g)) {
    if (!match[1].trim() || /^(?:image|img|图片|截图|思维导图|banner)\d*$/i.test(match[1].trim())) genericAltCount += 1;
  }
}
if (genericAltCount) warnings.push(`${genericAltCount} Markdown images still use generic alt text`);

const indexHtml = await fs.readFile(path.join(root, 'index.html'), 'utf8');
if (!indexHtml.includes('<html lang="zh-CN">')) errors.push('index.html must declare lang="zh-CN"');
if (indexHtml.includes('content="Description"')) errors.push('index.html still contains placeholder description');
if (indexHtml.includes('cdn.jsdelivr.net')) errors.push('index.html must use local pinned frontend dependencies');
if (indexHtml.includes('plugins/search.min.js')) errors.push('index.html must use the lazy local search implementation');
if (!indexHtml.includes('assets/js/route-loader.js')) errors.push('index.html must load route-aware assets');
if (/assets\/js\/(?:reading-data|reading-years|search-index)\.js/.test(indexHtml)) {
  errors.push('index.html must not load generated content as JavaScript globals');
}
if (/\?v=(?:build|\d{8})/.test(indexHtml)) errors.push('index.html must use the generated content-based asset version');
const generatedDataFiles = [
  'assets/data/reading-data.json',
  'assets/data/reading-years.json',
  'assets/data/book-metadata.json',
  'assets/data/search-index.json'
];
for (const relative of generatedDataFiles) {
  const file = path.join(root, relative);
  if (!allFiles.includes(file)) {
    errors.push(`missing generated data file ${relative}`);
    continue;
  }
  try {
    JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    errors.push(`${relative} is not valid JSON: ${error.message}`);
  }
}
try {
  const generatedReadingData = JSON.parse(await fs.readFile(path.join(root, 'assets/data/reading-data.json'), 'utf8'));
  const generatedReadingYears = JSON.parse(await fs.readFile(path.join(root, 'assets/data/reading-years.json'), 'utf8'));
  const generatedBooks = JSON.parse(await fs.readFile(path.join(root, 'assets/data/book-metadata.json'), 'utf8'));
  const expectedNotes = await Promise.all(readingFiles.map(async (file) => noteMetadata(
    await fs.readFile(file, 'utf8'),
    path.relative(root, file).split(path.sep).join('/'),
    libraryPreferences
  )));
  parsedYears.sort((a, b) => a.year - b.year);
  const expectedBooks = buildBookMetadata(expectedNotes, parsedYears);
  if (JSON.stringify(generatedReadingData.years) !== JSON.stringify(parsedYears)) {
    errors.push('assets/data/reading-data.json is stale; run npm run generate');
  }
  if (JSON.stringify(generatedReadingYears) !== JSON.stringify(parsedYears.map(item => item.year))) {
    errors.push('assets/data/reading-years.json is stale; run npm run generate');
  }
  if (JSON.stringify(generatedBooks) !== JSON.stringify(expectedBooks) || JSON.stringify(generatedReadingData.books) !== JSON.stringify(expectedBooks)) {
    errors.push('generated book metadata is stale or inconsistent; run npm run generate');
  }
  const bookIds = new Set(generatedBooks.map(book => book.id));
  for (const annual of generatedReadingData.years || []) {
    for (const record of annual.records || []) {
      if (!bookIds.has(record.bookId)) errors.push(`reading record references missing book metadata: ${record.bookId}`);
    }
  }
} catch {
  // The generated-file validation above already reports missing or invalid JSON.
}
for (const legacy of ['reading-data.js', 'reading-years.js', 'search-index.js']) {
  if (allFiles.includes(path.join(root, 'assets/js', legacy))) {
    errors.push(`legacy generated JavaScript data must be removed: assets/js/${legacy}`);
  }
}
const searchChunkDirectory = path.join(root, 'assets/data/search-chunks');
const searchChunkFiles = allFiles.filter((file) => path.dirname(file) === searchChunkDirectory && file.endsWith('.json'));
if (!searchChunkFiles.length) {
  errors.push('generated search index chunks are missing');
}
for (const file of searchChunkFiles) {
  try {
    JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    errors.push(`${path.relative(root, file)} is not valid JSON: ${error.message}`);
  }
}
for (const vendorFile of ['vue.css', 'docsify.min.js', 'zoom-image.min.js', 'docsify-pagination.min.js', 'countable.min.js']) {
  if (!allFiles.includes(path.join(root, 'assets/vendor/docsify', vendorFile))) errors.push(`missing local vendor asset ${vendorFile}`);
}

if (errors.length) {
  console.error(`Site check failed with ${errors.length} problem(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

if (warnings.length) {
  console.warn(`Site check warnings (${warnings.length}):`);
  warnings.forEach((warning) => console.warn(`- ${warning}`));
}

console.log(`Site check passed: ${textFiles.length} text files and all internal links are valid.`);
