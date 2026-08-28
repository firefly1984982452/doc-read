import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadTitleCopy(overrides = {}) {
  const source = await fs.readFile(new URL('../assets/js/title-copy.js', import.meta.url), 'utf8');
  const document = {
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    ...overrides.document
  };
  const window = {
    addEventListener() {},
    clearTimeout() {},
    document,
    location: { hash: '#/' },
    navigator: overrides.navigator || {},
    setTimeout() { return 1; }
  };
  window.window = window;
  vm.runInNewContext(source, { window, Promise, Error, RegExp, String });
  return window.DocReadTitleCopy;
}

test('copyText writes the complete title through the Clipboard API', async () => {
  let copied = '';
  const api = await loadTitleCopy({
    navigator: { clipboard: { async writeText(value) { copied = value; } } }
  });
  const title = '范妮·弗拉格《油炸绿番茄》思维导图、人物关系图、电影对比、书摘、读后感';
  await api.copyText(title);
  assert.equal(copied, title);
});

test('copyText falls back to execCommand when the Clipboard API is unavailable', async () => {
  let selected = false;
  let removed = false;
  let command = '';
  const textarea = {
    style: {},
    setAttribute() {},
    select() { selected = true; },
    remove() { removed = true; }
  };
  const api = await loadTitleCopy({
    document: {
      body: { appendChild() {} },
      createElement() { return textarea; },
      execCommand(value) { command = value; return true; }
    }
  });
  await api.copyText('完整标题');
  assert.equal(textarea.value, '完整标题');
  assert.equal(selected, true);
  assert.equal(command, 'copy');
  assert.equal(removed, true);
});
