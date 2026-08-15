import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { typoRules } from '../scripts/lib/typo-rules.mjs';

function fakeElement(attributes = {}) {
  const values = new Map(Object.entries(attributes));
  const listeners = new Map();
  const classes = new Set();
  return {
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        if (force === undefined ? !classes.has(name) : force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    },
    dataset: {},
    disabled: false,
    hidden: true,
    innerHTML: '',
    open: false,
    showModalCalls: 0,
    textContent: '',
    addEventListener(type, listener) { listeners.set(type, listener); },
    click() { return listeners.get('click')?.(); },
    close() {
      this.open = false;
      listeners.get('close')?.();
    },
    focus() {},
    getAttribute(name) { return values.get(name) || null; },
    removeAttribute(name) { values.delete(name); },
    setAttribute(name, value) { values.set(name, String(value)); },
    showModal() {
      this.open = true;
      this.showModalCalls += 1;
    }
  };
}

async function loadTypoChecker({ markdown, sourceError } = {}) {
  const source = await fs.readFile(new URL('../assets/js/typo-checker.js', import.meta.url), 'utf8');
  const elements = {
    'reading-tools': fakeElement(),
    'typo-check': fakeElement({ 'aria-label': '检测错别字' }),
    'typo-dialog': fakeElement(),
    'typo-dialog-summary': fakeElement(),
    'typo-results': fakeElement(),
    'typo-edit-note': fakeElement(),
    'typo-dismiss': fakeElement(),
    'typo-apply': fakeElement(),
    'wechat-copy-toast': fakeElement()
  };
  const document = {
    addEventListener() {},
    getElementById(id) { return elements[id] || null; },
    querySelector() { return null; }
  };
  const window = {
    DOC_READ_PAGE_SOURCE: sourceError ? null : { path: 'docs/read/test.md', markdown: markdown || '' },
    DOC_READ_TYPO_RULES: typoRules.map(rule => ({ ...rule })),
    DocReadResources: {
      json() { return Promise.resolve(typoRules); },
      text() { return Promise.reject(sourceError || new Error('missing source')); }
    },
    addEventListener() {},
    clearTimeout() {},
    location: { hash: '#/docs/read/test', hostname: 'notes.example', protocol: 'https:' },
    setTimeout() { return 1; }
  };
  window.window = window;
  window.document = document;
  vm.runInNewContext(source, {
    window,
    document,
    URL,
    AbortController,
    Array,
    Boolean,
    Error,
    Map,
    Object,
    Promise,
    RegExp,
    Set,
    String
  });
  return {
    button: elements['typo-check'],
    dialog: elements['typo-dialog'],
    results: elements['typo-results'],
    summary: elements['typo-dialog-summary'],
    toast: elements['wechat-copy-toast']
  };
}

async function flushInspection() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('clean result uses a toast and never opens the dialog', async () => {
  const ui = await loadTypoChecker({ markdown: '这是一段没有命中规则的正文。' });
  ui.button.click();
  assert.equal(ui.dialog.showModalCalls, 0);
  await flushInspection();
  assert.equal(ui.dialog.showModalCalls, 0);
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.toast.hidden, false);
  assert.match(ui.toast.textContent, /暂未发现/);
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.button.getAttribute('aria-busy'), null);
});

test('issues open the dialog only after inspection finishes', async () => {
  const ui = await loadTypoChecker({ markdown: '这件事即然开始了。' });
  ui.button.click();
  assert.equal(ui.dialog.showModalCalls, 0);
  await flushInspection();
  assert.equal(ui.dialog.showModalCalls, 1);
  assert.equal(ui.dialog.open, true);
  assert.match(ui.summary.textContent, /发现 1 处/);
  assert.match(ui.results.innerHTML, /即然/);
  assert.match(ui.results.innerHTML, /既然/);
  assert.equal(ui.toast.hidden, true);
});

test('inspection failure uses an error toast instead of the dialog', async () => {
  const ui = await loadTypoChecker({ sourceError: new Error('读取失败') });
  ui.button.click();
  await flushInspection();
  assert.equal(ui.dialog.showModalCalls, 0);
  assert.equal(ui.toast.dataset.state, 'error');
  assert.match(ui.toast.textContent, /检测没有完成/);
});
