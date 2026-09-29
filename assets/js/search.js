(function () {
  'use strict';

  var indexPromise = null;
  var searchManifest = null;
  var contentPromise = null;
  var contentItems = [];
  var latestQuery = '';
  var loadedChunks = new Map();
  var normalizedItems = new WeakMap();
  var searchContainer = null;
  var searchHasFocus = false;

  function updateHeaderHeight() {
    var nav = document.querySelector('.app-nav');
    var height = (nav && nav.getBoundingClientRect().height) || 57;
    document.documentElement.style.setProperty('--topbar-height', height + 'px');
    if (window.$docsify) window.$docsify.topMargin = Math.ceil(height) + 20;
  }

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
    results.hidden = !container.classList.contains('is-open');
    if (matches.length) {
      results.innerHTML = matches.map(function (match) {
        var highlighter = window.DocReadSearchHighlight;
        var summary = match.item.text ? highlighter.excerpt(match.item.text, query) : '书名匹配';
        var href = '#' + match.item.path + (match.item.path.indexOf('?') === -1 ? '?' : '&') + 'search=' + encodeURIComponent(query);
        return '<a class="matching-post" href="' + escapeHtml(href) + '">' +
          '<h2>' + highlighter.highlightText(match.item.title, query) + '</h2>' +
          '<p>' + highlighter.highlightText(summary, query) + '</p>' +
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
    var nav = document.querySelector('.app-nav');
    var useNavbar = nav && !window.matchMedia('(max-width: 768px)').matches;
    var host = useNavbar ? nav : document.body;
    if (!host) return;
    if (nav && nav.dataset.searchObserverBound !== 'true') {
      nav.dataset.searchObserverBound = 'true';
      // Docsify can replace the navigation after rendering the article.
      new MutationObserver(mount).observe(nav, { childList: true });
      if (window.ResizeObserver) new ResizeObserver(updateHeaderHeight).observe(nav);
    }
    if (searchContainer) {
      if (searchContainer.parentElement !== host) {
        var restoreFocus = searchHasFocus;
        host.insertBefore(searchContainer, host.firstChild);
        if (restoreFocus) searchContainer.querySelector('input').focus({ preventScroll: true });
      }
      searchContainer.classList.toggle('standalone-search', !useNavbar);
      updateHeaderHeight();
      return;
    }

    var container = document.createElement('div');
    searchContainer = container;
    container.className = 'search top-search';
    container.classList.toggle('standalone-search', !useNavbar);
    container.id = 'doc-read-search';
    container.setAttribute('role', 'search');
    container.innerHTML = '<label class="visually-hidden" for="doc-read-search-input">搜索阅读笔记</label>' +
      '<input id="doc-read-search-input" type="search" autocomplete="off" placeholder="搜索书名、作者或笔记内容" aria-controls="doc-read-search-results">' +
      '<button type="button" class="search-clear" data-search-clear aria-label="清除搜索" title="清除搜索" hidden><span aria-hidden="true">×</span></button>' +
      '<div id="doc-read-search-results" class="results-panel" data-search-results aria-live="polite" hidden></div>';
    host.insertBefore(container, host.firstChild);
    updateHeaderHeight();

    var input = container.querySelector('input');
    var clearButton = container.querySelector('[data-search-clear]');
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
    function closeResults() {
      container.classList.remove('is-open');
      container.querySelector('[data-search-results]').hidden = true;
    }
    function syncRouteQuery() {
      var query = new URLSearchParams((window.location.hash || '').split('?')[1] || '').get('search');
      if (query === null) return;
      input.value = query;
      latestQuery = query.trim();
      clearButton.hidden = !input.value;
    }
    function clearSearch() {
      queryVersion += 1;
      clearTimeout(debounceTimer);
      clearTimeout(progressTimer);
      input.value = '';
      latestQuery = '';
      clearButton.hidden = true;
      container.classList.remove('is-loading');
      closeResults();
      render(container, [], '', false);
      var hash = window.location.hash || '';
      var queryStart = hash.indexOf('?');
      var params = new URLSearchParams(queryStart < 0 ? '' : hash.slice(queryStart + 1));
      if (params.has('search')) {
        params.delete('search');
        var remaining = params.toString();
        // Updating only the URL avoids a Docsify render and keeps the reader's position.
        var url = new URL(window.location.href);
        url.hash = hash.slice(0, queryStart) + (remaining ? '?' + remaining : '');
        window.history.replaceState(window.history.state, '', url.href);
      }
      window.DocReadSearchHighlight.clear();
    }
    syncRouteQuery();
    window.addEventListener('hashchange', syncRouteQuery);
    input.addEventListener('focus', function () {
      searchHasFocus = true;
      container.classList.add('is-open');
      if (latestQuery) runSearch();
      loadIndex().catch(function () { /* Retried when searching. */ });
    });
    input.addEventListener('blur', function () {
      if (container.isConnected) searchHasFocus = false;
    });
    input.addEventListener('input', function () {
      container.classList.add('is-open');
      queryVersion += 1;
      latestQuery = input.value.trim();
      clearButton.hidden = !input.value;
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
      if (event.target.closest('[data-search-clear]')) {
        input.focus({ preventScroll: true });
        clearSearch();
        return;
      }
      if (event.target.closest('[data-search-retry]')) { queryVersion += 1; runSearch(); return; }
      var matchedLink = event.target.closest('.matching-post');
      if (!matchedLink) return;
      var href = matchedLink.getAttribute('href');
      closeResults();
      if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
        document.dispatchEvent(new CustomEvent('doc-read:search-result', { detail: { href: href } }));
      }
    });
    document.addEventListener('click', function (event) {
      if (container.contains(event.target)) return;
      closeResults();
    });
  }

  document.addEventListener('doc-read:rendered', mount);
  document.addEventListener('DOMContentLoaded', mount);
  window.addEventListener('resize', mount);
  setTimeout(mount, 300);
}());
