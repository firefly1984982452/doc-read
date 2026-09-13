(function () {
  'use strict';

  var indexPromise = null;
  var searchManifest = null;
  var contentPromise = null;
  var contentItems = [];
  var latestQuery = '';
  var loadedChunks = new Map();
  var normalizedItems = new WeakMap();

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
      var normalized = normalizedItems.get(item);
      if (!normalized) {
        normalized = { title: item.title.toLocaleLowerCase('zh-CN'), text: (item.text || '').toLocaleLowerCase('zh-CN') };
        normalizedItems.set(item, normalized);
      }
      var title = normalized.title;
      var text = titleOnly ? '' : normalized.text;
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
      results.setAttribute('aria-busy', 'false');
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
      var next = 0;
      var failure = null;
      function worker() {
        if (next >= count) return Promise.resolve();
        var chunkIndex = next++;
        var request = loadedChunks.has(chunkIndex)
          ? Promise.resolve()
          : loadJson('assets/data/search-chunks/' + chunkIndex + '.json').then(function (chunk) {
            loadedChunks.set(chunkIndex, chunk);
            contentItems = Array.from(loadedChunks.values()).reduce(function (all, items) { return all.concat(items); }, []);
            if (onProgress) onProgress(true);
          });
        return request.catch(function (error) { failure = error; }).then(worker);
      }
      return Promise.all(Array.from({ length: Math.min(3, count) }, worker)).then(function () {
        if (failure) throw failure;
      });
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
    var debounceTimer;
    var progressTimer;
    var queryVersion = 0;
    function scheduleRender(items, loading) {
      clearTimeout(progressTimer);
      progressTimer = setTimeout(function () { render(container, items, latestQuery, loading); }, 80);
    }
    function runSearch() {
      var version = queryVersion;
      if (!latestQuery) return;
      container.classList.add('is-loading');
      loadIndex().then(function (items) {
        if (version !== queryVersion) return;
        render(container, items, latestQuery, true);
        return loadContentChunks(function (loading) { scheduleRender(items, loading); });
      }).then(function () {
        if (version !== queryVersion) return;
        clearTimeout(progressTimer);
        container.classList.remove('is-loading');
        render(container, searchManifest.items, latestQuery, false);
      }).catch(function () {
        if (version !== queryVersion) return;
        clearTimeout(progressTimer);
        container.classList.remove('is-loading');
        render(container, searchManifest ? searchManifest.items : [], latestQuery, false);
        var results = container.querySelector('[data-search-results]');
        results.insertAdjacentHTML('beforeend', '<p class="search-empty">部分搜索内容加载失败。<button type="button" data-search-retry>重试</button></p>');
      });
    }
    function clearSearch() {
      queryVersion += 1;
      clearTimeout(debounceTimer);
      clearTimeout(progressTimer);
      input.value = '';
      latestQuery = '';
      container.classList.remove('is-loading');
      render(container, [], '', false);
    }
    input.addEventListener('focus', function () { loadIndex().catch(function () { /* Retried when searching. */ }); });
    input.addEventListener('input', function () {
      queryVersion += 1;
      latestQuery = input.value.trim().toLocaleLowerCase('zh-CN');
      clearTimeout(debounceTimer);
      if (!latestQuery) { clearSearch(); return; }
      debounceTimer = setTimeout(runSearch, 180);
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        clearSearch();
        input.blur();
      }
    });
    container.addEventListener('click', function (event) {
      if (event.target.closest('[data-search-retry]')) { queryVersion += 1; runSearch(); return; }
      if (!event.target.closest('.matching-post')) return;
      clearSearch();
    });
  }

  document.addEventListener('doc-read:rendered', mount);
  document.addEventListener('DOMContentLoaded', mount);
  setTimeout(mount, 300);
}());
