import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

async function loadHelpers() {
  const source = await fs.readFile(new URL('../assets/js/search-highlight.js', import.meta.url), 'utf8');
  const window = {
    document: { addEventListener() {} },
    addEventListener() {}
  };
  vm.runInNewContext(source, { window });
  return window.DocReadSearchHighlight;
}

test('highlighted snippets escape HTML in matches and surrounding text', async () => {
  const { highlightText } = await loadHelpers();
  const html = highlightText('<img src=x onerror="alert(1)"> & \' <script>', '<script>');
  assert.equal(html,
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39; <mark class="search-keyword">&lt;script&gt;</mark>');
  assert.doesNotMatch(html, /<(?:img|script)\b/);
});

test('empty queries still escape the complete text without adding marks', async () => {
  const { highlightText } = await loadHelpers();
  assert.equal(highlightText('A & B < C "quoted" \'single\'', ' \t\n '),
    'A &amp; B &lt; C &quot;quoted&quot; &#39;single&#39;');
  assert.equal(highlightText('', '阅读'), '');
});

test('regular expression metacharacters are matched literally', async () => {
  const { highlightText } = await loadHelpers();
  const term = 'a+b[0].*(?)$^|\\';
  assert.equal(highlightText(`prefix ${term} suffix aab0`, term),
    `prefix <mark class="search-keyword">${term}</mark> suffix aab0`);
  assert.equal(highlightText('any text', '.*'), 'any text');
});

test('matching ignores case while preserving the original spelling', async () => {
  const { highlightText } = await loadHelpers();
  assert.equal(highlightText('Read READ reading', 'rEaD'),
    '<mark class="search-keyword">Read</mark> <mark class="search-keyword">READ</mark> <mark class="search-keyword">read</mark>ing');
});

test('space-separated Chinese keywords are highlighted independently in text order', async () => {
  const { highlightText } = await loadHelpers();
  assert.equal(highlightText('作者写下阅读笔记，再谈阅读。', '  阅读 \t 作者\n阅读  '),
    '<mark class="search-keyword">作者</mark>写下<mark class="search-keyword">阅读</mark>笔记，再谈<mark class="search-keyword">阅读</mark>。');
});

test('overlapping keywords prefer the complete longer match without nested marks', async () => {
  const { highlightText } = await loadHelpers();
  assert.equal(highlightText('阅读笔记与阅读', '阅读 阅读笔记'),
    '<mark class="search-keyword">阅读笔记</mark>与<mark class="search-keyword">阅读</mark>');
});

test('excerpts center on the first matching keyword even when the query order differs', async () => {
  const { excerpt, highlightText } = await loadHelpers();
  const text = '前'.repeat(160) + '阅读笔记与作者' + '后'.repeat(180);
  const summary = excerpt(text, '作者   阅读');
  assert.equal(summary, '…' + '前'.repeat(42) + '阅读笔记与作者' + '后'.repeat(59) + '…');
  assert.match(highlightText(summary, '作者   阅读'), /<mark class="search-keyword">阅读<\/mark>/);
  assert.match(highlightText(summary, '作者   阅读'), /<mark class="search-keyword">作者<\/mark>/);
});

test('long matching terms remain complete rather than being truncated to snippet length', async () => {
  const { excerpt, highlightText } = await loadHelpers();
  const term = '长关键词'.repeat(40);
  const summary = excerpt('前'.repeat(120) + term + '后'.repeat(200), term);
  assert.equal(summary, '…' + '前'.repeat(42) + term + '…');
  assert.equal(highlightText(summary, term),
    '…' + '前'.repeat(42) + '<mark class="search-keyword">' + term + '</mark>…');
});

test('excerpts keep short text intact and provide bounded previews for absent keywords', async () => {
  const { excerpt } = await loadHelpers();
  assert.equal(excerpt('短篇阅读笔记', '阅读'), '短篇阅读笔记');
  assert.equal(excerpt('开始阅读' + '后'.repeat(160), '阅读'), '开始阅读' + '后'.repeat(104) + '…');
  assert.equal(excerpt('前'.repeat(120) + '阅读', '阅读'), '…' + '前'.repeat(42) + '阅读');
  assert.equal(excerpt('文'.repeat(160), '缺失'), '文'.repeat(108) + '…');
  assert.equal(excerpt('', '阅读'), '');
});

test('clearing removes article marks and cancels pending positioning without moving the reading position', async () => {
  const source = await fs.readFile(new URL('../assets/js/search-highlight.js', import.meta.url), 'utf8');
  const handlers = new Map();
  const frames = new Map();
  const timers = new Map();
  const scrolls = [];
  let nextId = 0;
  let painted = false;
  let normalized = 0;
  let replacement;
  let disconnected = false;
  const match = {
    textContent: '阅读', isConnected: true,
    parentNode: { normalize() { normalized++; } },
    classList: { add() {} },
    getBoundingClientRect: () => ({ top: 400 }),
    replaceWith(node) { replacement = node; painted = false; this.isConnected = false; }
  };
  const article = {
    querySelectorAll: () => painted ? [match] : [],
    querySelector() { painted = true; return match; }
  };
  const document = {
    querySelector: selector => selector === '.markdown-section' ? article : null,
    createTreeWalker: () => ({ nextNode: () => null }),
    createTextNode: textContent => ({ textContent }),
    addEventListener(name, callback) { handlers.set(name, callback); },
    removeEventListener(name) { handlers.delete(name); }
  };
  const window = {
    document, location: { hash: '#/docs/read/笔记?search=阅读' },
    DOC_READ_PAGE_SOURCE: { path: 'docs/read/笔记' },
    DocReadSectionFold: { reveal() {} },
    scrollX: 0, scrollY: 1234, innerHeight: 900,
    scrollTo(value) { scrolls.push(value); },
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    ResizeObserver: class {
      observe() {}
      disconnect() { disconnected = true; }
    },
    addEventListener() {}
  };
  vm.runInNewContext(source, { window, URLSearchParams });
  const runFrame = () => {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback();
  };
  handlers.get('doc-read:rendered')();
  runFrame();
  runFrame();
  assert.equal(timers.size, 3, 'positioning has delayed retries and a stop timer');
  handlers.get('doc-read:sections-ready')();
  assert.equal(frames.size, 1);
  window.DocReadSearchHighlight.clear();
  assert.equal(frames.size, 0);
  assert.equal(timers.size, 0);
  assert.equal(disconnected, true);
  assert.equal(replacement.textContent, '阅读');
  assert.equal(normalized, 1);
  assert.equal(painted, false);
  assert.equal(scrolls.at(-1).top, 1234);
  assert.equal(scrolls.at(-1).left, 0);
});
