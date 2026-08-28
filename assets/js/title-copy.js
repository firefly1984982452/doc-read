(function (global) {
  'use strict';

  var toastTimer = null;

  function isReadingNote() {
    return /^#\/docs\/(?:read|read-history)\//.test(global.location.hash);
  }

  function showToast(message, state) {
    var toast = global.document.getElementById('wechat-copy-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.state = state || '';
    toast.hidden = false;
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () { toast.hidden = true; }, 2600);
  }

  function fallbackCopy(text) {
    var textarea = global.document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    global.document.body.appendChild(textarea);
    textarea.select();
    var copied = global.document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('浏览器未允许复制标题');
  }

  function copyText(text) {
    if (global.navigator.clipboard && typeof global.navigator.clipboard.writeText === 'function') {
      return global.navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    }
    return Promise.resolve().then(function () { fallbackCopy(text); });
  }

  function copyButton(title) {
    var button = global.document.createElement('button');
    button.className = 'title-copy-button';
    button.type = 'button';
    button.textContent = '复制标题';
    button.setAttribute('aria-label', '复制完整标题');
    button.setAttribute('title', '复制完整标题');
    button.dataset.fullTitle = title;
    button.addEventListener('click', function () {
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      copyText(button.dataset.fullTitle).then(function () {
        button.textContent = '已复制';
        showToast('完整标题已复制到剪切板。', 'success');
      }).catch(function () {
        showToast('复制失败，请允许浏览器访问剪切板后重试。', 'error');
      }).finally(function () {
        global.setTimeout(function () {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.textContent = '复制标题';
        }, 1500);
      });
    });
    return button;
  }

  function mount() {
    if (!isReadingNote()) return;
    var heading = global.document.querySelector('.markdown-section h1');
    if (!heading || heading.closest('.article-title-row')) return;
    var title = heading.textContent.trim();
    if (!title) return;

    var row = global.document.createElement('div');
    row.className = 'article-title-row';
    row.setAttribute('data-full-title', title);
    heading.classList.add('article-title');
    heading.setAttribute('title', title);
    heading.parentNode.insertBefore(row, heading);
    row.appendChild(heading);
    row.appendChild(copyButton(title));
  }

  global.DocReadTitleCopy = { copyText: copyText, mount: mount };
  global.addEventListener('hashchange', function () { global.setTimeout(mount, 80); });
  global.document.addEventListener('doc-read:rendered', mount);
  global.document.addEventListener('DOMContentLoaded', function () { global.setTimeout(mount, 80); });
  global.setTimeout(mount, 120);
}(window));
