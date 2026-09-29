import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/js/history-reading-stats.js', import.meta.url), 'utf8');
const window = {};
vm.runInNewContext(source, { window });
const api = window.DocReadHistoryStats;

function element(tag, children = [], className = '') {
  return {
    nodeType: 1, tagName: tag.toUpperCase(), hidden: false,
    childNodes: children.map(child => typeof child === 'string' ? { nodeType: 3, nodeValue: child } : child),
    matches(selectors) {
      return selectors.split(', ').some(selector => selector[0] === '.'
        ? className.split(' ').includes(selector.slice(1))
        : selector.toUpperCase() === this.tagName);
    }
  };
}

test('reading notes, diaries and essays are eligible, including encoded and anchored routes', () => {
  for (const path of ['docs/read-history/《中国通史》纪录片学习笔记', 'docs/read-history/1-《史记》/《史记·十二本纪·1五帝本纪》', 'docs/read/普通笔记', 'docs/other/若华阅读笔记', 'docs/other/若华日记', 'docs/think/think']) {
    for (const route of ['#/' + path, '#/' + path + '.md', '#/' + encodeURI(path) + '?id=chapter-1']) {
      assert.equal(api.isArticle(route), true, route);
    }
  }
  for (const route of ['#/', '#/docs/library', '#/docs/years/2026', '#/docs/latest', '#/docs/catalog', '#/docs/think/update', '#/docs/think/about', '#/docs/read/', '#/%E0%A4']) {
    assert.equal(api.isArticle(route), false, route);
  }
});

test('Chinese characters, English words and numbers are counted without punctuation or URL destinations', () => {
  assert.equal(api.countWords('中国历史，English words 2023。'), 7);
  assert.equal(api.countWords('康熙 Emperor Kangxi 1662–1722 https://example.org/history/123?x=42'), 6);
  assert.equal(api.countWords('𠮷，甲！'), 2);
  assert.equal(api.countWords('  \n —— …，。https://example.org/ '), 0);
  assert.equal(api.readingMinutes(0), 0);
  assert.equal(api.readingMinutes(400), 1);
  assert.equal(api.readingMinutes(401), 2);
});

test('folded text and inline emphasis count once while title, metadata, captions and controls are excluded', () => {
  const collapsed = element('p', ['忽必', element('strong', ['烈']), '称帝。']);
  collapsed.hidden = true;
  const article = element('article', [
    element('h1', ['文章标题']),
    element('div', ['复制标题'], 'article-title-row'),
    element('p', ['date: 2023-11-10', element('span', ['总字数：999字'], 'history-reading-stats')], 'reading-date'),
    element('p', ['总字数：999字'], 'article-reading-meta'),
    element('p', [element('span', ['图片说明'], 'reading-image-caption')]),
    element('figure', [element('figcaption', ['额外图片说明'])]),
    element('h2', ['元朝', element('button', ['展开全部'])]),
    collapsed,
    element('p', [element('a', ['史料来源'])]),
    element('div', ['上一篇下一篇'], 'docsify-pagination-container'),
    element('script', ['不计入']),
    { nodeType: 8, nodeValue: '来源注释' }
  ]);
  assert.equal(api.countWords(api.bodyText(article)), 11);
  const before = api.bodyText(article);
  collapsed.hidden = false;
  assert.equal(api.bodyText(article), before);
});

test('inline formatting preserves English word boundaries and separate paragraphs stay separate', () => {
  assert.equal(api.countWords(api.bodyText(element('article', [
    element('p', ['Em', element('strong', ['peror'])]),
    element('p', ['Kangxi'])
  ]))), 2);
});
