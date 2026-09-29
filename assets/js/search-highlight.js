(function (global) {
  'use strict';

  var lastArticle = null;
  var lastSource = null;
  var lastQuery = '';
  var firstMatch = null;
  var landed = false;
  var frame = null;
  var forceLanding = false;
  var cancelLanding = function () {};
  var excluded = 'script, style, noscript, button, textarea, select, svg, [aria-hidden="true"], .docsify-pagination-container, .pagination-item, .countable, .history-reading-stats';
  var blocks = 'p, li, h1, h2, h3, h4, h5, h6, td, th, pre, figcaption, blockquote, .history-outline-line, .reading-image-caption';

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function findRanges(text, query) {
    var terms = Array.from(new Set(String(query).trim().split(/\s+/).filter(Boolean)));
    if (!terms.length) return [];
    var pattern = terms.sort(function (a, b) { return b.length - a.length; }).map(function (term) {
      return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('|');
    var matcher = new RegExp(pattern, 'giu');
    var ranges = [];
    var match;
    while ((match = matcher.exec(text))) ranges.push({ start: match.index, end: match.index + match[0].length });
    return ranges;
  }

  function highlightText(text, query) {
    text = String(text);
    var position = 0;
    var html = '';
    findRanges(text, query).forEach(function (range) {
      html += escapeHtml(text.slice(position, range.start)) + '<mark class="search-keyword">' +
        escapeHtml(text.slice(range.start, range.end)) + '</mark>';
      position = range.end;
    });
    return html + escapeHtml(text.slice(position));
  }

  function excerpt(text, query) {
    var match = findRanges(text, query)[0];
    var start = Math.max(0, (match ? match.start : 0) - 42);
    var end = Math.min(text.length, Math.max(start + 108, match ? match.end : 0));
    return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  }

  function clearHighlights(article) {
    article.querySelectorAll('mark.search-keyword').forEach(function (mark) {
      var parent = mark.parentNode;
      mark.replaceWith(global.document.createTextNode(mark.textContent));
      parent.normalize();
    });
  }

  function clear() {
    cancelLanding();
    if (frame !== null) global.cancelAnimationFrame(frame);
    frame = null;
    forceLanding = false;
    var article = global.document.querySelector('.markdown-section');
    var left = global.scrollX;
    var top = global.scrollY;
    if (article) clearHighlights(article);
    lastArticle = null;
    lastSource = null;
    lastQuery = '';
    firstMatch = null;
    landed = false;
    global.scrollTo({ left: left, top: top, behavior: 'instant' });
  }

  function highlightArticle(article, query) {
    var groups = new Map();
    var walker = global.document.createTreeWalker(article, 4);
    var node;
    // Search folded text as well, preserving links, bold text, and other inline formatting.
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (!parent || parent.closest(excluded) || !node.textContent) continue;
      var block = parent.closest(blocks) || article;
      var group = groups.get(block);
      if (!group) { group = { text: '', nodes: [] }; groups.set(block, group); }
      group.nodes.push({ node: node, start: group.text.length });
      group.text += node.textContent;
    }
    groups.forEach(function (group) {
      var ranges = findRanges(group.text, query);
      if (!ranges.length) return;
      group.nodes.forEach(function (part) {
        var text = part.node.textContent;
        var end = part.start + text.length;
        var overlaps = ranges.filter(function (range) { return range.start < end && range.end > part.start; });
        if (!overlaps.length) return;
        var fragment = global.document.createDocumentFragment();
        var position = 0;
        overlaps.forEach(function (range) {
          var localStart = Math.max(0, range.start - part.start);
          var localEnd = Math.min(text.length, range.end - part.start);
          fragment.appendChild(global.document.createTextNode(text.slice(position, localStart)));
          var mark = global.document.createElement('mark');
          mark.className = 'search-keyword';
          mark.textContent = text.slice(localStart, localEnd);
          fragment.appendChild(mark);
          position = localEnd;
        });
        fragment.appendChild(global.document.createTextNode(text.slice(position)));
        part.node.replaceWith(fragment);
      });
    });
    return article.querySelector('mark.search-keyword');
  }

  function decodedRoute(value) {
    var route = value.split('?')[0].replace(/^#\/?/, '').replace(/\.md$/, '');
    try { return decodeURIComponent(route); } catch (error) { return route; }
  }

  function searchQuery(hash) {
    return new URLSearchParams(hash.split('?')[1] || '').get('search') || '';
  }

  function scrollToMatch(article, match, hash, query) {
    cancelLanding();
    var stopped = false;
    var observer;
    var timers = [];
    function stop() {
      stopped = true;
      if (observer) observer.disconnect();
      timers.forEach(function (timer) { global.clearTimeout(timer); });
      ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) {
        global.document.removeEventListener(type, stop, true);
      });
    }
    function position() {
      if (stopped) return;
      if (decodedRoute(global.location.hash) !== decodedRoute(hash) || searchQuery(global.location.hash) !== query || !match.isConnected) { stop(); return; }
      var top = match.getBoundingClientRect().top + global.scrollY;
      var header = global.document.querySelector('.app-nav');
      var headerHeight = (header && header.getBoundingClientRect().height) || 57;
      global.scrollTo({ top: Math.max(0, top - headerHeight - Math.max(36, (global.innerHeight - headerHeight) * .25)), behavior: 'instant' });
      landed = true;
    }
    cancelLanding = stop;
    // Lazy article styles, images and the navbar can settle after Docsify's render hook.
    // Keep the match in place briefly, but yield immediately to the reader's input.
    if (global.ResizeObserver) {
      observer = new global.ResizeObserver(position);
      observer.observe(article);
      var header = global.document.querySelector('.app-nav');
      if (header) observer.observe(header);
    }
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach(function (type) {
      global.document.addEventListener(type, stop, { capture: true, passive: true });
    });
    position();
    [100, 350].forEach(function (delay) { timers.push(global.setTimeout(position, delay)); });
    timers.push(global.setTimeout(stop, 2000));
  }

  function apply() {
    frame = null;
    var article = global.document.querySelector('.markdown-section');
    if (!article) return;
    var hash = global.location.hash || '#/';
    var source = global.DOC_READ_PAGE_SOURCE;
    // Wait for the destination article; a hash change can precede its network response.
    if (!source || decodedRoute(source.path) !== decodedRoute(hash)) return;
    var query = searchQuery(hash);
    if (article !== lastArticle || source !== lastSource || query !== lastQuery) {
      cancelLanding();
      clearHighlights(article);
      lastArticle = article;
      lastSource = source;
      lastQuery = query;
      firstMatch = query ? highlightArticle(article, query) : null;
      landed = false;
    }
    if (!firstMatch || !firstMatch.isConnected) { forceLanding = false; return; }
    if (!global.DocReadSectionFold) return;
    if (landed && !forceLanding) return;
    global.DocReadSectionFold.reveal(firstMatch);
    firstMatch.classList.add('search-keyword-current');
    forceLanding = false;
    global.requestAnimationFrame(function () {
      if (decodedRoute(global.location.hash) !== decodedRoute(hash) || searchQuery(global.location.hash) !== query || !firstMatch || !firstMatch.isConnected) return;
      scrollToMatch(article, firstMatch, hash, query);
    });
  }

  function schedule(force) {
    forceLanding = forceLanding || force === true;
    if (frame !== null) global.cancelAnimationFrame(frame);
    frame = global.requestAnimationFrame(apply);
  }

  global.DocReadSearchHighlight = { highlightText: highlightText, excerpt: excerpt, clear: clear };
  global.document.addEventListener('doc-read:rendered', function () { schedule(false); });
  global.document.addEventListener('doc-read:sections-ready', function () { schedule(false); });
  global.document.addEventListener('doc-read:search-result', function (event) {
    var href = event.detail && event.detail.href;
    if (href && decodedRoute(href) === decodedRoute(global.location.hash) && searchQuery(href) === searchQuery(global.location.hash)) schedule(true);
  });
  global.addEventListener('hashchange', function () { schedule(false); });
  global.document.addEventListener('DOMContentLoaded', function () { schedule(false); });
}(window));
