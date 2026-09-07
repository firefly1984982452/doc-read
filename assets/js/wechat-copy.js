(function () {
  'use strict';

  var canonical = document.querySelector('link[rel="canonical"]');
  var PUBLIC_SITE = canonical
    ? canonical.href
    : new URL('./', window.location.href.split('#')[0]).href;
  var wechatButton = document.getElementById('wechat-copy');
  var zhihuButton = document.getElementById('zhihu-copy');
  var tools = document.getElementById('reading-tools');
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

  function isLocalUrl(url) {
    return url.protocol === 'file:' || /^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  }

  function projectRelativePath(url) {
    var canonicalUrl = new URL(PUBLIC_SITE);
    var projectName = canonicalUrl.pathname.split('/').filter(Boolean).pop();
    var marker = projectName ? '/' + projectName + '/' : '';
    var markerIndex = marker ? url.pathname.lastIndexOf(marker) : -1;
    if (markerIndex !== -1) return url.pathname.slice(markerIndex + marker.length);
    var knownPath = url.pathname.match(/\/(assets|docs)\/.+$/);
    return knownPath ? knownPath[0].replace(/^\//, '') : url.pathname.replace(/^\//, '');
  }

  function currentPublicRoute(anchor) {
    var route = (window.location.hash || '#/').split('?')[0];
    return PUBLIC_SITE + 'index.html' + route + (anchor ? '?id=' + anchor : '');
  }

  function publicUrl(href) {
    if (!href) return href;
    if (href.indexOf('#/') === 0) return PUBLIC_SITE + 'index.html' + href;
    if (href.charAt(0) === '#') return currentPublicRoute(href.slice(1));
    if (href.indexOf('/docs/') === 0) {
      return PUBLIC_SITE + 'index.html#' + href.replace(/\.md(?=$|[?#])/, '');
    }

    var resolved = new URL(href, window.location.href);
    if (isLocalUrl(resolved)) {
      if (resolved.hash.indexOf('#/docs/') === 0) return PUBLIC_SITE + 'index.html' + resolved.hash;
      var relative = projectRelativePath(resolved);
      if (relative.indexOf('docs/') === 0) {
        return PUBLIC_SITE + 'index.html#/' + relative.replace(/\.md(?=$|[?#])/, '');
      }
      return new URL(relative, PUBLIC_SITE).href;
    }
    return resolved.href;
  }

  function publicAssetUrl(src) {
    if (!src || /^(?:data:|blob:)/i.test(src)) return src;
    var resolved = new URL(src, window.location.href);
    if (!isLocalUrl(resolved) && /^https?:$/i.test(resolved.protocol)) return resolved.href;
    return new URL(projectRelativePath(resolved), PUBLIC_SITE).href;
  }

  function sanitizeAttributes(element, stripInlineStyles) {
    Array.from(element.attributes || []).forEach(function (attribute) {
      if (
        /^on/i.test(attribute.name)
        || attribute.name === 'id'
        || attribute.name === 'class'
        || attribute.name.indexOf('data-') === 0
        || attribute.name.indexOf('aria-') === 0
        || (stripInlineStyles && attribute.name === 'style')
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  }

  function prepareArticle(source, options) {
    options = options || {};
    var article = source.cloneNode(true);
    article.querySelectorAll('.section-fold-item[hidden]').forEach(function (element) {
      element.removeAttribute('hidden');
    });
    article.querySelectorAll('.countable, .docsify-copy-code-button, .pagination-item, script, style, button, noscript').forEach(function (element) {
      element.remove();
    });
    article.querySelectorAll('.article-title-row').forEach(unwrap);

    article.querySelectorAll('a.anchor').forEach(unwrap);
    article.querySelectorAll('a').forEach(function (link) {
      var href = publicUrl(link.getAttribute('href'));
      if (href) link.setAttribute('href', href);
      else link.removeAttribute('href');
      link.removeAttribute('target');
      link.removeAttribute('rel');
    });
    article.querySelectorAll('img').forEach(function (image) {
      var src = publicAssetUrl(image.getAttribute('src') || image.src);
      if (src) image.setAttribute('src', src);
      else image.removeAttribute('src');
      image.removeAttribute('data-origin');
    });

    article.querySelectorAll('*').forEach(function (element) {
      sanitizeAttributes(element, options.stripInlineStyles);
    });
    if (options.cleanRoot) sanitizeAttributes(article, options.stripInlineStyles);

    return article;
  }

  function styleArticle(source) {
    var article = prepareArticle(source);

    article.querySelectorAll('img').forEach(function (image) {
      applyStyles(image, {
        borderRadius: '6px',
        display: 'block',
        height: 'auto',
        margin: '22px auto',
        maxWidth: '100%'
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

  function zhihuArticle(source) {
    return prepareArticle(source, {
      cleanRoot: true,
      stripInlineStyles: true
    });
  }

  function articlePlainText(article) {
    function walk(node) {
      if (!node) return '';
      if (node.nodeType === 3) return node.nodeValue || '';
      if (node.nodeType !== 1) return '';

      var tag = String(node.tagName || '').toUpperCase();
      if (tag === 'BR') return '\n';
      if (tag === 'IMG') return node.getAttribute && node.getAttribute('alt') ? node.getAttribute('alt') : '';

      var text = Array.from(node.childNodes || []).map(walk).join('');
      if (tag === 'LI') return '- ' + text.trim() + '\n';
      if (tag === 'TD' || tag === 'TH') return text.trim() + '\t';
      if (tag === 'TR') return text.replace(/\t$/, '') + '\n';
      if (/^(ARTICLE|SECTION|DIV|H[1-6]|P|UL|OL|BLOCKQUOTE|PRE|TABLE)$/.test(tag)) return text.trim() + '\n\n';
      return text;
    }

    var text = walk(article);
    if (!text && article) text = article.innerText || article.textContent || '';
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function buildWechatPayload(source) {
    var article = styleArticle(source);
    return {
      html: '<section style="background:#ffffff;margin:0;padding:0;">' + article.outerHTML + '</section>',
      text: articlePlainText(article)
    };
  }

  function buildZhihuPayload(source) {
    var article = zhihuArticle(source);
    return {
      // Draft.js merges adjacent quote blocks. A non-quote spacer keeps each
      // original excerpt separate without adding visible text or dividers.
      html: article.outerHTML.replace(/<\/blockquote>\s*(?=<blockquote\b)/gi, '</blockquote><p>\u200b</p>'),
      text: articlePlainText(article),
      imageAlts: Array.from(article.querySelectorAll('img')).map(function (image) { return image.getAttribute('alt') || ''; }),
      quoteCount: article.querySelectorAll('blockquote').length,
      quotes: Array.from(article.querySelectorAll('blockquote')).map(function (quote) { return quote.textContent || ''; })
    };
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
    var activeElement = document.activeElement;
    var selection = window.getSelection ? window.getSelection() : null;
    var previousRanges = [];
    var copied = false;

    try {
      if (selection && typeof selection.getRangeAt === 'function') {
        for (var index = 0; index < selection.rangeCount; index += 1) {
          var previousRange = selection.getRangeAt(index);
          previousRanges.push(typeof previousRange.cloneRange === 'function' ? previousRange.cloneRange() : previousRange);
        }
      }
      holder.focus();
      var range = document.createRange();
      range.selectNodeContents(holder);
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    } finally {
      try {
        if (selection) {
          selection.removeAllRanges();
          previousRanges.forEach(function (previousRange) { selection.addRange(previousRange); });
        }
      } catch (error) {
        // A stale range should not prevent cleanup after the fallback copy attempt.
      }
      if (holder.parentNode) holder.parentNode.removeChild(holder);
      else if (typeof holder.remove === 'function') holder.remove();
      if (activeElement && typeof activeElement.focus === 'function') activeElement.focus();
    }
    if (!copied) throw new Error('浏览器未允许复制');
  }

  function writeClipboard(html, text) {
    function fallbackPromise() {
      try {
        copyFallback(html, text);
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    }

    if (window.navigator.clipboard && window.ClipboardItem) {
      try {
        return Promise.resolve(window.navigator.clipboard.write([new window.ClipboardItem({
          'text/html': new window.Blob([html], { type: 'text/html' }),
          'text/plain': new window.Blob([text], { type: 'text/plain' })
        })])).catch(fallbackPromise);
      } catch (error) {
        return fallbackPromise();
      }
    }
    return fallbackPromise();
  }

  function showToast(message, state) {
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.state = state || '';
    toast.hidden = false;
    window.clearTimeout(toast.docReadTimer);
    toast.docReadTimer = window.setTimeout(function () { toast.hidden = true; }, 3600);
  }

  function updateVisibility() {
    var isReadingNote = /^#\/docs\/(?:read|read-history)\//.test(window.location.hash);
    if (tools) tools.hidden = !isReadingNote;
    else {
      [wechatButton, zhihuButton].forEach(function (copyButton) {
        if (copyButton) copyButton.hidden = !isReadingNote;
      });
    }
    if (!isReadingNote && toast) toast.hidden = true;
  }

  function hideUntilRendered() {
    if (tools) tools.hidden = true;
    else {
      [wechatButton, zhihuButton].forEach(function (copyButton) {
        if (copyButton) copyButton.hidden = true;
      });
    }
    if (toast) toast.hidden = true;
  }

  function setButtonState(copyButton, state) {
    copyButton.disabled = Boolean(state);
    if (state) copyButton.dataset.copyState = state;
    else delete copyButton.dataset.copyState;
    if (state === 'loading') copyButton.setAttribute('aria-busy', 'true');
    else copyButton.removeAttribute('aria-busy');
  }

  function bindCopyButton(copyButton, buildPayload, successMessage) {
    if (!copyButton) return;
    copyButton.addEventListener('click', function () {
      var source = document.querySelector('.markdown-section');
      if (!source) {
        showToast('暂时无法读取当前文章，请刷新页面后重试。', 'error');
        return;
      }

      setButtonState(copyButton, 'loading');
      try {
        var payload = buildPayload(source);
        writeClipboard(payload.html, payload.text).then(function () {
          setButtonState(copyButton, 'success');
          showToast(successMessage, 'success');
        }).catch(function () {
          setButtonState(copyButton, 'error');
          showToast('浏览器没有授予剪切板权限，请允许访问后重试。', 'error');
        }).finally(function () {
          window.setTimeout(function () { setButtonState(copyButton, ''); }, 1800);
        });
      } catch (error) {
        setButtonState(copyButton, 'error');
        showToast('整理文章失败，请刷新页面后重试。', 'error');
        window.setTimeout(function () { setButtonState(copyButton, ''); }, 1800);
      }
    });
  }

  window.DocReadArticleCopy = {
    articlePlainText: articlePlainText,
    buildWechatPayload: buildWechatPayload,
    buildZhihuPayload: buildZhihuPayload,
    prepareArticle: prepareArticle,
    publicAssetUrl: publicAssetUrl,
    publicUrl: publicUrl,
    writeClipboard: writeClipboard
  };

  bindCopyButton(
    wechatButton,
    buildWechatPayload,
    '已复制紫色富文本，打开公众号编辑器直接粘贴即可。'
  );
  function zhihuRequest(id, payload) {
    var local = location.protocol === 'file:';
    var route = '/__doc_read/zhihu/' + (local ? 'file/' : '') + 'jobs' + (id ? '/' + encodeURIComponent(id) : '');
    var url = new URL(route, window.DOC_READ_XHS_API_URL || 'http://127.0.0.1:3002');
    if (!local) {
      var controller = new AbortController();
      var requestTimer = setTimeout(function () { controller.abort(); }, 15000);
      return fetch(url.href, Object.assign({ signal: controller.signal }, id ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }))
        .then(function (r) { return r.json(); }).finally(function () { clearTimeout(requestTimer); });
    }
    return new Promise(function (resolve, reject) {
      var callbacks = window.DocReadXhsJsonp = window.DocReadXhsJsonp || {};
      var key = 'zhihu' + Date.now().toString(36) + Math.random().toString(36).slice(2);
      var script = document.createElement('script');
      function cleanup() { clearTimeout(timer); delete callbacks[key]; script.remove(); }
      var timer = setTimeout(function () { cleanup(); reject(new Error('连接超时，请运行 npm run xhs:install 更新本地助手')); }, 15000);
      callbacks[key] = function (body) { cleanup(); resolve(body); };
      url.searchParams.set('callback', key);
      Object.keys(payload || {}).forEach(function (k) { url.searchParams.set(k, payload[k]); });
      script.onerror = function () { cleanup(); reject(new Error('无法连接本地助手，请运行 npm run xhs:install')); };
      script.src = url.href; document.head.appendChild(script);
    });
  }
  if (zhihuButton) {
    zhihuButton.setAttribute('aria-label', '送到知乎草稿');
    zhihuButton.dataset.tooltip = '送到知乎草稿（Shift 点击仅复制）';
    zhihuButton.addEventListener('click', async function (event) {
      if (zhihuButton.disabled) return;
      if (!document.querySelector('.markdown-section h1')) { showToast('无法读取当前文章，请等待页面加载完成', 'error'); return; }
      if (event && event.shiftKey) {
        var copied = buildZhihuPayload(document.querySelector('.markdown-section'));
        await writeClipboard(copied.html, copied.text);
        showToast('已复制知乎富文本', 'success'); return;
      }
      var route;
      try { route = decodeURIComponent(location.hash.split('?')[0].replace(/^#\//, '')).replace(/\.md$/, '') + '.md'; } catch (_) { return; }
      if (!/^(docs\/read|docs\/read-history)\/.+\.md$/.test(route)) return;
      zhihuButton.disabled = true;
      zhihuButton.setAttribute('aria-busy', 'true');
      function status(message) { toast.textContent = message; toast.hidden = false; clearTimeout(toast.docReadTimer); }
      try {
        status('正在连接本地助手…');
        var entry = new URL(location.href); entry.hash = ''; entry.search = '';
        var job = await zhihuRequest('', { path: route, siteOrigin: location.protocol === 'file:' ? entry.href : location.origin });
        var deadline = Date.now() + 10 * 60 * 1000;
        while (!job.error && job.status !== 'completed' && job.status !== 'failed') {
          status((job.progress || 0) + '% · ' + job.stage);
          if (Date.now() > deadline) throw new Error('等待超时，请检查 Chrome；已有草稿不会自动删除');
          await new Promise(function (resolve) { setTimeout(resolve, 1200); });
          job = await zhihuRequest(job.id);
        }
        if (job.error || job.status === 'failed') throw new Error(job.error || job.stage);
        status('知乎内容已就绪，未发布。' + (job.warning || '请确认知乎自动保存状态。'));
        if (job.draftUrl && /^https:\/\/zhuanlan\.zhihu\.com\/p\/\d+\/edit$/.test(job.draftUrl)) {
          var link = document.createElement('a'); link.href = job.draftUrl; link.textContent = '打开草稿'; link.target = '_blank'; link.rel = 'noopener'; toast.appendChild(link);
        }
      } catch (error) { status(error.message + '（Shift 点击知乎按钮仍可仅复制）'); }
      finally { zhihuButton.disabled = false; zhihuButton.removeAttribute('aria-busy'); }
    });
  }

  document.addEventListener('doc-read:rendered', updateVisibility);
  window.addEventListener('hashchange', hideUntilRendered);
  document.addEventListener('DOMContentLoaded', updateVisibility);
  updateVisibility();
}());
