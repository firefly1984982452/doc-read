import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirs = ['docs/read', 'docs/read-history'];
const outputRelative = process.argv[3] || 'reports/公众号发表对照.md';

function latestWechatSnapshot() {
  const candidates = fs.readdirSync(root)
    .filter(name => /^公众号发表对照-\d{4}-\d{2}-\d{2}\.md$/.test(name))
    .sort((a, b) => b.localeCompare(a));
  if (!candidates.length) throw new Error('未找到带日期的公众号发表对照快照');
  return candidates[0];
}

const snapshotRelative = process.argv[2] || latestWechatSnapshot();

function readWechatSnapshot(relative) {
  const markdown = fs.readFileSync(path.resolve(root, relative), 'utf8');
  const section = markdown.split(/^## 原始公众号标题快照\s*$/m)[1];
  if (!section) throw new Error(`${relative} 缺少“原始公众号标题快照”章节`);
  const titles = section
    .split(/\r?\n/)
    .map(line => line.match(/^\s*-\s+(.+?)\s*$/)?.[1])
    .filter(Boolean);
  if (!titles.length) throw new Error(`${relative} 没有可读取的公众号标题`);

  return {
    titles,
    date: markdown.match(/统计日期：(\d{4}-\d{2}-\d{2})/)?.[1] || '未知',
    recordCount: Number(markdown.match(/公众号后台共\s*(\d+)\s*条/)?.[1]) || titles.length
  };
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.md') ? [full] : [];
  });
}

const compact = value => value.normalize('NFKC')
  .replace(/[\s①②③④⑤⑥⑦⑧⑨⑩【】\[\]（）()《》·:：,，、?？!！“”"'‘’—–\-_.]/g, '')
  .toLowerCase();
const bracketTexts = value => [...value.matchAll(/《([^》]+)》/g)].map(match => match[1]);
const genericKeys = new Set(['史记', '汉书', '后汉书', '黄帝内经', '徐文兵讲黄帝内经']);

function keysFor(value) {
  const brackets = bracketTexts(value);
  const source = brackets.length ? brackets : [value];
  const keys = new Set();
  for (const item of source) {
    const cleaned = item.replace(/（[^）]*）|\([^)]*\)/g, '').replace(/十二本纪|本纪|传|纪/g, '');
    const segments = cleaned.split('·').filter(Boolean);
    for (const candidate of [cleaned, segments.length > 1 ? segments.at(-1) : '']) {
      const key = compact(candidate).replace(/^\d+/, '');
      if (key) keys.add(key);
      if (/^\d+$/.test(compact(candidate))) keys.add(compact(candidate));
    }
  }
  return [...keys].filter(key => key.length >= 2 && (!/^\d+$/.test(key) || key.length >= 4) && !genericKeys.has(key));
}

const snapshot = readWechatSnapshot(snapshotRelative);
const publishedTitles = [...new Set(snapshot.titles)];
const published = publishedTitles.map(title => ({ title, keys: keysFor(title) }));
const files = sourceDirs.flatMap(dir => walk(path.join(root, dir))).map(full => {
  const relative = path.relative(root, full).split(path.sep).join('/');
  const basename = path.basename(full, '.md');
  const content = fs.readFileSync(full, 'utf8');
  const firstLine = content.split(/\r?\n/).find(line => line.trim())?.trim() || basename;
  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title = firstLine.startsWith('#') ? (firstHeading || basename) : firstLine;
  const keys = [...new Set([...keysFor(basename), ...keysFor(title)])];
  const matches = published.filter(post => post.keys.some(key => keys.includes(key)));
  return { relative, title, basename, keys, matches };
});

const publishedFiles = files.filter(file => file.matches.length);
const unpublishedFiles = files.filter(file => !file.matches.length);
const matchedPostTitles = new Set(publishedFiles.flatMap(file => file.matches.map(post => post.title)));
const unmatchedPosts = publishedTitles.filter(title => !matchedPostTitles.has(title));
const duplicatePosts = [...new Map(publishedFiles
  .filter(file => file.matches.length > 1)
  .map(file => [file.relative, { file, titles: [...new Set(file.matches.map(post => post.title))] }])).values()];

function lineFor(file) {
  return `- [${file.title || file.basename}](${encodeURI(file.relative)})`;
}

const report = [
  '# “彭丹的阅读之旅”公众号与博客文章对照表',
  '',
  `> 数据快照日期：${snapshot.date}。公众号后台共 ${snapshot.recordCount} 条发表记录；一条记录可能包含多篇文章。博客范围为 \`docs/read\` 与 \`docs/read-history\` 下的 Markdown 文件。`,
  '',
  '## 统计摘要',
  '',
  `- 博客 Markdown：${files.length} 篇`,
  `- 已匹配为发表过：${publishedFiles.length} 篇`,
  `- 未匹配为发表过：${unpublishedFiles.length} 篇`,
  `- 公众号标题（去重）：${publishedTitles.length} 个`,
  `- 公众号非博客或暂未匹配标题：${unmatchedPosts.length} 个`,
  '',
  '> 匹配规则：优先比较书名号内的书名；史记、汉书、后汉书按具体篇章名匹配；黄帝内经忽略编号与“徐文兵”后缀。相同书名对应多个博客文件时会同时标记，建议人工复核。',
  '',
  '## 已发表过的博客文章',
  '',
  ...publishedFiles.sort((a, b) => a.relative.localeCompare(b.relative, 'zh-CN')).map(lineFor),
  '',
  '## 尚未发现发表记录的博客文章',
  '',
  ...unpublishedFiles.sort((a, b) => a.relative.localeCompare(b.relative, 'zh-CN')).map(lineFor),
  '',
  '## 公众号重复发表或同一博客对应多条标题',
  '',
  ...duplicatePosts.flatMap(({ file, titles }) => [
    `### ${file.basename}`,
    '',
    ...titles.map(title => `- ${title}`),
    ''
  ]),
  '## 公众号非博客文章或暂未匹配标题',
  '',
  ...unmatchedPosts.sort((a, b) => a.localeCompare(b, 'zh-CN')).map(title => `- ${title}`),
  '',
  '## 原始公众号标题快照',
  '',
  ...publishedTitles.map(title => `- ${title}`),
  ''
].join('\n');

const outputPath = path.resolve(root, outputRelative);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, report);

console.log(JSON.stringify({
  snapshot: snapshotRelative,
  output: outputRelative,
  blogFiles: files.length,
  published: publishedFiles.length,
  unpublished: unpublishedFiles.length,
  uniqueWechatTitles: publishedTitles.length,
  unmatchedWechatTitles: unmatchedPosts.length,
  duplicateBlogMatches: duplicatePosts.length
}, null, 2));
