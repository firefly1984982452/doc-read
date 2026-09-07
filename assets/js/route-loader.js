(function () {
  'use strict';

  function currentRoute() {
    return (window.location.hash || '#/').split('?')[0];
  }

  function update() {
    var route = currentRoute();
    var needsReadingData = route === '#/' || /^#\/docs\/(?:latest|library)(?:[.?/#]|$)/.test(route);
    var isYearArchive = /^#\/docs\/years\/\d{4}(?:\.md)?(?:[?#]|$)/.test(route);
    var isReadingNote = /^#\/docs\/(?:read|read-history)\//.test(route);
    var decodedRoute = route;
    try { decodedRoute = decodeURIComponent(route); } catch (error) { /* Ignore malformed routes. */ }
    var isRuohua = /^#\/docs\/other\/若华阅读笔记(?:\.md)?$/.test(decodedRoute);

    window.DocReadResources.script('assets/js/section-fold.js')
      .catch(function (error) { console.error(error); });

    if (needsReadingData) {
      window.DocReadResources.json('assets/data/reading-data.json')
        .then(function (data) { window.DOC_READ_DATA = data; })
        .then(function () { return window.DocReadResources.script('assets/js/reading-dashboard.js'); })
        .then(function () { document.dispatchEvent(new CustomEvent('doc-read:widgets-ready')); })
        .catch(function (error) { console.error(error); });
    }
    if (isYearArchive) {
      window.DocReadResources.script('assets/js/year-word-total.js')
        .then(function () { window.DocReadYearWordTotal.mount(); })
        .catch(function (error) { console.error(error); });
    }
    if (isReadingNote) {
      Promise.all([
        window.DocReadResources.script('assets/js/wechat-copy.js'),
        window.DocReadResources.script('assets/js/typo-checker.js'),
        window.DocReadResources.script('assets/js/xhs-export.js'),
        window.DocReadResources.script('assets/js/random-reading.js'),
        window.DocReadResources.script('assets/js/title-copy.js')
      ]).then(function () { window.DocReadTitleCopy.mount(); })
        .catch(function (error) { console.error(error); });
    }
    if (isRuohua) {
      Promise.all([
        window.DocReadResources.script('assets/js/title-copy.js'),
        window.DocReadResources.script('assets/js/ruohua-copy.js')
      ]).then(function () { window.DocReadRuohuaCopy.mount(); })
        .catch(function (error) { console.error(error); });
    }
  }

  window.addEventListener('hashchange', update);
  document.addEventListener('doc-read:rendered', update);
  document.addEventListener('DOMContentLoaded', update);
  update();
}());
