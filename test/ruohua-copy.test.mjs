import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/js/ruohua-copy.js', import.meta.url), 'utf8');
function load(hash) {
  const window = { location: { hash }, document: { addEventListener() {}, querySelector() { return null; } } };
  vm.runInNewContext(source, { window });
  return window.DocReadRuohuaCopy;
}
function element(tagName, ...children) {
  return { tagName, classList: { contains() { return false; } }, childNodes: children.map(child =>
    typeof child === 'string' ? { nodeType: 3, textContent: child } : child) };
}
function siblings(...nodes) {
  nodes.forEach((node, index) => { node.nextElementSibling = nodes[index + 1] || null; });
  return nodes[0];
}

test('copy controls are limited to the exact Ruohua route, including encoded links and anchors', () => {
  for (const route of ['#/docs/other/若华阅读笔记', '#/docs/other/若华阅读笔记.md?id=一', '#/docs/other/' + encodeURIComponent('若华阅读笔记')]) {
    assert.equal(load(route).isTarget(), true);
  }
  for (const route of ['#/', '#/docs/read/若华阅读笔记', '#/docs/other/其他', '#/docs/other/若华阅读笔记备份', '#/%E0%A4']) {
    assert.equal(load(route).isTarget(), false);
  }
});

test('copy includes the selected title, date and folded body, excluding controls and following notes', () => {
  const heading = element('H2', element('BUTTON', '折叠'), element('A', '《耳朵里的城市》阅读笔记'), element('BUTTON', '复制'));
  const body = element('P', '第一行', element('BR'), '第二行');
  body.hidden = true;
  siblings(heading, element('P', '阅读时间：2026年9月6日'), body, element('HR'), element('H2', '下一篇'), element('P', '不复制'));
  assert.equal(load('#/').sectionText(heading), '《耳朵里的城市》阅读笔记\n\n阅读时间：2026年9月6日\n\n第一行\n第二行');
});

test('copy retains subheadings and list line breaks but excludes Docsify pagination', () => {
  const heading = element('H2', '本篇');
  const footer = element('DIV', '上一篇 下一篇');
  footer.classList.contains = name => name === 'docsify-pagination-container';
  siblings(heading, element('H3', '感想'), element('UL', element('LI', '第一条'), element('LI', '第二条')), footer);
  assert.equal(load('#/').sectionText(heading), '本篇\n\n感想\n\n第一条\n第二条');
});

test('Ruohua body lines copy with two Chinese spaces without indenting headings, dates or link rows', () => {
  const heading = element('H2', '本篇');
  const body = element('P', '第一行\n\u3000\u3000第二行');
  body.classList.contains = name => name === 'ruohua-body-paragraph';
  siblings(heading, element('P', '阅读时间：2026年9月6日'), element('P', element('A', '手绘漫画链接')), body);
  assert.equal(load('#/').sectionText(heading), '本篇\n\n阅读时间：2026年9月6日\n\n手绘漫画链接\n\n\u3000\u3000第一行\n\u3000\u3000第二行');
});
