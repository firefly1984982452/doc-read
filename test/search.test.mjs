import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/js/search.js', import.meta.url), 'utf8');

function element() {
  const classes = new Set();
  const handlers = new Map();
  const attributes = new Map();
  return {
    value: '', hidden: false, innerHTML: '', isConnected: true,
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    addEventListener(name, callback) { handlers.set(name, callback); },
    fire(name, event = {}) { handlers.get(name)?.(event); },
    focus(options) { this.focusOptions = options; this.fire('focus'); },
    blur() { this.fire('blur'); },
    insertAdjacentHTML(position, html) { this.innerHTML += html; }
  };
}

function target(selector) {
  const node = element();
  node.closest = value => selector === value ? node : null;
  return node;
}

function mount(hash = '#/docs/read/笔记', { deferChunks = false } = {}) {
  const input = target('input');
  const clearButton = target('[data-search-clear]');
  const results = target('[data-search-results]');
  const container = target('.search');
  const elements = { input, '[data-search-clear]': clearButton, '[data-search-results]': results };
  container.querySelector = selector => elements[selector];
  container.contains = node => node === container || Object.values(elements).includes(node);
  const timers = new Map();
  const listeners = new Map();
  const events = [];
  const replacements = [];
  let timerId = 0;
  let clearCount = 0;
  let finishChunks;
  const pendingChunk = new Promise(resolve => { finishChunks = resolve; });
  const location = new URL('http://127.0.0.1:3000/?view=reading' + hash);
  const document = {
    body: { insertBefore(node) { node.parentElement = this; this.firstChild = node; } },
    documentElement: { style: { setProperty() {} } },
    querySelector: () => null,
    createElement: () => container,
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatchEvent(event) { events.push(event); }
  };
  const state = { reader: 'saved' };
  const window = {
    location, history: {
      state,
      replaceState(nextState, title, href) {
        replacements.push({ state: nextState, href });
        location.href = href;
      }
    },
    matchMedia: () => ({ matches: false }),
    addEventListener(name, callback) { listeners.set(name, callback); },
    DocReadResources: {
      json(path) {
        if (path.includes('search-index')) return Promise.resolve({
          chunkCount: 1, items: [{ title: 'Read 阅读', path: '/docs/read/目标', text: '' }]
        });
        return deferChunks ? pendingChunk : Promise.resolve([]);
      }
    },
    DocReadSearchHighlight: { highlightText: text => text, excerpt: text => text, clear() { clearCount++; } }
  };
  const setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  vm.runInNewContext(source, {
    document, window, URL, URLSearchParams, CustomEvent,
    setTimeout, clearTimeout: id => timers.delete(id)
  });
  function runTimers(delay) {
    for (const [id, timer] of [...timers]) {
      if (timer.delay === delay) { timers.delete(id); timer.callback(); }
    }
  }
  runTimers(300);
  return {
    input, clearButton, results, container, location, state, replacements, events, runTimers,
    clearCount: () => clearCount,
    finishChunks: () => finishChunks([]),
    navigate(hash) { location.hash = hash; listeners.get('hashchange')(); },
    type(value) { input.value = value; input.fire('input'); },
    click(node) { container.fire('click', { target: node }); }
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('result selection keeps the original keyword and closes only the result panel', async () => {
  const page = mount();
  page.type('ReAd 阅读');
  page.runTimers(180);
  await settle();
  assert.match(page.results.innerHTML, /search=ReAd%20%E9%98%85%E8%AF%BB/);
  const link = target('.matching-post');
  link.setAttribute('href', '#/docs/read/目标?search=ReAd%20阅读');
  page.click(link);
  assert.equal(page.input.value, 'ReAd 阅读');
  assert.equal(page.clearButton.hidden, false);
  assert.equal(page.results.hidden, true);
  assert.equal(page.clearCount(), 0);
  assert.equal(page.events.at(-1).type, 'doc-read:search-result');
});

test('the clear button removes only search state and late chunk responses cannot restore results', async () => {
  const page = mount('#/docs/read/笔记?id=episode-003&search=阅读&mode=focus', { deferChunks: true });
  assert.equal(page.input.value, '阅读');
  page.input.fire('focus');
  await settle();
  page.click(page.clearButton);
  assert.equal(page.input.value, '');
  assert.equal(page.clearButton.hidden, true);
  assert.equal(page.results.hidden, true);
  assert.equal(page.results.innerHTML, '');
  assert.equal(page.clearCount(), 1);
  assert.equal(page.location.hash, '#/docs/read/%E7%AC%94%E8%AE%B0?id=episode-003&mode=focus');
  assert.equal(page.location.search, '?view=reading');
  assert.equal(page.replacements[0].state, page.state);
  assert.equal(page.input.focusOptions.preventScroll, true);
  page.finishChunks();
  await settle();
  page.runTimers(80);
  assert.equal(page.results.hidden, true);
  assert.equal(page.results.innerHTML, '');
  assert.equal(page.container.classList.contains('is-loading'), false);
});

test('direct search links and subsequent search navigation restore the visible keyword', () => {
  const page = mount('#/docs/read/笔记?search=Read%20阅读');
  assert.equal(page.input.value, 'Read 阅读');
  page.navigate('#/docs/read/另一篇?search=作者');
  assert.equal(page.input.value, '作者');
  page.navigate('#/docs/read/另一篇?id=chapter-two');
  assert.equal(page.input.value, '作者', 'the last search stays visible until explicitly cleared');
  page.type('');
  assert.equal(page.clearButton.hidden, true);
  assert.equal(page.clearCount(), 1);
  assert.match(page.location.hash, /\?id=chapter-two$/);
});
