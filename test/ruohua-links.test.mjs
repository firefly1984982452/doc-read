import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const config = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => script.includes('window.$docsify ='));
function renderSource(hash, markdown) {
  const window = { location: { hash } };
  vm.runInNewContext(config, { window });
  let transform;
  window.$docsify.plugins[0]({ beforeEach(fn) { transform = fn; }, doneEach() {} });
  return { rendered: transform(markdown), original: window.DOC_READ_PAGE_SOURCE.markdown };
}

test('Ruohua hides empty comic link rows while preserving the original Markdown source', () => {
  const markdown = '## 标题\n\n[手绘漫画链接]()\n\n正文\n\n [手绘漫画链接](  ) \n';
  const result = renderSource('#/docs/other/' + encodeURIComponent('若华阅读笔记') + '.md?id=标题', markdown);
  assert.equal(result.rendered.includes('手绘漫画链接'), false);
  assert.equal(result.rendered.includes('正文'), true);
  assert.equal(result.original, markdown);
});

test('Ruohua retains filled comic links and unrelated content', () => {
  const markdown = '[手绘漫画链接](https://example.com/comic)\n\n[其他链接]()\n\n正文提到[手绘漫画链接]()示例';
  assert.equal(renderSource('#/docs/other/若华阅读笔记', markdown).rendered, markdown);
});

test('empty comic links on other pages are unchanged', () => {
  const markdown = '[手绘漫画链接]()\n';
  assert.equal(renderSource('#/docs/read/其他笔记', markdown).rendered, markdown);
});
