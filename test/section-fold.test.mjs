import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/js/section-fold.js', import.meta.url), 'utf8');

function element(tagName, textContent = '') {
  const classes = new Set();
  return {
    tagName: tagName.toUpperCase(), textContent, children: [], dataset: {}, attributes: {}, hidden: false,
    classList: {
      contains: name => classes.has(name),
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name]; },
    addEventListener(name, callback) { this[name] = callback; },
    querySelector() { return this.children.find(child => child.className === 'section-fold-toggle'); },
    contains(target) { return this === target || this.children.some(child => child.contains(target)); },
    insertBefore(child) { setChildren(this, [child, ...this.children]); },
    cloneNode() { return { textContent: this.textContent, querySelectorAll: () => [] }; }
  };
}

function setChildren(parent, children) {
  parent.children = children;
  children.forEach((child, index) => {
    child.parentElement = parent;
    child.previousElementSibling = children[index - 1] || null;
    child.nextElementSibling = children[index + 1] || null;
  });
}

function mount(hash, stored, storageThrows = false, { reduceMotion = true, deferArticle = false } = {}) {
  const heading = element('H2', '2026-09-09《小巫女真美丽》阅读笔记-手绘漫画');
  heading.id = 'first-section';
  const body = element('P', '原有正文');
  const inline = element('SPAN', '搜索结果');
  const match = element('MARK', '结果');
  match.id = 'search-match';
  setChildren(inline, [match]);
  setChildren(body, [inline]);
  const secondHeading = element('H2', '另一个区块');
  secondHeading.id = 'second-section';
  const secondBody = element('P', '另一个区块正文');
  const article = element('ARTICLE');
  setChildren(article, [heading, body, secondHeading, secondBody]);
  const events = [];
  const storageWrites = [];
  const timers = new Map();
  const animationFrames = [];
  let timerId = 0;
  let articleAvailable = !deferArticle;
  const document = {
    querySelector: () => articleAvailable ? article : null,
    createElement: element,
    addEventListener() {},
    dispatchEvent(event) { events.push(event); },
    getElementById: id => [heading, match, secondHeading].find(node => node.id === id)
  };
  const window = {
    location: { hash }, matchMedia: () => ({ matches: reduceMotion }),
    sessionStorage: {
      getItem() { if (storageThrows) throw Error('Unavailable'); return stored; },
      setItem(key, value) {
        if (storageThrows) throw Error('Unavailable');
        storageWrites.push({ key, value });
        stored = value;
      }
    },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(callback) { animationFrames.push(callback); },
    addEventListener() {}
  };
  class CustomEvent {
    constructor(type) { this.type = type; }
  }
  vm.runInNewContext(source, { window, document, URLSearchParams, CustomEvent });
  return {
    heading, body, match, secondHeading, secondBody, article, window, events, storageWrites, animationFrames,
    button: heading.children[0],
    showArticle() { articleAvailable = true; },
    runTimers(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === delay) {
          timers.delete(id);
          timer.callback();
        }
      }
    }
  };
}

test('compact reading pages always start collapsed, including encoded routes and previously expanded sections', () => {
  const routes = ['docs/other/若华阅读笔记', 'docs/other/若华日记', 'docs/read-history/《中国通史》纪录片学习笔记'].flatMap(path => [
    '#/' + path,
    '#/' + path + '.md',
    '#/' + encodeURI(path) + '?id=标题'
  ]);
  for (const hash of routes) {
    for (const stored of [null, '0', '1']) {
      const { body, button } = mount(hash, stored);
      assert.equal(body.hidden, true);
      assert.equal(button.getAttribute('aria-expanded'), 'false');
    }
  }
});

test('Ruohua remains expandable and collapsible without changing body text', () => {
  for (const name of ['若华阅读笔记', '若华日记']) {
    const { body, button } = mount('#/docs/other/' + name, null, true);
    const click = () => button.click({ preventDefault() {}, stopPropagation() {} });
    click();
    assert.equal(body.hidden, false);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    click();
    assert.equal(body.hidden, true);
    assert.equal(body.textContent, '原有正文');
  }
});

test('other pages keep their existing default and remembered folding state', () => {
  for (const hash of ['#/docs/read/普通笔记', '#/docs/other/若华阅读笔记备份', '#/%E0%A4']) {
    for (const stored of [null, '0', '1']) {
      assert.equal(mount(hash, stored).body.hidden, stored === '1');
    }
  }
  assert.equal(mount('#/docs/read/普通笔记', null, true).body.hidden, false);
  assert.equal(mount('#/', null).button, undefined);
});

test('search reveal opens the section containing a nested match without changing other sections or saved preferences', () => {
  const page = mount('#/docs/read/普通笔记', '1', false, { reduceMotion: false });
  assert.equal(page.body.hidden, true);
  page.window.DocReadSectionFold.reveal(page.match);
  assert.equal(page.body.hidden, false);
  assert.equal(page.button.getAttribute('aria-expanded'), 'true');
  assert.equal(page.body.classList.contains('is-fold-entering'), false);
  assert.equal(page.secondBody.hidden, true);
  assert.equal(page.secondHeading.children[0].getAttribute('aria-expanded'), 'false');
  assert.deepEqual(page.storageWrites, []);
  assert.equal(page.animationFrames.length, 0);
  assert.equal(page.events.length, 1, 'reveal must not recursively emit sections-ready');
});

test('search reveal mounts newly rendered headings and supports a match in a heading', () => {
  const page = mount('#/docs/read/普通笔记', '1', false, { deferArticle: true });
  assert.equal(page.button, undefined);
  const headingMatch = element('MARK', '另一个区块');
  setChildren(page.secondHeading, [headingMatch]);
  page.showArticle();
  page.window.DocReadSectionFold.reveal(headingMatch);
  assert.equal(page.heading.children[0].getAttribute('aria-expanded'), 'false');
  assert.equal(page.body.hidden, true);
  assert.equal(page.secondHeading.children[0].getAttribute('aria-expanded'), 'true');
  assert.equal(page.secondBody.hidden, false);
  assert.deepEqual(page.storageWrites, []);
});

test('search reveal ignores targets outside the article and the home page', () => {
  const page = mount('#/docs/read/普通笔记', '1');
  page.window.DocReadSectionFold.reveal(element('MARK', '外部结果'));
  page.window.DocReadSectionFold.reveal(null);
  assert.equal(page.body.hidden, true);
  assert.equal(page.secondBody.hidden, true);
  const home = mount('#/', '1');
  home.window.DocReadSectionFold.reveal(home.match);
  assert.equal(home.heading.children.length, 0);
  assert.equal(home.events.length, 0);
});

test('search reveal cancels a pending collapse while ordinary clicks still persist state', () => {
  const page = mount('#/docs/read/普通笔记', '0', false, { reduceMotion: false });
  page.button.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(page.button.getAttribute('aria-expanded'), 'false');
  assert.equal(page.body.classList.contains('is-fold-leaving'), true);
  assert.deepEqual(page.storageWrites, [{ key: 'doc-read:fold:#/docs/read/普通笔记:first-section', value: '1' }]);
  page.window.DocReadSectionFold.reveal(page.match);
  page.runTimers(150);
  assert.equal(page.body.hidden, false);
  assert.equal(page.body.classList.contains('is-fold-leaving'), false);
  assert.equal(page.storageWrites.length, 1);
});

test('mount exposes readiness after attaching buttons and remains idempotent', () => {
  const page = mount('#/docs/read/普通笔记', '1');
  assert.equal(page.events[0].type, 'doc-read:sections-ready');
  assert.equal(page.secondHeading.children[0].getAttribute('aria-expanded'), 'false');
  page.window.DocReadSectionFold.mount();
  assert.equal(page.heading.children.length, 1);
  assert.equal(page.secondHeading.children.length, 1);
  assert.equal(page.events.length, 2);
  assert.equal(page.events[1].type, 'doc-read:sections-ready');
});

test('existing anchor reveal keeps its animated, persisted behavior for nested targets', () => {
  const page = mount('#/docs/read/普通笔记?id=search-match', '1', false, { reduceMotion: false });
  page.runTimers(0);
  assert.equal(page.body.hidden, false);
  assert.equal(page.body.classList.contains('is-fold-entering'), true);
  assert.equal(page.secondBody.hidden, true);
  assert.deepEqual(page.storageWrites, [{ key: 'doc-read:fold:#/docs/read/普通笔记:first-section', value: '0' }]);
});
