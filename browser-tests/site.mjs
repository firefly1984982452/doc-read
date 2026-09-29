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

test('back-to-top keeps the reading route and works with keyboard, reduced motion and narrow toolbars', async t => {
  const page = await pageFor(t);
  const route = '/#/docs/read-history/' + encodeURIComponent('《中国通史》纪录片学习笔记') + '?id=episode-026';
  await page.goto(origin + route);
  const button = page.getByRole('button', { name: '回到顶部', exact: true });
  await button.waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.DocReadHistoryOutline && document.querySelectorAll('.history-study-time').length === 100);
  // Let Docsify finish its initial animated jump to episode-026 before testing a user action.
  await page.evaluate(() => new Promise(resolve => {
    let lastY = window.scrollY;
    let stableSince = performance.now();
    function settled(now) {
      if (lastY !== window.scrollY) { lastY = window.scrollY; stableSince = now; }
      if (now - stableSince >= 600) resolve();
      else requestAnimationFrame(settled);
    }
    requestAnimationFrame(settled);
  }));
  const originalURL = page.url();

  async function scrollDown() {
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
    await page.waitForFunction(() => window.scrollY > 1000);
  }
  async function expectTop() {
    await page.waitForFunction(() => window.scrollY === 0);
    assert.equal(page.url(), originalURL, 'returning to the top preserves the current article and anchor route');
  }

  assert.equal(await button.getAttribute('data-tooltip'), '回到顶部');
  assert.equal(await button.evaluate(element => element.parentElement.lastElementChild === element), true);
  await scrollDown();
  await button.click();
  await expectTop();
  await screenshot(page, 'history-back-to-top-desktop');

  await scrollDown();
  await page.locator('#random-reading').focus();
  await page.keyboard.press('Tab');
  assert.equal(await button.evaluate(element => document.activeElement === element), true, 'button follows random reading in keyboard order');
  await page.keyboard.press('Enter');
  await expectTop();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await scrollDown();
  await page.evaluate(() => {
    const scroll = window.scrollTo.bind(window);
    window.__topScrolls = [];
    window.scrollTo = (...args) => { window.__topScrolls.push(args); scroll(...args); };
  });
  await button.focus();
  await page.keyboard.press('Space');
  await expectTop();
  assert.equal(await page.evaluate(() => window.__topScrolls.at(-1)[0].behavior), 'instant', 'reduced motion skips animated scrolling');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator('.reading-tools .article-tool').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    assert.equal(bounds.length, 6);
    assert.ok(bounds.every(rect => rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= 844), `all six tools fit at ${width}px`);
    const theme = await page.locator('#theme-toggle').boundingBox();
    assert.ok(bounds.every(rect => rect.right < theme.x), 'article tools do not overlap the theme button');
    await scrollDown();
    await button.click();
    await expectTop();
  }
  await screenshot(page, 'history-back-to-top-mobile');
});

test('history episode metadata stays subtle on the page and only WeChat export omits study records, watch links and reflections', async t => {
  const page = await pageFor(t);
  await page.goto(origin + '/#/docs/read-history/' + encodeURIComponent('《中国通史》纪录片学习笔记'));
  await page.waitForFunction(() => window.DocReadArticleCopy && document.querySelectorAll('.history-reading-stats > span').length === 2 && document.querySelectorAll('.history-study-time').length === 100);

  const displayed = await page.evaluate(() => {
    const styles = selector => Array.from(document.querySelectorAll(selector)).map(element => ({
      size: getComputedStyle(element).fontSize,
      color: getComputedStyle(element).color,
      weight: getComputedStyle(element).fontWeight
    }));
    return {
      dates: styles('.history-study-time'),
      strongDates: styles('.history-study-time strong'),
      links: styles('.history-episode-watch a'),
      topDateColor: getComputedStyle(document.querySelector('.history-reading-date')).color
    };
  });
  assert.equal(displayed.dates.length, 100);
  assert.ok(displayed.dates.every(item => item.size === '13px' && item.color === displayed.topDateColor));
  assert.ok(displayed.strongDates.length > 0, 'exercise the original bold study-date label');
  assert.ok(displayed.strongDates.every(item => item.size === '13px' && item.weight === '400'));
  assert.equal(displayed.links.length, 100);
  assert.ok(displayed.links.every(item => item.size === '14px' && item.color === displayed.topDateColor));

  const exported = await page.evaluate(() => {
    const source = document.querySelector('.markdown-section');
    const sourceDate = source.querySelector('.history-reading-date');
    const topMetadataParts = [sourceDate.firstElementChild, ...sourceDate.querySelectorAll('.history-reading-stats > span')].map(element => element.textContent.trim());
    // Exercise copying before async history-outline has marked any metadata.
    const unmounted = source.cloneNode(true);
    unmounted.querySelectorAll('.history-study-time, .history-episode-watch').forEach(element => {
      element.classList.remove('history-study-time', 'history-episode-watch');
    });
    const followingSection = document.createElement('h2');
    followingSection.textContent = '观后感之后的独立章节';
    unmounted.appendChild(followingSection);
    const discussion = document.createElement('p');
    discussion.textContent = '关于学习时间：这只是正文讨论，阅读时间统计也要保留。';
    unmounted.appendChild(discussion);
    const quotedDate = document.createElement('blockquote');
    quotedDate.innerHTML = '<p>学习时间：2023年10月19日</p>';
    unmounted.appendChild(quotedDate);
    const payload = window.DocReadArticleCopy.buildWechatPayload(unmounted);
    const parsed = new DOMParser().parseFromString(payload.html, 'text/html');
    const copiedArticle = parsed.querySelector('article');
    const first = copiedArticle.firstElementChild;
    const watchLinks = root => Array.from(root.querySelectorAll('a')).filter(link => /^观看本集/.test(link.textContent)).length;
    const watchText = text => (text.match(/观看本集（哔哩哔哩）/g) || []).length;
    const studyDates = root => Array.from(root.querySelectorAll(':scope > p')).filter(p => /^学习时间[：:]/.test(p.textContent.trim())).length;
    const reflectionMarkers = ['阅读总结与观后感', '实际观看时间', '感触1：收获知识', '想法3：专心做一件事'];
    const hasReflection = text => reflectionMarkers.every(marker => text.includes(marker));
    const retainsReflection = payload => hasReflection(payload.text) && hasReflection(new DOMParser().parseFromString(payload.html, 'text/html').body.textContent);
    const zhihu = window.DocReadArticleCopy.buildZhihuPayload(source);
    // Both a different article in the same route and another route must retain episode metadata and reflections.
    const another = source.cloneNode(true);
    another.querySelector('h1').textContent = '普通笔记';
    const otherArticle = window.DocReadArticleCopy.buildWechatPayload(another);
    history.replaceState({}, '', '#/docs/read/普通笔记');
    const otherRoute = window.DocReadArticleCopy.buildWechatPayload(source);
    return {
      payload,
      topMetadataParts,
      topMetadata: { tag: first.tagName, text: first.textContent.trim(), fontSize: first.style.fontSize, color: first.style.color, textAlign: first.style.textAlign },
      otherArticleHasDate: /^date\s*:/mi.test(otherArticle.text),
      otherRouteHasDate: /^date\s*:/mi.test(otherRoute.text),
      directDates: studyDates(copiedArticle),
      originalDates: studyDates(source),
      wechatWatchLinks: watchLinks(copiedArticle),
      wechatWatchText: watchText(payload.text),
      originalWatchLinks: watchLinks(source),
      zhihuDates: (zhihu.text.match(/^学习时间[：:]/gm) || []).length,
      zhihuWatchLinks: watchText(zhihu.text),
      otherArticleDates: (otherArticle.text.match(/^学习时间[：:]/gm) || []).length,
      otherArticleWatchLinks: watchText(otherArticle.text),
      otherRouteDates: (otherRoute.text.match(/^学习时间[：:]/gm) || []).length,
      otherRouteWatchLinks: watchText(otherRoute.text),
      originalReflection: hasReflection(source.textContent),
      zhihuReflection: retainsReflection(zhihu),
      otherArticleReflection: retainsReflection(otherArticle),
      otherRouteReflection: retainsReflection(otherRoute)
    };
  });
  assert.equal(exported.topMetadataParts.length, 3);
  assert.match(exported.topMetadataParts[0], /^date\s*:/i);
  assert.match(exported.topMetadataParts[1], /^总字数[：:]/);
  assert.match(exported.topMetadataParts[2], /^预计阅读[：:]/);
  const expectedTopMetadata = exported.topMetadataParts.join('\u3000');
  assert.deepEqual(exported.topMetadata, { tag: 'P', text: expectedTopMetadata, fontSize: '12px', color: 'rgb(178, 178, 178)', textAlign: 'left' }, 'WeChat HTML begins with the three original metadata values separated by full-width spaces');
  assert.equal(exported.payload.text.split('\n')[0], expectedTopMetadata, 'WeChat plain text retains the same top metadata line');
  for (const content of [exported.payload.html, exported.payload.text]) {
    assert.equal((content.match(/总字数[：:]/g) || []).length, 1);
    assert.equal((content.match(/预计阅读[：:]/g) || []).length, 1);
  }
  assert.equal(exported.otherArticleHasDate, false, 'another article still omits its top date');
  assert.equal(exported.otherRouteHasDate, false, 'another route still omits its top date');
  assert.equal(exported.directDates, 0, 'all episode dates are absent from exported HTML');
  assert.equal((exported.payload.text.match(/^学习时间[：:]/gm) || []).length, 1, 'plain text retains only the deliberate quotation, not the 100 episode records');
  assert.doesNotMatch(exported.payload.text, /学习日期待核对|2021年10月31日|2011年11月2日/);
  assert.doesNotMatch(exported.payload.html, /学习日期待核对|2021年10月31日|2011年11月2日/);
  for (const content of [exported.payload.html, exported.payload.text]) {
    assert.doesNotMatch(content, /阅读总结与观后感|实际观看时间|感触1：收获知识|想法3：专心做一件事/, 'the reflection heading and unique content are absent from WeChat HTML and plain text');
    assert.match(content, /观后感之后的独立章节/, 'removal stops at the next same-level heading');
    assert.match(content, /关于学习时间：这只是正文讨论，阅读时间统计也要保留。/);
    assert.match(content, /学习时间：2023年10月19日/, 'the quotation after the next section is retained');
  }
  assert.equal(exported.originalDates, 100, 'copy never mutates the displayed/source dates');
  assert.equal(exported.wechatWatchLinks, 0, 'all episode watch links are absent from WeChat HTML');
  assert.equal(exported.wechatWatchText, 0, 'all episode watch labels are absent from WeChat plain text');
  assert.equal(exported.originalWatchLinks, 100, 'copy never mutates the displayed/source watch links');
  assert.equal(exported.zhihuDates, 100, 'only the WeChat path removes study records');
  assert.equal(exported.zhihuWatchLinks, 100, 'Zhihu export retains episode watch links');
  assert.equal(exported.otherArticleDates, 100);
  assert.equal(exported.otherArticleWatchLinks, 100);
  assert.equal(exported.otherRouteDates, 100);
  assert.equal(exported.otherRouteWatchLinks, 100);
  assert.equal(exported.originalReflection, true, 'copy never mutates the displayed/source reflection section');
  assert.equal(exported.zhihuReflection, true, 'Zhihu HTML and plain text retain the complete reflection section');
  assert.equal(exported.otherArticleReflection, true, 'another article retains its reflection section in HTML and plain text');
  assert.equal(exported.otherRouteReflection, true, 'another route retains the reflection section in HTML and plain text');
});

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
  assert.equal(await page.locator('.sidebar-toggle').evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), true, 'the menu button is above the mobile search bar and receives pointer events');
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
  const originalTitle = await page.locator('.markdown-section h1').innerText();
  assert.ok(originalTitle.length > 0, 'source title remains on the page');
  assert.ok(!copied.text.includes(originalTitle), 'plain text excludes the main title');
  assert.doesNotMatch(copied.html, /<h1\b/i);
  assert.doesNotMatch(copied.text, /9787544291170/);
  assert.match(copied.text, /一、书籍简介/);
  assert.doesNotMatch(copied.text, /1\. 书籍简介|2\. 书籍信息|3\. 阅读记录/);
  assert.match(await page.locator('.markdown-section').textContent(), /9787544291170/);
  const exported = await page.evaluate(html => {
    const article = new DOMParser().parseFromString(html, 'text/html');
    const style = target => {
      const element = typeof target === 'string' ? article.querySelector(target) : target;
      return { fontSize: element.style.fontSize, lineHeight: element.style.lineHeight, color: element.style.color };
    };
    const paragraphs = Array.from(article.querySelectorAll('p'));
    return { paragraph: style(paragraphs.find(p => !/^date:/.test(p.textContent.trim()) && !p.querySelector('img') && p.textContent.trim())), list: article.querySelector('li') ? style('li') : null, date: paragraphs.some(p => /^date:/.test(p.textContent.trim())), h2: style('h2'), h3: style('h3'), caption: style(Array.from(article.querySelectorAll('span')).find(e => e.style.fontSize === '12px' && e.style.textAlign === 'center')) };
  }, copied.html);
  assert.deepEqual(exported.paragraph, { fontSize: '16px', lineHeight: '1.75', color: 'rgb(63, 63, 63)' });
  assert.equal(exported.list, null, 'metadata lists are excluded from this article export');
  assert.equal(exported.date, false);
  assert.doesNotMatch(copied.text, /date\s*:/i);
  assert.equal(await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelector('article').firstElementChild.tagName, copied.html), 'H2', 'export begins with content, without date or leading divider');
  assert.equal(exported.caption.fontSize, '12px');
  assert.equal(exported.caption.color, 'rgb(178, 178, 178)');
  assert.equal(exported.h2.fontSize, '18px');
  assert.equal(exported.h3.fontSize, '16px');
  const textRuns = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const paragraphs = Array.from(doc.querySelectorAll('p')).filter(p => !/^date:/.test(p.textContent.trim()) && !p.querySelector('img'));
    // Model an editor that drops font size on paragraph containers when pasting.
    paragraphs.forEach(p => p.style.removeProperty('font-size'));
    return paragraphs.flatMap(p => Array.from(p.querySelectorAll('span')).filter(span => span.childNodes.length === 1 && span.firstChild.nodeType === 3).map(span => span.style.fontSize));
  }, copied.html);
  assert.ok(textRuns.length > 20, 'verify actual article text runs');
  assert.ok(textRuns.every(size => size === '16px'), 'body text carries 16px even without paragraph styles');

  const headings = await page.evaluate(html => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll('h3')).map(h => ({ text: h.textContent, decoration: h.style.textDecoration, border: h.style.borderBottomWidth, display: h.style.display })), copied.html);
  assert.ok(headings.some(h => h.text.length > 40), 'exercise long chapter headings');
  for (const heading of headings) {
    assert.equal(heading.decoration, 'none');
    assert.equal(heading.border, '3px');
    assert.equal(heading.display, 'block');
  }

  assert.doesNotMatch(copied.html, /<button|data-fold-key|localhost|127\.0\.0\.1/);
  await page.evaluate(() => { window.testDenyClipboard = true; });
  await page.locator('#wechat-copy').click();
  await page.waitForFunction(() => document.getElementById('wechat-copy-toast').textContent.includes('权限'));
});
