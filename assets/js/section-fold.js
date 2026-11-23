(function () {
  'use strict';

  var pendingTimers = new WeakMap();
  var nodeOwners = new WeakMap();
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function currentRoute() {
    return (window.location.hash || '#/').split('?')[0];
  }

  function headingLevel(heading) {
    return /^H[1-6]$/.test(heading.tagName) ? Number(heading.tagName.slice(1)) : 0;
  }

  function sectionTitle(heading) {
    var clone = heading.cloneNode(true);
    clone.querySelectorAll('button').forEach(function (button) { button.remove(); });
    return (clone.textContent || '本节').trim();
  }

  function isArticleCover(node) {
    if (node.tagName !== 'P' || node.childElementCount !== 1) return false;
    var image = node.querySelector(':scope > img, :scope > .reading-image-with-caption > img');
    return Boolean(image && /^《[^》]+》(微信公众号封面|纪录片学习笔记封面)$/.test(image.getAttribute('alt') || ''));
  }

  function sectionNodes(heading) {
    var nodes = [];
    var level = headingLevel(heading);
    var current = heading.nextElementSibling;
    while (current) {
      var currentLevel = headingLevel(current);
      if (currentLevel && currentLevel <= level) break;
      if (current.classList.contains('docsify-pagination-container') || current.classList.contains('pagination-item')) break;
      // An article's cover sits outside the last foldable section.
      if (isArticleCover(current)) break;
      nodes.push(current);
      current = current.nextElementSibling;
    }
    return nodes;
  }

  function stateKey(heading, index) {
    return 'doc-read:fold:' + currentRoute() + ':' + (heading.id || index);
  }

  function savedCollapsed(key) {
    var route = currentRoute();
    try { route = decodeURIComponent(route); } catch (error) { /* Keep malformed routes unchanged. */ }
    // Both Ruohua pages start as compact lists, regardless of old saved states.
    if (/^#\/docs\/other\/若华(?:阅读笔记|日记)(?:\.md)?$/.test(route)) return true;
    if (/^#\/docs\/read-history\/《(?:中国|世界)通史》纪录片学习笔记(?:\.md)?$/.test(route)) return true;
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

  function isNodeCollapsed(node) {
    var owners = nodeOwners.get(node);
    return owners && Array.from(owners).some(function (heading) {
      return heading.classList.contains('is-section-collapsed');
    });
  }

  function updateNode(node, animate) {
    // A node may belong to H2, H3 and H4 simultaneously. Cancel animation per
    // node so an older parent/child transition cannot overwrite the new state.
    var timer = pendingTimers.get(node);
    if (timer) window.clearTimeout(timer);
    pendingTimers.delete(node);
    node.classList.remove('is-fold-entering', 'is-fold-leaving');

    if (isNodeCollapsed(node)) {
      if (!animate || reduceMotion || node.hidden) {
        node.hidden = true;
        return;
      }
      node.classList.add('is-fold-leaving');
      timer = window.setTimeout(function () {
        node.hidden = Boolean(isNodeCollapsed(node));
        node.classList.remove('is-fold-leaving');
        pendingTimers.delete(node);
      }, 150);
      pendingTimers.set(node, timer);
      return;
    }

    var wasHidden = node.hidden;
    node.hidden = false;
    if (animate && !reduceMotion && wasHidden) {
      node.classList.add('is-fold-entering');
      window.requestAnimationFrame(function () {
        node.classList.remove('is-fold-entering');
      });
    }
  }

  function setCollapsed(heading, button, nodes, collapsed, options) {
    heading.classList.toggle('is-section-collapsed', collapsed);
    updateLabel(button, sectionTitle(heading), collapsed);
    // Compact headings start expanded on each newly rendered page. Existing
    // H2 preferences and the compact-list defaults stay specific to H2.
    if (options && options.persist && heading.tagName === 'H2') saveCollapsed(button.dataset.foldKey, collapsed);
    nodes.forEach(function (node) { updateNode(node, options && options.animate); });
  }

  function mountHeading(heading, index) {
    if (heading.querySelector('.section-fold-toggle')) return;
    var nodes = sectionNodes(heading);
    if (!nodes.length) return;
    nodes.forEach(function (node) {
      node.classList.add('section-fold-item');
      var owners = nodeOwners.get(node);
      if (!owners) { owners = new Set(); nodeOwners.set(node, owners); }
      owners.add(heading);
    });

    var key = stateKey(heading, index);
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'section-fold-toggle' + (heading.tagName === 'H2' ? '' : ' section-fold-toggle-compact');
    button.dataset.foldKey = key;
    button.innerHTML = '<span aria-hidden="true"></span>';
    heading.classList.add('has-section-fold');
    heading.insertBefore(button, heading.firstChild);

    setCollapsed(heading, button, nodes, heading.tagName === 'H2' && savedCollapsed(key), { animate: false, persist: false });
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      var collapsed = button.getAttribute('aria-expanded') === 'true';
      setCollapsed(heading, button, nodes, collapsed, { animate: true, persist: true });
    });
  }

  function revealTarget(article, target, options) {
    if (!target || !article.contains(target)) return;
    while (target.parentElement && target.parentElement !== article) target = target.parentElement;
    var current = target;
    var level = 7;
    while (current && current !== article) {
      var currentLevel = headingLevel(current);
      if (currentLevel && currentLevel < level) {
        level = currentLevel;
        var button = current.querySelector('.section-fold-toggle');
        if (button && button.getAttribute('aria-expanded') === 'false') {
          setCollapsed(current, button, sectionNodes(current), false, options);
        }
        if (level === 1) return;
      }
      current = current.previousElementSibling;
    }
  }

  function revealCurrentAnchor(article) {
    var query = (window.location.hash || '').split('?')[1] || '';
    var anchor = new URLSearchParams(query).get('id');
    if (!anchor) return;
    try { anchor = decodeURIComponent(anchor); } catch (error) { /* Keep the original anchor. */ }
    revealTarget(article, document.getElementById(anchor), { animate: true, persist: true });
  }

  function mountHeadings(article) {
    var headings = Array.from(article.children).filter(function (element) {
      return /^(?:H3|H4)$/.test(element.tagName) || (element.tagName === 'H2' && currentRoute() !== '#/');
    });
    headings.forEach(mountHeading);
    return headings.length;
  }

  function reveal(target) {
    var article = document.querySelector('.markdown-section');
    if (!article || !target || !article.contains(target)) return;
    mountHeadings(article);
    revealTarget(article, target, { animate: false, persist: false });
  }

  function mount() {
    var article = document.querySelector('.markdown-section');
    if (!article) return;
    if (!mountHeadings(article)) return;
    window.setTimeout(function () { revealCurrentAnchor(article); }, 0);
    document.dispatchEvent(new CustomEvent('doc-read:sections-ready'));
  }

  window.DocReadSectionFold = { mount: mount, reveal: reveal };

  document.addEventListener('doc-read:rendered', mount);
  window.addEventListener('hashchange', function () { window.setTimeout(mount, 60); });
  document.addEventListener('DOMContentLoaded', mount);
  // Native selection copying has no platform-specific exporter. Remove only
  // our controls from its HTML fragment and preserve the browser's text/range.
  document.addEventListener('copy', function (event) {
    if (event.defaultPrevented || !event.clipboardData || !window.getSelection) return;
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    var fragment = document.createElement('div');
    for (var index = 0; index < selection.rangeCount; index++) {
      fragment.appendChild(selection.getRangeAt(index).cloneContents());
    }
    var buttons = fragment.querySelectorAll('.section-fold-toggle');
    if (!buttons.length) return;
    buttons.forEach(function (button) { button.remove(); });
    event.clipboardData.setData('text/html', fragment.innerHTML);
    event.clipboardData.setData('text/plain', selection.toString());
    event.preventDefault();
  });
  mount();
}());
