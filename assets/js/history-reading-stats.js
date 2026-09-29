(function (global) {
  'use strict';

  var excluded = 'h1, .article-title-row, .reading-date, .article-reading-meta, .history-reading-stats, .reading-image-caption, figcaption, button, [role="button"], input, select, textarea, script, style, noscript, .docsify-pagination-container, .pagination-item, .countable, .word-count';

  function routePath(hash) {
    var route = String(hash || '').split('?')[0].replace(/^#\//, '').replace(/\.md$/, '');
    try { return decodeURIComponent(route); } catch (error) { return ''; }
  }

  function isArticle(hash) {
    var route = routePath(hash);
    return /^docs\/(?:read|read-history|other)\/.+/.test(route) || route === 'docs/think/think';
  }

  function bodyText(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1 || node.matches(excluded)) return '';
    // Traverse text nodes rather than innerText, so collapsed sections remain included.
    var text = Array.from(node.childNodes).map(bodyText).join('');
    return /^(?:P|DIV|SECTION|H[2-6]|LI|UL|OL|BLOCKQUOTE|TR|TD|TH|BR)$/.test(node.tagName)
      ? '\n' + text + '\n' : text;
  }

  function countWords(text) {
    var plain = String(text || '').replace(/(?:https?:\/\/|www\.)[^\s<>]+/gi, ' ');
    var chinese = plain.match(/\p{Script=Han}/gu) || [];
    var words = plain.replace(/\p{Script=Han}/gu, ' ').match(/[\p{L}\p{N}]+(?:[’'.-][\p{L}\p{N}]+)*/gu) || [];
    return chinese.length + words.length;
  }

  function readingMinutes(count) {
    return Math.ceil(count / 400);
  }

  function mount() {
    if (!isArticle(global.location.hash)) return;
    var source = global.DOC_READ_PAGE_SOURCE;
    if (!source || source.path !== routePath(global.location.hash) + '.md') return;
    var article = global.document.querySelector('.markdown-section');
    if (!article || !article.querySelector('h1')) return;
    var date = Array.from(article.children).find(function (node) {
      return node.tagName === 'P' && (node.classList.contains('article-reading-meta') || /^\s*date\s*:/i.test(node.textContent));
    });
    if (!date) {
      // Undated essays and diaries still show reading statistics, without inventing a date.
      date = global.document.createElement('p');
      var title = article.querySelector('.article-title-row, h1');
      title.insertAdjacentElement('afterend', date);
    }
    date.classList.add('article-reading-meta');

    var count = countWords(bodyText(article));
    var stats = date.querySelector('.history-reading-stats');
    if (!stats) {
      if (date.firstChild) {
        var dateValue = global.document.createElement('span');
        while (date.firstChild) dateValue.appendChild(date.firstChild);
        date.appendChild(dateValue);
      }
      stats = global.document.createElement('span');
      stats.className = 'history-reading-stats';
      date.appendChild(stats);
      date.classList.add('history-reading-date');
    }
    stats.title = '统计正文（含折叠内容）；汉字逐字计数，英文和数字按词计数；不计文章标题、日期、标点、链接地址、图片说明及操作按钮。按约 400 字/分钟估算，向上取整。';
    stats.textContent = '';
    ['总字数：' + count.toLocaleString('zh-CN') + ' 字', '预计阅读：' + readingMinutes(count) + ' 分钟'].forEach(function (label) {
      var item = global.document.createElement('span');
      item.textContent = label;
      stats.appendChild(item);
    });
  }

  // Keep the existing asset and global name so cached pages can load the generalized implementation.
  global.DocReadHistoryStats = { isArticle: isArticle, bodyText: bodyText, countWords: countWords, readingMinutes: readingMinutes, mount: mount };
}(window));
