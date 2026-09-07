import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { extractArticleTitle, planScreenshotPositions, safeFolderName } from './lib/xhs-export.mjs';
import { sendZhihuDraft } from './lib/zhihu-draft.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const writableRoots = [path.join(root, 'docs/read'), path.join(root, 'docs/read-history')];
const jobs = new Map();
let runningJob = '';

async function loadEnvFile(file) {
  try {
    const source = await fs.readFile(file, 'utf8');
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await loadEnvFile(path.join(root, '.env'));
await loadEnvFile(path.join(root, '.env.local'));
await loadEnvFile(path.join(homedir(), '.codex', '.env'));

const host = '127.0.0.1';
const port = Number(process.env.DOC_READ_XHS_PORT) || 3002;
const outputRoot = path.resolve(expandHome(process.env.DOC_READ_XHS_OUTPUT_ROOT || '~/Downloads/小红书-待上传'));
const defaultSiteOrigin = process.env.DOC_READ_SITE_ORIGIN || 'http://127.0.0.1:3000/';
const allowedOrigins = configuredOrigins();

function expandHome(value) {
  return String(value || '').replace(/^~(?=$|\/)/, homedir());
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function callbackId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw Object.assign(new Error('无效的本地页面回调'), { status: 400 });
  return id;
}

function sendScriptResponse(response, callback, body) {
  const id = callbackId(callback);
  const payload = JSON.stringify(body).replace(/[\u2028\u2029]/g, character => character === '\u2028' ? '\\u2028' : '\\u2029');
  response.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(`window.DocReadXhsJsonp&&window.DocReadXhsJsonp[${JSON.stringify(id)}]&&window.DocReadXhsJsonp[${JSON.stringify(id)}](${payload});`);
}

function configuredOrigins() {
  const origins = new Set();
  const configured = [defaultSiteOrigin, ...String(process.env.DOC_READ_ALLOWED_ORIGINS || '').split(',')];
  for (const value of configured) {
    try {
      const url = new URL(String(value || '').trim());
      if (!/^https?:$/.test(url.protocol)) continue;
      origins.add(url.origin);
      if (/^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)) {
        for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
          origins.add(`${url.protocol}//${hostname}${url.port ? `:${url.port}` : ''}`);
        }
      }
    } catch { /* Ignore malformed optional origins. */ }
  }
  return origins;
}

function loopbackOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^https?:$/.test(url.protocol) || !/^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)) return '';
    return url.origin;
  } catch { return ''; }
}

function normalizedSiteOrigin(value) {
  const requested = String(value || '').trim();
  if (requested) {
    let url;
    try { url = new URL(requested); } catch { /* Validate as a loopback URL below. */ }
    if (url?.protocol === 'file:') {
      try {
        url.hash = '';
        url.search = '';
        const entry = path.resolve(fileURLToPath(url));
        const expected = path.resolve(root, 'index.html');
        if (entry !== expected) throw new Error();
        return url.href;
      } catch {
        throw Object.assign(new Error('本地截图只允许访问当前项目的 index.html'), { status: 403 });
      }
    }
    const requestedOrigin = loopbackOrigin(requested);
    if (!requestedOrigin) throw new Error('移动端截图只允许访问当前项目的 index.html 或本机 Docsify 服务');
    return requestedOrigin + '/';
  }
  const origin = loopbackOrigin(defaultSiteOrigin);
  if (!origin) throw new Error('移动端截图只允许访问本机 Docsify 服务');
  return origin + '/';
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (origin === 'null') return false;
  if (origin && !loopbackOrigin(origin) && !allowedOrigins.has(origin)) return false;
  response.setHeader('Access-Control-Allow-Origin', origin || '*');
  response.setHeader('Vary', 'Origin');
  return true;
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw Object.assign(new Error('请求内容过大'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('请求内容不是有效 JSON'); }
}

async function readableMarkdown(relative) {
  if (!/^(?:docs\/read|docs\/read-history)\/.+\.md$/.test(relative)) {
    throw Object.assign(new Error('只允许导出阅读笔记 Markdown'), { status: 403 });
  }
  const candidate = path.resolve(root, relative);
  const real = await fs.realpath(candidate).catch(() => '');
  if (!real || !writableRoots.some(directory => real.startsWith(directory + path.sep))) {
    throw Object.assign(new Error('找不到当前阅读笔记原文件'), { status: 404 });
  }
  return { file: real, markdown: await fs.readFile(real, 'utf8') };
}

function cleanJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    title: job.title,
    outputDirectory: job.outputDirectory || '',
    screenshotCount: job.screenshotCount || 0,
    warning: job.warning || '',
    error: job.error || '',
    draftUrl: job.draftUrl || ''
  };
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function stamp() {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function uniqueOutputDirectory(title) {
  await fs.mkdir(outputRoot, { recursive: true });
  const base = path.join(outputRoot, safeFolderName(title));
  const suffix = stamp();
  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? base : `${base}-${suffix}${index === 1 ? '' : `-${index}`}`;
    try {
      await fs.mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('同名小红书截图目录过多，请整理下载目录后重试');
}

function captureUrl(relative, siteOrigin) {
  const base = new URL(normalizedSiteOrigin(siteOrigin));
  const target = new URL(base);
  target.hash = `#/${relative.replace(/\.md$/, '')}`;
  return target.href;
}

async function chromeExecutable() {
  const candidates = [
    process.env.DOC_READ_CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { await fs.access(candidate); return candidate; } catch { /* Try the next browser. */ }
  }
  throw new Error('没有找到可用于截图的 Chrome；可通过 DOC_READ_CHROME_PATH 指定');
}

async function waitForImages(page) {
  return page.evaluate(async () => {
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    for (let y = 0; y < height; y += 720) {
      window.scrollTo(0, y);
      await new Promise(resolve => setTimeout(resolve, 35));
    }
    window.scrollTo(0, 0);
    let timedOut = false;
    const images = Promise.all(Array.from(document.images).map(image => {
      if (image.complete) return typeof image.decode === 'function' ? image.decode().catch(() => {}) : Promise.resolve();
      return new Promise(resolve => {
        const timer = setTimeout(resolve, 8000);
        const finish = () => { clearTimeout(timer); resolve(); };
        image.addEventListener('load', finish, { once: true });
        image.addEventListener('error', finish, { once: true });
      });
    }));
    await Promise.race([
      images,
      new Promise(resolve => setTimeout(() => { timedOut = true; resolve(); }, 15000))
    ]);
    return { timedOut };
  });
}

async function captureScreenshots({ relative, directory, siteOrigin, onProgress }) {
  const executablePath = await chromeExecutable();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--allow-file-access-from-files', '--disable-background-networking', '--hide-scrollbars']
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 720, height: 960 },
      deviceScaleFactor: 1.5,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      locale: 'zh-CN'
    });
    const page = await context.newPage();
    const url = captureUrl(relative, siteOrigin);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('.markdown-section h1', { timeout: 60_000 });
    await page.waitForFunction(expected => {
      const source = window.DOC_READ_PAGE_SOURCE;
      return source && source.path === expected;
    }, relative, { timeout: 60_000 });
    await page.evaluate(() => {
      localStorage.setItem('doc-read-theme', 'light');
      document.documentElement.dataset.theme = 'light';
      document.querySelectorAll('.section-fold-toggle[aria-expanded="false"]').forEach(button => button.click());
    });
    await page.addStyleTag({ content: `
      html, body { background: #edf3fc !important; scroll-behavior: auto !important; }
      * { animation: none !important; transition: none !important; }
      .sidebar, .sidebar-toggle, .reading-tools, .theme-toggle, #reading-progress,
      .wechat-copy-toast, .typo-dialog, .docsify-pagination-container, .pagination-item { display: none !important; }
      .content, body.close .content, body:not(.close) .content { left: 0 !important; transform: none !important; }
      .app-nav { box-sizing: border-box !important; left: auto !important; margin: 28px auto 0 !important; max-width: 650px !important;
        padding: 18px 30px !important; position: static !important; right: auto !important; width: calc(100vw - 70px) !important; }
      .markdown-section { background: var(--surface) !important; box-shadow: 0 18px 48px rgba(50,61,86,.12) !important;
        box-sizing: border-box !important; margin: 0 auto 46px !important; max-width: 650px !important;
        min-height: 0 !important; padding: 44px 34px 90px !important; width: calc(100vw - 70px) !important; }
      .markdown-section img { max-width: 100% !important; }
      .section-fold-item[hidden] { display: revert !important; }
      .section-fold-toggle { pointer-events: none !important; }
    ` });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    const imageState = await waitForImages(page);
    const geometry = await page.evaluate(() => {
      const articleChildren = Array.from(document.querySelectorAll('.markdown-section > *'));
      const articleBottom = articleChildren.reduce((bottom, element) => (
        Math.max(bottom, element.getBoundingClientRect().bottom + window.scrollY)
      ), 0);
      const nav = document.querySelector('.app-nav');
      const navBottom = nav ? nav.getBoundingClientRect().bottom + window.scrollY : 0;
      const contentHeight = Math.ceil(Math.max(articleBottom, navBottom) + 46);
      const spacer = document.createElement('div');
      spacer.setAttribute('aria-hidden', 'true');
      spacer.style.height = '960px';
      document.body.appendChild(spacer);
      return { contentHeight };
    });
    const pageHeight = 960;
    const positions = planScreenshotPositions(geometry.contentHeight, pageHeight);
    if (positions.length > 80) throw new Error('文章超过 80 张截图，请先缩短文章或调大截图高度');
    for (let index = 0; index < positions.length; index += 1) {
      const y = positions[index];
      await page.evaluate(scrollY => window.scrollTo(0, scrollY), y);
      await page.waitForTimeout(90);
      const filename = `${String(index + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(directory, filename), fullPage: false, animations: 'disabled' });
      await onProgress?.(index + 1, positions.length, filename);
    }
    await context.close();
    return { count: positions.length, url, imageWarning: imageState.timedOut ? '部分网络图片加载超时，截图已继续生成' : '' };
  } finally {
    await browser.close();
  }
}

async function runJob(job, body) {
  try {
    updateJob(job, { status: 'running', stage: '正在读取文章…', progress: 3 });
    const { markdown } = await readableMarkdown(body.path);
    const title = extractArticleTitle(markdown, path.basename(body.path, '.md'));
    if (body.target === 'zhihu') {
      const browser = await chromium.launch({ executablePath: await chromeExecutable(), headless: true, args: ['--allow-file-access-from-files'] });
      let payload;
      try {
        const page = await browser.newPage();
        await page.goto(captureUrl(body.path, body.siteOrigin), { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.DocReadArticleCopy && window.marked);
        payload = await page.evaluate(markdown => {
          const article = document.createElement('article');
          article.innerHTML = window.marked(markdown.replace(/^# .+\r?\n/, ''));
          return window.DocReadArticleCopy.buildZhihuPayload(article);
        }, markdown);
      } finally { await browser.close(); }
      const result = await sendZhihuDraft({ relative: body.path, markdown, payload, title, progress(stage, progress) { updateJob(job, { title, stage, progress }); } });
      updateJob(job, { ...result, status: 'completed', progress: 100, stage: '知乎内容已就绪，未发布；请确认自动保存状态' });
      return;
    }
    const directory = await uniqueOutputDirectory(title);
    updateJob(job, { title, outputDirectory: directory, stage: '正在生成 1080×1440 连续截图…', progress: 8 });
    const capture = await captureScreenshots({
      relative: body.path,
      directory,
      siteOrigin: body.siteOrigin,
      async onProgress(done, total, filename) {
        updateJob(job, { stage: `正在保存第 ${done}/${total} 张截图（1080×1440）…`, progress: 8 + Math.round((done / total) * 90) });
      }
    });
    job.screenshotCount = capture.count;
    updateJob(job, {
      status: 'completed',
      stage: `${capture.count} 张 1080×1440 截图已保存`,
      progress: 100,
      warning: capture.imageWarning
    });
  } catch (error) {
    updateJob(job, { status: 'failed', draftUrl: error.draftUrl || '', stage: body.target === 'zhihu' ? '知乎导入未完成，请检查 Chrome 中的草稿' : '截图没有完成', error: error.message || '本地助手执行失败' });
  } finally {
    if (runningJob === job.id) runningJob = '';
  }
}

async function createJob(body) {
  if (runningJob) throw Object.assign(new Error('已有一篇文章正在生成小红书截图，请完成后再试'), { status: 409 });
  const reservation = `reserving-${randomUUID()}`;
  runningJob = reservation;
  try {
    const relative = String(body.path || '');
    await readableMarkdown(relative);
    const siteOrigin = normalizedSiteOrigin(body.siteOrigin);
    const id = randomUUID();
    const job = { id, status: 'queued', stage: '准备开始…', progress: 0, title: safeFolderName(path.basename(relative, '.md')), createdAt: Date.now(), updatedAt: Date.now() };
    jobs.set(id, job);
    runningJob = id;
    setImmediate(() => runJob(job, { path: relative, siteOrigin, target: body.target === 'zhihu' ? 'zhihu' : 'xhs' }));
    return cleanJob(job);
  } catch (error) {
    if (runningJob === reservation) runningJob = '';
    throw error;
  }
}

async function startJob(request, response) {
  if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的页面来源' });
  const body = await requestBody(request);
  const job = await createJob({ ...body, target: request.url.startsWith('/__doc_read/zhihu/') ? 'zhihu' : 'xhs' });
  sendJson(response, 202, job);
}

async function startFileJob(url, response) {
  const callback = url.searchParams.get('callback');
  try { callbackId(callback); }
  catch (error) { return sendJson(response, error.status || 400, { error: error.message }); }
  try {
    const job = await createJob({
      path: url.searchParams.get('path') || '',
      title: url.searchParams.get('title') || '',
      siteOrigin: url.searchParams.get('siteOrigin') || '',
      target: url.pathname.startsWith('/__doc_read/zhihu/') ? 'zhihu' : 'xhs'
    });
    sendScriptResponse(response, callback, job);
  } catch (error) {
    sendScriptResponse(response, callback, { error: error.message || '无法启动小红书截图', status: error.status || 500 });
  }
}

function pruneJobs() {
  const threshold = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of jobs) if (job.updatedAt < threshold && id !== runningJob) jobs.delete(id);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
  try {
    pruneJobs();
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/__doc_read/')) {
      if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的页面来源' });
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return response.end();
    }
    if (request.method === 'GET' && ['/__doc_read/xhs/file/jobs', '/__doc_read/zhihu/file/jobs'].includes(url.pathname)) {
      return await startFileJob(url, response);
    }
    const fileJobMatch = url.pathname.match(/^\/__doc_read\/(?:xhs|zhihu)\/file\/jobs\/([0-9a-f-]+)$/i);
    if (request.method === 'GET' && fileJobMatch) {
      const callback = url.searchParams.get('callback');
      const job = jobs.get(fileJobMatch[1]);
      return sendScriptResponse(response, callback, job ? cleanJob(job) : { error: '找不到这次生成任务', status: 404 });
    }
    if (request.method === 'GET' && url.pathname === '/__doc_read/xhs/status') {
      if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的页面来源' });
      const chrome = await chromeExecutable().then(() => true).catch(() => false);
      return sendJson(response, 200, {
        service: 'doc-read-xhs',
        protocolVersion: 1,
        ready: chrome,
        chrome,
        outputRoot,
        running: Boolean(runningJob)
      });
    }
    if (request.method === 'POST' && /^\/__doc_read\/(xhs|zhihu)\/jobs$/.test(url.pathname)) return await startJob(request, response);
    const jobMatch = url.pathname.match(/^\/__doc_read\/(?:xhs|zhihu)\/jobs\/([0-9a-f-]+)$/i);
    if (request.method === 'GET' && jobMatch) {
      if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的页面来源' });
      const job = jobs.get(jobMatch[1]);
      return job ? sendJson(response, 200, cleanJob(job)) : sendJson(response, 404, { error: '找不到这次生成任务' });
    }
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || '小红书本地助手发生错误' });
  }
});

server.listen(port, host, () => {
  console.log(`小红书本地助手：http://${host}:${port}`);
  console.log(`输出目录：${outputRoot}`);
  console.log('网页仍可使用 docsify serve；点击小红书按钮后会把 1080×1440 连续截图直接保存到文章文件夹。');
});
