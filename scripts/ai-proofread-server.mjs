import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyAiIssues,
  DEFAULT_AI_MODEL,
  requestOpenAIProofreading
} from './lib/ai-proofreader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const writableRoots = [path.join(root, 'docs/read'), path.join(root, 'docs/read-history')];
const reviews = new Map();
const writeLocks = new Set();
const reviewLifetime = 30 * 60 * 1000;
let analysisRunning = false;

async function loadEnvFile(relative) {
  try {
    const source = await fs.readFile(path.join(root, relative), 'utf8');
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await loadEnvFile('.env');
await loadEnvFile('.env.local');

const host = '127.0.0.1';
const port = Number(process.env.DOC_READ_AI_PORT) || 3001;
const model = process.env.OPENAI_PROOFREAD_MODEL || process.env.OPENAI_MODEL || DEFAULT_AI_MODEL;
const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function setCors(request, response, allowMissingOrigin = false) {
  const origin = request.headers.origin;
  if (!origin) return allowMissingOrigin;
  if (origin === 'null') return false;
  let allowed = false;
  try {
    const url = new URL(origin);
    allowed = /^https?:$/.test(url.protocol) && /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  } catch { /* Invalid origins are rejected. */ }
  const configured = String(process.env.DOC_READ_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  if (configured.includes(origin)) allowed = true;
  if (!allowed) return false;
  response.setHeader('Access-Control-Allow-Origin', origin);
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('请求内容不是有效的 JSON');
  }
}

async function writableMarkdown(relative) {
  if (!/^(?:docs\/read|docs\/read-history)\/.+\.md$/.test(relative)) return null;
  try {
    const candidate = path.resolve(root, relative);
    const real = await fs.realpath(candidate);
    if (!writableRoots.some(directory => real.startsWith(directory + path.sep))) return null;
    return real;
  } catch {
    return null;
  }
}

function pruneReviews() {
  const now = Date.now();
  for (const [id, review] of reviews) {
    if (review.expiresAt <= now) reviews.delete(id);
  }
  while (reviews.size > 30) reviews.delete(reviews.keys().next().value);
}

async function sourceFromRequest(body) {
  const relative = String(body.path || '');
  const file = await writableMarkdown(relative);
  if (!file) throw Object.assign(new Error('只允许校对 docs/read 或 docs/read-history 下已存在的 Markdown'), { status: 403 });
  const markdown = await fs.readFile(file, 'utf8');
  return { relative, file, markdown, editable: true };
}

async function analyze(request, response) {
  if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的页面来源' });
  if (!process.env.OPENAI_API_KEY) {
    return sendJson(response, 503, { error: '在线 AI 服务尚未配置 OPENAI_API_KEY' });
  }
  if (analysisRunning) return sendJson(response, 429, { error: '已有文章正在进行 AI 校对，请完成后再试' });
  const body = await requestBody(request);
  const source = await sourceFromRequest(body);
  if (source.markdown.length > 200_000) throw Object.assign(new Error('文章超过 20 万字符，请拆分后再检测'), { status: 413 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  let analysis;
  analysisRunning = true;
  try {
    analysis = await requestOpenAIProofreading({
      apiKey: process.env.OPENAI_API_KEY,
      markdown: source.markdown,
      model,
      baseUrl,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('在线 AI 校对超时，请稍后重试');
    throw error;
  } finally {
    analysisRunning = false;
    clearTimeout(timeout);
  }

  pruneReviews();
  const analysisId = randomUUID();
  const sourceDigest = digest(source.markdown);
  reviews.set(analysisId, {
    analysisId,
    path: source.relative,
    file: source.file,
    digest: sourceDigest,
    issues: analysis.issues,
    expiresAt: Date.now() + reviewLifetime
  });
  sendJson(response, 200, {
    path: source.relative,
    digest: sourceDigest,
    analysisId,
    editable: source.editable,
    model: analysis.model,
    chunks: analysis.chunks,
    issues: analysis.issues
  });
}

async function applyReview(request, response) {
  if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的页面来源' });
  const body = await requestBody(request);
  pruneReviews();
  const review = reviews.get(String(body.analysisId || ''));
  if (!review) return sendJson(response, 410, { error: 'AI 校对结果已过期，请重新检测' });
  if (!review.file) return sendJson(response, 422, { error: '当前 AI 服务不能直接修改这个文件' });
  if (body.path !== review.path || (body.digest && body.digest !== review.digest)) {
    return sendJson(response, 409, { error: '校对结果与当前文件不一致，请重新检测' });
  }
  const source = await fs.readFile(review.file, 'utf8');
  if (digest(source) !== review.digest) return sendJson(response, 409, { error: '原文件在校对后发生了变化，请重新检测' });
  if (writeLocks.has(review.file)) return sendJson(response, 423, { error: '这个文件正在修改，请稍后重试' });
  writeLocks.add(review.file);
  let temporary = '';
  try {
    const selectedIds = Array.isArray(body.issueIds) ? [...new Set(body.issueIds.map(String))] : [];
    const corrected = applyAiIssues(source, review.issues, selectedIds);
    if (corrected === source) return sendJson(response, 422, { error: '没有可自动修改的高置信度问题' });

    const selected = new Set(selectedIds);
    const changed = review.issues.filter(issue => issue.fixable && selected.has(issue.id)).length;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupRelative = path.join('.codex-backups', 'ai-proofreading', stamp, review.path);
    const backup = path.join(root, backupRelative);
    await fs.mkdir(path.dirname(backup), { recursive: true });
    await fs.writeFile(backup, source, 'utf8');
    temporary = `${review.file}.codex-ai-proofread-${process.pid}-${randomUUID()}.tmp`;
    await fs.writeFile(temporary, corrected, 'utf8');
    await fs.rename(temporary, review.file);
    temporary = '';
    reviews.delete(review.analysisId);
    sendJson(response, 200, {
      changed,
      backup: backupRelative.split(path.sep).join('/')
    });
  } finally {
    writeLocks.delete(review.file);
    if (temporary) await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
  try {
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/__doc_read/')) {
      if (!setCors(request, response)) return sendJson(response, 403, { error: '不允许的页面来源' });
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      return response.end();
    }
    if (request.method === 'GET' && url.pathname === '/__doc_read/ai-status') {
      if (!setCors(request, response, true)) return sendJson(response, 403, { error: '不允许的页面来源' });
      return sendJson(response, 200, { configured: Boolean(process.env.OPENAI_API_KEY), model });
    }
    if (request.method === 'POST' && url.pathname === '/__doc_read/ai-proofread') return await analyze(request, response);
    if (request.method === 'POST' && url.pathname === '/__doc_read/apply-ai-proofread') return await applyReview(request, response);
    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const message = error?.message || '在线 AI 校对服务发生错误';
    const upstream = Number(error?.status);
    const status = [400, 401, 403, 409, 413, 422, 423, 429, 500, 502, 503, 504].includes(upstream)
      ? upstream
      : (error?.name === 'AbortError' ? 504 : 500);
    sendJson(response, status, { error: message });
  }
});

server.listen(port, host, () => {
  console.log(`AI proofreading proxy: http://${host}:${port}`);
  console.log(`Model: ${model}`);
  console.log(process.env.OPENAI_API_KEY
    ? 'OPENAI_API_KEY 已加载；可以开始在线 AI 校对。'
    : '未找到 OPENAI_API_KEY；请复制 .env.example 为 .env 并填写密钥。');
});
