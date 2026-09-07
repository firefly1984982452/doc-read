import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { puppeteer } from '../../node_modules/chrome-devtools-mcp/build/src/third_party/index.js';

export function coverMatches(title, names) {
  const book = title.match(/《([^》]+)》/)?.[1] || title;
  const normalize = value => value.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  return names.filter(name => /\.(png|jpe?g)$/i.test(name) && normalize(name).includes(normalize(book)));
}

export function draftKey(relative, markdown) {
  return createHash('sha256').update(relative + '\n' + markdown).digest('hex');
}

export function missingTextLines(payload, actual) {
  const normalize = value => String(value).replace(/\s|\u200b/g, '');
  const imageAlts = new Set((payload.imageAlts || []).map(normalize));
  const text = normalize(actual);
  return payload.text.split('\n').map(s => normalize(s).replace(/^[-]/, ''))
    .filter(line => line && !imageAlts.has(line) && !text.includes(line));
}

export async function fillDraftTitle(page, title) {
  // Fill through the editor's input events; simulated character typing can
  // silently lose Chinese text while the controlled editor is mounting.
  await page.locator('textarea').fill(title);
  await page.waitForFunction(expected => document.querySelector('textarea')?.value === expected, { timeout: 15_000 }, title);
  // Commit the controlled title field before changing the article body.
  await page.keyboard.press('Tab');
}

export async function checkDraftInPlace(editor, title) {
  // DOM validation only: no second tab, navigation, reload, or claim of persistence.
  verifyDraftTitle(await editor.$eval('textarea', e => e.value), title);
  return editor;
}

export function verifyDraftTitle(actual, expected) {
  if (actual !== expected) throw new Error('标题保存校验未通过，请检查知乎标题；没有发布');
}

export async function sendZhihuDraft({ relative, markdown, payload, title, progress }) {
  const coverRoot = path.join(homedir(), 'Downloads/codex-图片生成/公众号图片');
  const names = coverMatches(title, await fs.readdir(coverRoot).catch(() => []));
  const stateRoot = path.join(homedir(), 'Library/Application Support/doc-read');
  const stateFile = path.join(stateRoot, 'zhihu-drafts.json');
  const key = draftKey(relative, markdown);
  let saved = {};
  try { saved = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch { /* First run. */ }
  progress('连接 Chrome；若弹出远程调试授权，请点击允许…', 20);
  const browser = await puppeteer.connect({ channel: 'chrome', defaultViewport: null, protocolTimeout: 60_000 });
  let page;
  try {
    // Never navigate, replace, or close a user-owned editor tab.
    page = await browser.newPage();
    await page.goto('https://zhuanlan.zhihu.com/write', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.bringToFront();
    progress('等待知乎登录和编辑器就绪（必要时请在 Chrome 登录）…', 30);
    await page.waitForSelector('textarea,[contenteditable="true"]', { timeout: 120_000 });
    // Local file JSONP has no trustworthy Origin header. Require an explicit
    // confirmation in Chrome before a local request can transfer private notes.
    progress('请在 Chrome 确认本次草稿导入…', 35);
    let approved = false;
    // Use a normal, visible DOM confirmation, never auto-accept browser dialogs.
    await page.evaluate(title => {
      const box = document.createElement('dialog');
      box.id = 'doc-read-draft-confirm';
      const p = document.createElement('p');
      p.textContent = 'doc-read 请求导入：' + title + '。仅保存知乎草稿，不发布。';
      const yes = document.createElement('button'); yes.textContent = '确认导入草稿';
      const no = document.createElement('button'); no.textContent = '取消';
      yes.onclick = () => { box.dataset.answer = 'yes'; box.close(); };
      no.onclick = () => { box.dataset.answer = 'no'; box.close(); };
      box.oncancel = () => { box.dataset.answer = 'no'; };
      box.append(p, yes, no); document.body.append(box); box.showModal();
    }, title);
    await page.waitForFunction(() => document.getElementById('doc-read-draft-confirm')?.dataset.answer, { timeout: 120_000 });
    approved = await page.$eval('#doc-read-draft-confirm', e => e.dataset.answer === 'yes');
    await page.$eval('#doc-read-draft-confirm', e => e.remove());
    if (!approved) throw new Error('已取消导入，没有修改文章');
    let resume = false;
    if (saved[key]?.formatVersion === 2 && saved[key]?.url && /^https:\/\/zhuanlan\.zhihu\.com\/p\/\d+\/edit$/.test(saved[key].url)) {
      await page.goto(saved[key].url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('textarea');
      if (await page.$eval('textarea', e => e.value) === title) {
        if (saved[key].complete) return { draftUrl: saved[key].url, warning: '已打开这篇笔记之前生成的草稿，没有覆盖其后续编辑。' };
        resume = true;
      } else {
        throw new Error('原草稿标题已被修改，请手动检查；没有覆盖内容');
      }
    }
    await page.waitForSelector('[contenteditable="true"]');
    const empty = await page.evaluate(() => !document.querySelector('textarea').value.trim() && !document.querySelector('[contenteditable="true"]').innerText.trim());
    if (!empty && !resume) throw new Error('编辑器已有内容，为避免覆盖已停止');
    if (!resume) {
    progress('填入标题、正文和思维导图…', 45);
    await fillDraftTitle(page, title);
    await page.evaluate(payload => {
      const editor = document.querySelector('[contenteditable="true"]');
      editor.focus();
      const data = new DataTransfer();
      data.setData('text/html', payload.html); data.setData('text/plain', payload.text);
      editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, payload);
    await page.waitForFunction(() => document.querySelector('[contenteditable="true"]')?.innerText.length > 20);
    }
    await page.evaluate(() => {
      if (document.querySelector('.Catalog-TitleIcon')) return;
      const button = document.querySelector('button[aria-label="目录"]');
      if (!button) throw new Error('未找到知乎目录按钮');
      button.click();
    });
    let warning = '';
    let cover = names.length === 1 ? names[0] : '';
    if (names.length > 1) {
      progress('找到多个封面，请在 Chrome 选择…', 60);
      await page.evaluate(names => {
        const box = document.createElement('dialog'); box.id = 'doc-read-cover-choice';
        const text = document.createElement('p'); text.textContent = '请选择这篇文章的公众号封面'; box.append(text);
        names.forEach(name => { const b = document.createElement('button'); b.textContent = name; b.onclick = () => {box.dataset.choice = name; box.close();}; box.append(b, document.createElement('br')); });
        box.oncancel = () => {box.dataset.choice = '__skip__';}; document.body.append(box); box.showModal();
      }, names);
      await page.waitForFunction(() => document.getElementById('doc-read-cover-choice')?.dataset.choice, { timeout: 120_000 });
      cover = await page.$eval('#doc-read-cover-choice', e => e.dataset.choice);
      await page.$eval('#doc-read-cover-choice', e => e.remove());
      if (!names.includes(cover)) cover = '';
    }
    const needsCover = !await page.$('img[alt="封面图"]');
    if (cover && needsCover) {
      progress('上传公众号封面…', 70);
      const file = await fs.realpath(path.join(coverRoot, cover));
      const realRoot = await fs.realpath(coverRoot);
      if (!file.startsWith(realRoot + path.sep)) throw new Error('封面不在允许的图片目录');
      const chooserPromise = page.waitForFileChooser({ timeout: 15_000 });
      await page.evaluate(() => {
        const el = Array.from(document.querySelectorAll('label')).find(e => e.textContent.trim() === '添加文章封面');
        if (!el) throw new Error('未找到知乎封面上传入口');
        el.click();
      });
      await (await chooserPromise).accept([file]);
      // A crop dialog requires human judgement; do not crop away cover text.
      progress('封面已提交；如知乎出现裁剪窗口，请确认完整保留文字后保存…', 80);
    } else if (!cover && needsCover) warning = '没有选定匹配封面，请在知乎手动添加。';
    progress('等待图片转存及草稿保存…', 85);
    await page.waitForFunction(() => /\/p\/\d+\/edit/.test(location.pathname) && !document.body.innerText.includes('草稿保存中'), { timeout: 120_000 });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[contenteditable="true"] img')).every(i => i.complete && i.naturalWidth > 0 && /zhihu|zhimg/.test(i.src)), { timeout: 120_000 });
    if (cover) {
      await page.waitForFunction(() => { const image = document.querySelector('img[alt="封面图"]'); return image?.complete && image.naturalWidth > 0; }, { timeout: 120_000 });
    }
    await checkDraftInPlace(page, title);
    await page.waitForSelector('[contenteditable="true"]');
    verifyDraftTitle(await page.$eval('textarea', e => e.value), title);
    const actual = await page.$eval('[contenteditable="true"]', e => e.innerText);
    if (missingTextLines(payload, actual).length) throw new Error('正文完整性校验未通过，请检查已创建的知乎草稿');
    const actualQuotes = await page.$$eval('[contenteditable="true"] blockquote', items => items.length);
    if (Number.isInteger(payload.quoteCount) && actualQuotes !== payload.quoteCount) throw new Error(`书摘分段校验未通过：应为 ${payload.quoteCount} 条引用，实际 ${actualQuotes} 条`);
    if (payload.quotes) {
      const quotes = await page.$$eval('[contenteditable="true"] blockquote', items => items.map(e => e.textContent));
      const normalize = text => text.replace(/\s|\u200b/g, '');
      if (payload.quotes.some((quote, i) => normalize(quote) !== normalize(quotes[i] || ''))) throw new Error('书摘逐条校验未通过，请检查草稿中的重复或缺失内容');
    }
    const imageCount = (payload.html.match(/<img\b/g) || []).length;
    await page.waitForFunction(count => {
      const images = Array.from(document.querySelectorAll('[contenteditable="true"] img'));
      return images.length === count && images.every(i => i.complete && i.naturalWidth > 0);
    }, { timeout: 60_000 }, imageCount);
    const draftUrl = page.url();
    if (!await page.$('.Catalog-TitleIcon')) throw new Error('目录保存校验未通过');
    if (cover) await page.waitForFunction(() => { const image = document.querySelector('img[alt="封面图"]'); return image?.complete && image.naturalWidth > 0; }, { timeout: 60_000 });
    saved[key] = { url: draftUrl, title, complete: true, formatVersion: 2 };
    await fs.mkdir(stateRoot, { recursive: true });
    await fs.writeFile(stateFile, JSON.stringify(saved, null, 2));
    return { draftUrl, warning: [warning, '请确认知乎显示草稿已保存后再关闭；本地助手不会刷新编辑页。'].filter(Boolean).join(' ') };
  } catch (error) {
    if (page && /^https:\/\/zhuanlan\.zhihu\.com\/p\/\d+\/edit$/.test(page.url())) {
      const matches = await page.$eval('textarea', e => e.value).then(value => value === title).catch(() => false);
      if (matches && (!saved[key]?.complete || saved[key]?.formatVersion !== 2)) {
        saved[key] = { url: page.url(), title, complete: false, formatVersion: 2 };
        await fs.mkdir(stateRoot, { recursive: true });
        await fs.writeFile(stateFile, JSON.stringify(saved, null, 2));
      }
      error.draftUrl = page.url();
    }
    throw error;
  } finally {
    await browser.disconnect();
  }
}
