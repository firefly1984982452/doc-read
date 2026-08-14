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
        if (link.textContent.trim() === '年度归档') link.setAttribute('href', '#/docs/years/' + latest);
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
  setTimeout(mount, 300);
}());
