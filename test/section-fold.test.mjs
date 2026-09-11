import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../assets/js/section-fold.js', import.meta.url), 'utf8');

function element(tagName, textContent = '') {
  const classes = new Set();
  return {
    tagName, textContent, children: [], dataset: {}, attributes: {}, hidden: false,
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
    insertBefore(child) { this.children.unshift(child); },
    cloneNode() { return { textContent: this.textContent, querySelectorAll: () => [] }; }
  };
}

function mount(hash, stored, storageThrows = false) {
  const heading = element('H2', '2026-09-09《小巫女真美丽》阅读笔记-手绘漫画');
  const body = element('P', '原有正文');
  heading.nextElementSibling = body;
  const article = { children: [heading, body] };
  const document = { querySelector: () => article, createElement: element, addEventListener() {} };
  const window = {
    location: { hash }, matchMedia: () => ({ matches: true }),
    sessionStorage: {
      getItem() { if (storageThrows) throw Error('Unavailable'); return stored; },
      setItem(key, value) { stored = value; }
    },
    setTimeout() {}, clearTimeout() {}, addEventListener() {}
  };
  vm.runInNewContext(source, { window, document, URLSearchParams });
  return { heading, body, button: heading.children[0] };
}

test('Ruohua always starts collapsed, including encoded routes and previously expanded sections', () => {
  for (const hash of ['#/docs/other/若华阅读笔记', '#/docs/other/若华阅读笔记.md', '#/docs/other/' + encodeURIComponent('若华阅读笔记') + '?id=标题']) {
    for (const stored of [null, '0', '1']) {
      const { body, button } = mount(hash, stored);
      assert.equal(body.hidden, true);
      assert.equal(button.getAttribute('aria-expanded'), 'false');
    }
  }
});

test('Ruohua remains expandable and collapsible without changing body text', () => {
  const { body, button } = mount('#/docs/other/若华阅读笔记', null, true);
  const click = () => button.click({ preventDefault() {}, stopPropagation() {} });
  click();
  assert.equal(body.hidden, false);
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  click();
  assert.equal(body.hidden, true);
  assert.equal(body.textContent, '原有正文');
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
