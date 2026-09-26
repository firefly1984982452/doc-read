import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/js/archive-nav.js', import.meta.url), 'utf8');
const navbar = await fs.readFile(new URL('../_navbar.md', import.meta.url), 'utf8');

// Use the real Markdown destinations, with the same hash links Docsify renders.
function navbarHtml() {
  const rows = navbar.split('\n').map(line => line.match(/^( *)- \[([^\]]+)\]\(([^)]+)\)/)).filter(Boolean);
  let html = '<ul>', nested = false;
  for (const [, indent, label, path] of rows) {
    if (indent) {
      if (!nested) { html += '<ul>'; nested = true; }
      html += '<li><a href="' + (path.startsWith('/') ? '#' + path : path) + '">' + label + '</a></li>';
    } else {
      if (nested) { html += '</ul>'; nested = false; }
      if (html !== '<ul>') html += '</li>';
      html += '<li><a href="' + (path.startsWith('/') ? '#' + path : path) + '">' + label + '</a>';
    }
  }
  return html + (nested ? '</ul>' : '') + '</li></ul>';
}

function environment(t, { failYears = false } = {}) {
  const observers = new Map();
  let observerCalls = 0;
  class Element extends EventTarget {
    constructor(tagName, text = '') {
      super();
      this.tagName = tagName.toUpperCase();
      this.text = text;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      const classes = new Set();
      this.classList = {
        contains: name => classes.has(name),
        add: (...names) => names.forEach(name => classes.add(name)),
        toggle: (name, value) => value ? classes.add(name) : classes.delete(name)
      };
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
    appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) {
      if (selector.startsWith('.')) return selector.slice(1).split('.').every(name => this.classList.contains(name));
      return this.tagName === selector.toUpperCase();
    }
    closest(selector) {
      const parts = selector.split(' ');
      if (parts.length === 2) return this.matches(parts[1]) && this.parentElement?.closest(parts[0]) ? this : null;
      return this.matches(selector) ? this : this.parentElement?.closest(selector) || null;
    }
    querySelectorAll(selector) {
      const parts = selector.split(' ');
      const nodes = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
      if (selector === '*') return nodes;
      return nodes.filter(node => parts.length === 1 ? node.matches(selector) : node.matches(parts[1]) && node.parentElement?.closest(parts[0]));
    }
    querySelector(selector) {
      return selector.startsWith(':scope > ')
        ? this.children.find(node => node.matches(selector.slice(9))) || null
        : this.querySelectorAll(selector)[0] || null;
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
    matchMedia: query => ({ matches: query === '(hover: hover)' }),
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
  const oldTrigger = trigger(env.nav, '若华');

  env.window.location.hash = '#/docs/other/' + encodeURIComponent('若华日记') + '?id=某篇';
  env.nav.innerHTML = navbarHtml();
  await flush();

  assert.notEqual(trigger(env.nav, '若华'), oldTrigger, 'use the new DOM nodes');
  const menu = assertDropdown(env.nav, '若华');
  assertDropdown(env.nav, '年度归档');
  assert.deepEqual(menu.querySelectorAll('a').map(link => [link.textContent, link.getAttribute('href')]), [
    ['日记', '#/docs/other/若华日记.md'],
    ['阅读笔记', '#/docs/other/若华阅读笔记.md']
  ]);
  assert.equal(trigger(env.nav, '若华').classList.contains('active'), true);
  assert.equal(trigger(env.nav, '日记').getAttribute('aria-current'), 'page');
  assert.equal(trigger(env.nav, '阅读笔记').getAttribute('aria-current'), null);
  assert.equal(env.observerCalls, 1, 'rebinding does not observe its own descendant updates');
});

test('Ruohua dropdown remains usable when annual archive data fails', async t => {
  const env = environment(t, { failYears: true });
  await flush();
  assertDropdown(env.nav, '若华');
  env.nav.innerHTML = navbarHtml();
  await flush();
  assertDropdown(env.nav, '若华');
  assert.equal(env.observerCalls, 1);
});
