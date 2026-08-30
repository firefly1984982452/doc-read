import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { extractArticleTitle, planScreenshotPositions, safeFolderName } from '../scripts/lib/xhs-export.mjs';

test('Xiaohongshu screenshot export uses the complete article title', () => {
  const markdown = `# 岸见一郎《被讨厌的勇气》思维导图、书摘、读后感

## 一、书籍信息

重要的不是过去，而是你怎么看待过去。

## 二、思维导图

## 三、书摘
`;
  assert.equal(extractArticleTitle(markdown), '岸见一郎《被讨厌的勇气》思维导图、书摘、读后感');
});

test('Xiaohongshu helper exports only 1080x1440 screenshots into the article folder', async () => {
  const source = await fs.readFile(new URL('../scripts/xhs-export-server.mjs', import.meta.url), 'utf8');
  assert.match(source, /viewport:\s*\{ width: 720, height: 960 \}/);
  assert.match(source, /deviceScaleFactor:\s*1\.5/);
  assert.match(source, /path\.join\(directory, filename\)/);
  assert.doesNotMatch(source, /path\.join\(directory, ['"]正文截图['"]\)/);
  assert.doesNotMatch(source, /小红书文案\.txt|buildXhsMaterials|generateCoverWithRetry|manifest\.json/);
  assert.match(source, /fileURLToPath\(url\)/);
  assert.match(source, /path\.resolve\(root, ['"]index\.html['"]\)/);
  assert.match(source, /application\/javascript; charset=utf-8/);
  assert.match(source, /\/__doc_read\/xhs\/file\/jobs/);
  assert.match(source, /origin === ['"]null['"]\) return false/);
});

test('folder names preserve Chinese titles while removing unsafe path characters', () => {
  assert.equal(safeFolderName('作者《书名》：读后感/笔记\\终稿'), '作者《书名》：读后感 笔记 终稿');
  assert.ok(Array.from(safeFolderName('很长'.repeat(100))).length <= 86);
});

test('mobile screenshot positions cover the article without a near-duplicate tail page', () => {
  assert.deepEqual(planScreenshotPositions(900), [0]);
  assert.deepEqual(planScreenshotPositions(1000), [0]);
  assert.deepEqual(planScreenshotPositions(1920), [0, 960]);
  const longArticle = planScreenshotPositions(2960);
  assert.deepEqual(longArticle, [0, 667, 1333, 2000]);
  assert.equal(longArticle.at(-1), 2960 - 960);
  for (let index = 1; index < longArticle.length; index += 1) {
    assert.ok(longArticle[index] > longArticle[index - 1]);
    assert.ok(longArticle[index] - longArticle[index - 1] <= 960);
  }
});

function fakeElement(attributes = {}) {
  const values = new Map(Object.entries(attributes));
  const listeners = new Map();
  return {
    dataset: {},
    disabled: false,
    hidden: true,
    textContent: '',
    value: Number(attributes.value || 0),
    addEventListener(type, listener) { listeners.set(type, listener); },
    click() { return listeners.get('click')?.(); },
    getAttribute(name) { return values.get(name) || null; },
    removeAttribute(name) { values.delete(name); },
    setAttribute(name, value) { values.set(name, String(value)); }
  };
}

async function loadXhsExport(fetchImpl, locationOverrides = {}, scriptLoader) {
  const source = await fs.readFile(new URL('../assets/js/xhs-export.js', import.meta.url), 'utf8');
  const button = fakeElement({ 'aria-label': '发布到小红书' });
  const toast = fakeElement();
  const message = fakeElement();
  const progress = fakeElement({ max: '100', value: '0' });
  const classes = new Set();
  let window;
  const head = {
    appendChild(script) {
      script.parentNode = head;
      if (scriptLoader) {
        Promise.resolve().then(() => scriptLoader(script, window)).catch(() => script.onerror?.());
      }
      return script;
    },
    removeChild(script) { script.parentNode = null; }
  };
  const document = {
    head,
    documentElement: {
      classList: {
        toggle(name, force) { if (force) classes.add(name); else classes.delete(name); }
      }
    },
    getElementById(id) {
      return {
        'xhs-export': button,
        'wechat-copy-toast': fakeElement(),
        'xhs-export-toast': toast,
        'xhs-export-status-text': message,
        'xhs-export-progress': progress
      }[id] || null;
    },
    createElement(name) { return { nodeName: String(name).toUpperCase(), parentNode: null, async: false, src: '', onerror: null }; },
    querySelector(selector) { return selector === '.markdown-section h1' ? { textContent: '测试《书名》读后感' } : null; }
  };
  window = {
    clearTimeout() {},
    location: Object.assign({
      hash: '#/docs/read/测试《书名》',
      href: 'http://127.0.0.1:3007/#/docs/read/测试《书名》',
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:3007',
      protocol: 'http:'
    }, locationOverrides),
    setTimeout() { return 1; }
  };
  window.window = window;
  window.document = document;
  vm.runInNewContext(source, {
    window,
    document,
    fetch: fetchImpl,
    AbortController,
    URL,
    JSON,
    Number,
    Object,
    Promise,
    String,
    Error,
    encodeURIComponent
  });
  return { button, toast, message, progress, classes, api: window.DocReadXhsExport };
}

function jsonResponse(body, ok = true) {
  return { ok, text: async () => JSON.stringify(body) };
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

test('Xiaohongshu button starts a local job and restores the cursor after completion', async () => {
  const calls = [];
  const ui = await loadXhsExport(async (url, options = {}) => {
    calls.push({ url, options });
    if (options.method === 'POST') return jsonResponse({ id: 'job-1' });
    return jsonResponse({
      id: 'job-1',
      status: 'completed',
      screenshotCount: 6,
      outputDirectory: '/Users/test/Downloads/小红书-待上传/测试《书名》读后感'
    });
  });
  ui.button.click();
  assert.equal(ui.button.disabled, true);
  assert.equal(ui.button.getAttribute('aria-busy'), 'true');
  assert.equal(ui.classes.has('xhs-export-busy'), true);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(JSON.parse(calls[0].options.body).path, 'docs/read/测试《书名》.md');
  assert.equal(JSON.parse(calls[0].options.body).siteOrigin, 'http://127.0.0.1:3007');
  assert.match(ui.message.textContent, /已保存 6 张 1080×1440 截图/);
  assert.doesNotMatch(ui.message.textContent, /封面|文案/);
  assert.equal(ui.toast.dataset.state, 'success');
  assert.equal(ui.progress.value, 100);
  assert.equal(ui.progress.hidden, false);
  assert.equal(ui.progress.getAttribute('aria-valuenow'), '100');
  assert.equal(ui.classes.has('xhs-export-busy'), false);
});

test('local file page can start the same Xiaohongshu screenshot job', async () => {
  const calls = [];
  const ui = await loadXhsExport(async () => { throw new Error('file mode must not use fetch'); }, {
    href: 'file:///Users/pengdan/pd/study/github/doc/doc-read/index.html#/docs/read/测试《书名》',
    hostname: '',
    origin: 'null',
    protocol: 'file:'
  }, (script, window) => {
    const url = new URL(script.src);
    calls.push(url);
    const callback = url.searchParams.get('callback');
    if (url.pathname.endsWith('/file/jobs')) {
      window.DocReadXhsJsonp[callback]({ id: 'job-file', progress: 0 });
      return;
    }
    window.DocReadXhsJsonp[callback]({ id: 'job-file', status: 'completed', screenshotCount: 2, outputDirectory: '/tmp/测试《书名》读后感' });
  });
  ui.button.click();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].pathname, '/__doc_read/xhs/file/jobs');
  assert.equal(calls[0].searchParams.get('path'), 'docs/read/测试《书名》.md');
  assert.equal(calls[0].searchParams.get('siteOrigin'), 'file:///Users/pengdan/pd/study/github/doc/doc-read/index.html');
  assert.equal(calls[1].pathname, '/__doc_read/xhs/file/jobs/job-file');
  assert.match(ui.message.textContent, /已保存 2 张 1080×1440 截图/);
  assert.equal(ui.toast.dataset.state, 'success');
});

test('running Xiaohongshu job shows its real progress below the status text', async () => {
  const ui = await loadXhsExport(async (url, options = {}) => {
    if (options.method === 'POST') return jsonResponse({ id: 'job-progress', progress: 0 });
    return jsonResponse({ id: 'job-progress', status: 'running', stage: '正在保存第 3/6 张截图（1080×1440）…', progress: 53 });
  });
  ui.button.click();
  await flush();
  assert.match(ui.message.textContent, /53%/);
  assert.equal(ui.toast.dataset.state, 'loading');
  assert.equal(ui.progress.value, 53);
  assert.equal(ui.progress.hidden, false);
  assert.equal(ui.progress.getAttribute('aria-valuenow'), '53');
  assert.equal(ui.progress.getAttribute('aria-valuetext'), '53%');
  assert.equal(ui.classes.has('xhs-export-busy'), true);
});

test('missing local helper produces an actionable error and clears loading state', async () => {
  const ui = await loadXhsExport(async () => { throw new Error('Failed to fetch'); });
  ui.button.click();
  await flush();
  assert.equal(ui.button.disabled, false);
  assert.equal(ui.toast.dataset.state, 'error');
  assert.match(ui.message.textContent, /npm run xhs:install/);
  assert.equal(ui.progress.hidden, true);
  assert.equal(ui.classes.has('xhs-export-busy'), false);
});
