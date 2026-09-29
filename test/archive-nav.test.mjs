import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/js/archive-nav.js', import.meta.url), 'utf8');
const navbar = await fs.readFile(new URL('../_navbar.md', import.meta.url), 'utf8');
const libraryMarkdown = await fs.readFile(new URL('../docs/library.md', import.meta.url), 'utf8');

// Use the real Markdown destinations, with the same hash links Docsify renders.
function navbarHtml() {
  const rows = navbar.split('\n').map(line => line.match(/^( *)- \[([^\]]+)\]\(([^)]+)\)/)).filter(Boolean);
  const root = { indent: -1, children: [] };
  const stack = [root];
  for (const [, indent, label, path] of rows) {
    while (stack.at(-1).indent >= indent.length) stack.pop();
    const item = { indent: indent.length, label, path, children: [] };
    stack.at(-1).children.push(item);
    stack.push(item);
  }
  const render = items => '<ul>' + items.map(item => '<li><a href="' +
    (item.path.startsWith('/') ? '#' + item.path : item.path) + '">' + item.label + '</a>' +
    (item.children.length ? render(item.children) : '') + '</li>').join('') + '</ul>';
  return render(root.children);
}

function environment(t, { failYears = false, touch = false } = {}) {
  const observers = new Map();
  let observerCalls = 0;
  class Element {
    constructor(tagName, text = '') {
      this.tagName = tagName.toUpperCase();
      this.text = text;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.listeners = new Map();
      const classes = new Set();
      this.classList = {
        contains: name => classes.has(name),
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        toggle: (name, value) => value ? classes.add(name) : classes.delete(name)
      };
    }
    addEventListener(type, listener) {
      this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    }
    dispatchEvent(event) {
      if (!event.target) Object.defineProperty(event, 'target', { value: this });
      Object.defineProperty(event, 'currentTarget', { value: this, configurable: true });
      for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
      if (event.bubbles && !event.cancelBubble && this.parentElement) this.parentElement.dispatchEvent(event);
      return !event.defaultPrevented;
    }
    focus() {
      if (document.activeElement === this) return;
      const previous = document.activeElement;
      document.activeElement = this;
      if (previous) previous.dispatchEvent(eventOf('focusout', { relatedTarget: this }));
      this.dispatchEvent(eventOf('focusin', { relatedTarget: previous }));
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
    set textContent(value) { this.text = String(value); this.children = []; }
    get parentNode() { return this.parentElement; }
    getBoundingClientRect() { return { left: 430, right: 600, width: 170, top: 50, bottom: 86, height: 36 }; }
    appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector, scope) {
      const tokens = selector.replace(/\s*>\s*/g, ' > ').trim().split(/\s+/);
      const simple = (node, part) => {
        if (part === '*') return true;
        if (part === ':scope') return node === scope;
        const tag = part.match(/^[\w-]+/);
        if (tag && node.tagName !== tag[0].toUpperCase()) return false;
        if (![...part.matchAll(/\.([\w-]+)/g)].every(([, name]) => node.classList.contains(name))) return false;
        return [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, name, value]) =>
          value === undefined ? node.getAttribute(name) !== null : node.getAttribute(name) === value);
      };
      const match = (node, index) => {
        if (!node || !simple(node, tokens[index])) return false;
        if (!index) return true;
        if (tokens[index - 1] === '>') return match(node.parentElement, index - 2);
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          if (match(parent, index - 1)) return true;
        }
        return false;
      };
      return match(this, tokens.length - 1);
    }
    closest(selector) {
      return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
    }
    querySelectorAll(selector) {
      const nodes = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
      if (selector === '*') return nodes;
      return nodes.filter(node => node.matches(selector, this));
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    set innerHTML(html) {
      this.children = [];
      const stack = [this];
      for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith('</')) { stack.pop(); continue; }
        if (token.startsWith('<')) {
          const node = new Element(token.match(/^<(\w+)/)[1]);
          for (const [, name, value] of token.matchAll(/([\w-]+)="([^"]*)"/g)) {
            if (name === 'class') node.classList.add(...value.split(' '));
            else node.setAttribute(name, value);
          }
          stack.at(-1).appendChild(node);
          stack.push(node);
        } else stack.at(-1).text += token;
      }
      // A root childList replacement, without a page-rendered event, reproduces
      // Docsify's late navbar replacement. Descendant mutations do not notify it.
      for (const callback of observers.get(this) || []) queueMicrotask(() => {
        observerCalls++;
        callback([{ type: 'childList', target: this }]);
      });
    }
  }
  const document = new Element('document');
  document.activeElement = null;
  document.getElementById = id => document.querySelectorAll('*').find(node => node.id === id) || null;
  document.createElement = tag => new Element(tag);
  const nav = document.appendChild(new Element('nav'));
  nav.classList.add('app-nav');
  nav.innerHTML = navbarHtml();
  const window = {
    location: { hash: '#/docs/library' },
    innerWidth: touch ? 390 : 1280,
    addEventListener() {},
    matchMedia: query => ({ matches: query === '(hover: hover)' ? !touch : touch }),
    DocReadResources: { json: async () => {
      if (failYears) throw new Error('Unavailable');
      return [2025, 2026];
    } }
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe(node, options) {
      assert.equal(options.childList, true);
      assert.notEqual(options.subtree, true, 'navbar descendants must not trigger a mount loop');
      observers.set(node, [...(observers.get(node) || []), this.callback]);
    }
  }
  vm.runInNewContext(source, { window, document, MutationObserver, setTimeout() {} });
  t.after(() => observers.clear());
  document.dispatchEvent(new Event('doc-read:rendered'));
  return { nav, document, window, get observerCalls() { return observerCalls; } };
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); }
function eventOf(type, properties = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, properties);
  return event;
}
function click(element) {
  assert.ok(element, 'clicked element exists');
  element.focus();
  const event = eventOf('click');
  element.dispatchEvent(event);
  return event;
}
function trigger(nav, label) { return nav.querySelectorAll('a').find(link => link.textContent === label); }
function assertDropdown(nav, label) {
  const link = trigger(nav, label);
  assert.equal(link.getAttribute('aria-haspopup'), 'true');
  assert.equal(link.getAttribute('aria-expanded'), 'false');
  const item = link.closest('li');
  const menu = item.querySelector(':scope > ul');
  assert.equal(link.getAttribute('aria-controls'), menu.id);
  item.dispatchEvent(new Event('pointerenter'));
  assert.equal(link.getAttribute('aria-expanded'), 'true', label + ' opens on hover');
  item.dispatchEvent(new Event('pointerleave'));
  assert.equal(link.getAttribute('aria-expanded'), 'false', label + ' closes when the pointer leaves');
  return menu;
}

test('dropdowns rebind after Docsify replaces the navbar after the rendered event', async t => {
  const env = environment(t);
  await flush();
  assertDropdown(env.nav, '若华');
  assertDropdown(env.nav, '年度归档');
  assertDropdown(env.nav, '全部书目');
  const oldTrigger = trigger(env.nav, '若华');

  env.window.location.hash = '#/docs/other/' + encodeURIComponent('若华日记') + '?id=某篇';
  env.nav.innerHTML = navbarHtml();
  await flush();

  assert.notEqual(trigger(env.nav, '若华'), oldTrigger, 'use the new DOM nodes');
  const menu = assertDropdown(env.nav, '若华');
  assertDropdown(env.nav, '年度归档');
  assertDropdown(env.nav, '全部书目');
  assertDropdown(env.nav, '古文典籍');
  assert.deepEqual(menu.querySelectorAll('a').map(link => [link.textContent, link.getAttribute('href')]), [
    ['日记', '#/docs/other/若华日记.md'],
    ['阅读笔记', '#/docs/other/若华阅读笔记.md']
  ]);
  assert.equal(trigger(env.nav, '若华').classList.contains('active'), true);
  assert.equal(trigger(env.nav, '日记').getAttribute('aria-current'), 'page');
  assert.equal(trigger(env.nav, '阅读笔记').getAttribute('aria-current'), null);
  assert.equal(env.observerCalls, 1, 'rebinding does not observe its own descendant updates');
});

test('static dropdowns remain usable when annual archive data fails', async t => {
  const env = environment(t, { failYears: true });
  await flush();
  assertDropdown(env.nav, '若华');
  assertDropdown(env.nav, '全部书目');
  env.nav.innerHTML = navbarHtml();
  await flush();
  assertDropdown(env.nav, '若华');
  assertDropdown(env.nav, '全部书目');
  assert.equal(env.observerCalls, 1);
});

test('library categories retain their nested destinations and bind hover at both levels', async t => {
  const env = environment(t);
  await flush();
  const library = trigger(env.nav, '全部书目');
  const category = trigger(env.nav, '古文典籍');
  const leaf = trigger(env.nav, '《黄帝内经》');
  assert.equal(category.parentElement.parentElement.parentElement, library.parentElement);
  assert.equal(leaf.parentElement.parentElement.parentElement, category.parentElement);
  assert.equal(leaf.getAttribute('href'), '#/docs/library.md?id=《黄帝内经》');

  library.closest('li').dispatchEvent(new Event('pointerenter'));
  category.closest('li').dispatchEvent(new Event('pointerenter'));
  assert.equal(library.getAttribute('aria-expanded'), 'true');
  assert.equal(category.getAttribute('aria-expanded'), 'true');
  assert.equal(category.getAttribute('aria-controls'), leaf.parentElement.parentElement.id);
  library.closest('li').dispatchEvent(new Event('pointerleave'));
  assert.equal(library.getAttribute('aria-expanded'), 'false');
  assert.equal(category.getAttribute('aria-expanded'), 'false', 'closing a root also closes its nested menu');
});

test('book category links preserve title brackets in actual library heading anchors', async t => {
  const env = environment(t);
  await flush();
  const headings = [...libraryMarkdown.matchAll(/^### (.+)$/gm)].map(([, title]) => title.trim());
  for (const title of ['《黄帝内经》', '《庄子》']) {
    const link = trigger(env.nav, title);
    const target = new URL(link.getAttribute('href').slice(1), 'http://doc-read.test');
    const anchor = target.searchParams.get('id');
    assert.equal(anchor, title, 'Docsify keeps Chinese title brackets in these heading IDs');
    assert.ok(headings.includes(anchor), 'anchor points to an existing library H3');

    env.window.location.hash = '#/docs/library?id=' + encodeURIComponent(anchor);
    env.document.dispatchEvent(new Event('doc-read:rendered'));
    await flush();
    assert.equal(link.getAttribute('aria-current'), 'page', 'encoded anchor selects the corresponding menu entry');
    assert.equal(trigger(env.nav, '全部书目').classList.contains('active'), true);
  }
});

test('touch category toggles keep the ancestor open, while leaf navigation closes every open level', async t => {
  const env = environment(t, { touch: true });
  await flush();
  const library = trigger(env.nav, '全部书目');
  const category = trigger(env.nav, '古文典籍');
  const leaf = trigger(env.nav, '《黄帝内经》');

  assert.equal(click(library).defaultPrevented, true);
  assert.equal(click(category).defaultPrevented, true);
  assert.equal(category.getAttribute('aria-expanded'), 'true');
  assert.equal(library.getAttribute('aria-expanded'), 'true', 'a category click must not close its ancestor');
  click(category);
  assert.equal(category.getAttribute('aria-expanded'), 'false');
  assert.equal(library.getAttribute('aria-expanded'), 'true');
  click(category);
  assert.equal(click(leaf).defaultPrevented, false, 'leaf links still navigate');
  assert.equal(library.getAttribute('aria-expanded'), 'false');
  assert.equal(category.getAttribute('aria-expanded'), 'false');
});

test('Escape closes only the focused submenu, then the root on a second press', async t => {
  const env = environment(t, { touch: true });
  await flush();
  const library = trigger(env.nav, '全部书目');
  const category = trigger(env.nav, '古文典籍');
  const leaf = trigger(env.nav, '《黄帝内经》');
  click(library);
  click(category);
  leaf.focus();
  leaf.dispatchEvent(eventOf('keydown', { key: 'Escape' }));
  assert.equal(category.getAttribute('aria-expanded'), 'false');
  assert.equal(library.getAttribute('aria-expanded'), 'true');
  assert.equal(env.document.activeElement, category);
  category.dispatchEvent(eventOf('keydown', { key: 'Escape' }));
  assert.equal(library.getAttribute('aria-expanded'), 'false');
  assert.equal(env.document.activeElement, library);
});

test('arrow keys enter a nested submenu and return to its parent without closing the root', async t => {
  const env = environment(t);
  await flush();
  const library = trigger(env.nav, '全部书目');
  const category = trigger(env.nav, '古文典籍');
  const leaf = trigger(env.nav, '《黄帝内经》');
  library.focus();
  library.dispatchEvent(eventOf('keydown', { key: 'ArrowDown' }));
  assert.equal(env.document.activeElement, category);
  category.dispatchEvent(eventOf('keydown', { key: 'ArrowRight' }));
  assert.equal(env.document.activeElement, leaf);
  assert.equal(category.getAttribute('aria-expanded'), 'true');
  leaf.dispatchEvent(eventOf('keydown', { key: 'ArrowLeft' }));
  assert.equal(env.document.activeElement, category);
  assert.equal(category.getAttribute('aria-expanded'), 'false');
  assert.equal(library.getAttribute('aria-expanded'), 'true');
});

test('Ruohua and annual archive touch navigation still toggles and follows leaf links', async t => {
  const env = environment(t, { touch: true });
  await flush();
  for (const [label, leafLabel] of [['若华', '日记'], ['年度归档', '2026']]) {
    const parent = trigger(env.nav, label);
    assert.equal(click(parent).defaultPrevented, true);
    assert.equal(parent.getAttribute('aria-expanded'), 'true');
    assert.equal(click(trigger(env.nav, leafLabel)).defaultPrevented, false);
    assert.equal(parent.getAttribute('aria-expanded'), 'false');
  }
});
