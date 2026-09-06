import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/js/random-reading.js', import.meta.url), 'utf8');
const bookMetadata = JSON.parse(await fs.readFile(new URL('../assets/data/book-metadata.json', import.meta.url), 'utf8'));

function fakeButton() {
  return {
    attributes: new Map([['aria-label', '随机一篇内容']]),
    dataset: { tooltip: '随机一篇内容' },
    disabled: false,
    addEventListener(type, listener) { if (type === 'click') this.click = listener; },
    getAttribute(name) { return this.attributes.get(name) || null; },
    removeAttribute(name) { this.attributes.delete(name); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
  };
}

function loadRandomReading({ books, currentHash, random = () => 0, reject = false }) {
  const button = fakeButton();
  const toast = { dataset: {}, hidden: true, textContent: '' };
  const progress = { style: { transform: 'scaleX(0.65)' } };
  const location = { hash: currentHash };
  const listeners = new Map();
  const scrollCalls = [];
  const math = Object.create(Math);
  math.random = random;
  const document = {
    addEventListener(type, listener, options = {}) {
      const entries = listeners.get(type) || [];
      entries.push({ listener, once: Boolean(options.once) });
      listeners.set(type, entries);
    },
    dispatchEvent(event) {
      const entries = [...(listeners.get(event.type) || [])];
      entries.forEach(({ listener, once }) => {
        listener(event);
        if (once) this.removeEventListener(event.type, listener);
      });
    },
    removeEventListener(type, listener) {
      const entries = listeners.get(type) || [];
      listeners.set(type, entries.filter((entry) => entry.listener !== listener));
    },
    getElementById(id) {
      return {
        'random-reading': button,
        'reading-progress': progress,
        'wechat-copy-toast': toast
      }[id] || null;
    }
  };
  const window = {
    clearTimeout() {},
    document,
    DocReadResources: {
      json(relative) {
        assert.equal(relative, 'assets/data/book-metadata.json');
        return reject ? Promise.reject(new Error('offline')) : Promise.resolve(books);
      }
    },
    location,
    scrollTo(options, top) {
      scrollCalls.push(typeof options === 'object'
        ? [options.left, options.top, options.behavior]
        : [options, top, 'auto']);
    },
    setTimeout(callback) { callback(); }
  };
  window.window = window;
  vm.runInNewContext(source, { window, Map, Array, String, Math: math, Promise, Error, decodeURIComponent });
  return { api: window.DocReadRandomReading, button, document, location, progress, scrollCalls, toast, window };
}

test('random reading uses generated book metadata and avoids the current article', async () => {
  const ui = loadRandomReading({
    currentHash: '#/docs/read/%E5%BD%93%E5%89%8D',
    books: [
      { path: '/docs/read/当前' },
      { path: '/docs/read/下一篇' },
      { path: '/docs/think/about' }
    ]
  });

  const selected = await ui.button.click();
  assert.equal(selected.path, '/docs/read/下一篇');
  assert.equal(ui.location.hash, '#/docs/read/下一篇');
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.button.getAttribute('aria-label'), '随机一篇内容');
});

test('random reading clears progress immediately and scrolls only after the target article renders', async () => {
  const ui = loadRandomReading({
    currentHash: '#/docs/read/当前',
    books: [
      { path: '/docs/read/当前' },
      { path: '/docs/read/下一篇' }
    ]
  });

  await ui.button.click();
  assert.deepEqual(ui.scrollCalls, []);
  assert.equal(ui.progress.style.transform, 'scaleX(0)');

  ui.window.DOC_READ_PAGE_SOURCE = { path: 'docs/read/当前.md' };
  ui.progress.style.transform = 'scaleX(0.4)';
  ui.document.dispatchEvent({ type: 'doc-read:rendered' });
  assert.deepEqual(ui.scrollCalls, []);
  assert.equal(ui.progress.style.transform, 'scaleX(0.4)');

  ui.window.DOC_READ_PAGE_SOURCE = { path: 'docs/read/下一篇.md' };
  ui.document.dispatchEvent({ type: 'doc-read:rendered' });
  assert.deepEqual(ui.scrollCalls, [[0, 0, 'instant']]);
  assert.equal(ui.progress.style.transform, 'scaleX(0)');

  ui.document.dispatchEvent({ type: 'doc-read:rendered' });
  assert.deepEqual(ui.scrollCalls, [[0, 0, 'instant']]);
});

test('random reading includes historical notes and uses the supplied random position', () => {
  const ui = loadRandomReading({ books: [], currentHash: '#/' });
  const candidates = ui.api.readingBooks([
    { path: '/docs/read/甲' },
    { path: '/docs/read-history/史记/乙.md' },
    { path: '/docs/library' }
  ], '#/docs/read/别篇');

  assert.equal(candidates.length, 2);
  assert.equal(ui.api.choose(candidates, () => 0.99).path, '/docs/read-history/史记/乙.md');
  assert.equal(ui.api.routeFor(candidates[1]), '#/docs/read-history/史记/乙');
});

test('random reading excludes maintenance reports from the generated metadata pool', () => {
  const ui = loadRandomReading({ books: [], currentHash: '#/docs/read/当前' });
  const candidates = ui.api.readingBooks(bookMetadata, '#/docs/read/当前');

  assert.ok(candidates.length > 0);
  assert.equal(candidates.some((item) => item.path === '/docs/read/错别字校对报告'), false);
});

test('random reading reports a recoverable loading error', async () => {
  const ui = loadRandomReading({ books: [], currentHash: '#/docs/read/当前', reject: true });
  assert.equal(await ui.button.click(), null);
  assert.match(ui.toast.textContent, /随机文章读取失败/);
  assert.equal(ui.toast.dataset.state, 'error');
  assert.equal(ui.button.disabled, false);
});
