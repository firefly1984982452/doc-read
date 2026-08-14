(function () {
  'use strict';

  var indexPromise = null;
  var searchManifest = null;
  var contentPromise = null;
  var contentItems = [];
  var latestQuery = '';

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function loadJson(relative) {
    return window.DocReadResources.json(relative);
  }

  function loadIndex() {
    if (searchManifest) return Promise.resolve(searchManifest.items || []);
    if (!indexPromise) {
      indexPromise = loadJson('assets/data/search-index.json').then(function (manifest) {
        searchManifest = manifest;
        return manifest.items || [];
      }).catch(function (error) {
        indexPromise = null;
        throw error;
      });
    }
    return indexPromise;
  }

  function excerpt(text, query) {
    var lower = text.toLocaleLowerCase('zh-CN');
    var index = lower.indexOf(query);
    var start = Math.max(0, index < 0 ? 0 : index - 42);
    var end = Math.min(text.length, start + 108);
    return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  function rank(items, query, titleOnly) {
    var terms = query.toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return items.map(function (item) {
      var title = item.title.toLocaleLowerCase('zh-CN');
      var text = titleOnly ? '' : (item.text || '').toLocaleLowerCase('zh-CN');
      var score = 0;
      for (var index = 0; index < terms.length; index += 1) {
        var term = terms[index];
        var titlePosition = title.indexOf(term);
        var textPosition = text.indexOf(term);
        if (titlePosition < 0 && textPosition < 0) return null;
        if (titlePosition >= 0) score += titlePosition === 0 ? 120 : 80;
        if (textPosition >= 0) score += Math.max(8, 30 - Math.floor(textPosition / 800));
      }
      return { item: item, score: score };
    }).filter(Boolean);
  }

  function search(titleItems, bodyItems, query) {
    var byPath = new Map();
    rank(titleItems, query, true).concat(rank(bodyItems, query, false)).forEach(function (match) {
      var existing = byPath.get(match.item.path);
      if (!existing || match.score > existing.score || (!existing.item.text && match.item.text)) {
        byPath.set(match.item.path, match);
      }
    });
    return Array.from(byPath.values()).sort(function (a, b) {
      return b.score - a.score || a.item.title.localeCompare(b.item.title, 'zh-CN');
    }).slice(0, 12);
  }

  function render(container, titleItems, query, loading) {
    var results = container.querySelector('[data-search-results]');
    if (!query) {
      results.hidden = true;
      results.innerHTML = '';
      return;
    }
    var matches = search(titleItems, contentItems, query);
    results.hidden = false;
    if (matches.length) {
      results.innerHTML = matches.map(function (match) {
        var summary = match.item.text ? excerpt(match.item.text, query) : '书名匹配';
        return '<a class="matching-post" href="#' + escapeHtml(match.item.path) + '">' +
          '<h2>' + escapeHtml(match.item.title) + '</h2>' +
          '<p>' + escapeHtml(summary) + '</p>' +
        '</a>';
      }).join('');
    } else {
      results.innerHTML = '<p class="search-empty">' + (loading ? '正在检索正文内容…' : '没有找到相关内容') + '</p>';
    }
    results.setAttribute('aria-busy', String(Boolean(loading)));
  }

  function loadContentChunks(onProgress) {
    if (contentPromise) return contentPromise;
    contentPromise = loadIndex().then(function () {
      var count = Number(searchManifest && searchManifest.chunkCount || 0);
      var sequence = Promise.resolve();
      for (var index = 0; index < count; index += 1) {
        (function (chunkIndex) {
          sequence = sequence.then(function () {
            return loadJson('assets/data/search-chunks/' + chunkIndex + '.json').then(function (chunk) {
              contentItems = contentItems.concat(chunk);
              if (onProgress) onProgress(chunkIndex + 1 < count);
            });
          });
        }(index));
      }
      return sequence;
    }).catch(function (error) {
      contentPromise = null;
      throw error;
    });
    return contentPromise;
  }

  function mount() {
    var sidebar = document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('doc-read-search')) return;

    var container = document.createElement('div');
    container.className = 'search';
    container.id = 'doc-read-search';
    container.setAttribute('role', 'search');
    container.innerHTML = '<label class="visually-hidden" for="doc-read-search-input">搜索阅读笔记</label>' +
      '<input id="doc-read-search-input" type="search" autocomplete="off" placeholder="搜索书名、作者或笔记内容" aria-controls="doc-read-search-results">' +
      '<div id="doc-read-search-results" class="results-panel" data-search-results aria-live="polite" hidden></div>';
    sidebar.insertBefore(container, sidebar.firstChild);

    var input = container.querySelector('input');
    input.addEventListener('focus', loadIndex);
    input.addEventListener('input', function () {
      latestQuery = input.value.trim().toLocaleLowerCase('zh-CN');
      if (!latestQuery) {
        render(container, [], '', false);
        return;
      }
      container.classList.add('is-loading');
      loadIndex().then(function (items) {
        render(container, items, latestQuery, true);
        return loadContentChunks(function (loading) {
          render(container, items, latestQuery, loading);
        });
      }).then(function () {
        container.classList.remove('is-loading');
        return loadIndex();
      }).then(function (items) {
        render(container, items, latestQuery, false);
      }).catch(function () {
        container.classList.remove('is-loading');
        var results = container.querySelector('[data-search-results]');
        results.hidden = false;
        results.innerHTML = '<p class="search-empty">搜索索引加载失败，请刷新后重试。</p>';
      });
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        input.value = '';
        latestQuery = '';
        render(container, [], '', false);
        input.blur();
      }
    });
    container.addEventListener('click', function (event) {
      if (!event.target.closest('.matching-post')) return;
      input.value = '';
      latestQuery = '';
      render(container, [], '', false);
    });
  }

  document.addEventListener('doc-read:rendered', mount);
  document.addEventListener('DOMContentLoaded', mount);
  setTimeout(mount, 300);
}());
