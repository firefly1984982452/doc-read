(function (global) {
  'use strict';

  function formatWan(value) {
    var rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, '').replace(/\.$/, '');
  }

  function monthFromHeading(text, year) {
    var match = String(text || '').trim().match(/^(\d{4})\s*[-年]\s*(\d{1,2})(?:\s*月)?(?:\s*[【[]\s*(\d+(?:\.\d+)?)\s*万字?\s*[】\]])?/);
    if (!match || match[1] !== String(year)) return null;
    var month = Number(match[2]);
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    return { month: month, explicitWan: match[3] === undefined ? null : Number(match[3]) };
  }

  function sumBookWords(nodes) {
    return Array.from(nodes || []).reduce(function (sum, node) {
      var matches = String(node.textContent || '').matchAll(/【\s*(\d+(?:\.\d+)?)\s*万(?:字)?(?:[^】]*)】/g);
      for (var match of matches) sum += Number(match[1]);
      return sum;
    }, 0);
  }

  function sectionsFromArticle(article, year) {
    var headings = Array.from(article.querySelectorAll('h2'));
    return headings.map(function (heading) {
      var month = monthFromHeading(heading.textContent, year);
      if (!month) return null;
      var nodes = [];
      var cursor = heading.nextElementSibling;
      while (cursor && cursor.tagName !== 'H2') {
        if (cursor.tagName === 'UL' || cursor.tagName === 'OL') nodes.push(cursor);
        cursor = cursor.nextElementSibling;
      }
      return { explicitWan: month.explicitWan, nodes: nodes };
    }).filter(Boolean);
  }

  function equationFromSections(sections) {
    var parts = sections.map(function (section) {
      return typeof section.explicitWan === 'number' ? section.explicitWan : sumBookWords(section.nodes);
    }).filter(function (value) { return Number.isFinite(value) && value > 0; });
    if (!parts.length) return '';
    var total = parts.reduce(function (sum, value) { return sum + value; }, 0);
    return parts.map(formatWan).join('+') + '=' + formatWan(total) + '万字';
  }

  function mount() {
    var routeMatch = global.location.hash.match(/^#\/docs\/years\/(\d{4})(?:\.md)?(?:[?#]|$)/);
    if (!routeMatch) return;
    var article = global.document.querySelector('.markdown-section');
    if (!article) return;
    var heading = Array.from(article.querySelectorAll('h2')).find(function (element) {
      return /^(?:总)?字数$/.test(element.textContent.trim());
    });
    if (!heading) return;

    var equation = equationFromSections(sectionsFromArticle(article, routeMatch[1]));
    if (!equation) return;
    var total = article.querySelector('[data-year-word-total]');
    if (!total) {
      total = heading.nextElementSibling;
      if (!total || total.tagName !== 'P') {
        total = global.document.createElement('p');
        heading.insertAdjacentElement('afterend', total);
      }
    }
    total.classList.add('year-word-total');
    total.setAttribute('data-year-word-total', '');
    total.setAttribute('aria-live', 'polite');
    total.textContent = equation;
  }

  global.DocReadYearWordTotal = {
    equationFromSections: equationFromSections,
    monthFromHeading: monthFromHeading,
    mount: mount
  };

  global.addEventListener('hashchange', function () { global.setTimeout(mount, 80); });
  global.document.addEventListener('doc-read:rendered', mount);
  global.document.addEventListener('DOMContentLoaded', function () { global.setTimeout(mount, 80); });
  global.setTimeout(mount, 160);
}(window));
