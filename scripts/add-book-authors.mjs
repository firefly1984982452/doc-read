import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readDirectory = path.join(root, 'docs/read');
const reportPath = path.join(root, '公众号发表对照-2026-08-13.md');
const scriptPath = fileURLToPath(import.meta.url);
const legacyManifestPath = path.join(root, 'assets/data/legacy-routes.json');
const legacyScriptPath = path.join(root, 'assets/data/legacy-routes.js');
const apply = process.argv.includes('--apply');
const verbose = process.argv.includes('--verbose');
const excluded = new Set(['错别字校对报告.md']);

for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (value === '--exclude' && process.argv[index + 1]) {
    excluded.add(process.argv[index + 1]);
    index += 1;
  } else if (value.startsWith('--exclude=')) {
    excluded.add(value.slice('--exclude='.length));
  }
}

const manualAuthors = new Map([
  ['《赵氏孤儿》.md', '贾志刚']
]);

const manualTargets = new Map([
  ['丹尼尔《思考，快与慢》.md', '丹尼尔·卡尼曼《思考，快与慢》重读.md']
]);

function decodePath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanReportLabel(value) {
  return value
    .replace(/^\s*✓\s*/, '')
    .replace(/^\s*\d+\s+(?=\S)/, '')
    .trim();
}

function authorBeforeTitle(value) {
  const titleIndex = value.indexOf('《');
  if (titleIndex < 1) return '';
  return value
    .slice(0, titleIndex)
    .replace(/^\s*✓\s*/, '')
    .replace(/^\s*\d+[.\u3001\s]*/, '')
    .trim();
}

function headingFrom(markdown) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? { full: match[0], text: match[1].trim() } : null;
}

function targetHeading(current, author) {
  const titleIndex = current.indexOf('《');
  if (titleIndex < 0) return `${author}${current}`;
  const leading = current.slice(0, titleIndex).trim();
  const sequence = leading.match(/^(\d+)(?:[.\u3001\s]|$)/)?.[1];
  return `${sequence ? `${sequence} ` : ''}${author}${current.slice(titleIndex)}`;
}

function countBookTitles(value) {
  return [...value.matchAll(/《/g)].length;
}

function encodeUriLower(value) {
  return encodeURI(value).replace(/%[0-9A-F]{2}/g, (part) => part.toLowerCase());
}

function replacementPairs(oldRelative, newRelative) {
  const oldRoute = oldRelative.replace(/\.md$/, '');
  const newRoute = newRelative.replace(/\.md$/, '');
  const values = [
    [oldRelative, newRelative],
    [oldRoute, newRoute],
    [encodeURI(oldRelative), encodeURI(newRelative)],
    [encodeURI(oldRoute), encodeURI(newRoute)],
    [encodeUriLower(oldRelative), encodeUriLower(newRelative)],
    [encodeUriLower(oldRoute), encodeUriLower(newRoute)]
  ];
  return [...new Map(values.filter(([oldValue, newValue]) => oldValue !== newValue)
    .map((pair) => [pair[0], pair])).values()]
    .sort((a, b) => b[0].length - a[0].length);
}

function legacyRepairPairs(routes) {
  const pairs = [];
  for (const [oldRoute, newRoute] of Object.entries(routes)) {
    const oldRelative = `${oldRoute.replace(/^\//, '')}.md`;
    const newRelative = `${newRoute.replace(/^\//, '')}.md`;
    const oldBase = path.basename(oldRelative);
    const newBase = path.basename(newRelative);
    const brokenRelative = newRelative.replace(oldBase, newBase);
    if (brokenRelative === newRelative) continue;
    pairs.push(
      [brokenRelative, newRelative],
      [encodeURI(brokenRelative), encodeURI(newRelative)],
      [encodeUriLower(brokenRelative), encodeUriLower(newRelative)]
    );
  }
  return [...new Map(pairs.map((pair) => [pair[0], pair])).values()]
    .sort((a, b) => b[0].length - a[0].length);
}

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (['.git', 'node_modules', '.codex-backups'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    if (entry.isFile()) files.push(absolute);
  }
  return files;
}

const report = await fs.readFile(reportPath, 'utf8');
const reportMetadata = new Map();
for (const match of report.matchAll(/\[([^\]]+)]\((docs\/read\/[^)]+\.md)\)/g)) {
  const relative = decodePath(match[2]);
  const basename = path.basename(relative);
  const label = cleanReportLabel(match[1]);
  const author = authorBeforeTitle(label);
  reportMetadata.set(basename, { label, author });
}

const sourceNames = (await fs.readdir(readDirectory))
  .filter((name) => name.endsWith('.md') && !excluded.has(name))
  .sort((a, b) => a.localeCompare(b, 'zh-CN'));
const sourceSet = new Set(sourceNames);
const plans = [];
const unresolved = [];

for (const sourceName of sourceNames) {
  const absolute = path.join(readDirectory, sourceName);
  const markdown = await fs.readFile(absolute, 'utf8');
  const heading = headingFrom(markdown);
  const metadata = reportMetadata.get(sourceName);
  const author = manualAuthors.get(sourceName)
    || metadata?.author
    || authorBeforeTitle(sourceName)
    || authorBeforeTitle(heading?.text || '');

  if (!author || !heading) {
    unresolved.push({ sourceName, author, heading: heading?.text || '' });
    continue;
  }

  const titleIndex = sourceName.indexOf('《');
  if (titleIndex < 0) {
    unresolved.push({ sourceName, author, heading: heading.text });
    continue;
  }

  let targetName = manualTargets.get(sourceName) || `${author}${sourceName.slice(titleIndex)}`;
  if (countBookTitles(sourceName) > 1 && metadata?.label && countBookTitles(metadata.label) > 1) {
    targetName = `${metadata.label}.md`;
  }
  const newHeading = targetHeading(heading.text, author);
  plans.push({ sourceName, targetName, heading, newHeading });
}

if (unresolved.length) {
  console.error('无法确定作者或一级标题：');
  for (const item of unresolved) console.error(`- ${item.sourceName} | ${item.heading || '无 H1'}`);
  process.exit(1);
}

const targetOwners = new Map();
for (const plan of plans) {
  const owners = targetOwners.get(plan.targetName) || [];
  owners.push(plan.sourceName);
  targetOwners.set(plan.targetName, owners);
}
const collisions = [...targetOwners.entries()].filter(([, owners]) => owners.length > 1);
const occupiedTargets = [];
for (const plan of plans.filter(({ sourceName, targetName }) =>
  sourceName !== targetName && !sourceSet.has(targetName)
)) {
  try {
    await fs.access(path.join(readDirectory, plan.targetName));
    occupiedTargets.push(plan);
  } catch {
    // The target does not exist and is safe to create.
  }
}

if (collisions.length) {
  console.error('目标文件名冲突：');
  for (const [target, owners] of collisions) console.error(`- ${target}: ${owners.join(', ')}`);
  process.exit(1);
}
if (occupiedTargets.length) {
  console.error('目标文件名已被本次范围外的文件占用：');
  for (const plan of occupiedTargets) console.error(`- ${plan.targetName}`);
  process.exit(1);
}

const renamePlans = plans.filter(({ sourceName, targetName }) => sourceName !== targetName);
const headingPlans = plans.filter(({ heading, newHeading }) => heading.text !== newHeading);

console.log(`范围：${plans.length} 篇；排除：${[...excluded].join('、')}`);
console.log(`计划重命名 ${renamePlans.length} 个文件，更新 ${headingPlans.length} 个一级标题。`);
if (verbose) {
  for (const plan of renamePlans) console.log(`RENAME ${plan.sourceName} -> ${plan.targetName}`);
  for (const plan of headingPlans) console.log(`H1 ${plan.sourceName}: ${plan.heading.text} -> ${plan.newHeading}`);
}

if (!apply) {
  console.log('当前为预览模式；确认后使用 --apply 执行。');
  process.exit(0);
}

const temporaryMoves = [];
for (let index = 0; index < renamePlans.length; index += 1) {
  const plan = renamePlans[index];
  const temporaryName = `.__book-author-${process.pid}-${index}.md`;
  await fs.rename(
    path.join(readDirectory, plan.sourceName),
    path.join(readDirectory, temporaryName)
  );
  temporaryMoves.push({ ...plan, temporaryName });
}
for (const plan of temporaryMoves) {
  await fs.rename(
    path.join(readDirectory, plan.temporaryName),
    path.join(readDirectory, plan.targetName)
  );
}

for (const plan of plans) {
  if (plan.heading.text === plan.newHeading) continue;
  const finalPath = path.join(readDirectory, plan.targetName);
  const markdown = await fs.readFile(finalPath, 'utf8');
  const updated = markdown.replace(plan.heading.full, `# ${plan.newHeading}`);
  await fs.writeFile(finalPath, updated, 'utf8');
}

let legacyRoutes = {};
try {
  legacyRoutes = JSON.parse(await fs.readFile(legacyManifestPath, 'utf8'));
} catch {
  // The first normalization run starts without a legacy manifest.
}

const allPairs = [
  ...renamePlans.flatMap(({ sourceName, targetName }) => replacementPairs(
  `docs/read/${sourceName}`,
  `docs/read/${targetName}`
  )),
  ...legacyRepairPairs(legacyRoutes)
].sort((a, b) => b[0].length - a[0].length);
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.txt', '.xml', '.yaml', '.yml']);
const changedReferenceFiles = [];
for (const absolute of await walk(root)) {
  if ([scriptPath, legacyManifestPath, legacyScriptPath].includes(absolute)
    || (path.dirname(absolute) === readDirectory && excluded.has(path.basename(absolute)))
    || !textExtensions.has(path.extname(absolute))) continue;
  const original = await fs.readFile(absolute, 'utf8');
  let updated = original;
  for (const [oldValue, newValue] of allPairs) updated = updated.split(oldValue).join(newValue);
  if (updated === original) continue;
  await fs.writeFile(absolute, updated, 'utf8');
  changedReferenceFiles.push(path.relative(root, absolute));
}

for (const { sourceName, targetName } of renamePlans) {
  const oldRoute = `/docs/read/${sourceName.replace(/\.md$/, '')}`;
  const newRoute = `/docs/read/${targetName.replace(/\.md$/, '')}`;
  legacyRoutes[oldRoute] = newRoute;
}
for (const route of Object.keys(legacyRoutes)) {
  const visited = new Set([route]);
  let target = legacyRoutes[route];
  while (legacyRoutes[target] && !visited.has(target)) {
    visited.add(target);
    target = legacyRoutes[target];
  }
  legacyRoutes[route] = target;
}
legacyRoutes = Object.fromEntries(Object.entries(legacyRoutes)
  .sort(([left], [right]) => left.localeCompare(right, 'zh-CN')));
await fs.writeFile(legacyManifestPath, `${JSON.stringify(legacyRoutes, null, 2)}\n`, 'utf8');
await fs.writeFile(legacyScriptPath, `(function (global) {
  'use strict';
  var routes = ${JSON.stringify(legacyRoutes)};
  global.DOC_READ_LEGACY_ROUTES = routes;
  var hash = global.location.hash || '';
  var queryAt = hash.indexOf('?');
  var routePart = queryAt >= 0 ? hash.slice(0, queryAt) : hash;
  var suffix = queryAt >= 0 ? hash.slice(queryAt) : '';
  var decoded = routePart.replace(/^#/, '');
  try { decoded = decodeURIComponent(decoded); } catch (error) { /* Keep the original route. */ }
  decoded = decoded.replace(/\\.md$/, '');
  var target = routes[decoded];
  if (!target) return;
  global.history.replaceState(null, '', global.location.pathname + global.location.search + '#' + target + suffix);
}(window));
`, 'utf8');

console.log(`已重命名 ${renamePlans.length} 个文件，更新 ${headingPlans.length} 个 H1，改写 ${changedReferenceFiles.length} 个引用文件，保留 ${Object.keys(legacyRoutes).length} 条旧路由兼容映射。`);
