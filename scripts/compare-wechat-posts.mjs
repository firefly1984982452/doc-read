import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceDirs = ['docs/read', 'docs/read-history'];
const publishedTitles = [
  '《当下的力量》思维导图、书摘','《窄门》人物关系图、每章情节解析、书评','《布鲁克林有棵树》思维导图、人物关系图、每章情节解析、书摘、书评','《跳出自我的盒子》书评','《改命记实录》思维导图、重点解构、书评','《原生家庭》思维导图、重点解构、佳句摘抄、书评','《原生家庭》读后感：悟已往之不谏，知来者之可追。','《最重要的事，只有一件》思维导图、重点解析','《事实》（比尔·盖茨推荐）思维导图、重点解析、书评','2025年阅读总结【586万字】','2025年生活总结','《吃掉那只青蛙》思维导图-21条法则',
  '《翦商》思维导图','《没有人给他写信的上校》思维导图、每章情节梗概','《罪与罚》每章情节梗概、人物关系整理','《1984》思维导图、人物关系图、每章情节梗概','《打开心智》思维导图、重点解析、书评','《贪婪的多巴胺》思维导图、重点解析、书摘、书评','《我被行走治愈了》','《自驱型成长》思维导图、重点解析','《麦克白》人物关系图、每章情节解析','《思考，快与慢》思维导图',
  '蒙曼《太平公主和她的时代》人物关系图、思维导图','我的10月复盘总结','我的9月复盘总结','《怪诞行为学》思维导图、重点解构、书评','《允许爱情消失》思维导图、书摘','《心流》思维导图、重点解构、书摘','《雷雨》人物关系图、每章情节解析、书摘','《桃花源没事儿》每章情节解析、书摘','我的8月复盘总结','《李尔王》思维导图、重点解构、书评','《作文六要》思维导图、重点解构、书评','《刻意练习》思维导图、重点解构、书评','我的7月复盘总结','《刻意练习》思维导图、重点解构、书评','《福格行为模型》思维导图','我的6月复盘总结','我的5月复盘总结','《成长的觉醒》思维导图、重点解构、书评','《自控力》思维导图、重点解构、书评','我的4月复盘总结',
  '《学会学习》思维导图、重点解构、书评','我决定放弃只读名著','《包法利夫人》人物关系图、每章情节解析','《自学是门手艺》思维导图、重点解析','我的3月总结','《悉达多》人物关系图、每章情节解析','《悉达多》读后感：今日方知我是我','《了凡四训》思维导图 + 精华金句','《霍乱时期的爱情》读后感：人生自是有情痴，此恨不关风与月！','《百年孤独》人物关系图、故事情节解析','公众号文章汇总链接：世界十大名著、二十四史、《徐文兵讲黄帝内经》、其他名著等','《霍乱时期的爱情》思维导图、人物关系图、每章情节梗概','《暴食症康复指南》思维导图','《非暴力沟通》思维导图','我的2月总结','《你就是孩子最好的玩具》思维导图','《你就是孩子最好的玩具》思维导图','《如何说孩子才会听 怎么听孩子才肯说》思维导图','《带夫修行》','《掌控习惯》思维导图','《控糖革命》：轻松控糖的10个小窍门',
  '《白夜行》人物关系图、故事情节解析','《复活》人物关系图、故事情节解析','《变形记》故事情节解析','11《后汉书·本纪·皇后纪下》','10《后汉书·本纪·皇后纪上》','8《后汉书·本纪·灵帝纪》','9《后汉书·本纪·献帝纪》','7《后汉书·本纪·孝桓帝纪》','6《后汉书·本纪·孝顺孝冲孝质帝纪》','5《后汉书·本纪·孝安帝纪》','4《后汉书·本纪·孝和孝殇帝纪》','3《后汉书·本纪·肃宗孝章帝纪》','3《后汉书·本纪·肃宗孝章帝纪》','4《后汉书·本纪·孝和孝殇帝纪》','5《后汉书·本纪·孝安帝纪》','6《后汉书·本纪·孝顺孝冲孝质帝纪》','7《后汉书·本纪·孝桓帝纪》','8《后汉书·本纪·灵帝纪》','9《后汉书·本纪·献帝纪》','2《后汉书·本纪·显宗孝明帝纪》','1《后汉书·本纪·光武帝纪》','1《汉书·传·王莽传》人物关系图、详细文章内容','6《汉书·平帝纪》人物关系图、详细文章内容','5《汉书·哀帝纪》人物关系图、详细文章内容','4《汉书·成帝纪》人物关系图、详细文章内容','3《汉书·元帝纪》人物关系图、详细文章内容',
  '2《汉书·宣帝纪》人物关系图、详细文章内容','1《汉书·昭帝纪》人物关系图、详细文章内容','《1984》人物关系图、故事情节解析','《卡拉马佐夫兄弟》人物关系图、故事情节解析','《多囊卵巢综合征完全指南》阅读笔记','《橘子不是唯一的水果》人物关系图、情节整理','6《黄帝内经·灵枢·通天（徐文兵）》详细笔记','5《黄帝内经·灵枢·天年（徐文兵）》详细笔记','4《黄帝内经·素问·异法方宜论（徐文兵）》详细笔记','3《黄帝内经·素问·金匮真言论（徐文兵）》详细笔记','2《黄帝内经·素问·四气调神大论（徐文兵）》详细笔记','1《黄帝内经·素问·上古天真论（徐文兵）》详细笔记','12《史记·孝武本纪》人物关系图、详细文章内容','11《史记·孝景本纪》人物关系图、详细文章内容','10《史记·孝文本纪》人物关系图、详细文章内容','9《史记·吕太后本纪》人物关系图、详细文章内容','8《史记·高祖本纪》人物关系图、详细文章内容','7《史记·项羽本纪》人物关系图、详细文章内容','6《史记·秦始皇本纪》人物关系图、详细文章内容','5《史记·秦本纪》人物关系图、详细文章内容',
  '4《史记·周本纪》人物关系图、详细文章内容','3《史记·殷本纪》人物关系图、详细文章内容','2《史记·夏本纪》人物关系图、详细文章内容','1《史记·五帝本纪》人物关系图、详细文章内容','10《飘》（乱世佳人）人物关系图、故事情节解析','9《约翰·克利斯朵夫》人物关系图、故事情节解析','9《约翰·克利斯朵夫》人物关系图、故事情节解析','8《安娜·卡列尼娜》人物关系图、故事情节解析','7《悲惨世界》人物关系图、故事情节解析','6《红与黑》人物关系图、故事情节解析','5《大卫·科波菲尔》人物关系图、故事情节解析','3《童年》人物关系图、故事情节解析','4《呼啸山庄》人物关系图、故事情节解析','2《巴黎圣母院》人物关系图、故事情节解析','1《战争与和平》人物关系图、故事情节解析','《基督山伯爵》人物关系、情节整理','《人性的枷锁》人物关系、情节整理','《哈姆雷特》人物关系图、情节整理','《哈姆雷特》人物关系图、情节整理','《人性的枷锁》人物关系、情节整理','《人性的枷锁》人物关系、情节整理','《哈姆雷特》人物关系图、情节整理','《基督山伯爵》人物关系、情节整理','结婚了'
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : entry.name.endsWith('.md') ? [full] : [];
  });
}

const compact = value => value.normalize('NFKC').replace(/[\s①②③④⑤⑥⑦⑧⑨⑩【】\[\]（）()《》·:：,，、?？!！“”"'‘’—–\-_.]/g, '').toLowerCase();
const bracketTexts = value => [...value.matchAll(/《([^》]+)》/g)].map(match => match[1]);
const genericKeys = new Set(['史记','汉书','后汉书','黄帝内经','徐文兵讲黄帝内经']);

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

const published = publishedTitles.map(title => ({ title, keys: keysFor(title) }));
const files = sourceDirs.flatMap(dir => walk(path.join(root, dir))).map(full => {
  const relative = path.relative(root, full).split(path.sep).join('/');
  const basename = path.basename(full, '.md');
  const content = fs.readFileSync(full, 'utf8');
  const firstLine = content.split(/\r?\n/).find(line => line.trim())?.trim() || basename;
  const firstHeading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const h1 = firstLine.startsWith('#') ? (firstHeading || basename) : firstLine;
  const keys = [...new Set([...keysFor(basename), ...keysFor(h1)])];
  const matches = published.filter(post => post.keys.some(key => keys.includes(key)));
  return { relative, title: h1, basename, keys, matches };
});

const publishedFiles = files.filter(file => file.matches.length);
const unpublishedFiles = files.filter(file => !file.matches.length);
const matchedPostTitles = new Set(publishedFiles.flatMap(file => file.matches.map(post => post.title)));
const unmatchedPosts = [...new Set(publishedTitles)].filter(title => !matchedPostTitles.has(title));
const duplicatePosts = [...new Map(publishedFiles
  .filter(file => file.matches.length > 1)
  .map(file => [file.relative, { file, titles: [...new Set(file.matches.map(post => post.title))] }])).values()];

function lineFor(file) {
  const label = file.title || file.basename.replace(/\.md$/, '');
  return `- [${label}](${encodeURI(file.relative)})`;
}

const generatedAt = '2026-08-13';
const report = [
  '# “彭丹的阅读之旅”公众号与博客文章对照表',
  '',
  `> 统计日期：${generatedAt}。公众号后台共 126 条发表记录；一条记录可能包含多篇文章。博客范围为 \`docs/read\` 与 \`docs/read-history\` 下的 Markdown 文件。`,
  '',
  '## 统计摘要',
  '',
  `- 博客 Markdown：${files.length} 篇`,
  `- 已匹配为发表过：${publishedFiles.length} 篇`,
  `- 未匹配为发表过：${unpublishedFiles.length} 篇`,
  `- 公众号标题（去重）：${new Set(publishedTitles).size} 个`,
  `- 公众号非博客或暂未匹配标题：${unmatchedPosts.length} 个`,
  '',
  '> 匹配规则：优先比较书名号内的书名；史记、汉书、后汉书按具体篇章名匹配；黄帝内经忽略编号与“徐文兵”后缀。相同书名对应多个博客文件时会同时标记，建议人工复核。',
  '',
  '## 已发表过的博客文章',
  '',
  ...publishedFiles.sort((a,b) => a.relative.localeCompare(b.relative,'zh-CN')).map(lineFor),
  '',
  '## 尚未发现发表记录的博客文章',
  '',
  ...unpublishedFiles.sort((a,b) => a.relative.localeCompare(b.relative,'zh-CN')).map(lineFor),
  '',
  '## 公众号重复发表或同一博客对应多条标题',
  '',
  ...duplicatePosts.flatMap(({file,titles}) => [
    `### ${file.basename}`,
    '',
    ...titles.map(title => `- ${title}`),
    ''
  ]),
  '## 公众号非博客文章或暂未匹配标题',
  '',
  ...unmatchedPosts.sort((a,b) => a.localeCompare(b,'zh-CN')).map(title => `- ${title}`),
  '',
  '## 原始公众号标题快照',
  '',
  ...[...new Set(publishedTitles)].map(title => `- ${title}`),
  ''
].join('\n');

fs.writeFileSync(path.join(root, '公众号发表对照-2026-08-13.md'), report);

console.log(JSON.stringify({
  blogFiles: files.length,
  published: publishedFiles.length,
  unpublished: unpublishedFiles.length,
  uniqueWechatTitles: new Set(publishedTitles).size,
  unmatchedWechatTitles: unmatchedPosts.length,
  duplicateBlogMatches: duplicatePosts.length
}, null, 2));
