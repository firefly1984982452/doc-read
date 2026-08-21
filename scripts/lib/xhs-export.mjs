const BOOK_TITLE = /《([^》]{1,80})》/;

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

export function articleHeadings(markdown, limit = 6) {
  return String(markdown || '')
    .split(/\r?\n/)
    .map(line => line.match(/^#{2,4}\s+(.+?)\s*$/)?.[1])
    .filter(Boolean)
    .map(cleanInlineMarkdown)
    .filter(Boolean)
    .slice(0, limit);
}

function articleParagraphs(markdown, limit = 3) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map(block => block
      .split(/\r?\n/)
      .filter(line => !/^\s*(?:#{1,6}|[-*+]\s|\d+[.)]\s|>|!\[|date\s*:|---)/i.test(line))
      .join(' '))
    .map(cleanInlineMarkdown)
    .filter(text => text.length >= 24)
    .slice(0, limit);
}

function truncate(value, max) {
  const chars = Array.from(String(value || ''));
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
}

function bookLabel(title) {
  const match = String(title || '').match(BOOK_TITLE);
  return match ? `《${match[1]}》` : truncate(title, 18);
}

function classify(title, headings, markdown) {
  const source = [title, ...headings, String(markdown).slice(0, 2400)].join(' ');
  if (/心理|习惯|方法|学习|思维|沟通|成长|效率|认知|自控|关系/.test(source)) {
    return { type: '方法与心理', palette: 'macaron', accent: '薰衣草紫、珊瑚粉、暖米白', strategy: 'information-dense' };
  }
  if (/历史|史记|春秋|战国|王朝|红楼|古诗|庄子|黄帝内经|哲学|经典/.test(source)) {
    return { type: '历史与经典', palette: 'blue-gold', accent: '深靛蓝、旧金、宣纸米白', strategy: 'story-driven' };
  }
  if (/悬疑|犯罪|死亡|孤独|悲剧|战争|复仇|人性/.test(source)) {
    return { type: '文学与人性', palette: 'crimson-navy', accent: '酒红、深海军蓝、奶油白', strategy: 'story-driven' };
  }
  return { type: '文学阅读', palette: 'purple-paper', accent: '主题紫、墨蓝、暖纸白', strategy: 'story-driven' };
}

function copyText({ title, headings, paragraphs, classification }) {
  const book = bookLabel(title);
  const highlights = headings.length
    ? headings.slice(0, 4).map((heading, index) => `${index + 1}. ${heading}`).join('\n')
    : '1. 书里最打动我的观点\n2. 阅读过程中反复思考的问题\n3. 读完后真正留下来的改变';
  const opening = paragraphs[0]
    ? truncate(paragraphs[0], 118)
    : `最近读完${book}，把书里最值得反复回看的部分整理成了这篇笔记。`;
  return [
    `【标题备选 1】读完${book}，我记住了这几件事`,
    `【标题备选 2】${book}｜一篇读透的阅读笔记`,
    '',
    `最近读完${book}。`,
    '',
    opening,
    '',
    '这篇笔记主要整理了：',
    highlights,
    '',
    '它不是标准答案，只是我在这个阅读阶段留下的一次诚实记录。也想知道，你读这本书时最难忘的是哪一部分？',
    '',
    `#读书 #阅读笔记 #书评 #${classification.type.replace(/与/g, '')} #彭丹的阅读之旅`
  ].join('\n');
}

function commonPrompt({ title, book, subtitle, classification }) {
  return [
    '用途：小红书竖版读书博客封面，比例 3:4。',
    `主题：${title}`,
    `主标题（必须逐字准确、醒目且只出现一次）：“${book}”`,
    `副标题（必须逐字准确）：“${subtitle}”`,
    `内容类型：${classification.type}。`,
    '构图要求：上方和中心保留清晰文字安全区；缩略图状态仍能读懂主标题；不要模拟真实出版社封面，不要出现人物照片或品牌商标。',
    '中文排版要求：简体中文，字形完整，不要错字、乱码、拼音或重复文字；主标题最多两行。',
    'Include the exact, fully legible watermark “彭丹的阅读之旅” positioned at the bottom-right, approximately 25% opacity. The watermark should be subtle and must not overlap the title or main illustration.'
  ].join('\n');
}

function sketchPrompt(context) {
  return [
    '---',
    'preset: sketch-summary',
    'style: sketch-notes',
    'layout: sparse',
    'palette: macaron',
    'aspect_ratio: 3:4',
    '---',
    commonPrompt(context),
    '',
    '视觉风格：高收藏率手绘读书笔记封面，暖米色纸张底，紫色与柔和马卡龙色点缀，细腻铅笔线、便签、高亮笔与书页元素。',
    '视觉中心：打开的书、两三枚与主题相关的手绘符号和自然留白；信息层级像精心整理的读书手账，但封面仍保持 sparse。',
    '标题使用清晰有力的中文手写黑体，副标题像荧光笔标记；不要做幼儿插画，不要塞满小字。'
  ].join('\n');
}

export function buildXhsMaterials(markdown, fallbackTitle = '阅读笔记') {
  const title = extractArticleTitle(markdown, fallbackTitle);
  const headings = articleHeadings(markdown);
  const paragraphs = articleParagraphs(markdown);
  const classification = classify(title, headings, markdown);
  const book = bookLabel(title);
  const subtitle = '阅读笔记';
  const context = { title, book, subtitle, classification };
  const copy = copyText({ title, headings, paragraphs, classification });
  const analysis = [
    '# 小红书内容分析',
    '',
    `- 主题：${title}`,
    `- 内容类型：${classification.type}`,
    '- 目标读者：喜欢阅读、书评与个人成长内容的小红书用户',
    `- 核心钩子：用“${book} + 阅读笔记”在缩略图阶段说清内容`,
    `- 文章要点：${headings.length ? headings.join('；') : '书籍信息；核心观点；读后感'}`,
    '- 互动触发：邀请读者分享最难忘的章节或观点',
    '- 视觉机会：用书页、纸张与主题象征物建立单一视觉锚点，不复制真实书封',
    '- 输出策略：生成一张手绘笔记风封面',
    '- 画幅：3:4 竖屏',
    '- 水印：“彭丹的阅读之旅”，约 25% 透明度，默认右下',
    ''
  ].join('\n');
  const outline = [
    '---',
    `strategy: ${classification.strategy}`,
    'name: 手绘笔记风封面',
    'style: sketch-notes',
    'default_layout: sparse',
    'image_count: 1',
    `generated: ${new Date().toISOString()}`,
    '---',
    '',
    '# 封面方案',
    '',
    '## 01 手绘笔记风',
    '- Position: cover',
    '- Layout: sparse',
    `- Hook: ${book}`,
    '- Filename: 封面/01-手绘笔记风.png',
    `- Text Content: ${book} / ${subtitle}`,
    '- Visual Concept: 暖纸、手绘书页、马卡龙标注',
    ''
  ].join('\n');
  return {
    title,
    copy,
    analysis,
    outline,
    prompts: [
      { filename: '01-cover-sketch.md', output: '01-手绘笔记风.png', style: '手绘笔记风', content: sketchPrompt(context) }
    ]
  };
}
