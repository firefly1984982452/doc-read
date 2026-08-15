import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function createLoader(overrides = {}) {
  const source = await fs.readFile(new URL('../assets/js/resource-loader.js', import.meta.url), 'utf8');
  const window = {
    DOC_READ_BUILD: 'test-build',
    location: { href: 'https://example.test/doc-read/#/' },
    setTimeout(callback) { callback(); },
    ...overrides
  };
  window.window = window;
  vm.runInNewContext(source, { window, URL, Map, Number, Math, Promise, Error });
  return window;
}

test('JSON resources retry transient failures and cache the successful result', async () => {
  let attempts = 0;
  const window = await createLoader({
    fetch: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('temporary network failure');
      return { ok: true, json: async () => ({ ready: true }) };
    },
    document: { createElement() {}, head: { appendChild() {} } }
  });
  const first = await window.DocReadResources.json('assets/data/example.json');
  const second = await window.DocReadResources.json('assets/data/example.json');
  assert.equal(attempts, 3);
  assert.deepEqual(first, { ready: true });
  assert.equal(second, first);
});

test('dynamic scripts retry failed elements before resolving', async () => {
  let attempts = 0;
  const document = {
    createElement() {
      return { remove() {} };
    },
    head: {
      appendChild(element) {
        attempts += 1;
        if (attempts < 3) element.onerror();
        else element.onload();
      }
    }
  };
  const window = await createLoader({ fetch: async () => ({ ok: true }), document });
  await window.DocReadResources.script('assets/js/example.js');
  assert.equal(attempts, 3);
});

test('a terminal failure is evicted so a later user action can try again', async () => {
  let attempts = 0;
  let available = false;
  const window = await createLoader({
    fetch: async () => {
      attempts += 1;
      if (!available) throw new Error('offline');
      return { ok: true, json: async () => ({ recovered: true }) };
    },
    document: { createElement() {}, head: { appendChild() {} } }
  });
  await assert.rejects(window.DocReadResources.json('assets/data/recover.json', { attempts: 1 }), /offline/);
  available = true;
  assert.deepEqual(await window.DocReadResources.json('assets/data/recover.json', { attempts: 1 }), { recovered: true });
  assert.equal(attempts, 2);
});

test('text resources use the same retry and cache behavior', async () => {
  let attempts = 0;
  const window = await createLoader({
    fetch: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary');
      return { ok: true, text: async () => '# Markdown' };
    },
    document: { createElement() {}, head: { appendChild() {} } }
  });
  assert.equal(await window.DocReadResources.text('docs/read/example.md'), '# Markdown');
  assert.equal(await window.DocReadResources.text('docs/read/example.md'), '# Markdown');
  assert.equal(attempts, 2);
});
