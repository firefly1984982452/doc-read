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
    matches(selector) {
      if (selector.startsWith('.')) return classes.has(selector.slice(1)) || (this.className || '').split(/\s+/).includes(selector.slice(1));
      return this.tagName === selector.toUpperCase();
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
      if (selector === '*') return descendants;
      return descendants.filter(child => selector.split(',').some(part => child.matches(part.trim())));
    },
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

function mount(hash, stored, storageThrows = false, { reduceMotion = true, deferArticle = false, children = null } = {}) {
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
  setChildren(article, children || [heading, body, secondHeading, secondBody]);
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
    getElementById: id => article.querySelectorAll('*').find(node => node.id === id)
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

function nestedPage({ hash = '#/docs/read/分层笔记', stored = null, reduceMotion = true } = {}) {
  const nodes = {};
  for (const [name, tag, text] of [
    ['parent', 'H2', '梗概'], ['intro', 'P', '总述'],
    ['part', 'H3', '第一部分'], ['chapter', 'H4', '第一章'],
    ['body', 'P', '第一章正文'], ['detail', 'H5', '细节'], ['detailBody', 'P', '细节正文'],
    ['nextChapter', 'H4', '第二章'], ['nextBody', 'P', '第二章正文'],
    ['nextPart', 'H3', '第二部分'], ['nextPartBody', 'P', '第二部分正文'],
    ['following', 'H2', '书摘'], ['followingBody', 'P', '书摘正文'],
    ['end', 'H1', '下一篇'], ['endBody', 'P', '下一篇正文']
  ]) {
    nodes[name] = element(tag, text);
    nodes[name].id = name;
  }
  const match = element('MARK', '搜索命中');
  match.id = 'nested-match';
  setChildren(nodes.body, [match]);
  const page = mount(hash, stored, false, { reduceMotion, children: Object.values(nodes) });
  return { ...page, nodes, match, button: name => nodes[name].querySelector('.section-fold-toggle') };
}

function click(button) {
  assert.ok(button, 'the section has a folding control');
  button.click({ preventDefault() {}, stopPropagation() {} });
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
  assert.equal(home.body.hidden, false);
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

test('H3 and H4 start expanded even under a remembered or default-collapsed H2', () => {
  for (const hash of ['#/docs/read/分层笔记', '#/docs/other/若华日记', '#/docs/read-history/《中国通史》纪录片学习笔记']) {
    const page = nestedPage({ hash, stored: '1' });
    assert.equal(page.button('parent').getAttribute('aria-expanded'), 'false');
    for (const name of ['part', 'chapter', 'nextChapter', 'nextPart']) {
      assert.equal(page.button(name).getAttribute('aria-expanded'), 'true', name + ' ignores remembered H2 defaults');
      assert.ok(page.button(name).className.split(/\s+/).includes('section-fold-toggle-compact'));
    }
    assert.equal(page.nodes.body.hidden, true, 'expanded child controls do not unhide a collapsed ancestor');
    click(page.button('parent'));
    assert.equal(page.nodes.body.hidden, false);
    assert.equal(page.nodes.nextPartBody.hidden, false);
  }
});

test('nested folding stops at peer headings and preserves child choices through parent toggles', () => {
  const page = nestedPage();
  const { nodes } = page;
  click(page.button('chapter'));
  assert.equal(nodes.chapter.hidden, false);
  assert.equal(nodes.body.hidden, true);
  assert.equal(nodes.detail.hidden, true, 'an H5 belongs to the preceding H4');
  assert.equal(nodes.detailBody.hidden, true);
  assert.equal(nodes.nextChapter.hidden, false);
  assert.equal(nodes.nextBody.hidden, false);

  click(page.button('part'));
  assert.equal(nodes.chapter.hidden, true);
  assert.equal(nodes.nextChapter.hidden, true);
  assert.equal(nodes.nextBody.hidden, true);
  assert.equal(nodes.nextPart.hidden, false, 'a sibling H3 stays visible');
  assert.equal(nodes.nextPartBody.hidden, false);
  click(page.button('part'));
  assert.equal(nodes.chapter.hidden, false);
  assert.equal(nodes.body.hidden, true, 'expanding H3 preserves an explicitly folded H4');
  assert.equal(nodes.nextBody.hidden, false);

  click(page.button('parent'));
  assert.equal(nodes.nextPart.hidden, true);
  assert.equal(nodes.following.hidden, false, 'a sibling H2 stays visible');
  assert.equal(nodes.followingBody.hidden, false);
  assert.equal(nodes.end.hidden, false, 'a later H1 starts a new section');
  click(page.button('parent'));
  assert.equal(nodes.body.hidden, true, 'expanding H2 also preserves the folded H4');
  assert.equal(nodes.nextBody.hidden, false);
  click(page.button('chapter'));
  assert.equal(nodes.body.hidden, false);
  assert.equal(nodes.detail.hidden, false);
  assert.equal(nodes.detailBody.hidden, false);
});

test('compact controls ignore storage, preserve choices on remount, and reset for a freshly rendered page', () => {
  const page = nestedPage();
  click(page.button('chapter'));
  click(page.button('part'));
  assert.deepEqual(page.storageWrites, [], 'H3/H4 choices are not persisted into a new render');
  page.window.DocReadSectionFold.mount();
  page.window.DocReadSectionFold.mount();
  assert.equal(page.nodes.body.hidden, true);
  assert.equal(page.button('part').getAttribute('aria-expanded'), 'false');
  for (const name of ['parent', 'part', 'chapter', 'nextChapter', 'nextPart', 'following']) {
    assert.equal(page.nodes[name].querySelectorAll('.section-fold-toggle').length, 1);
  }
  const fresh = nestedPage();
  assert.equal(fresh.nodes.body.hidden, false);
  assert.equal(fresh.button('chapter').getAttribute('aria-expanded'), 'true');
  assert.equal(fresh.button('part').getAttribute('aria-expanded'), 'true');
});

test('search reveal opens every containing level without expanding unrelated siblings or saving preferences', () => {
  const page = nestedPage({ reduceMotion: false });
  for (const name of ['chapter', 'nextChapter', 'part', 'parent']) click(page.button(name));
  const savedBeforeReveal = [...page.storageWrites];
  page.window.DocReadSectionFold.reveal(page.match);
  page.runTimers(150);
  for (const name of ['parent', 'part', 'chapter']) {
    assert.equal(page.button(name).getAttribute('aria-expanded'), 'true', name + ' is revealed');
  }
  assert.equal(page.nodes.body.hidden, false);
  assert.equal(page.nodes.body.classList.contains('is-fold-leaving'), false);
  assert.equal(page.nodes.body.classList.contains('is-fold-entering'), false);
  assert.equal(page.button('nextChapter').getAttribute('aria-expanded'), 'false');
  assert.equal(page.nodes.nextBody.hidden, true, 'unrelated sibling remains folded');
  assert.deepEqual(page.storageWrites, savedBeforeReveal);
});

test('anchor navigation reveals both a folded heading and its ancestors', () => {
  const page = nestedPage({ reduceMotion: false });
  for (const name of ['chapter', 'nextChapter', 'part', 'parent']) click(page.button(name));
  page.window.location.hash += '?id=chapter';
  page.window.DocReadSectionFold.mount();
  page.runTimers(0);
  page.runTimers(150);
  for (const name of ['parent', 'part', 'chapter']) {
    assert.equal(page.button(name).getAttribute('aria-expanded'), 'true');
  }
  assert.equal(page.nodes.chapter.hidden, false);
  assert.equal(page.nodes.body.hidden, false);
  assert.equal(page.nodes.nextBody.hidden, true);
  assert.equal(page.storageWrites.at(-1).value, '0', 'revealing the H2 anchor keeps its remembered behavior');
  assert.ok(page.storageWrites.every(write => write.key.endsWith(':parent')), 'compact levels never write a saved state');
});

test('pending child and parent animations cannot expose a collapsed descendant', () => {
  const page = nestedPage({ reduceMotion: false });
  click(page.button('chapter'));
  click(page.button('part'));
  click(page.button('part'));
  page.runTimers(150);
  assert.equal(page.nodes.chapter.hidden, false);
  assert.equal(page.nodes.body.hidden, true);
  assert.equal(page.nodes.nextBody.hidden, false);

  click(page.button('parent'));
  click(page.button('chapter'));
  page.runTimers(150);
  assert.equal(page.button('chapter').getAttribute('aria-expanded'), 'true');
  assert.equal(page.nodes.body.hidden, true, 'opening a child cannot reveal content hidden by its parent');
  click(page.button('parent'));
  page.animationFrames.forEach(callback => callback());
  page.runTimers(150);
  assert.equal(page.nodes.body.hidden, false);
  assert.equal(page.nodes.body.classList.contains('is-fold-leaving'), false);
});

test('skipped heading levels and the home page use the same section boundaries', () => {
  for (const hash of ['#/', '#/docs/library']) {
    const parent = element('H2', '总标题');
    const chapter = element('H4', '跳级章节');
    const body = element('P', '章节正文');
    const peer = element('H3', '后续分组');
    const peerBody = element('P', '后续正文');
    const page = mount(hash, null, false, { children: [parent, chapter, body, peer, peerBody] });
    assert.equal(Boolean(parent.querySelector('.section-fold-toggle')), hash !== '#/');
    assert.equal(chapter.querySelector('.section-fold-toggle').getAttribute('aria-expanded'), 'true');
    assert.equal(peer.querySelector('.section-fold-toggle').getAttribute('aria-expanded'), 'true');
    click(chapter.querySelector('.section-fold-toggle'));
    assert.equal(body.hidden, true);
    assert.equal(peer.hidden, false);
    assert.equal(peerBody.hidden, false);
    page.window.DocReadSectionFold.reveal(body);
    assert.equal(body.hidden, false, 'search reveal also works for a compact control on the home page');
  }
});
