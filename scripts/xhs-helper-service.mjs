import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const label = 'com.pengdan.doc-read-xhs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uid = process.getuid();
const domain = `gui/${uid}`;
const service = `${domain}/${label}`;
const launchAgents = path.join(homedir(), 'Library', 'LaunchAgents');
const logs = path.join(homedir(), 'Library', 'Logs', 'doc-read');
const plist = path.join(launchAgents, `${label}.plist`);
const server = path.join(root, 'scripts', 'xhs-export-server.mjs');
const outputRoot = path.join(homedir(), 'Downloads', '小红书-待上传');

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function launchctl(args, allowFailure = false) {
  const result = spawnSync('/bin/launchctl', args, { encoding: 'utf8' });
  if (!allowFailure && result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `launchctl ${args.join(' ')} 失败`).trim());
  }
  return result;
}

function plistSource() {
  const values = {
    node: process.execPath,
    server,
    root,
    outputRoot,
    home: homedir(),
    path: process.env.PATH || '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin',
    stdout: path.join(logs, 'xhs-helper.log'),
    stderr: path.join(logs, 'xhs-helper-error.log')
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array><string>${escapeXml(values.node)}</string><string>${escapeXml(values.server)}</string></array>
  <key>WorkingDirectory</key><string>${escapeXml(values.root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${escapeXml(values.home)}</string>
    <key>PATH</key><string>${escapeXml(values.path)}</string>
    <key>DOC_READ_SITE_ORIGIN</key><string>http://127.0.0.1:3000/</string>
    <key>DOC_READ_XHS_OUTPUT_ROOT</key><string>${escapeXml(values.outputRoot)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>${escapeXml(values.stdout)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(values.stderr)}</string>
</dict>
</plist>
`;
}

async function waitUntilReady() {
  let lastError;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:3002/__doc_read/xhs/status', {
        headers: { Origin: 'http://127.0.0.1:3000' },
        signal: AbortSignal.timeout(1000)
      });
      if (response.ok) {
        const body = await response.json();
        if (body.service === 'doc-read-xhs' && body.protocolVersion === 1) return body;
        lastError = new Error('3002 端口不是兼容的小红书助手');
        continue;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`服务没有就绪：${lastError?.message || '连接失败'}`);
}

async function install() {
  await Promise.all([
    fs.mkdir(launchAgents, { recursive: true }),
    fs.mkdir(logs, { recursive: true }),
    fs.mkdir(outputRoot, { recursive: true })
  ]);
  launchctl(['bootout', service], true);
  const temporary = `${plist}.tmp-${process.pid}`;
  await fs.writeFile(temporary, plistSource(), 'utf8');
  await fs.rename(temporary, plist);
  launchctl(['bootstrap', domain, plist]);
  launchctl(['enable', service]);
  launchctl(['kickstart', '-k', service]);
  const status = await waitUntilReady();
  console.log(`小红书本地助手已安装并启动：${service}`);
  console.log(`Chrome：${status.chrome ? '就绪' : '未找到'}；Codex：${status.codex ? '就绪' : '未找到'}`);
  console.log(`输出目录：${status.outputRoot}`);
}

async function uninstall() {
  launchctl(['bootout', service], true);
  await fs.rm(plist, { force: true });
  console.log('小红书本地助手已停止，并已移除登录启动项。');
}

async function status() {
  const result = launchctl(['print', service], true);
  if (result.status !== 0) {
    console.log('小红书本地助手尚未安装。运行 npm run xhs:install 即可安装。');
    process.exitCode = 1;
    return;
  }
  const health = await waitUntilReady();
  console.log(`小红书本地助手正在运行；Chrome：${health.chrome ? '就绪' : '未找到'}；Codex：${health.codex ? '就绪' : '未找到'}`);
  console.log(`输出目录：${health.outputRoot}`);
}

const command = process.argv[2] || 'status';
if (command === 'install') await install();
else if (command === 'uninstall') await uninstall();
else if (command === 'status') await status();
else throw new Error(`未知命令：${command}`);
