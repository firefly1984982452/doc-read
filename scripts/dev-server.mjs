import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTypoCorrections, detectTypos } from './lib/typo-rules.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.DOC_READ_PORT) || 3000;
const host = '127.0.0.1';
const writableRoots = [path.join(root, 'docs/read'), path.join(root, 'docs/read-history')];
const mimeTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.xml': 'application/xml; charset=utf-8'
};

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function setCors(request, response) {
  const origin = request.headers.origin;
  if (!origin || origin === 'null' || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin || '*');
    response.setHeader('Vary', 'Origin');
    return true;
  }
  return false;
}

async function writableMarkdown(relative) {
  if (!/^(?:docs\/read|docs\/read-history)\/.+\.md$/.test(relative)) throw new Error('只允许修改阅读笔记 Markdown');
  const candidate = path.resolve(root, relative);
  const real = await fs.realpath(candidate);
  if (!writableRoots.some(directory => real.startsWith(directory + path.sep))) throw new Error('文件不在允许修改的目录内');
  return real;
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function requestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function analyze(request, response, url) {
  if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的来源' });
  const relative = url.searchParams.get('path') || '';
  const file = await writableMarkdown(relative);
  const source = await fs.readFile(file, 'utf8');
  sendJson(response, 200, { path: relative, digest: digest(source), issues: detectTypos(source), editable: true });
}

async function apply(request, response) {
  if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的来源' });
  const body = await requestBody(request);
  const file = await writableMarkdown(String(body.path || ''));
  const source = await fs.readFile(file, 'utf8');
  if (body.digest && body.digest !== digest(source)) return sendJson(response, 409, { error: '原文件在检测后发生了变化，请重新检测' });
  const ruleIds = Array.isArray(body.ruleIds) ? body.ruleIds.map(String) : [];
  const issues = detectTypos(source).filter(issue => ruleIds.includes(issue.ruleId));
  const corrected = applyTypoCorrections(source, ruleIds);
  if (!issues.length || corrected === source) return sendJson(response, 422, { error: '没有可以修改的错别字' });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRelative = path.join('.codex-backups', 'typos', stamp, body.path);
  const backup = path.join(root, backupRelative);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.writeFile(backup, source, 'utf8');
  const temporary = `${file}.codex-typo-${process.pid}.tmp`;
  await fs.writeFile(temporary, corrected, 'utf8');
  await fs.rename(temporary, file);
  sendJson(response, 200, { changed: issues.length, backup: backupRelative.split(path.sep).join('/') });
}

async function serveStatic(response, url) {
  let relative;
  try { relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'; }
  catch { return sendJson(response, 400, { error: '无效路径' }); }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) return sendJson(response, 403, { error: '路径越界' });
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    const content = await fs.readFile(file);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': /^(?:assets\/data|assets\/js)/.test(relative) ? 'no-cache' : 'no-store'
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
  try {
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/__doc_read/')) {
      if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的来源' });
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
      return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/__doc_read/typos') return await analyze(request, response, url);
    if (request.method === 'POST' && url.pathname === '/__doc_read/apply-typos') return await apply(request, response);
    if (request.method === 'GET' || request.method === 'HEAD') return await serveStatic(response, url);
    sendJson(response, 405, { error: 'Method not allowed' });
  } catch (error) {
    sendJson(response, 400, { error: error.message || '请求失败' });
  }
});

server.listen(port, host, () => {
  console.log(`Doc Read is available at http://${host}:${port}/`);
  console.log('错别字检测可直接修改阅读笔记；修改前会自动备份原文件。');
});
