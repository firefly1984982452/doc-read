import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const concurrency = 8;

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

const imagePattern = /(?:!\[[^\]]*\]\(|<img[^>]+src=["'])(https?:\/\/[^\s)"']+)/gi;
const sources = new Map();
for (const file of await walk(path.join(root, 'docs'))) {
  const contents = await fs.readFile(file, 'utf8');
  for (const match of contents.matchAll(imagePattern)) {
    if (!sources.has(match[1])) sources.set(match[1], []);
    sources.get(match[1]).push(path.relative(root, file));
  }
}

const urls = [...sources.keys()];
const failures = [];
let cursor = 0;

async function worker() {
  while (cursor < urls.length) {
    const url = urls[cursor++];
    try {
      let response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(12000) });
      if (response.status === 405) response = await fetch(url, { headers: { Range: 'bytes=0-0' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      if (!response.ok) failures.push({ url, status: response.status, files: sources.get(url) });
    } catch (error) {
      failures.push({ url, status: error.name, files: sources.get(url) });
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
await fs.mkdir(path.join(root, 'reports'), { recursive: true });
await fs.writeFile(path.join(root, 'reports/image-health.json'), JSON.stringify({ checkedAt: new Date().toISOString(), total: urls.length, failures }, null, 2));

console.log(`Checked ${urls.length} external images; ${failures.length} need attention. Report: reports/image-health.json`);
process.exitCode = failures.length ? 1 : 0;
