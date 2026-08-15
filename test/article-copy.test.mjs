import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadCopy(overrides = {}) {
  const source = await fs.readFile(new URL('../assets/js/wechat-copy.js', import.meta.url), 'utf8');
  const document = {
    querySelector(selector) {
      if (selector === 'link[rel="canonical"]') return { href: 'https://notes.example/doc-read/' };
      return null;
    },
    getElementById() { return null; },
    addEventListener() {},
    ...overrides.document
  };
  const navigator = overrides.navigator || {};
  const window = {
    location: {
      href: 'file:///Users/test/doc-read/index.html#/docs/read/test',
      hash: '#/docs/read/test',
      ...overrides.location
    },
    navigator,
    Blob,
    ClipboardItem: overrides.ClipboardItem,
    addEventListener() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    ...overrides.window
  };
  window.window = window;
  window.document = document;
  vm.runInNewContext(source, {
    window,
    document,
    navigator,
    URL,
    Blob,
    Array,
    Object,
    String,
    Boolean,
    RegExp,
    Promise,
    Error
  });
  return { api: window.DocReadArticleCopy, document, window };
}

function mutableElement(tagName, initialAttributes = {}, childNodes = []) {
  const attributes = new Map(Object.entries(initialAttributes));
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    childNodes,
    style: {},
    get attributes() {
      return Array.from(attributes, ([name, value]) => ({ name, value }));
    },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); }
  };
}

function textNode(value) {
  return { nodeType: 3, nodeValue: value };
}

test('public URLs replace local routes, anchors and assets with canonical URLs', async () => {
  const { api } = await loadCopy();
  assert.equal(
    api.publicUrl('/docs/read/《测试》.md'),
    'https://notes.example/doc-read/index.html#/docs/read/《测试》'
  );
  assert.equal(
    api.publicUrl('#章节一'),
    'https://notes.example/doc-read/index.html#/docs/read/test?id=章节一'
  );
  assert.equal(api.publicUrl('#/'), 'https://notes.example/doc-read/index.html#/');
  assert.equal(
    decodeURI(api.publicUrl('http://localhost:3000/#/docs/read/《测试》')),
    'https://notes.example/doc-read/index.html#/docs/read/《测试》'
  );
  assert.equal(
    api.publicAssetUrl('file:///Users/test/doc-read/assets/images/cover.png'),
    'https://notes.example/doc-read/assets/images/cover.png'
  );
  assert.equal(api.publicAssetUrl('https://cdn.example/cover.png'), 'https://cdn.example/cover.png');
});

test('plain text keeps useful block, list and table boundaries', async () => {
  const { api } = await loadCopy();
  const article = mutableElement('article', {}, [
    mutableElement('h1', {}, [textNode('标题')]),
    mutableElement('p', {}, [textNode('第一段')]),
    mutableElement('ul', {}, [
      mutableElement('li', {}, [textNode('甲')]),
      mutableElement('li', {}, [textNode('乙')])
    ]),
    mutableElement('table', {}, [
      mutableElement('tr', {}, [
        mutableElement('th', {}, [textNode('书名')]),
        mutableElement('th', {}, [textNode('作者')])
      ])
    ])
  ]);
  assert.equal(api.articlePlainText(article), '标题\n\n第一段\n\n- 甲\n- 乙\n\n书名\t作者');
});

test('Zhihu payload is semantic and strips page-only attributes and local URLs', async () => {
  const { api } = await loadCopy();
  const link = mutableElement('a', {
    href: '/docs/read/《测试》.md',
    rel: 'noopener',
    target: '_blank',
    style: 'color:red',
    class: 'external'
  });
  const image = mutableElement('img', {
    src: 'file:///Users/test/doc-read/assets/images/cover.png',
    'data-origin': 'cover.png',
    style: 'width:1200px'
  });
  image.src = 'file:///Users/test/doc-read/assets/images/cover.png';
  const dirty = mutableElement('p', { id: 'intro', class: 'lead', style: 'text-indent:2em', onclick: 'bad()' }, [textNode('正文')]);
  const article = mutableElement('article', { id: 'main', class: 'markdown-section', style: 'color:red' }, [dirty]);
  article.cloneNode = () => article;
  article.querySelectorAll = selector => ({
    '.section-fold-item[hidden]': [],
    '.countable, .docsify-copy-code-button, .pagination-item, script, style, button, noscript': [],
    'a.anchor': [],
    a: [link],
    img: [image],
    '*': [link, image, dirty]
  }[selector] || []);
  Object.defineProperty(article, 'outerHTML', {
    get() {
      const attributes = article.attributes.map(attribute => ` ${attribute.name}="${attribute.value}"`).join('');
      return `<article${attributes}><p>正文</p></article>`;
    }
  });

  const payload = api.buildZhihuPayload({ cloneNode: () => article });
  assert.equal(payload.html, '<article><p>正文</p></article>');
  assert.equal(payload.text, '正文');
  assert.equal(link.getAttribute('href'), 'https://notes.example/doc-read/index.html#/docs/read/《测试》');
  assert.equal(link.getAttribute('target'), null);
  assert.equal(link.getAttribute('style'), null);
  assert.equal(image.getAttribute('src'), 'https://notes.example/doc-read/assets/images/cover.png');
  assert.equal(image.getAttribute('style'), null);
  assert.equal(dirty.getAttribute('onclick'), null);
});

test('Clipboard API writes both HTML and plain text MIME values', async () => {
  let clipboardItems;
  class TestClipboardItem {
    constructor(values) { this.values = values; }
  }
  const { api } = await loadCopy({
    ClipboardItem: TestClipboardItem,
    navigator: {
      clipboard: {
        async write(items) { clipboardItems = items; }
      }
    }
  });

  await api.writeClipboard('<article><p>正文</p></article>', '正文');
  assert.equal(clipboardItems.length, 1);
  assert.equal(await clipboardItems[0].values['text/html'].text(), '<article><p>正文</p></article>');
  assert.equal(await clipboardItems[0].values['text/plain'].text(), '正文');
});

test('rejected Clipboard API falls back to execCommand and restores selection', async () => {
  const copied = new Map();
  let copyListener;
  let removed = false;
  let restoredFocus = false;
  const originalRange = { cloneRange() { return this; } };
  const ranges = [originalRange];
  const selection = {
    get rangeCount() { return ranges.length; },
    getRangeAt(index) { return ranges[index]; },
    removeAllRanges() { ranges.length = 0; },
    addRange(range) { ranges.push(range); }
  };
  const body = {
    appendChild(holder) { holder.parentNode = body; },
    removeChild(holder) { holder.parentNode = null; removed = true; }
  };
  const holder = {
    style: {},
    parentNode: null,
    setAttribute() {},
    addEventListener(type, listener) { if (type === 'copy') copyListener = listener; },
    focus() {}
  };
  class TestClipboardItem {
    constructor(values) { this.values = values; }
  }
  const { api } = await loadCopy({
    ClipboardItem: TestClipboardItem,
    navigator: { clipboard: { async write() { throw new Error('denied'); } } },
    window: { getSelection: () => selection },
    document: {
      body,
      activeElement: { focus() { restoredFocus = true; } },
      createElement: () => holder,
      createRange: () => ({ selectNodeContents() {} }),
      execCommand(command) {
        assert.equal(command, 'copy');
        copyListener({
          clipboardData: { setData(type, value) { copied.set(type, value); } },
          preventDefault() {}
        });
        return true;
      }
    }
  });

  await api.writeClipboard('<article>正文</article>', '正文');
  assert.equal(copied.get('text/html'), '<article>正文</article>');
  assert.equal(copied.get('text/plain'), '正文');
  assert.equal(removed, true);
  assert.equal(restoredFocus, true);
  assert.deepEqual(ranges, [originalRange]);
});

test('missing rendered article reports an error without mutating either icon button', async () => {
  function button() {
    return {
      dataset: {},
      disabled: false,
      hidden: true,
      addEventListener(type, listener) { if (type === 'click') this.click = listener; },
      setAttribute() {},
      removeAttribute() {}
    };
  }
  const wechat = button();
  const zhihu = button();
  const tools = { hidden: true };
  const toast = { dataset: {}, hidden: true, textContent: '' };
  await loadCopy({
    document: {
      querySelector(selector) {
        if (selector === 'link[rel="canonical"]') return { href: 'https://notes.example/doc-read/' };
        return null;
      },
      getElementById(id) {
        return { 'wechat-copy': wechat, 'zhihu-copy': zhihu, 'reading-tools': tools, 'wechat-copy-toast': toast }[id] || null;
      }
    }
  });

  zhihu.click();
  assert.match(toast.textContent, /无法读取当前文章/);
  assert.equal(toast.dataset.state, 'error');
  assert.equal(wechat.disabled, false);
  assert.equal(zhihu.disabled, false);
});
