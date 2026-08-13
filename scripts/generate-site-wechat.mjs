import fs from 'node:fs/promises';
import path from 'node:path';

const [renderedPath, outputPath] = process.argv.slice(2);

if (!renderedPath || !outputPath) {
  throw new Error('Usage: node scripts/generate-site-wechat.mjs <rendered-html> <output-html>');
}

const rendered = await fs.readFile(renderedPath, 'utf8');
const title = rendered.match(/^<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1].replace(/<[^>]+>/g, '').trim() || '阅读笔记';
const dateMatch = rendered.match(/<p>date:\s*(\d{4})-(\d{2})-(\d{2})(?:\s+[^<]*)?<\/p>/i);
const displayDate = dateMatch ? `${dateMatch[1]} 年 ${Number(dateMatch[2])} 月 ${Number(dateMatch[3])} 日` : '';
const palette = {
  accent: '#8b22e8',
  accentStrong: '#7216ca',
  accentSoft: '#ead8ff',
  accentPale: '#f5edff',
  ink: '#54525a',
  text: '#5e5a62',
  muted: '#8e8995',
  line: '#e4d8f2',
  quote: '#f7f1ff'
};

let body = rendered
  .replace(/^<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '')
  .replace(
    /<p>date:\s*\d{4}-\d{2}-\d{2}(?:\s+[^<]*)?<\/p>/i,
    displayDate ? `<p style="margin: 1em 8px 2.2em; color: ${palette.muted}; font-size: 13px; letter-spacing: .06em; text-align: center;">记录于 ${displayDate}</p>` : ''
  )
  .replace(/<h2([^>]*)>/g, `<h2$1 style="border-left: 7px solid ${palette.accentSoft}; color: ${palette.accent}; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; font-size: 23px; font-weight: 700; line-height: 1.45; margin: 3.2em 0 1.7em; padding: .18em 0 .18em .85em;">`)
  .replace(/<h3([^>]*)>/g, `<h3$1 style="border-bottom: 4px solid ${palette.accentSoft}; color: ${palette.ink}; display: table; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; font-size: 19px; font-weight: 700; line-height: 1.5; margin: 2.5em auto 1.4em; padding: 0 .15em .25em; text-align: center;">`)
  .replace(/<h4([^>]*)>/g, `<h4$1 style="color: ${palette.accentStrong}; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; font-size: 17px; font-weight: 700; margin: 2em 0 1em;">`)
  .replace(/<p>/g, `<p style="color: ${palette.text}; font-size: 16px; letter-spacing: .045em; line-height: 1.9; margin: 1.25em 8px; text-align: justify; text-indent: 2em;">`)
  .replace(/<strong>/g, `<strong style="color: ${palette.accent}; font-weight: 700;">`)
  .replace(/<a /g, `<a style="color: ${palette.accent}; text-decoration: underline; text-decoration-color: ${palette.accentSoft}; text-underline-offset: 3px;" `)
  .replace(/<hr>/g, `<hr style="border: 0; border-top: 1px solid ${palette.line}; margin: 2.8em 0;">`)
  .replace(/<blockquote>/g, `<blockquote style="background: ${palette.quote}; border-left: 3px solid ${palette.accent}; border-radius: 0 8px 8px 0; color: ${palette.text}; margin: 1.5em 0; padding: .9em 1.15em;">`)
  .replace(/<blockquote([^>]*)>\s*<p style="([^"]*)text-indent: 2em;([^"]*)">/g, '<blockquote$1><p style="$2text-indent: 0;$3">')
  .replace(/<ul>/g, `<ul style="color: ${palette.text}; margin: 1.2em 0; padding-left: 1.6em;">`)
  .replace(/<ol>/g, `<ol style="color: ${palette.text}; margin: 1.2em 0; padding-left: 1.8em;">`)
  .replace(/<li>/g, `<li style="color: ${palette.text}; font-size: 16px; line-height: 1.85; margin: .6em 0;">`)
  .replace(/<img /g, '<img style="border-radius: 6px; display: block; height: auto; margin: 1.2em auto; max-width: 100%;" ')
  .replace(/<table>/g, `<table style="border-collapse: collapse; color: ${palette.text}; font-size: 14px; margin: 1.8em 0; width: 100%;">`)
  .replace(/<thead>/g, `<thead style="background: ${palette.accentPale}; color: ${palette.accentStrong};">`)
  .replace(/<th>/g, `<th style="border: 1px solid ${palette.line}; border-bottom: 2px solid ${palette.accent}; font-weight: 700; padding: .7em .6em;">`)
  .replace(/<td>/g, `<td style="border: 1px solid ${palette.line}; padding: .65em .6em;">`);

const header = `
  <section style="border-bottom: 3px solid ${palette.accentSoft}; margin: 0 0 2.4em; padding: .8em 8px 1.6em; text-align: left;">
    <p style="color: ${palette.accent}; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; font-size: 12px; font-weight: 700; letter-spacing: .22em; margin: 0 0 1em; text-indent: 0;">DAN'S READING NOTES</p>
    <h1 style="color: ${palette.ink}; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; font-size: 30px; font-weight: 750; line-height: 1.4; margin: 0;">${title}</h1>
  </section>`;

const article = `<section style="background-color: #fff; background-image: linear-gradient(rgba(112,75,145,.075) 1px, transparent 1px), linear-gradient(90deg, rgba(112,75,145,.075) 1px, transparent 1px); background-size: 40px 40px; color: ${palette.text}; font-family: 'Noto Serif SC', 'Songti SC', STSong, serif; padding: 30px 24px 48px;">${header}${body}</section>`;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · 网站紫色公众号排版</title>
  <style>
    * { box-sizing: border-box; }
    body { background: #f0edf7; margin: 0 auto; max-width: 800px; padding: 24px; }
    .copy-toolbar { align-items: center; background: #fff; border: 1px solid ${palette.line}; border-radius: 10px; display: flex; font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif; justify-content: space-between; margin-bottom: 18px; padding: 13px 15px; position: sticky; top: 12px; z-index: 10; }
    .copy-toolbar strong, .copy-toolbar span { display: block; }
    .copy-toolbar strong { color: ${palette.ink}; font-size: 15px; }
    .copy-toolbar span { color: ${palette.muted}; font-size: 12px; margin-top: 3px; }
    .copy-toolbar button { background: ${palette.accent}; border: 0; border-radius: 5px; color: #fff; cursor: pointer; font-size: 14px; font-weight: 700; padding: 10px 17px; }
    .copy-toolbar button[data-copied="true"] { background: #4a9b72; }
    #output { background: #fff; box-shadow: 0 18px 55px rgba(62,43,79,.12); }
    @media (max-width: 560px) { body { padding: 10px; } .copy-toolbar { align-items: stretch; flex-direction: column; gap: 10px; } }
    @media print { .copy-toolbar { display: none; } }
  </style>
</head>
<body>
  <div class="copy-toolbar">
    <div><strong>网站紫色排版 · 公众号版本</strong><span>复制内容不包含此工具栏</span></div>
    <button type="button" data-copy-button>复制整篇文章</button>
  </div>
  <div id="output">${article}</div>
  <script>
    (function () {
      var button = document.querySelector('[data-copy-button]');
      var output = document.getElementById('output');
      function done() {
        button.dataset.copied = 'true';
        button.textContent = '已复制，可去公众号粘贴';
        setTimeout(function () { button.dataset.copied = 'false'; button.textContent = '复制整篇文章'; }, 2600);
      }
      button.addEventListener('click', async function () {
        var selection = window.getSelection();
        try {
          if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({
              'text/html': new Blob([output.innerHTML], { type: 'text/html' }),
              'text/plain': new Blob([output.innerText], { type: 'text/plain' })
            })]);
          } else {
            var range = document.createRange(); range.selectNodeContents(output);
            selection.removeAllRanges(); selection.addRange(range); document.execCommand('copy'); selection.removeAllRanges();
          }
          done();
        } catch (error) {
          var fallback = document.createRange(); fallback.selectNodeContents(output);
          selection.removeAllRanges(); selection.addRange(fallback); document.execCommand('copy'); selection.removeAllRanges(); done();
        }
      });
    }());
  </script>
</body>
</html>`;

const resolvedOutputPath = path.resolve(outputPath);
await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
await fs.writeFile(resolvedOutputPath, html, 'utf8');
