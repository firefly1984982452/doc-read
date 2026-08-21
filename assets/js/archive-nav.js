(function () {
  'use strict';

  var yearsPromise = null;

  function loadYears() {
    if (yearsPromise) return yearsPromise;
    yearsPromise = window.DocReadResources.json('assets/data/reading-years.json')
      .catch(function (error) {
        yearsPromise = null;
        throw error;
      });
    return yearsPromise;
  }

  function links(years, descending) {
    var values = years.slice();
    if (descending) values.reverse();
    return values.map(function (year) {
      return '<a href="#/docs/years/' + year + '">' + year + '</a>';
    }).join('<span aria-hidden="true"> · </span>');
  }

  function archiveMenu(years, currentYear) {
    return years.slice().reverse().map(function (year) {
      var active = String(year) === String(currentYear);
      return '<li><a href="#/docs/years/' + year + '"' + (active ? ' class="active" aria-current="page"' : '') + '>' + year + '</a></li>';
    }).join('');
  }

  function setExpanded(item, expanded) {
    if (!item) return;
    item.classList.toggle('is-open', expanded);
    if (!expanded) {
      delete item.dataset.archiveTouchOpen;
    }
    var trigger = item.querySelector(':scope > a');
    if (trigger) trigger.setAttribute('aria-expanded', String(expanded));
  }

  function enhanceArchiveMenu(link, years, latest) {
    var item = link.closest('li');
    if (!item) return;
    var menu = item.querySelector(':scope > ul');
    if (!menu) {
      menu = document.createElement('ul');
      item.appendChild(menu);
    }
    var routeMatch = window.location.hash.match(/^#\/docs\/years\/(\d{4})/);
    var currentYear = routeMatch && routeMatch[1];
    var menuSignature = years.join(',') + '|' + (currentYear || '');
    var menuIndex = Array.prototype.indexOf.call(document.querySelectorAll('.app-nav a'), link) + 1;
    item.classList.add('archive-nav-item');
    link.classList.toggle('active', Boolean(currentYear));
    link.setAttribute('href', '#/docs/years/' + latest);
    link.setAttribute('aria-haspopup', 'true');
    link.setAttribute('aria-expanded', String(item.classList.contains('is-open')));
    menu.className = 'archive-year-menu';
    menu.id = menu.id || 'archive-years-menu-' + menuIndex;
    menu.setAttribute('aria-label', '选择年度归档');
    link.setAttribute('aria-controls', menu.id);
    if (menu.dataset.archiveMenuSignature !== menuSignature) {
      menu.innerHTML = archiveMenu(years, currentYear);
      menu.dataset.archiveMenuSignature = menuSignature;
    }
    if (item.dataset.archiveMenuBound === 'true') return;
    item.dataset.archiveMenuBound = 'true';
    item.addEventListener('pointerenter', function () {
      if (window.matchMedia('(hover: hover)').matches) setExpanded(item, true);
    });
    item.addEventListener('pointerleave', function () {
      if (!item.contains(document.activeElement)) setExpanded(item, false);
    });
    item.addEventListener('focusin', function () { setExpanded(item, true); });
    item.addEventListener('focusout', function (event) {
      if (!item.contains(event.relatedTarget)) setExpanded(item, false);
    });
    item.addEventListener('click', function (event) {
      if (event.target.closest('.archive-year-menu a')) setExpanded(item, false);
    });
    link.addEventListener('click', function (event) {
      if (!window.matchMedia('(hover: none), (max-width: 768px)').matches) return;
      event.preventDefault();
      var expanded = item.dataset.archiveTouchOpen !== 'true';
      item.dataset.archiveTouchOpen = expanded ? 'true' : 'false';
      setExpanded(item, expanded);
    });
  }

  function mount() {
    loadYears().then(function (years) {
      if (!years.length) return;
      var first = years[0];
      var latest = years[years.length - 1];
      document.querySelectorAll('[data-archive-start]').forEach(function (element) { element.textContent = first; });
      document.querySelectorAll('[data-archive-range]').forEach(function (element) { element.textContent = first + '—' + latest; });

      ['home-year-list', 'library-year-list'].forEach(function (id) {
        var root = document.getElementById(id);
        if (root) root.innerHTML = links(years, true);
      });

      document.querySelectorAll('.app-nav a').forEach(function (link) {
        if (link.textContent.trim() === '年度归档') enhanceArchiveMenu(link, years, latest);
      });

      document.querySelectorAll('.sidebar-nav strong').forEach(function (heading) {
        if (heading.textContent.trim() !== '年度归档') return;
        var paragraph = heading.closest('p');
        var list = paragraph && paragraph.nextElementSibling;
        if (!list || list.tagName !== 'UL') {
          var section = heading.closest('li');
          list = section && section.querySelector(':scope > ul');
        }
        if (!list) return;
        list.innerHTML = years.slice().reverse().map(function (year) {
          return '<li><a href="#/docs/years/' + year + '">' + year + '</a></li>';
        }).join('');
      });
    }).catch(function () {
      document.querySelectorAll('.dynamic-year-list').forEach(function (element) {
        element.textContent = '年度归档暂时无法读取，请稍后重试。';
      });
    });
  }

  document.addEventListener('doc-read:rendered', mount);
  document.addEventListener('DOMContentLoaded', mount);
  document.addEventListener('click', function (event) {
    document.querySelectorAll('.archive-nav-item.is-open').forEach(function (item) {
      if (!item.contains(event.target)) setExpanded(item, false);
    });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    document.querySelectorAll('.archive-nav-item.is-open').forEach(function (item) {
      var trigger = item.querySelector(':scope > a');
      if (trigger && item.contains(document.activeElement)) trigger.focus();
      setExpanded(item, false);
    });
  });
  setTimeout(mount, 300);
}());
