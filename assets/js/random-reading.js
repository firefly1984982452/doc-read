(function (global) {
  'use strict';

  var button = global.document.getElementById('random-reading');
  var toast = global.document.getElementById('wechat-copy-toast');
  var booksPromise = null;
  var pendingRenderReset = null;
  var idleLabel = button ? (button.getAttribute('aria-label') || '随机一篇内容') : '随机一篇内容';
  var excludedPaths = ['/docs/read/错别字校对报告'];

  function normalizePath(value) {
    var path = String(value || '').split('?')[0].replace(/^#/, '').replace(/\.md$/, '');
    try { path = decodeURIComponent(path); } catch (error) { /* Keep the encoded route. */ }
    return path.charAt(0) === '/' ? path : '/' + path;
  }

  function readingBooks(items, currentHash) {
    var currentPath = normalizePath(currentHash);
    var books = (Array.isArray(items) ? items : []).filter(function (item) {
      var path = normalizePath(item && item.path);
      return item
        && /^\/docs\/(?:read|read-history)\//.test(path)
        && excludedPaths.indexOf(path) === -1;
    });
    var alternatives = books.filter(function (item) {
      return normalizePath(item.path) !== currentPath;
    });
    return alternatives.length ? alternatives : books;
  }

  function choose(items, random) {
    if (!items.length) return null;
    var index = Math.min(items.length - 1, Math.floor((random || Math.random)() * items.length));
    return items[index];
  }

  function routeFor(item) {
    return '#' + normalizePath(item && item.path);
  }

  function showToast(message, state) {
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.state = state || '';
    toast.hidden = false;
    global.clearTimeout(toast.docReadTimer);
    toast.docReadTimer = global.setTimeout(function () { toast.hidden = true; }, 3600);
  }

  function setButtonState(busy) {
    if (!button) return;
    button.disabled = busy;
    if (busy) {
      button.dataset.copyState = 'loading';
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-label', '正在随机选择文章');
      button.dataset.tooltip = '正在随机选择…';
      return;
    }
    delete button.dataset.copyState;
    button.removeAttribute('aria-busy');
    button.setAttribute('aria-label', idleLabel);
    button.dataset.tooltip = idleLabel;
  }

  function loadBooks() {
    if (booksPromise) return booksPromise;
    booksPromise = global.DocReadResources.json('assets/data/book-metadata.json')
      .catch(function (error) {
        booksPromise = null;
        throw error;
      });
    return booksPromise;
  }

  function resetProgress() {
    var progress = global.document.getElementById('reading-progress');
    if (progress) progress.style.transform = 'scaleX(0)';
  }

  function resetReadingPosition() {
    resetProgress();
    global.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  function resetAfterRender(route) {
    var expectedPath = normalizePath(route);
    if (pendingRenderReset) {
      global.document.removeEventListener('doc-read:rendered', pendingRenderReset);
    }
    pendingRenderReset = function () {
      var source = global.DOC_READ_PAGE_SOURCE;
      var renderedPath = source && source.path ? source.path : global.location.hash;
      if (normalizePath(renderedPath) !== expectedPath) return;
      global.document.removeEventListener('doc-read:rendered', pendingRenderReset);
      pendingRenderReset = null;
      resetReadingPosition();
    };
    global.document.addEventListener('doc-read:rendered', pendingRenderReset);
  }

  function openRandomReading() {
    if (!button || button.disabled) return Promise.resolve(null);
    setButtonState(true);
    return loadBooks().then(function (items) {
      var selected = choose(readingBooks(items, global.location.hash));
      if (!selected) throw new Error('没有可供随机阅读的文章');
      var route = routeFor(selected);
      resetProgress();
      if (global.location.hash === route) {
        resetReadingPosition();
      } else {
        resetAfterRender(route);
        global.location.hash = route;
      }
      return selected;
    }).catch(function () {
      showToast('随机文章读取失败，请刷新页面后重试。', 'error');
      return null;
    }).finally(function () {
      setButtonState(false);
    });
  }

  if (button) button.addEventListener('click', openRandomReading);

  global.DocReadRandomReading = {
    choose: choose,
    normalizePath: normalizePath,
    open: openRandomReading,
    readingBooks: readingBooks,
    routeFor: routeFor
  };
}(window));
