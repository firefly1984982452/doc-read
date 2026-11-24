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

test('article reading statistics follow dates, support undated pages and exclude navigation pages', async t => {
  const page = await pageFor(t);
  for (const [route, dateText] of [
    ['docs/read/斯蒂芬·茨威格《断头王后：玛丽·安托瓦内特传》', 'date: 2026-09-30'],
    ['docs/read-history/《中国通史》纪录片学习笔记', 'date: 2023-11-10'],
    ['docs/read/芭芭拉·明托《金字塔原理》', 'date:'],
    ['docs/other/若华日记', null],
    ['docs/other/若华阅读笔记', null],
    ['docs/think/think', null]
  ]) {
    // Hash navigation exercises the cached module as well as initial page loading.
    await page.goto(origin + '/#/' + encodeURI(route));
    await page.waitForFunction(path => window.DOC_READ_PAGE_SOURCE?.path === path + '.md' &&
      document.querySelectorAll('.article-reading-meta .history-reading-stats > span').length === 2, route);
    const before = await page.locator('.article-reading-meta').textContent();
    if (dateText) assert.ok(before.startsWith(dateText), route + ' keeps its original date');
    else assert.ok(!before.includes('date:'), route + ' does not invent a missing date');
    assert.match(before, /总字数：[\d,]+ 字预计阅读：\d+ 分钟/);
    assert.equal(await page.locator('.article-reading-meta').evaluate(element => getComputedStyle(element).fontSize), '13px', route + ' uses the shared metadata size');
    assert.equal(await page.locator('.article-reading-meta').evaluate(element => getComputedStyle(element).textIndent), '0px');

    await page.evaluate(() => {
      window.DocReadHistoryStats.mount();
      window.DocReadHistoryStats.mount();
    });
    assert.equal(await page.locator('.article-reading-meta').count(), 1, 'repeated rendering keeps one metadata row');
    assert.equal(await page.locator('.article-reading-meta').textContent(), before, 'statistics never count themselves');
    assert.equal(await page.locator('.history-reading-stats').count(), 1);

    if (route.includes('中国通史')) {
      const collapsedCount = await page.locator('.is-section-collapsed').count();
      assert.ok(collapsedCount > 0, 'history chapters remain folded by default');
      await page.locator('.section-fold-toggle').first().click();
      await page.evaluate(() => window.DocReadHistoryStats.mount());
      assert.equal(await page.locator('.article-reading-meta').textContent(), before, 'folded and expanded text have identical counts');
    }
    if (route.includes('断头王后')) await screenshot(page, 'article-reading-statistics');
  }

  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(origin + '/#/docs/read/' + encodeURIComponent('斯蒂芬·茨威格《断头王后：玛丽·安托瓦内特传》'));
  await page.locator('.article-reading-meta').waitFor();
  const rects = await page.locator('.article-reading-meta .history-reading-stats > span').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }));
  assert.ok(rects.every(rect => rect.left >= 0 && rect.right <= 320), 'statistics wrap within a narrow viewport');
  await screenshot(page, 'article-reading-statistics-mobile');

  for (const route of ['docs/library', 'docs/years/2026', 'docs/think/update', 'docs/latest']) {
    await page.goto(origin + '/#/' + route);
    await page.waitForFunction(path => window.DOC_READ_PAGE_SOURCE?.path === path + '.md', route);
    assert.equal(await page.locator('.article-reading-meta').count(), 0, route + ' is not an article');
  }
});

test('page edge buttons keep the reading route and work with keyboard, reduced motion and narrow toolbars', async t => {
  const page = await pageFor(t);
  const route = '/#/docs/read-history/' + encodeURIComponent('《中国通史》纪录片学习笔记') + '?id=episode-026';
  await page.goto(origin + route);
  const button = page.getByRole('button', { name: '回到顶部', exact: true });
  const bottomButton = page.getByRole('button', { name: '去底部', exact: true });
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
  async function expectBottom() {
    await page.waitForFunction(() => {
      const page = document.scrollingElement;
      return Math.abs(page.scrollHeight - page.clientHeight - page.scrollTop) <= 1;
    });
    assert.equal(page.url(), originalURL, 'going to the bottom preserves the current article and anchor route');
  }

  assert.equal(await button.getAttribute('data-tooltip'), '回到顶部');
  assert.equal(await bottomButton.getAttribute('data-tooltip'), '去底部');
  assert.equal(await bottomButton.evaluate(element => element.previousElementSibling.id), 'back-to-top');
  assert.equal(await bottomButton.evaluate(element => element.parentElement.lastElementChild === element), true);
  await scrollDown();
  await button.click();
  await expectTop();
  await screenshot(page, 'history-back-to-top-desktop');
  await bottomButton.click();
  await expectBottom();

  await scrollDown();
  await page.locator('#random-reading').focus();
  await page.keyboard.press('Tab');
  assert.equal(await button.evaluate(element => document.activeElement === element), true, 'button follows random reading in keyboard order');
  await page.keyboard.press('Enter');
  await expectTop();
  await page.keyboard.press('Tab');
  assert.equal(await bottomButton.evaluate(element => document.activeElement === element), true, 'bottom button follows top button in keyboard order');
  await page.keyboard.press('Enter');
  await expectBottom();

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
  await bottomButton.focus();
  await page.keyboard.press('Space');
  await expectBottom();
  assert.equal(await page.evaluate(() => window.__topScrolls.at(-1)[0].behavior), 'instant', 'bottom button also respects reduced motion');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bounds = await page.locator('.reading-tools .article-tool').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    }));
    assert.equal(bounds.length, 7);
    assert.ok(bounds.every(rect => rect.left >= 0 && rect.right <= width && rect.top >= 0 && rect.bottom <= 844), `all seven tools fit at ${width}px`);
    const theme = await page.locator('#theme-toggle').boundingBox();
    assert.ok(bounds.every(rect => rect.right < theme.x), 'article tools do not overlap the theme button');
    await scrollDown();
    await button.click();
    await expectTop();
    await bottomButton.click();
    await expectBottom();
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
  assert.equal(exported.otherArticleHasDate, true, 'another article retains its top date');
  assert.equal(exported.otherRouteHasDate, true, 'another route retains its top date');
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

test('Li Bai poem cards retain styling, fill available rows and wrap without site CSS', async t => {
  const page = await pageFor(t, { width: 375, height: 844 });
  await page.goto(origin + '/#/docs/read/' + encodeURIComponent('李长之《李白传》'));
  await page.waitForFunction(() => window.DocReadArticleCopy &&
    document.querySelectorAll('.markdown-section .libai-poem-card').length === 55 &&
    document.querySelector('.article-reading-meta .history-reading-stats'));

  const copied = await page.evaluate(() => {
    const source = document.querySelector('.markdown-section');
    const before = source.outerHTML;
    const cards = Array.from(source.querySelectorAll('.libai-poem-card')).map(card => ({
      title: card.querySelector('.libai-poem-title').textContent.trim(),
      titleLinks: Array.from(card.querySelectorAll('.libai-poem-title a')).map(link => ({ text: link.textContent, href: link.getAttribute('href') })),
      source: card.querySelector('.libai-poem-source').textContent.trim(),
      sourceLinks: Array.from(card.querySelectorAll('.libai-poem-source a')).map(link => ({ text: link.textContent, href: link.getAttribute('href') })),
      meta: card.querySelector('.libai-poem-meta').textContent.trim(),
      verse: card.querySelector('.libai-poem-verse').textContent.trim(),
      verseAlign: getComputedStyle(card.querySelector('.libai-poem-verse')).textAlign,
      verseFont: getComputedStyle(card.querySelector('.libai-poem-verse')).fontFamily,
      verseWeight: getComputedStyle(card.querySelector('.libai-poem-verse')).fontWeight,
      story: card.querySelector('.libai-poem-story')?.textContent.trim() || '',
      breaks: card.querySelectorAll('.libai-poem-verse br').length,
      paired: !!card.closest('.libai-poem-pair')
    }));
    const payload = window.DocReadArticleCopy.buildWechatPayload(source);
    const headingColors = Array.from(source.querySelectorAll('h3, h4')).map(heading => ({
      text: heading.textContent.trim(), color: getComputedStyle(heading.querySelector('.anchor span') || heading).color,
      font: getComputedStyle(heading).fontFamily, weight: getComputedStyle(heading).fontWeight
    }));
    const bodyParagraph = Array.from(source.querySelectorAll(':scope > p')).find(p => p.textContent.startsWith('① 727年前后'));
    const bodyTypography = { text: bodyParagraph.textContent, font: getComputedStyle(bodyParagraph).fontFamily,
      weight: getComputedStyle(bodyParagraph).fontWeight };
    return { ...payload, cards, headingColors, bodyTypography, paperImage: getComputedStyle(source).backgroundImage,
      unchanged: before === source.outerHTML,
      documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
  });
  assert.equal(copied.unchanged, true, 'exporting only transforms the clone, including tags, classes and fold state');
  assert.ok(copied.documentWidth <= copied.viewportWidth, 'the reading page has no horizontal overflow at 375px');
  assert.equal(copied.cards.length, 55);
  assert.ok(copied.cards.every(card => card.source && card.sourceLinks.length), 'every original blog card retains its source footer and links');
  assert.deepEqual(copied.cards.filter(card => card.paired).map(card => card.title), ['崔颢《黄鹤楼》', '李白《登金陵凤凰台》']);

  // A separate document has no Docsify stylesheet: only the actual clipboard HTML can style these cards.
  const preview = await pageFor(t, { width: 375, height: 844 });
  await preview.setContent('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + copied.html + '</body></html>');
  const rendered = await preview.evaluate(expected => {
    const article = document.querySelector('article');
    const sections = Array.from(article.querySelectorAll('section'));
    const text = element => element.textContent.trim();
    const cards = expected.map(item => {
      const titles = sections.filter(element => !element.querySelector('section') && text(element) === item.title);
      if (titles.length !== 1) throw new Error('Expected one exported title for ' + item.title + ', got ' + titles.length);
      const title = titles[0];
      const card = title.parentElement;
      const meta = title.nextElementSibling;
      const verse = meta.nextElementSibling;
      const style = getComputedStyle(card);
      const rect = card.getBoundingClientRect();
      const verseStyle = getComputedStyle(verse);
      const ellipses = Array.from(verse.querySelectorAll(':scope > span')).filter(element => text(element) === '……');
      const story = item.story ? verse.nextElementSibling : null;
      const storyStyle = story && getComputedStyle(story);
      return {
        title: text(title), tag: card.tagName, display: style.display, verticalAlign: style.verticalAlign,
        titleLinks: Array.from(title.querySelectorAll('a')).map(link => ({ text: link.textContent, href: link.getAttribute('href') })),
        width: rect.width, left: rect.left, right: rect.right,
        background: style.backgroundColor, border: style.borderBottomWidth,
        borderStyle: style.borderBottomStyle, topBorder: style.borderTopWidth,
        edge: style.borderBottomColor, topEdge: style.borderTopColor,
        titleSize: getComputedStyle(title).fontSize, titleWeight: getComputedStyle(title).fontWeight,
        meta: text(meta), metaSize: getComputedStyle(meta).fontSize,
        verse: text(verse), verseSize: verseStyle.fontSize, verseAlign: verseStyle.textAlign, indent: verseStyle.textIndent,
        verseFont: verseStyle.fontFamily, verseWeight: verseStyle.fontWeight,
        verseTextSizes: Array.from(verse.querySelectorAll('span')).filter(element => text(element) !== '……').map(element => getComputedStyle(element).fontSize),
        story: story ? { text: text(story), size: storyStyle.fontSize, color: storyStyle.color, font: storyStyle.fontFamily,
          align: storyStyle.textAlign, border: storyStyle.borderLeftWidth, padding: storyStyle.paddingLeft } : null,
        breaks: verse.querySelectorAll('br').length,
        ellipses: ellipses.map(element => ({ display: getComputedStyle(element).display, width: element.getBoundingClientRect().width,
          size: getComputedStyle(element).fontSize, align: getComputedStyle(element).textAlign })),
        sourceFooters: Array.from(card.children).filter(element => text(element) === item.source).length
      };
    });
    const titleSet = new Set(expected.map(item => item.title));
    const titleOrder = sections.filter(element => !element.querySelector('section') && titleSet.has(text(element))).map(text);
    return { cards, titleOrder, text: article.textContent, styleSheets: document.styleSheets.length,
      styles: document.querySelectorAll('style, link[rel="stylesheet"]').length,
      cardClasses: document.querySelectorAll('.libai-poem-card').length,
      documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
  }, copied.cards);
  assert.equal(rendered.styleSheets, 0);
  assert.equal(rendered.styles, 0, 'the preview cannot inherit site CSS');
  assert.equal(rendered.cardClasses, 0, 'card presentation survives class sanitization');
  assert.deepEqual(rendered.titleOrder, copied.cards.map(card => card.title), 'all poem cards keep their original reading order');
  assert.ok(rendered.documentWidth <= rendered.viewportWidth, 'clipboard HTML has no horizontal overflow at 375px');

  const paper = await preview.evaluate(() => {
    const article = document.querySelector('article');
    const outer = article.parentElement;
    const style = getComputedStyle(outer);
    return {
      tag: outer.tagName, background: style.backgroundColor, image: style.backgroundImage, size: style.backgroundSize,
      articleBackground: getComputedStyle(article).backgroundColor,
      headingColors: Array.from(article.querySelectorAll('h3, h4')).map(heading => ({
        text: heading.textContent.trim(), color: getComputedStyle(heading.querySelector('span') || heading).color,
        font: getComputedStyle(heading).fontFamily, weight: getComputedStyle(heading).fontWeight
      }))
    };
  });
  assert.equal(paper.tag, 'SECTION', 'grid paper lives on the paste-compatible outer wrapper');
  assert.equal(paper.background, 'rgb(255, 255, 255)');
  assert.equal(paper.image, copied.paperImage, 'copy retains the blog grid pattern without external stylesheets');
  assert.equal(paper.size, '40px 40px, 40px 40px');
  assert.equal(paper.articleBackground, 'rgba(0, 0, 0, 0)', 'the article does not cover the grid paper');
  assert.deepEqual(paper.headingColors, copied.headingColors, 'stage and numbered subheadings keep their visible blog colors');

  for (const [index, card] of rendered.cards.entries()) {
    const original = copied.cards[index];
    assert.equal(card.tag, 'SECTION', card.title + ' uses a paste-compatible wrapper');
    assert.equal(card.display, 'inline-block');
    assert.equal(card.verticalAlign, 'top', 'cards on the same row align at the top');
    assert.deepEqual(card.titleLinks, original.titleLinks, card.title + ' keeps its title links');
    assert.ok(card.width > 120 && card.width <= 360, card.title + ' fits its content inside the mobile viewport');
    assert.ok(card.left >= 0 && card.right <= 375, card.title + ' stays inside the narrow viewport');
    assert.equal(card.border, '1px');
    assert.equal(card.borderStyle, 'solid');
    assert.equal(card.topBorder, '3px');
    assert.ok(['rgb(255, 249, 233)', 'rgb(240, 246, 241)', 'rgb(247, 242, 252)'].includes(card.background), card.title + ' retains paper color');
    assert.equal(card.titleSize, '14px');
    assert.equal(card.titleWeight, '650');
    assert.equal(card.meta, original.meta);
    assert.equal(card.metaSize, '12px');
    assert.equal(card.verse, original.verse, card.title + ' keeps the actual poem text');
    assert.equal(card.verseSize, '14px');
    assert.equal(original.verseAlign, 'center', card.title + ' centers verses on the blog');
    assert.equal(card.verseAlign, 'center', card.title + ' centers verses in WeChat');
    assert.equal(card.verseFont, original.verseFont, card.title + ' keeps the blog serif font');
    assert.equal(card.verseWeight, original.verseWeight, card.title + ' keeps the blog regular weight');
    assert.ok(card.verseTextSizes.length > 0 && card.verseTextSizes.every(size => size === '14px'), card.title + ' styles the poem text itself');
    assert.ok(card.ellipses.every(item => item.align === 'center' && item.size === '12px'), card.title + ' keeps ellipses centered and small');
    if (original.story) {
      assert.equal(card.story.text, original.story, card.title + ' retains its explanation');
      assert.equal(card.story.size, '12px');
      assert.equal(card.story.color, 'rgb(117, 103, 125)');
      assert.match(card.story.font, /sans-serif/);
      assert.equal(card.story.align, 'left');
      assert.equal(card.story.border, '2px');
      assert.equal(card.story.padding, '9px');
    }
    assert.equal(card.indent, '0px');
    assert.equal(card.breaks, original.breaks, card.title + ' keeps its line breaks');
    assert.equal(card.sourceFooters, 0, card.title + ' omits only the source footer in the WeChat copy');
    if (original.paired) {
      assert.equal(card.background, 'rgb(247, 242, 252)');
      assert.equal(card.edge, 'rgb(223, 208, 238)');
      assert.equal(card.topEdge, 'rgb(182, 154, 204)', 'both comparison cards retain the matching purple treatment');
    }
  }

  const shortNote = rendered.cards.find(card => card.title === '《峨眉山月歌》');
  const longerNote = rendered.cards.find(card => card.title === '《渡荆门送别》');
  assert.ok(shortNote.width + 10 < longerNote.width, 'shorter verses produce a narrower exported card');
  assert.ok(new Set(rendered.cards.map(card => Math.round(card.width))).size >= 3, 'exported cards are no longer uniformly wide');

  const excerpts = [
    ['《蜀道难》', '……蜀道之难，难于上青天！……一夫当关，万夫莫开。……', '蚕丛及鱼凫'],
    ['《将进酒》', '君不见黄河之水天上来，奔流到海不复回。……人生得意须尽欢，莫使金樽空对月。天生我材必有用，千金散尽还复来。……', '烹羊宰牛且为乐'],
    ['《南陵别儿童入京》', '……仰天大笑出门去，我辈岂是蓬蒿人。', '白酒新熟山中归'],
    ['《月下独酌·其一》', '花间一壶酒，独酌无相亲。举杯邀明月，对影成三人。……', '永结无情游'],
    ['《行路难·其一》', '……停杯投箸不能食，拔剑四顾心茫然。……长风破浪会有时，直挂云帆济沧海。', '金樽清酒斗十千'],
    ['《梦游天姥吟留别》', '……安能摧眉折腰事权贵，使我不得开心颜？', '海客谈瀛洲'],
    ['《宣州谢朓楼饯别校书叔云》', '弃我去者，昨日之日不可留；乱我心者，今日之日多烦忧。……抽刀断水水更流，举杯消愁愁更愁。人生在世不称意，明朝散发弄扁舟。', '俱怀逸兴壮思飞']
  ];
  assert.equal(rendered.cards.filter(card => card.title.endsWith('· 节选')).length, copied.cards.filter(card => card.title.endsWith('· 节选')).length);
  for (const [title, verse, omittedLine] of excerpts) {
    const card = rendered.cards.find(card => card.title === title + ' · 节选');
    assert.ok(card, title + ' remains an excerpt');
    assert.equal(card.verse, verse, title + ' exports only the selected lines');
    assert.ok(card.ellipses.length > 0 && card.ellipses.every(item => item.display === 'block' && item.width > 100), title + ' places ellipses on separate lines');
    assert.ok(!rendered.text.includes(omittedLine), title + ' does not append the full poem elsewhere');
  }
  // Check actual line boxes: fitting the viewport alone misses a trailing orphan character.
  for (const width of [320, 375, 414, 677, 1024]) {
    await preview.setViewportSize({ width, height: 844 });
    const layout = await preview.evaluate(() => {
      document.body.style.letterSpacing = '2px'; // An editor's surrounding typography must not widen verses.
      const title = Array.from(document.querySelectorAll('section')).find(element =>
        !element.querySelector('section') && element.textContent.trim() === '《上李邕》');
      const card = title.parentElement;
      const verse = title.nextElementSibling.nextElementSibling;
      const rect = card.getBoundingClientRect();
      const article = document.querySelector('article');
      const articleStyle = getComputedStyle(article);
      return {
        width: rect.width, left: rect.left, right: rect.right,
        available: article.clientWidth - parseFloat(articleStyle.paddingLeft) - parseFloat(articleStyle.paddingRight),
        lineCounts: Array.from(verse.children).filter(element => element.tagName === 'SPAN').map(element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return new Set(Array.from(range.getClientRects()).filter(box => box.width > 0).map(box => box.top)).size;
        }),
        documentWidth: document.documentElement.scrollWidth
      };
    });
    assert.ok(layout.width <= Math.min(layout.available, 360), 'card fits its content without exceeding the editor width at ' + width + 'px');
    assert.deepEqual(layout.lineCounts, [1, 1, 1, 1], 'each couplet stays on one line at ' + width + 'px');
    assert.ok(layout.left >= 0 && layout.right <= width && layout.documentWidth <= width, 'no overflow at ' + width + 'px');
  }
  // Adjacent ordinary groups share one flow; the comparison pair remains a separate group.
  const blogGroups = await page.evaluate(() => {
    const grids = Array.from(document.querySelectorAll('.libai-poem-grid'));
    return {
      adjacentOrdinary: grids.filter(grid => !grid.classList.contains('libai-poem-pair') &&
        grid.nextElementSibling?.matches('.libai-poem-grid:not(.libai-poem-pair)')).length,
      pairs: grids.filter(grid => grid.classList.contains('libai-poem-pair')).map(grid =>
        Array.from(grid.querySelectorAll('.libai-poem-title')).map(title => title.textContent.trim()))
    };
  });
  assert.equal(blogGroups.adjacentOrdinary, 0, 'adjacent ordinary card containers do not force an early row break');
  assert.deepEqual(blogGroups.pairs, [['崔颢《黄鹤楼》', '李白《登金陵凤凰台》']], 'the related comparison pair stays grouped');
  for (const width of [320, 375, 414, 677, 1024]) {
    for (const [surface, target] of [['blog', page], ['wechat', preview]]) {
      await target.setViewportSize({ width, height: 900 });
      const flow = await target.evaluate(({ titles, surface }) => {
        const article = document.querySelector(surface === 'blog' ? '.markdown-section' : 'article');
        const titleSet = new Set(titles);
        const titleNodes = surface === 'blog'
          ? Array.from(article.querySelectorAll('.libai-poem-title'))
          : Array.from(article.querySelectorAll('section')).filter(section => !section.querySelector('section') && titleSet.has(section.textContent.trim()));
        const cards = titleNodes.map(title => title.parentElement);
        const groupTitles = ['《赠汪伦》', '《侠客行》 · 节选', '《秋浦歌十七首·其十五》', '《长相思·其一》 · 节选'];
        const groupCards = groupTitles.map(name => cards.find(card => titleNodes[cards.indexOf(card)].textContent.trim() === name));
        const rect = card => { const box = card.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width }; };
        return {
          sameGroup: groupCards.every(card => card.parentElement === groupCards[0].parentElement),
          group: groupCards.map(rect), cards: cards.map(rect),
          titleOrder: titleNodes.map(title => title.textContent.trim()),
          documentWidth: document.documentElement.scrollWidth
        };
      }, { titles: copied.cards.map(card => card.title), surface });
      assert.deepEqual(flow.titleOrder, copied.cards.map(card => card.title), surface + ' preserves all card ordering at ' + width + 'px');
      assert.equal(flow.sameGroup, true, surface + ' puts 赠汪伦 and subsequent poems in one flow');
      assert.ok(flow.documentWidth <= width + 1 && flow.cards.every(card => card.left >= -1 && card.right <= width + 1),
        surface + ' has no card or document horizontal overflow at ' + width + 'px');
      if (width >= 677) {
        assert.ok(Math.abs(flow.group[0].top - flow.group[1].top) < 1, surface + ' fills the first row with 赠汪伦 and 侠客行 at ' + width + 'px');
        if (surface === 'wechat') assert.ok(Math.abs(flow.group[0].top - flow.group[2].top) < 1, 'three short cards fit the wide WeChat first row');
      }
      if (width <= 375) assert.ok(flow.group[1].top >= flow.group[0].bottom - 1, surface + ' naturally wraps the next poem on a narrow screen');
      for (let i = 1; i < flow.group.length; i++) {
        const previous = flow.group[i - 1], current = flow.group[i];
        assert.ok(current.top >= previous.top - 1, surface + ' never reorders rows');
        if (Math.abs(current.top - previous.top) < 1) assert.ok(current.left >= previous.right - 1, surface + ' lays out each row left to right without overlap');
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.libai-poem-title').filter({ hasText: '《赠汪伦》' }).evaluate(title => {
    title.closest('.libai-poem-grid').scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -100, behavior: 'instant' });
  });
  await screenshot(page, 'libai-blog-continuous-poem-cards-desktop');
  await preview.setViewportSize({ width: 677, height: 900 });
  await preview.getByText('《赠汪伦》', { exact: true }).last().evaluate(title => {
    title.closest('section').parentElement.parentElement.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -16, behavior: 'instant' });
  });
  await screenshot(preview, 'libai-wechat-continuous-poem-cards-desktop');
  await preview.setViewportSize({ width: 375, height: 900 });
  await preview.getByText('《赠汪伦》', { exact: true }).last().evaluate(title => {
    title.closest('section').parentElement.parentElement.scrollIntoView({ block: 'start', behavior: 'instant' });
    window.scrollBy({ top: -16, behavior: 'instant' });
  });
  await screenshot(preview, 'libai-wechat-continuous-poem-cards-wrapped');
  const retainedSources = await page.locator('.libai-poem-card').evaluateAll(cards => cards.map(card => ({
    source: card.querySelector('.libai-poem-source')?.textContent.trim(),
    links: Array.from(card.querySelectorAll('.libai-poem-source a')).map(link => ({ text: link.textContent, href: link.getAttribute('href') }))
  })));
  assert.deepEqual(retainedSources, copied.cards.map(card => ({ source: card.source, links: card.sourceLinks })), 'exporting never removes source footers from the blog');
  const blogCards = await page.locator('.libai-poem-card').evaluateAll(cards => cards.map(card => ({
    title: card.querySelector('.libai-poem-title').textContent.trim(), width: card.getBoundingClientRect().width
  })));
  assert.ok(blogCards.find(card => card.title === '《峨眉山月歌》').width + 10 < blogCards.find(card => card.title === '《渡荆门送别》').width,
    'blog cards also size themselves to their content');
  const noteSizing = await page.evaluate(() => {
    const article = document.querySelector('.markdown-section');
    const card = Array.from(article.querySelectorAll('.libai-poem-card')).find(card => card.querySelector('.libai-poem-title').textContent.includes('《赠孟浩然》'));
    const original = card.innerHTML;
    const verseText = card.querySelector('.libai-poem-verse').textContent.trim();
    function measure() {
      const html = window.DocReadArticleCopy.buildWechatPayload(article).html;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const verse = Array.from(doc.querySelectorAll('section')).find(section => section.textContent.trim() === verseText);
      return { blog: card.getBoundingClientRect().width, copied: parseFloat(verse.parentElement.style.width) };
    }
    const before = measure();
    card.querySelector('.libai-poem-title').textContent += '很长的补充标题'.repeat(10);
    card.querySelector('.libai-poem-meta').textContent += '这里是很长的年代备注'.repeat(10);
    const note = document.createElement('div');
    note.className = 'libai-poem-story';
    note.textContent = '这是一段用来检查换行的长备注，不能把诗卡撑宽。'.repeat(10);
    card.appendChild(note);
    const after = measure();
    const wraps = note.getBoundingClientRect().height > 40 && note.scrollWidth <= note.clientWidth + 1;
    card.innerHTML = original;
    return { before, after, wraps };
  });
  assert.deepEqual(noteSizing.after, noteSizing.before, 'titles and notes do not determine card width on the blog or in the clipboard');
  assert.ok(noteSizing.wraps, 'long notes wrap within the verse-sized card');
  await page.getByText('《峨眉山月歌》', { exact: true }).last().scrollIntoViewIfNeeded();
  await screenshot(page, 'libai-blog-content-width');
  await page.getByText('《赠孟浩然》', { exact: true }).last().scrollIntoViewIfNeeded();
  await screenshot(page, 'libai-blog-verse-width-notes');
  await preview.setViewportSize({ width: 375, height: 844 });
  await preview.evaluate(() => { document.body.style.letterSpacing = ''; });
  await preview.getByText('《上李邕》', { exact: true }).last().scrollIntoViewIfNeeded();
  await screenshot(preview, 'libai-wechat-poem-cards-mobile');
  await preview.setViewportSize({ width: 677, height: 800 });
  await preview.getByText('3. 在安陆成家，结识孟浩然', { exact: true }).scrollIntoViewIfNeeded();
  await screenshot(preview, 'libai-wechat-grid-and-headings');

  // Paste may discard typography on parent blocks; the text itself must still match the blog.
  const pastedTypography = await preview.evaluate(expected => {
    const article = document.querySelector('article');
    article.querySelectorAll('*').forEach(element => {
      if (element.tagName !== 'SPAN' || element.children.length) {
        element.style.removeProperty('font-family');
        element.style.removeProperty('font-weight');
      }
    });
    article.style.fontFamily = 'sans-serif';
    article.style.fontWeight = '900';
    const paragraph = Array.from(article.querySelectorAll('p')).find(p => p.textContent === expected.text);
    const typography = element => ({ font: getComputedStyle(element).fontFamily, weight: getComputedStyle(element).fontWeight });
    return {
      body: Array.from(paragraph.querySelectorAll('span')).filter(span => span.childNodes.length === 1 && span.firstChild.nodeType === 3).map(typography),
      emphasis: Array.from(article.querySelectorAll('strong span, b span')).map(typography)
    };
  }, copied.bodyTypography);
  assert.ok(pastedTypography.body.length > 1, 'checks both ordinary text and the inline poem link');
  assert.ok(pastedTypography.body.every(style => style.font === copied.bodyTypography.font && style.weight === copied.bodyTypography.weight),
    'body text and links retain the blog font and regular weight even when parent styles are lost');
  assert.ok(pastedTypography.emphasis.length > 0 && pastedTypography.emphasis.every(style => style.weight === '700'), 'intentional emphasis stays bold');
});

test('Li Bai poem grids follow their H2 fold state while WeChat copying retains hidden poems', async t => {
  const page = await pageFor(t, { width: 375, height: 844 });
  await page.goto(origin + '/#/docs/read/' + encodeURIComponent('李长之《李白传》'));
  await page.waitForFunction(() => window.DocReadSectionFold && window.DocReadArticleCopy &&
    document.querySelectorAll('.markdown-section .libai-poem-card').length === 55 &&
    document.querySelector('.markdown-section h2 .section-fold-toggle'));
  const source = await page.evaluate(() => {
    const article = document.querySelector('.markdown-section');
    const headings = Array.from(article.querySelectorAll(':scope > h2'));
    const owners = Array.from(article.querySelectorAll('.libai-poem-grid')).map(grid => {
      let node = grid;
      while (node.parentElement !== article) node = node.parentElement;
      while (node && node.tagName !== 'H2') node = node.previousElementSibling;
      if (!node?.querySelector('.section-fold-toggle')) throw new Error('Poem grid has no foldable H2 owner');
      return headings.indexOf(node);
    });
    return {
      owners: Array.from(new Set(owners)),
      poems: Array.from(article.querySelectorAll('.libai-poem-card')).map(card => ({
        title: card.querySelector('.libai-poem-title').textContent.trim(),
        verse: card.querySelector('.libai-poem-verse').textContent.trim()
      }))
    };
  });
  assert.equal(source.poems.length, 55);
  assert.ok(source.owners.length > 0, 'find poem sections from their position, independent of section titles');

  for (const index of source.owners) {
    const heading = page.locator('.markdown-section > h2').nth(index);
    await heading.locator('.section-fold-toggle').click();
    await page.waitForFunction(index => {
      let node = document.querySelectorAll('.markdown-section > h2')[index].nextElementSibling;
      while (node && !/^H[12]$/.test(node.tagName)) {
        if (!node.hidden) return false;
        node = node.nextElementSibling;
      }
      return true;
    }, index);
    const folded = await heading.evaluate(heading => {
      const grids = [];
      let node = heading.nextElementSibling;
      while (node && !/^H[12]$/.test(node.tagName)) {
        if (node.matches('.libai-poem-grid')) grids.push(node);
        grids.push(...node.querySelectorAll('.libai-poem-grid'));
        node = node.nextElementSibling;
      }
      return {
        expanded: heading.querySelector('button').getAttribute('aria-expanded'),
        displays: grids.map(grid => getComputedStyle(grid).display),
        visiblePoems: grids.flatMap(grid => Array.from(grid.querySelectorAll('.libai-poem-card'))).filter(card => card.getClientRects().length > 0).length,
        nextHeadingVisible: !node || node.getClientRects().length > 0
      };
    });
    assert.equal(folded.expanded, 'false');
    assert.ok(folded.displays.length > 0 && folded.displays.every(display => display === 'none'), 'hidden poem grids must override their flex layout');
    assert.equal(folded.visiblePoems, 0, 'folding removes all poems in this section from layout');
    assert.equal(folded.nextHeadingVisible, true, 'the following section heading stays visible');
  }

  const copied = await page.evaluate(() => {
    const article = document.querySelector('.markdown-section');
    const before = article.outerHTML;
    const payload = window.DocReadArticleCopy.buildWechatPayload(article);
    return { html: payload.html, unchanged: article.outerHTML === before };
  });
  assert.equal(copied.unchanged, true, 'copying keeps the original sections collapsed');
  const preview = await pageFor(t, { width: 375, height: 844 });
  await preview.setContent(copied.html);
  const exported = await preview.evaluate(poems => {
    const sections = Array.from(document.querySelectorAll('article section'));
    return poems.map(poem => {
      const title = sections.find(section => !section.querySelector('section') && section.textContent.trim() === poem.title);
      const card = title?.parentElement;
      return { title: poem.title, visible: !!card?.getClientRects().length,
        verse: title?.nextElementSibling?.nextElementSibling?.textContent.trim() };
    });
  }, source.poems);
  assert.equal(exported.length, 55);
  for (const [index, poem] of exported.entries()) {
    assert.equal(poem.visible, true, poem.title + ' is present and visible in the copied article');
    assert.equal(poem.verse, source.poems[index].verse, poem.title + ' retains all its displayed lines');
  }

  for (const index of source.owners) await page.locator('.markdown-section > h2').nth(index).locator('.section-fold-toggle').click();
  assert.equal(await page.locator('.libai-poem-grid').evaluateAll(grids => grids.every(grid => !grid.hidden && getComputedStyle(grid).display === 'flex')), true, 'expanding restores the original flex layout');
  assert.equal(await page.locator('.libai-poem-card').evaluateAll(cards => cards.filter(card => card.getClientRects().length > 0).length), 55);
});

test('Idiot WeChat button preserves all heading colors and serif body after paste cleanup', async t => {
  const page = await pageFor(t);
  await page.addInitScript(() => {
    window.testCopied = [];
    document.execCommand = () => false;
    Object.defineProperty(navigator, 'clipboard', { value: { write: async items => {
      window.testCopied = await Promise.all(items.map(async item => ({
        html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text()
      })));
    } } });
  });
  await page.goto(origin + '/#/docs/read/' + encodeURIComponent('陀思妥耶夫斯基《白痴》'));
  await page.locator('#wechat-copy').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.article-reading-meta .history-reading-stats'));
  const headingText = '① 关于我决定弃读';
  const expected = await page.evaluate(text => {
    const heading = Array.from(document.querySelectorAll('.markdown-section h4')).find(element => element.textContent.trim() === text);
    const paragraph = heading.nextElementSibling;
    const bodyStyle = getComputedStyle(paragraph);
    return {
      headingText: text, headingColor: getComputedStyle(heading.querySelector('.anchor span') || heading).color,
      headingFont: getComputedStyle(heading).fontFamily, headingWeight: getComputedStyle(heading).fontWeight,
      bodyText: paragraph.textContent.trim(), bodyColor: bodyStyle.color, bodyFont: bodyStyle.fontFamily,
      bodyWeight: bodyStyle.fontWeight, bodySize: bodyStyle.fontSize, bodyIndent: bodyStyle.textIndent
    };
  }, headingText);
  assert.equal(expected.headingColor, 'rgb(52, 73, 94)', 'the real reflection heading is dark blue-gray on the blog');
  assert.equal(expected.bodyColor, 'rgb(63, 63, 63)');
  assert.match(expected.bodyFont, /"Songti SC"/);
  assert.equal(expected.bodyWeight, '400');
  assert.equal(expected.bodySize, '16px');
  assert.equal(expected.bodyIndent, '32px');

  await page.locator('#wechat-copy').click();
  await page.waitForFunction(() => window.testCopied.length > 0);
  await page.waitForFunction(() => document.getElementById('wechat-copy-toast').textContent.includes('已复制公众号富文本'));
  const copied = await page.evaluate(() => window.testCopied[0]);
  assert.ok(copied.text.includes(expected.bodyText), 'the actual copy button includes the original reflection');

  // Only clipboard HTML supplies styling in this separate document.
  const preview = await pageFor(t, { width: 900, height: 700 });
  await preview.setContent('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + copied.html + '</body></html>');
  const inspect = async clean => preview.evaluate(({ expected, clean }) => {
    const article = document.querySelector('article');
    const leafSpans = element => Array.from(element.querySelectorAll('span')).filter(span =>
      span.childNodes.length === 1 && span.firstChild.nodeType === 3 && span.textContent.trim());
    if (clean) {
      // Model a paste sanitizer discarding typography everywhere except actual text spans.
      document.querySelectorAll('*').forEach(element => {
        const isTextSpan = element.tagName === 'SPAN' && element.childNodes.length === 1 && element.firstChild.nodeType === 3;
        if (!isTextSpan) ['color', 'font-family', 'font-weight'].forEach(property => element.style.removeProperty(property));
      });
      document.body.style.color = '#ff00ff';
      document.body.style.fontFamily = 'sans-serif';
      document.body.style.fontWeight = '900';
    }
    const typography = element => {
      const style = getComputedStyle(element);
      return { color: style.color, font: style.fontFamily, weight: style.fontWeight, size: style.fontSize };
    };
    const headings = Array.from(article.querySelectorAll('h2, h3, h4')).map(heading => ({
      tag: heading.tagName, text: heading.textContent.trim(), visible: !!heading.getClientRects().length,
      runs: leafSpans(heading).map(typography)
    }));
    const heading = Array.from(article.querySelectorAll('h4')).find(element => element.textContent.trim() === expected.headingText);
    const paragraph = heading.nextElementSibling;
    return {
      headings, bodyText: paragraph.textContent.trim(), bodyVisible: !!paragraph.getClientRects().length,
      bodyIndent: getComputedStyle(paragraph).textIndent, bodyRuns: leafSpans(paragraph).map(typography)
    };
  }, { expected, clean });
  const before = await inspect(false);
  assert.deepEqual([...new Set(before.headings.map(heading => heading.tag))].sort(), ['H2', 'H3', 'H4']);
  for (const heading of before.headings) {
    assert.equal(heading.visible, true, heading.text + ' is visible in the exported article');
    assert.ok(heading.runs.length > 0, heading.text + ' has actual styled text runs');
    const expectedColor = heading.tag === 'H2' ? 'rgb(132, 38, 236)' : 'rgb(52, 73, 94)';
    assert.ok(heading.runs.every(run => run.color === expectedColor && run.font === expected.headingFont && run.weight === expected.headingWeight),
      heading.text + ' retains the shared heading colors and typography');
    if (heading.tag === 'H4') {
      assert.ok(heading.runs.every(run => run.size === '16.8px'), heading.text + ' keeps the blog 16.8px size on the copied text');
    }
  }
  assert.equal(before.bodyText, expected.bodyText);
  assert.equal(before.bodyVisible, true);
  assert.equal(before.bodyIndent, expected.bodyIndent, 'ordinary paragraphs retain the two-character indent');
  assert.ok(before.bodyRuns.length > 0);
  assert.ok(before.bodyRuns.every(run => run.color === expected.bodyColor && run.font === expected.bodyFont &&
    run.weight === expected.bodyWeight && run.size === expected.bodySize), 'the reflection body matches the blog serif typography');
  await preview.getByRole('heading', { name: headingText, exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
  await screenshot(preview, 'idiot-wechat-typography');

  const after = await inspect(true);
  assert.deepEqual(after, before, 'all H2/H3/H4 text and the reflection body keep their colors and fonts when parent styles are removed');
});

test('nested H3/H4 folds preserve child state and export complete articles without controls', async t => {
  const page = await pageFor(t, { width: 375, height: 844 });
  await page.goto(origin + '/#/docs/read/' + encodeURIComponent('蒙曼《唐玄宗》'));
  await page.waitForFunction(() => window.DocReadArticleCopy &&
    document.querySelectorAll('.markdown-section > h4 .section-fold-toggle').length === 41);
  const part = page.locator('.markdown-section > h3').filter({ hasText: '第一部分' });
  const chapter = page.locator('.markdown-section > h4').first();
  const chapterButton = chapter.locator('.section-fold-toggle');
  const partButton = part.locator('.section-fold-toggle');
  assert.equal(await page.locator('.markdown-section > :is(h3,h4) .section-fold-toggle[aria-expanded="false"]').count(), 0,
    'all new subsection controls start expanded');

  const compact = await chapterButton.evaluate(button => {
    const style = getComputedStyle(button);
    const glyph = getComputedStyle(button.querySelector('span'));
    const rect = button.getBoundingClientRect();
    return { background: style.backgroundImage, shadow: style.boxShadow, border: style.borderWidth,
      glyphWidth: parseFloat(glyph.width), width: rect.width, left: rect.left, right: rect.right, viewport: innerWidth };
  });
  assert.equal(compact.background, 'none');
  assert.equal(compact.shadow, 'none');
  assert.equal(compact.border, '0px');
  assert.ok(compact.glyphWidth <= 8, 'the symbol is visually small');
  assert.ok(compact.width >= 20, 'the small symbol keeps a usable click target');
  assert.ok(compact.left >= 0 && compact.right <= compact.viewport, 'the control stays inside the mobile page');

  const selectionCopy = await page.evaluate(() => {
    const article = document.querySelector('.markdown-section');
    const part = Array.from(article.querySelectorAll(':scope > h3')).find(node => node.textContent.includes('第一部分'));
    const chapter = article.querySelector(':scope > h4');
    const paragraph = chapter.nextElementSibling;
    const range = document.createRange();
    range.setStartBefore(part);
    range.setEndAfter(paragraph);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const originalText = selection.toString();
    const originalHtml = article.outerHTML;
    const clipboardData = new DataTransfer();
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData });
    document.dispatchEvent(event);
    const result = { html: clipboardData.getData('text/html'), text: clipboardData.getData('text/plain'), originalText,
      selectedPoint: paragraph.textContent.trim(), nextPoint: paragraph.nextElementSibling.textContent.trim(),
      handled: event.defaultPrevented, unchanged: article.outerHTML === originalHtml && selection.toString() === originalText };
    selection.removeAllRanges();
    return result;
  });
  assert.equal(selectionCopy.handled, true, 'manual selection copy strips page controls');
  assert.equal(selectionCopy.text, selectionCopy.originalText, 'manual copy preserves the exact selected plain text');
  assert.match(selectionCopy.html, /第一部分/);
  assert.doesNotMatch(selectionCopy.html, /<button|section-fold-toggle|aria-expanded|aria-label/);
  assert.ok(selectionCopy.text.includes(selectionCopy.selectedPoint));
  assert.ok(!selectionCopy.text.includes(selectionCopy.nextPoint), 'manual copy does not enlarge the selection');
  assert.equal(selectionCopy.unchanged, true);

  await chapterButton.click();
  await page.waitForFunction(() => document.querySelector('.markdown-section > h4').nextElementSibling.hidden);
  assert.equal(await page.locator('.markdown-section > h4').nth(1).isVisible(), true, 'the next chapter is unaffected');
  await partButton.click();
  await page.waitForFunction(() => document.querySelector('.markdown-section > h4').hidden);
  await partButton.click();
  await chapter.waitFor({ state: 'visible' });
  assert.equal(await chapterButton.getAttribute('aria-expanded'), 'false');
  assert.equal(await chapter.evaluate(heading => heading.nextElementSibling.hidden), true,
    'reopening the part preserves its collapsed chapter');
  await chapterButton.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.markdown-section > h4').nextElementSibling.hidden);
  assert.equal(await chapterButton.getAttribute('aria-expanded'), 'true', 'the compact control supports the keyboard');
  await chapterButton.click();
  await page.waitForFunction(() => document.querySelector('.markdown-section > h4').nextElementSibling.hidden);
  await partButton.click();
  await page.waitForFunction(() => document.querySelector('.markdown-section > h4').hidden);

  const copied = await page.evaluate(() => {
    const article = document.querySelector('.markdown-section');
    const before = article.outerHTML;
    const expectedChapters = Array.from(article.querySelectorAll(':scope > h4')).map(heading => heading.textContent.trim());
    const expectedPoints = Array.from(article.querySelectorAll(':scope > p')).map(node => node.textContent.trim())
      .filter(text => /^[①-⑳]/.test(text));
    const wechat = window.DocReadArticleCopy.buildWechatPayload(article);
    const zhihu = window.DocReadArticleCopy.buildZhihuPayload(article);
    return { expectedChapters, expectedPoints, wechat, zhihu, unchanged: before === article.outerHTML };
  });
  assert.equal(copied.unchanged, true, 'both exports leave the nested fold states untouched');
  assert.equal(copied.expectedChapters.length, 41);
  assert.equal(copied.expectedPoints.length, 130, 'includes chapter points plus the foreword and timeline');
  for (const [platform, payload] of Object.entries({ wechat: copied.wechat, zhihu: copied.zhihu })) {
    assert.doesNotMatch(payload.html, /<button|section-fold|data-fold-key|aria-expanded|aria-label|\shidden(?:[=>\s]|$)/,
      platform + ' contains no fold control or hidden-state markup');
    assert.doesNotMatch(payload.text, /折叠“|展开“/);
    for (const text of copied.expectedChapters.concat(copied.expectedPoints)) {
      assert.ok(payload.text.includes(text), platform + ' keeps ' + text);
    }
    const visible = await page.evaluate(html => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return Array.from(doc.querySelectorAll('h4, p')).every(node => !node.hidden && node.style.display !== 'none');
    }, payload.html);
    assert.equal(visible, true, platform + ' makes the folded content visible in the export');
  }
  await partButton.click();
  await chapter.waitFor({ state: 'visible' });
  await chapterButton.click();
  await page.waitForFunction(() => !document.querySelector('.markdown-section > h4').nextElementSibling.hidden &&
    !document.querySelector('.is-fold-entering, .is-fold-leaving'));
  await chapterButton.evaluate(button => Promise.allSettled(button.getAnimations({ subtree: true }).map(animation => animation.finished)));
  await part.evaluate(heading => window.scrollTo({ top: window.scrollY + heading.getBoundingClientRect().top - 90, behavior: 'instant' }));
  await screenshot(page, 'nested-fold-controls-mobile');
  await page.setViewportSize({ width: 1280, height: 900 });
  await part.evaluate(heading => window.scrollTo({ top: window.scrollY + heading.getBoundingClientRect().top - 150, behavior: 'instant' }));
  await screenshot(page, 'nested-fold-controls-desktop');
});

test('library subheadings also receive expanded compact fold controls', async t => {
  const page = await pageFor(t);
  await page.goto(origin + '/#/docs/library');
  await page.waitForFunction(() => document.querySelectorAll('.markdown-section > h3 .section-fold-toggle-compact').length > 0);
  const buttons = page.locator('.markdown-section > h3 .section-fold-toggle-compact');
  assert.ok(await buttons.count() > 1, 'navigation pages also support subsection folding');
  assert.equal(await buttons.evaluateAll(nodes => nodes.every(button => button.getAttribute('aria-expanded') === 'true')), true);
  await buttons.first().click();
  await page.waitForFunction(() => document.querySelector('.markdown-section > h3').nextElementSibling.hidden);
  assert.equal(await page.locator('.markdown-section > h3').nth(1).isVisible(), true);
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
  assert.equal(exported.date, true);
  const metadata = await page.locator('.article-reading-meta').textContent();
  const expectedMetadata = metadata.trim().replace(/\s*(总字数[：:]|预计阅读[：:])/g, '　$1').trim();
  assert.equal(copied.text.split('\n')[0], expectedMetadata);
  assert.match(copied.text.split('\n')[0], /总字数[：:].+　预计阅读[：:]/);
  assert.equal(await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelector('article').firstElementChild.tagName, copied.html), 'P', 'export begins with the reading metadata');
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

test('Zhihu export compacts images and groups excerpts without losing content', async t => {
  const page = await pageFor(t);
  const filename = '赫尔曼·黑塞《德米安》';
  await page.goto(origin + '/#/docs/read/' + encodeURIComponent(filename));
  await page.waitForFunction(() => window.DocReadArticleCopy && window.marked);
  await page.locator('.article-reading-meta').waitFor();
  const result = await page.evaluate(async filename => {
    const markdown = await (await fetch('/docs/read/' + encodeURIComponent(filename) + '.md')).text();
    const source = document.createElement('article');
    source.innerHTML = window.marked(markdown.replace(/^# .+\r?\n/, ''));
    const original = source.innerHTML;
    const payload = window.DocReadArticleCopy.buildZhihuPayload(source);
    const wechat = window.DocReadArticleCopy.buildWechatPayload(source);
    const renderedSource = document.querySelector('.markdown-section');
    const renderedOriginal = renderedSource.innerHTML;
    const rendered = window.DocReadArticleCopy.buildZhihuPayload(renderedSource);
    const renderedDoc = new DOMParser().parseFromString(rendered.html, 'text/html');
    const exported = new DOMParser().parseFromString(payload.html, 'text/html');
    const article = exported.querySelector('article');
    const fixture = document.createElement('article');
    fixture.innerHTML = `
      <h1 title="主标题 | 副标题问句">主标题 | 副标题问句</h1>
      <p class="article-reading-meta"><span>date: 2026-09-10</span><span class="history-reading-stats">总字数：100 字</span></p>
      <h2>图片与正文</h2>
      <p> </p><p><br></p><p>\u200b</p><hr>
      <p> <img src="https://example.com/first.jpg" alt="第一图"> </p>
      <p><img src="https://example.com/second.jpg" alt="第二图"></p>
      <p>alpha <strong>beta</strong> gamma<br>delta</p>
      <p> \t<span>　　<strong>　 已有缩进</strong></span>保留强调</p>
      <p>正文日期：2026-09-10，应保留。</p><p>date: 2020-01-01 是正文里的日期说明。</p>
      <p><img src="https://example.com/caption.jpg">图注仍在</p>
      <ul><li><p>列表段落</p></li></ul>
      <table><tbody><tr><td><p>表格段落</p></td></tr></tbody></table>
      <p><code>代码段落</code></p>
      <figure><figcaption><p>图注段落</p></figcaption></figure>
      <p class="libai-poem-verse">诗歌首句<br>诗歌次句</p>
      <pre>  first\n    second</pre>
      <h3>第一章</h3><blockquote>甲 <em>乙</em></blockquote>
      <blockquote>丙<br>丁</blockquote><h3>第二章</h3><blockquote><p>戊</p></blockquote>
    `;
    const fixtureOriginal = fixture.innerHTML;
    const compact = window.DocReadArticleCopy.buildZhihuPayload(fixture);
    const fixtureDoc = new DOMParser().parseFromString(compact.html, 'text/html');
    return {
      payload,
      wechatText: wechat.text,
      rendered,
      renderedTitle: renderedDoc.querySelector('h1').textContent,
      renderedTitleTooltip: renderedDoc.querySelector('h1').getAttribute('title'),
      renderedUnchanged: renderedSource.innerHTML === renderedOriginal,
      sourceUnchanged: source.innerHTML === original,
      repeated: window.DocReadArticleCopy.buildZhihuPayload(source).html === payload.html,
      imageCount: article.querySelectorAll('img').length,
      directImages: article.querySelectorAll(':scope > img').length,
      ordinaryParagraphs: Array.from(article.querySelectorAll(':scope > p')).map(p => p.textContent),
      excerptParagraphs: Array.from(article.querySelectorAll('blockquote p')).map(p => p.textContent),
      nativeHeadings: Array.from(article.querySelectorAll('h2, h3, h4, h5, h6')).map(h => ({
        level: Number(h.tagName.slice(1)), text: h.textContent.trim()
      })),
      equationCount: article.querySelectorAll('.ztext-math, [data-eeimg], img[eeimg]').length,
      emptyParagraphs: Array.from(article.querySelectorAll('p')).filter(p => !p.textContent.trim() && !p.querySelector('img')).length,
      chapterExcerptCounts: Array.from(article.querySelectorAll('blockquote')).map(q => q.querySelectorAll('p').length),
      compact,
      fixtureTitle: fixtureDoc.querySelector('h1').textContent,
      fixtureUnchanged: fixture.innerHTML === fixtureOriginal,
      inlineText: fixtureDoc.querySelector('strong').parentElement.innerHTML,
      preText: fixtureDoc.querySelector('pre').textContent,
      fixtureImageCount: fixtureDoc.querySelectorAll('img').length,
      retainedCaption: fixtureDoc.querySelector('img[src$="caption.jpg"]').parentElement.textContent,
      normalizedIndent: Array.from(fixtureDoc.querySelectorAll('p')).find(p => p.textContent.includes('已有缩进')).textContent,
      excludedParagraphs: Array.from(fixtureDoc.querySelectorAll('li p, td p, figcaption p, p:has(code)')).map(p => p.textContent),
      verseParagraph: Array.from(fixtureDoc.querySelectorAll('p')).find(p => p.textContent.includes('诗歌首句')).textContent,
      rootWhitespace: Array.from(fixtureDoc.querySelector('article').childNodes).filter(n => n.nodeType === 3 && !n.nodeValue.trim()).length,
      quoteBreaks: fixtureDoc.querySelector('blockquote').querySelectorAll('br').length
    };
  }, filename);
  assert.equal(result.sourceUnchanged, true);
  assert.equal(result.repeated, true);
  assert.match(result.payload.text, /一、书籍简介/);
  assert.doesNotMatch(result.payload.text, /ISBN|9787201159096|1\. 书籍简介|2\. 书籍信息|3\. 阅读记录|一阅完成/);
  assert.doesNotMatch(result.payload.text, /date: 2026-09-10/);
  assert.match(result.wechatText, /date: 2026-09-10/);
  assert.equal(result.renderedUnchanged, true);
  assert.equal(result.renderedTitle, '赫尔曼·黑塞《德米安》思维导图、人物关系图、每章情节解析');
  assert.equal(result.renderedTitleTooltip, null);
  assert.doesNotMatch(result.rendered.text, /date: 2026-09-10|如果不再做别人眼中的好孩子，你会成为谁？/);
  assert.match(result.payload.text, /确实不错，不过我还是看的云里雾里的，哲学精神还不够。/);
  assert.equal(result.imageCount, 4);
  assert.equal(result.directImages, 4);
  assert.ok(result.ordinaryParagraphs.length > 10);
  assert.ok(result.ordinaryParagraphs.every(text => /^\u3000{2}[^\s]/.test(text)), 'ordinary prose has exactly two full-width spaces');
  assert.ok(result.excerptParagraphs.every(text => !/^\u3000/.test(text)), 'quoted excerpts remain unindented');
  assert.equal(result.nativeHeadings.length, 23);
  assert.equal(result.payload.headingColor, undefined);
  assert.equal(result.payload.autoCatalog, true);
  assert.equal(result.payload.headings.length, 23);
  assert.doesNotMatch(result.payload.text, /\\color|\\textbf/);
  assert.deepEqual(result.nativeHeadings, result.payload.headings);
  assert.equal(result.equationCount, 0);
  assert.doesNotMatch(result.payload.html, /\\color|\\textbf|ztext-math/);
  assert.equal(result.emptyParagraphs, 0);
  assert.equal(result.payload.quoteCount, 8);
  assert.equal(result.payload.excerptCount, 15);
  assert.deepEqual(result.chapterExcerptCounts, [2, 1, 1, 2, 4, 2, 2, 1]);
  assert.doesNotMatch(result.payload.html, /\u200b|<hr\b/);
  assert.equal(result.fixtureUnchanged, true);
  assert.equal(result.fixtureTitle, '主标题');
  assert.doesNotMatch(result.compact.text, /date: 2026-09-10|总字数：100 字|副标题问句/);
  assert.match(result.compact.text, /正文日期：2026-09-10，应保留。/);
  assert.match(result.compact.text, /date: 2020-01-01 是正文里的日期说明。/);
  assert.equal(result.inlineText, '　　alpha <strong>beta</strong> gamma<br>delta');
  assert.equal(result.normalizedIndent, '　　已有缩进保留强调');
  assert.deepEqual(result.excludedParagraphs, ['列表段落', '表格段落', '代码段落', '图注段落']);
  assert.equal(result.verseParagraph, '诗歌首句诗歌次句');
  assert.equal(result.preText, '  first\n    second');
  assert.equal(result.fixtureImageCount, 3);
  assert.equal(result.retainedCaption, '图注仍在');
  assert.equal(result.rootWhitespace, 0);
  assert.equal(result.compact.quoteCount, 2);
  assert.equal(result.compact.excerptCount, 3);
  assert.equal(result.quoteBreaks, 2, 'raw quote text has a boundary break and keeps its explicit break');
  assert.match(result.compact.text, /alpha beta gamma\ndelta/);
  assert.doesNotMatch(result.compact.html, /\u200b|<hr\b/);
});

test('World History WeChat copy aligns each episode note number', async t => {
  const page = await pageFor(t, { width: 375, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { write: async ([item]) => {
      window.copiedHistory = await (await item.getType('text/html')).text();
    } } });
  });
  await page.goto(origin + '/#/docs/read-history/' + encodeURIComponent('《世界通史》纪录片学习笔记'));
  await page.locator('#wechat-copy').click();
  await page.waitForFunction(() => window.copiedHistory);
  const preview = await pageFor(t, { width: 375, height: 800 });
  await preview.setContent(await page.evaluate(() => window.copiedHistory));
  const episodes = await preview.evaluate(() => [96, 97].map(episode => {
    const heading = Array.from(document.querySelectorAll('h3')).find(element => element.textContent.startsWith('第' + episode + '集'));
    const rows = Array.from(heading.nextElementSibling.nextElementSibling.querySelectorAll(':scope > p'));
    return rows.map(row => {
      const text = document.createTreeWalker(row, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      return { number: range.toString(), left: range.getBoundingClientRect().left };
    });
  }));
  for (const rows of episodes) {
    assert.deepEqual(rows.map(row => row.number), ['①', '②', '③', '④']);
    assert.ok(rows.every(row => row.left === rows[0].left));
  }
});
