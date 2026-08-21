import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { buildXhsMaterials, extractArticleTitle, planScreenshotPositions, safeFolderName } from '../scripts/lib/xhs-export.mjs';

test('Xiaohongshu materials keep the article theme and generate only one sketch cover', () => {
  const markdown = `# 岸见一郎《被讨厌的勇气》思维导图、书摘、读后感

## 一、书籍信息

重要的不是过去，而是你怎么看待过去。

## 二、思维导图

## 三、书摘
`;
  const materials = buildXhsMaterials(markdown);
  assert.equal(extractArticleTitle(markdown), '岸见一郎《被讨厌的勇气》思维导图、书摘、读后感');
  assert.equal(materials.prompts.length, 1);
  assert.equal(materials.prompts[0].filename, '01-cover-sketch.md');
  assert.equal(materials.prompts[0].output, '01-手绘笔记风.png');
  assert.equal(materials.prompts[0].style, '手绘笔记风');
  assert.match(materials.copy, /#读书/);
  assert.match(materials.analysis, /方法与心理/);
  assert.match(materials.prompts[0].content, /sketch-notes/);
  assert.doesNotMatch(materials.prompts[0].content, /screen-print|preset: poster/);
  for (const prompt of materials.prompts) {
    assert.match(prompt.content, /副标题（必须逐字准确）：“阅读笔记”/);
    assert.doesNotMatch(prompt.content, /值得收藏的阅读启发/);
  }
  assert.match(materials.outline, /Text Content: 《被讨厌的勇气》 \/ 阅读笔记/);
  for (const prompt of materials.prompts) {
    assert.match(prompt.content, /3:4/);
    assert.match(prompt.content, /25%/);
  }
  assert.match(materials.prompts[0].content, /watermark “文章首发微信公众号：彭丹的阅读之旅”/);
  assert.match(materials.analysis, /输出策略：生成一张手绘笔记风封面/);
  assert.doesNotMatch(materials.analysis, /海报风|两张封面/);
  assert.doesNotMatch(materials.outline, /海报风|screen-print|image_count: 2/);
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

async function loadXhsExport(fetchImpl) {
  const source = await fs.readFile(new URL('../assets/js/xhs-export.js', import.meta.url), 'utf8');
  const button = fakeElement({ 'aria-label': '发布到小红书' });
  const toast = fakeElement();
  const message = fakeElement();
  const progress = fakeElement({ max: '100', value: '0' });
  const classes = new Set();
  const document = {
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
    querySelector(selector) { return selector === '.markdown-section h1' ? { textContent: '测试《书名》读后感' } : null; }
  };
  const window = {
    clearTimeout() {},
    location: {
      hash: '#/docs/read/测试《书名》',
      href: 'http://127.0.0.1:3007/#/docs/read/测试《书名》',
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:3007',
      protocol: 'http:'
    },
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
      coverCount: 1,
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
  assert.match(ui.message.textContent, /已保存 6 张正文截图/);
  assert.match(ui.message.textContent, /1 张手绘封面/);
  assert.doesNotMatch(ui.message.textContent, /2 张封面/);
  assert.equal(ui.toast.dataset.state, 'success');
  assert.equal(ui.progress.value, 100);
  assert.equal(ui.progress.hidden, false);
  assert.equal(ui.progress.getAttribute('aria-valuenow'), '100');
  assert.equal(ui.classes.has('xhs-export-busy'), false);
});

test('running Xiaohongshu job shows its real progress below the status text', async () => {
  const ui = await loadXhsExport(async (url, options = {}) => {
    if (options.method === 'POST') return jsonResponse({ id: 'job-progress', progress: 0 });
    return jsonResponse({ id: 'job-progress', status: 'running', stage: '正在用 Codex 生成手绘封面…', progress: 60 });
  });
  ui.button.click();
  await flush();
  assert.match(ui.message.textContent, /60%/);
  assert.equal(ui.toast.dataset.state, 'loading');
  assert.equal(ui.progress.value, 60);
  assert.equal(ui.progress.hidden, false);
  assert.equal(ui.progress.getAttribute('aria-valuenow'), '60');
  assert.equal(ui.progress.getAttribute('aria-valuetext'), '60%');
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
