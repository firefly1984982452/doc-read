import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'node_modules']);
const ignoredFiles = new Set(['docs/demo.md']);

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

const indexHtml = await fs.readFile(path.join(root, 'index.html'), 'utf8');
if (!indexHtml.includes('<html lang="zh-CN">')) errors.push('index.html must declare lang="zh-CN"');
if (indexHtml.includes('content="Description"')) errors.push('index.html still contains placeholder description');
if (/cdn\.jsdelivr\.net\/npm\/docsify@(?!4\.13\.1)/.test(indexHtml)) errors.push('Docsify dependencies must be pinned to 4.13.1');

if (errors.length) {
  console.error(`Site check failed with ${errors.length} problem(s):`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Site check passed: ${textFiles.length} text files and all internal links are valid.`);
