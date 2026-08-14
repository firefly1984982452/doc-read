import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

async function exists(relative) {
  try {
    await fs.access(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

for (const relative of [
  '.nojekyll',
  '404.md',
  'index.html',
  '_sidebar.md',
  '_navbar.md',
  '_coverpage.md',
  'robots.txt',
  'site.webmanifest',
  'sitemap.xml',
  'assets/data/reading-data.json',
  'assets/data/reading-years.json',
  'assets/data/book-metadata.json',
  'assets/data/search-index.json'
]) {
  if (!await exists(relative)) errors.push(`deployment file is missing: ${relative}`);
}

const indexHtml = await fs.readFile(path.join(root, 'index.html'), 'utf8');
const buildVersion = indexHtml.match(/window\.DOC_READ_BUILD\s*=\s*['"]([^'"]+)['"]/)?.[1];
if (!buildVersion || !/^[a-f0-9]{10}$/.test(buildVersion)) errors.push('index.html has no valid content build version');

const localReferences = [...indexHtml.matchAll(/(?:src|href)=["']\.\/([^"'#?]+)(?:\?[^"'#]*)?["']/g)]
  .map(match => decodeURI(match[1]));
for (const relative of new Set(localReferences)) {
  if (!await exists(relative)) errors.push(`index.html references a missing deployment asset: ${relative}`);
}

for (const match of indexHtml.matchAll(/(?:src|href)=["']\.\/([^"'#?]+)\?v=([^"'#]+)["']/g)) {
  if (match[2] !== buildVersion) errors.push(`${match[1]} uses stale build version ${match[2]}`);
}

try {
  const searchManifest = JSON.parse(await fs.readFile(path.join(root, 'assets/data/search-index.json'), 'utf8'));
  const chunkDirectory = path.join(root, 'assets/data/search-chunks');
  const chunkFiles = (await fs.readdir(chunkDirectory)).filter(name => name.endsWith('.json')).sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
  const expected = Array.from({ length: searchManifest.chunkCount }, (_, index) => `${index}.json`);
  if (JSON.stringify(chunkFiles) !== JSON.stringify(expected)) {
    errors.push(`search chunks do not match manifest: expected ${expected.length}, found ${chunkFiles.length}`);
  }
  const indexedItems = [];
  for (const chunk of expected) {
    if (!await exists(`assets/data/search-chunks/${chunk}`)) continue;
    const items = JSON.parse(await fs.readFile(path.join(chunkDirectory, chunk), 'utf8'));
    indexedItems.push(...items);
  }
  if (indexedItems.length !== searchManifest.items.length) {
    errors.push(`search manifest has ${searchManifest.items.length} titles but chunks contain ${indexedItems.length} pages`);
  }
} catch (error) {
  errors.push(`search deployment data cannot be verified: ${error.message}`);
}

const canonical = indexHtml.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
const sitemap = await fs.readFile(path.join(root, 'sitemap.xml'), 'utf8');
if (!canonical) {
  errors.push('index.html has no canonical site URL');
} else {
  for (const match of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    if (!match[1].startsWith(canonical)) {
      errors.push(`sitemap URL is outside canonical deployment base: ${match[1]}`);
      continue;
    }
    const relative = decodeURI(match[1].slice(canonical.length));
    if (relative && !await exists(relative)) errors.push(`sitemap route is missing from deployment: ${relative}`);
  }
}

if (errors.length) {
  console.error(`Deployment check failed with ${errors.length} problem(s):`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Deployment check passed: ${new Set(localReferences).size} local entry assets, generated JSON, search chunks, and sitemap routes are complete.`);
