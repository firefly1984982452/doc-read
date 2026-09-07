import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { coverMatches, draftKey, missingTextLines, fillDraftTitle, verifyDraftTitle, checkDraftInPlace } from '../scripts/lib/zhihu-draft.mjs';

test('title check stays in the existing editor with no navigation or refresh', async () => {
  const editor = { async $eval() { return '标题 | 副标题'; }, reload() { assert.fail('must not reload'); }, goto() { assert.fail('must not navigate'); } };
  assert.equal(await checkDraftInPlace(editor, '标题 | 副标题'), editor);
});

test('missing title leaves the editor open without automatic retry or navigation', async () => {
  const editor = { async $eval() { return ''; }, close() { assert.fail('must not close'); }, goto() { assert.fail('must not navigate'); } };
  await assert.rejects(checkDraftInPlace(editor, '标题'), /标题保存校验/);
});

test('Chinese title uses fill and verifies the input before proceeding', async () => {
  const calls = [];
  const page = {
    locator(selector) { assert.equal(selector, 'textarea'); return { async fill(value) { calls.push(value); } }; },
    keyboard: { async press(key) { assert.equal(key, 'Tab'); } },
    async waitForFunction(fn, options, expected) { assert.equal(expected, calls[0]); assert.equal(options.timeout, 15000); calls.push('verified'); }
  };
  await fillDraftTitle(page, '李尚龙《AI时代：弯道超车新思维》');
  assert.deepEqual(calls, ['李尚龙《AI时代：弯道超车新思维》', 'verified']);
});

test('a missing or changed saved title must never report success', () => {
  assert.throws(() => verifyDraftTitle('', '原标题'), /标题保存校验未通过/);
  assert.throws(() => verifyDraftTitle('别的标题', '原标题'), /标题保存校验未通过/);
  assert.doesNotThrow(() => verifyDraftTitle('原标题', '原标题'));
});

test('image alt text is not mistaken for lost body text, real missing text still fails', () => {
  const payload = { text: '正文\n思维导图\n未来不会被AI代替的12个技能\n另一条书摘', imageAlts: ['思维导图', '未来不会被AI代替的12个技能'] };
  assert.deepEqual(missingTextLines(payload, '正文\n\u200b\n另一条书摘'), []);
  assert.deepEqual(missingTextLines(payload, '正文'), ['另一条书摘']);
});

test('cover matching uses full book name, tolerates filename punctuation and returns ambiguity', () => {
  const title = '李尚龙《杠杆思维：AI时代给普通人的认知升级系统》思维导图、书摘、读后感';
  const a = '53-李尚龙-杠杆思维-AI时代给普通人的认知升级系统.png';
  assert.deepEqual(coverMatches(title, [a, 'AI时代.png', a.replace('.png', '.jpg')]), [a, a.replace('.png', '.jpg')]);
  assert.deepEqual(coverMatches(title, ['杠杆思维.txt', '杠杆思维.png']), []);
});

test('idempotency is scoped to both source path and exact source content', () => {
  assert.equal(draftKey('a', 'b'), draftKey('a', 'b'));
  assert.notEqual(draftKey('a', 'b'), draftKey('a', 'c'));
  assert.notEqual(draftKey('a', 'b'), draftKey('d', 'b'));
});

for (const protocol of ['file:', 'http:']) test(`Zhihu button uses ${protocol === 'file:' ? 'JSONP' : 'Fetch'} and restores state`, async () => {
  const listeners = {};
  const button = { dataset: {}, disabled: false, setAttribute() {}, removeAttribute() {}, addEventListener(name, fn) { listeners[name] = fn; } };
  const toast = { textContent: '', hidden: true };
  const requests = [];
  const location = { protocol, href: protocol === 'file:' ? 'file:///tmp/index.html#/docs/read/测试' : 'http://localhost:3000/#/docs/read/测试', hash: '#/docs/read/测试', origin: 'http://localhost:3000' };
  const document = {
    querySelector(selector) { if (selector === '.markdown-section h1') return { textContent: '测试' }; return null; },
    getElementById(id) { return id === 'zhihu-copy' ? button : id === 'wechat-copy-toast' ? toast : null; },
    addEventListener() {},
    createElement() { return { remove() {} }; },
    head: { appendChild(script) { const url = new URL(script.src); requests.push(url); queueMicrotask(() => window.DocReadXhsJsonp[url.searchParams.get('callback')]({ status: 'completed' })); } }
  };
  const window = { location, document, navigator: {}, addEventListener() {}, clearTimeout, setTimeout };
  const fetch = async (url, options) => { requests.push({ url, options }); return { json: async () => ({ status: 'completed' }) }; };
  vm.runInNewContext(await fs.readFile(new URL('../assets/js/wechat-copy.js', import.meta.url), 'utf8'), {window, document, location, URL, fetch, AbortController, setTimeout, clearTimeout, console});
  await listeners.click({});
  assert.equal(requests.length, 1);
  if (protocol === 'file:') {
    assert.equal(requests[0].pathname, '/__doc_read/zhihu/file/jobs');
    assert.equal(requests[0].searchParams.get('path'), 'docs/read/测试.md');
  } else {
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(JSON.parse(requests[0].options.body).path, 'docs/read/测试.md');
  }
  assert.equal(button.disabled, false);
  assert.match(toast.textContent, /未发布/);
});
