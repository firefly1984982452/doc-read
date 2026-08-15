(function () {
  'use strict';

  var pendingTimers = new WeakMap();
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function currentRoute() {
    return (window.location.hash || '#/').split('?')[0];
  }

  function isFoldablePage() {
    return currentRoute() !== '#/';
  }

  function sectionTitle(heading) {
    var clone = heading.cloneNode(true);
    clone.querySelectorAll('button').forEach(function (button) { button.remove(); });
    return (clone.textContent || '本节').trim();
  }

  function sectionNodes(heading) {
    var nodes = [];
    var current = heading.nextElementSibling;
    while (current && !/^(?:H1|H2)$/.test(current.tagName)) {
      if (current.classList.contains('docsify-pagination-container') || current.classList.contains('pagination-item')) break;
      nodes.push(current);
      current = current.nextElementSibling;
    }
    return nodes;
  }

  function stateKey(heading, index) {
    return 'doc-read:fold:' + currentRoute() + ':' + (heading.id || index);
  }

  function savedCollapsed(key) {
    try { return window.sessionStorage.getItem(key) === '1'; }
    catch (error) { return false; }
  }

  function saveCollapsed(key, collapsed) {
    try { window.sessionStorage.setItem(key, collapsed ? '1' : '0'); }
    catch (error) { /* Folding still works when storage is unavailable. */ }
  }

  function updateLabel(button, title, collapsed) {
    var action = collapsed ? '展开' : '折叠';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', action + '“' + title + '”');
    button.setAttribute('title', action + '本节');
  }

  function setCollapsed(heading, button, nodes, collapsed, options) {
    var timer = pendingTimers.get(heading);
    if (timer) window.clearTimeout(timer);
    pendingTimers.delete(heading);
    heading.classList.toggle('is-section-collapsed', collapsed);
    updateLabel(button, sectionTitle(heading), collapsed);
    if (options && options.persist) saveCollapsed(button.dataset.foldKey, collapsed);

    if (collapsed) {
      if (!options || !options.animate || reduceMotion) {
        nodes.forEach(function (node) {
          node.classList.remove('is-fold-entering', 'is-fold-leaving');
          node.hidden = true;
        });
        return;
      }
      nodes.forEach(function (node) {
        node.classList.remove('is-fold-entering');
        node.classList.add('is-fold-leaving');
      });
      timer = window.setTimeout(function () {
        nodes.forEach(function (node) {
          node.hidden = true;
          node.classList.remove('is-fold-leaving');
        });
        pendingTimers.delete(heading);
      }, 150);
      pendingTimers.set(heading, timer);
      return;
    }

    nodes.forEach(function (node) {
      node.hidden = false;
      node.classList.remove('is-fold-leaving');
      if (options && options.animate && !reduceMotion) node.classList.add('is-fold-entering');
    });
    if (options && options.animate && !reduceMotion) {
      window.requestAnimationFrame(function () {
        nodes.forEach(function (node) { node.classList.remove('is-fold-entering'); });
      });
    }
  }

  function mountHeading(heading, index) {
    if (heading.querySelector('.section-fold-toggle')) return;
    var nodes = sectionNodes(heading);
    if (!nodes.length) return;
    nodes.forEach(function (node) { node.classList.add('section-fold-item'); });

    var key = stateKey(heading, index);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'section-fold-toggle';
    button.dataset.foldKey = key;
    button.innerHTML = '<span aria-hidden="true"></span>';
    heading.classList.add('has-section-fold');
    heading.insertBefore(button, heading.firstChild);

    setCollapsed(heading, button, nodes, savedCollapsed(key), { animate: false, persist: false });
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var collapsed = button.getAttribute('aria-expanded') === 'true';
      setCollapsed(heading, button, nodes, collapsed, { animate: true, persist: true });
    });
  }

  function revealCurrentAnchor(article) {
    var query = (window.location.hash || '').split('?')[1] || '';
    var anchor = new URLSearchParams(query).get('id');
    if (!anchor) return;
    try { anchor = decodeURIComponent(anchor); } catch (error) { /* Keep the original anchor. */ }
    var target = document.getElementById(anchor);
    if (!target || !article.contains(target)) return;
    while (target.parentElement && target.parentElement !== article) target = target.parentElement;
    var current = target;
    while (current && current !== article) {
      if (current.tagName === 'H2') {
        var button = current.querySelector('.section-fold-toggle');
        if (button && button.getAttribute('aria-expanded') === 'false') {
          setCollapsed(current, button, sectionNodes(current), false, { animate: true, persist: true });
        }
        return;
      }
      current = current.previousElementSibling;
    }
  }

  function mount() {
    if (!isFoldablePage()) return;
    var article = document.querySelector('.markdown-section');
    if (!article) return;
    Array.from(article.children).filter(function (element) { return element.tagName === 'H2'; })
      .forEach(mountHeading);
    window.setTimeout(function () { revealCurrentAnchor(article); }, 0);
  }

  document.addEventListener('doc-read:rendered', mount);
  window.addEventListener('hashchange', function () { window.setTimeout(mount, 60); });
  document.addEventListener('DOMContentLoaded', mount);
  mount();
}());
