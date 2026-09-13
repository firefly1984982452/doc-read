import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

let browser, server, origin;
before(async () => {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  server = spawn(process.execPath, ['scripts/dev-server.mjs'], {
    env: { ...process.env, DOC_READ_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local server startup timed out')), 10000);
    server.once('error', reject);
    server.once('exit', code => { clearTimeout(timeout); reject(new Error('Server exited: ' + code)); });
    server.stdout.on('data', data => { if (String(data).includes('available at')) { clearTimeout(timeout); resolve(); } });
  });
  origin = `http://127.0.0.1:${port}`;
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.DOC_READ_TEST_BROWSER || (existsSync(macChrome) ? macChrome : undefined) });
});
after(async () => {
  await browser?.close();
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
});

async function pageFor(t, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  // Keep tests offline and prevent any requests to publishing assistants/accounts.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], 'no uncaught browser errors'));
  return page;
}
async function screenshot(page, name) {
  if (!process.env.DOC_READ_TEST_SCREENSHOTS) return;
  await mkdir(process.env.DOC_READ_TEST_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.DOC_READ_TEST_SCREENSHOTS, name + '.png') });
}
async function input(page, value) {
  // Set the test field through DOM APIs; no keyboard or input method simulation.
  await page.locator('#doc-read-search-input').evaluate((element, text) => {
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function enter(page) {
  await page.goto(origin + '/');
  await page.locator('[data-cover-action="enter"]').click();
  await page.locator('#doc-read-search-input').waitFor();
}

test('home data failure shows retry and recovers without reload', async t => {
  const page = await pageFor(t);
  let fail = true;
  await page.route('**/assets/data/reading-data.json*', route => fail ? route.fulfill({ status: 503, body: 'offline' }) : route.continue());
  await enter(page);
  await page.locator('#reading-dashboard [data-reading-retry]').waitFor();
  await screenshot(page, '首页加载失败');
  fail = false;
  await page.locator('#reading-dashboard [data-reading-retry]').click();
  await page.locator('#reading-dashboard[data-mounted="true"]').waitFor();
  assert.ok(await page.locator('#recent-reading-list li').count() > 0);
  assert.equal(await page.locator('#reading-tools').isVisible(), false);
  await screenshot(page, '桌面首页');
});

test('search reuses successful chunks after failure and clears pending results', async t => {
  const page = await pageFor(t);
  let fail = true, active = 0, peak = 0;
  const requests = new Map();
  await page.route('**/assets/data/search-chunks/*.json*', async route => {
    const key = new URL(route.request().url()).pathname;
    requests.set(key, (requests.get(key) || 0) + 1);
    active++; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 25));
      if (fail && key.endsWith('/1.json')) await route.fulfill({ status: 503, body: 'offline' });
      else await route.continue();
    } finally { active--; }
  });
  await enter(page);
  await input(page, '林黛玉');
  await page.locator('[data-search-retry]').waitFor();
  const completed = requests.get('/assets/data/search-chunks/0.json');
  fail = false;
  await page.locator('[data-search-retry]').click();
  await page.waitForFunction(() => document.querySelector('[data-search-results]').getAttribute('aria-busy') === 'false' && !document.querySelector('[data-search-retry]'));
  assert.ok(await page.locator('.matching-post').count() > 0);
  assert.equal(requests.get('/assets/data/search-chunks/0.json'), completed);
  assert.ok(peak <= 3, `peak concurrent chunks: ${peak}`);
  await input(page, '百年孤独');
  await input(page, '');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-search-results]').isVisible(), false);
});

test('mobile sidebar navigation stays in the same tab and fits viewport', async t => {
  const page = await pageFor(t, { width: 390, height: 844 });
  await enter(page);
  await page.locator('.sidebar-toggle').click();
  await page.locator('.sidebar a[href*="docs/library"]').first().click();
  await page.waitForFunction(() => location.hash.includes('docs/library') && document.querySelector('.markdown-section h1'));
  const link = page.locator('.markdown-section a[href*="/docs/read/"]').first();
  assert.notEqual(await link.getAttribute('target'), '_blank');
  await link.click();
  await page.waitForFunction(() => location.hash.includes('/docs/read/') && document.body.classList.contains('reading-note-page'));
  assert.equal(page.context().pages().length, 1);
  await screenshot(page, '手机阅读页');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
});

test('article copy includes folded content and reports clipboard denial', async t => {
  const page = await pageFor(t);
  await page.addInitScript(() => {
    window.testCopied = [];
    document.execCommand = () => false;
    Object.defineProperty(navigator, 'clipboard', { value: { write: async items => {
      if (window.testDenyClipboard) throw new Error('Denied');
      window.testCopied = await Promise.all(items.map(async item => ({
        html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text()
      })));
    } } });
  });
  await page.goto(origin + '/#/docs/read/' + encodeURIComponent('加西亚·马尔克斯《百年孤独》'));
  await page.locator('#wechat-copy').waitFor({ state: 'visible' });
  await page.locator('.section-fold-toggle').first().click();
  await page.locator('.section-fold-item[hidden]').first().waitFor({ state: 'attached' });
  await page.locator('#wechat-copy').click();
  await page.waitForFunction(() => window.testCopied.length > 0);
  const copied = await page.evaluate(() => window.testCopied[0]);
  assert.match(copied.text, /9787544291170/);
  assert.doesNotMatch(copied.html, /<button|data-fold-key|localhost|127\.0\.0\.1/);
  await page.evaluate(() => { window.testDenyClipboard = true; });
  await page.locator('#wechat-copy').click();
  await page.waitForFunction(() => document.getElementById('wechat-copy-toast').textContent.includes('权限'));
});
