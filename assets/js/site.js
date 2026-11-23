(function () {
  'use strict';

  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  var progress = document.getElementById('reading-progress');
  var progressLabel = document.getElementById('reading-progress-label');
  var progressFrame = null;
  var observedArticle = null;
  var progressObserver = window.ResizeObserver ? new window.ResizeObserver(scheduleProgress) : null;
  var backToTop = document.getElementById('back-to-top');
  var backToBottom = document.getElementById('back-to-bottom');

  if (backToTop) backToTop.addEventListener('click', function () {
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, left: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
  });

  if (backToBottom) backToBottom.addEventListener('click', function () {
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var page = document.scrollingElement || root;
    window.scrollTo({ top: page.scrollHeight, left: 0, behavior: reducedMotion ? 'instant' : 'smooth' });
  });

  function closeCoverAndShowRoute(route) {
    var cover = document.querySelector('.cover');
    if (cover) {
      cover.classList.remove('show');
      cover.setAttribute('aria-hidden', 'true');
    }
    if (window.location.hash !== route) {
      window.location.hash = route;
    } else {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  document.addEventListener('click', function (event) {
    var action = event.target.closest('[data-cover-action]');
    if (!action) return;
    event.preventDefault();
    var route = action.dataset.coverAction === 'library' ? '#/docs/library.md' : '#/';
    closeCoverAndShowRoute(route);
  });

  function updateThemeLabel() {
    var isDark = root.dataset.theme === 'dark';
    toggle.setAttribute('aria-label', isDark ? '切换到浅色主题' : '切换到深色主题');
    toggle.setAttribute('title', isDark ? '切换到浅色主题' : '切换到深色主题');
  }

  toggle.addEventListener('click', function () {
    var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem('doc-read-theme', next);
    updateThemeLabel();
  });

  function setProgress(value) {
    var ratio = Math.min(Math.max(value, 0), 1);
    var percent = Math.round(ratio * 100);
    if (progress) {
      progress.style.transform = 'scaleX(' + ratio + ')';
      progress.setAttribute('aria-valuenow', String(percent));
    }
    if (progressLabel) {
      progressLabel.dataset.progress = percent + '%';
      progressLabel.style.setProperty('--progress-position', (ratio * 100) + '%');
    }
  }

  function updateProgress() {
    progressFrame = null;
    var article = document.querySelector('.markdown-section');
    if (article !== observedArticle) {
      if (progressObserver) {
        progressObserver.disconnect();
        if (article) progressObserver.observe(article);
      }
      observedArticle = article;
    }
    if (!article) {
      setProgress(0);
      if (progressLabel) progressLabel.hidden = true;
      return;
    }
    var rect = article.getBoundingClientRect();
    if (progressLabel) progressLabel.hidden = !rect.height || rect.top >= window.innerHeight;
    var readable = article.scrollHeight - window.innerHeight;
    setProgress(readable > 0 ? -rect.top / readable : (rect.bottom <= window.innerHeight ? 1 : 0));
  }

  function scheduleProgress() {
    if (progressFrame === null) progressFrame = window.requestAnimationFrame(updateProgress);
  }

  window.DocReadProgress = { reset: function () { setProgress(0); } };
  window.addEventListener('scroll', scheduleProgress, { passive: true });
  window.addEventListener('resize', scheduleProgress, { passive: true });
  document.addEventListener('doc-read:rendered', scheduleProgress);
  document.addEventListener('doc-read:sections-ready', scheduleProgress);
  window.addEventListener('hashchange', function () {
    setProgress(0);
    scheduleProgress();
  });
  scheduleProgress();
  updateThemeLabel();
}());
