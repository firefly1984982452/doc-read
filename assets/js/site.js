(function () {
  'use strict';

  var root = document.documentElement;
  var toggle = document.getElementById('theme-toggle');
  var progress = document.getElementById('reading-progress');

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

  function updateProgress() {
    var article = document.querySelector('.markdown-section');
    if (!article) return;
    var rect = article.getBoundingClientRect();
    var readable = Math.max(article.scrollHeight - window.innerHeight, 1);
    var read = Math.min(Math.max(-rect.top, 0), readable);
    progress.style.transform = 'scaleX(' + (read / readable) + ')';
  }

  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress, { passive: true });
  window.addEventListener('hashchange', function () {
    progress.style.transform = 'scaleX(0)';
    window.requestAnimationFrame(updateProgress);
  });
  updateThemeLabel();
}());
