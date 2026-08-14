(function () {
  'use strict';

  var canonical = document.querySelector('link[rel="canonical"]');
  var PUBLIC_SITE = canonical
    ? canonical.href
    : new URL('./', window.location.href.split('#')[0]).href;
  var button = document.getElementById('wechat-copy');
  var toast = document.getElementById('wechat-copy-toast');

  function applyStyles(element, styles) {
    Object.keys(styles).forEach(function (property) {
      element.style[property] = styles[property];
    });
  }

  function unwrap(element) {
    var parent = element.parentNode;
    while (element.firstChild) parent.insertBefore(element.firstChild, element);
    parent.removeChild(element);
  }

  function publicUrl(href) {
    if (!href || href.charAt(0) === '#') {
      return href && href.indexOf('#/docs/') === 0 ? PUBLIC_SITE + 'index.html' + href : href;
    }
    if (/^https?:\/\//i.test(href)) return href;
    if (href.indexOf('/docs/') === 0) {
      return PUBLIC_SITE + 'index.html#' + href.replace(/\.md(?=$|[?#])/, '');
    }
    return new URL(href, PUBLIC_SITE).href;
  }

  function styleArticle(source) {
    var article = source.cloneNode(true);
    article.querySelectorAll('.countable, .docsify-copy-code-button, .pagination-item, script, style, button, noscript').forEach(function (element) {
      element.remove();
    });

    article.querySelectorAll('a.anchor').forEach(unwrap);
    article.querySelectorAll('a').forEach(function (link) {
      var href = publicUrl(link.getAttribute('href'));
      if (href) link.setAttribute('href', href);
      else link.removeAttribute('href');
      link.removeAttribute('target');
      link.removeAttribute('rel');
    });
    article.querySelectorAll('img').forEach(function (image) {
      image.setAttribute('src', image.src);
      image.removeAttribute('data-origin');
      applyStyles(image, {
        borderRadius: '6px',
        display: 'block',
        height: 'auto',
        margin: '22px auto',
        maxWidth: '100%'
      });
    });

    article.querySelectorAll('*').forEach(function (element) {
      Array.from(element.attributes).forEach(function (attribute) {
        if (/^on/i.test(attribute.name) || attribute.name === 'id' || attribute.name === 'class' || attribute.name.indexOf('data-') === 0 || attribute.name.indexOf('aria-') === 0) {
          element.removeAttribute(attribute.name);
        }
      });
    });

    applyStyles(article, {
      background: '#ffffff',
      boxSizing: 'border-box',
      color: '#5f5868',
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
      fontSize: '16px',
      lineHeight: '1.9',
      margin: '0 auto',
      maxWidth: '677px',
      padding: '10px 12px',
      wordBreak: 'break-word'
    });

    article.querySelectorAll('h1').forEach(function (heading) {
      applyStyles(heading, {
        borderBottom: '3px solid #ead8ff',
        color: '#342842',
        fontSize: '30px',
        fontWeight: '700',
        lineHeight: '1.35',
        margin: '12px 0 34px',
        padding: '0 0 18px',
        textAlign: 'left'
      });
    });
    article.querySelectorAll('h2').forEach(function (heading) {
      applyStyles(heading, {
        borderLeft: '6px solid #e3c9ff',
        color: '#8426ec',
        fontSize: '24px',
        fontWeight: '700',
        lineHeight: '1.45',
        margin: '42px 0 22px',
        padding: '4px 0 4px 14px',
        textAlign: 'left'
      });
    });
    article.querySelectorAll('h3').forEach(function (heading) {
      applyStyles(heading, {
        color: '#3e3250',
        fontSize: '20px',
        fontWeight: '700',
        lineHeight: '1.5',
        margin: '34px 0 18px',
        padding: '0 0 7px',
        textAlign: 'center',
        textDecoration: 'underline',
        textDecorationColor: '#dfc4ff',
        textDecorationThickness: '3px',
        textUnderlineOffset: '8px'
      });
    });
    article.querySelectorAll('h4, h5, h6').forEach(function (heading) {
      applyStyles(heading, {
        color: '#6f25bd',
        fontSize: '18px',
        fontWeight: '700',
        lineHeight: '1.55',
        margin: '28px 0 14px'
      });
    });
    article.querySelectorAll('p').forEach(function (paragraph) {
      var isMetadata = /^\s*date\s*:/i.test(paragraph.textContent);
      var containsMedia = Boolean(paragraph.querySelector('img, svg, video, iframe'));
      applyStyles(paragraph, {
        color: isMetadata ? '#8f8798' : '#5f5868',
        fontSize: isMetadata ? '14px' : '16px',
        lineHeight: '1.9',
        margin: isMetadata ? '0 0 28px' : '1.05em 0',
        textAlign: containsMedia ? 'center' : 'justify',
        textIndent: isMetadata || containsMedia ? '0' : '2em'
      });
    });
    article.querySelectorAll('strong, b').forEach(function (strong) {
      applyStyles(strong, { color: '#8426ec', fontWeight: '700' });
    });
    article.querySelectorAll('a').forEach(function (link) {
      applyStyles(link, { color: '#8426ec', textDecoration: 'underline', textUnderlineOffset: '3px' });
    });
    article.querySelectorAll('ul, ol').forEach(function (list) {
      applyStyles(list, { margin: '18px 0', paddingLeft: '1.6em' });
    });
    article.querySelectorAll('li').forEach(function (item) {
      applyStyles(item, { color: '#5f5868', lineHeight: '1.85', margin: '6px 0' });
    });
    article.querySelectorAll('blockquote').forEach(function (quote) {
      applyStyles(quote, {
        background: '#faf6ff',
        borderLeft: '4px solid #b96cff',
        color: '#655a70',
        margin: '26px 0',
        padding: '14px 18px'
      });
      quote.querySelectorAll('p').forEach(function (paragraph) { paragraph.style.textIndent = '0'; });
    });
    article.querySelectorAll('table').forEach(function (table) {
      applyStyles(table, { borderCollapse: 'collapse', fontSize: '14px', margin: '26px 0', width: '100%' });
    });
    article.querySelectorAll('th').forEach(function (cell) {
      applyStyles(cell, { background: '#8426ec', border: '1px solid #d8b9fa', color: '#ffffff', fontWeight: '700', padding: '9px 7px', textAlign: 'center' });
    });
    article.querySelectorAll('td').forEach(function (cell) {
      applyStyles(cell, { border: '1px solid #e4d3f4', color: '#5f5868', padding: '8px 7px', textAlign: 'left', verticalAlign: 'top' });
    });
    article.querySelectorAll('code').forEach(function (code) {
      applyStyles(code, { background: '#f6effd', borderRadius: '3px', color: '#6f25bd', fontFamily: 'Menlo, Consolas, monospace', padding: '2px 5px' });
    });
    article.querySelectorAll('pre').forEach(function (pre) {
      applyStyles(pre, { background: '#2f2738', borderRadius: '5px', color: '#f7f2fb', lineHeight: '1.65', overflowX: 'auto', padding: '14px' });
      pre.querySelectorAll('code').forEach(function (code) { code.style.background = 'transparent'; code.style.color = 'inherit'; });
    });
    article.querySelectorAll('hr').forEach(function (rule) {
      applyStyles(rule, { border: '0', borderTop: '1px solid #e8d7f8', margin: '34px 0' });
    });

    return article;
  }

  function copyFallback(html, text) {
    var holder = document.createElement('div');
    holder.setAttribute('contenteditable', 'true');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;opacity:0;pointer-events:none;';
    holder.innerHTML = html;
    document.body.appendChild(holder);
    var onCopy = function (event) {
      if (!event.clipboardData) return;
      event.clipboardData.setData('text/html', html);
      event.clipboardData.setData('text/plain', text);
      event.preventDefault();
    };
    holder.addEventListener('copy', onCopy, { once: true });
    holder.focus();
    var range = document.createRange();
    range.selectNodeContents(holder);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    var copied = document.execCommand('copy');
    selection.removeAllRanges();
    holder.remove();
    if (!copied) throw new Error('浏览器未允许复制');
  }

  function writeClipboard(html, text) {
    if (navigator.clipboard && window.ClipboardItem) {
      return navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]).catch(function () { copyFallback(html, text); });
    }
    copyFallback(html, text);
    return Promise.resolve();
  }

  function showToast(message, state) {
    toast.textContent = message;
    toast.dataset.state = state || '';
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () { toast.hidden = true; }, 3600);
  }

  function updateVisibility() {
    var isReadingNote = /^#\/docs\/(?:read|read-history)\//.test(window.location.hash);
    button.hidden = !isReadingNote;
    if (!isReadingNote) toast.hidden = true;
  }

  button.addEventListener('click', function () {
    var source = document.querySelector('.markdown-section');
    if (!source) return;
    var originalText = button.textContent;
    button.disabled = true;
    button.textContent = '正在整理…';
    try {
      var article = styleArticle(source);
      var html = '<section style="background:#ffffff;margin:0;padding:0;">' + article.outerHTML + '</section>';
      writeClipboard(html, article.textContent || '').then(function () {
        button.textContent = '已复制';
        showToast('已复制紫色富文本，打开公众号编辑器直接粘贴即可。', 'success');
      }).catch(function () {
        button.textContent = '复制失败';
        showToast('浏览器没有授予剪切板权限，请在 HTTPS 页面重试。', 'error');
      }).finally(function () {
        window.setTimeout(function () {
          button.disabled = false;
          button.textContent = originalText;
        }, 1800);
      });
    } catch (error) {
      button.disabled = false;
      button.textContent = originalText;
      showToast('整理文章失败，请刷新页面后重试。', 'error');
    }
  });

  document.addEventListener('doc-read:rendered', updateVisibility);
  window.addEventListener('hashchange', function () { window.setTimeout(updateVisibility, 60); });
  document.addEventListener('DOMContentLoaded', updateVisibility);
  updateVisibility();
}());
