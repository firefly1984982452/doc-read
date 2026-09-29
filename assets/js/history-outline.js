(function (global) {
  'use strict';

  var notePath = 'docs/read-history/《中国通史》纪录片学习笔记.md';
  var circledNumber = /^[①-⑳㉑-㉟㊱-㊿]/;
  var letterNumber = /^[a-zA-Z][).）．]/;

  function mount() {
    var source = global.DOC_READ_PAGE_SOURCE;
    if (!source || source.path !== notePath) return;
    var article = global.document.querySelector('.markdown-section');
    if (!article) return;

    article.querySelectorAll(':scope > p').forEach(function (paragraph) {
      var text = paragraph.textContent.trim();
      paragraph.classList.toggle('history-section-label', /^(?:本集笔记|著名事件、名人名事、典故|备注)[：:]$/.test(text));
      paragraph.classList.toggle('history-study-time', /^学习时间\s*[：:]\s*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日\s*$/.test(text));
      var link = paragraph.querySelector('a');
      var isWatch = link && /^观看本集\s*[（(]哔哩哔哩[）)]$/.test(text) &&
        /^https:\/\/(?:www\.)?bilibili\.com\/bangumi\/play\/ep\d+(?:[?#]|$)/.test(link.getAttribute('href') || '');
      paragraph.classList.toggle('history-episode-watch', Boolean(isWatch));
      // Keep both paragraphs in place so section folding and search retain their targets.
      if (/^著名事件、名人名事、典故[：:]$/.test(text)) {
        var details = paragraph.nextElementSibling;
        if (details && details.tagName === 'P' && !details.querySelector('img')) {
          paragraph.classList.add('history-anecdote-title');
          details.classList.add('history-anecdote-body');
        }
      }
    });

    article.querySelectorAll(':scope > p.reading-body-paragraph').forEach(function (paragraph) {
      var lines = Array.from(paragraph.children).filter(function (node) { return node.tagName === 'SPAN'; });
      var hasNumberedLines = lines.some(function (line) { return circledNumber.test(line.textContent.trim()); });
      // Plain labels and notes also use one source span per line, separated by <br>.
      // Align these peer lines as well; leave ordinary inline spans in prose alone.
      var hasSourceLines = lines.length > 1 && Array.from(paragraph.children).some(function (node) { return node.tagName === 'BR'; }) &&
        Array.from(paragraph.childNodes).every(function (node) {
          return node.nodeType === 3 ? !node.textContent.trim() : node.nodeType === 8 || /^(?:SPAN|BR)$/.test(node.nodeName);
        });
      if (!hasNumberedLines && !hasSourceLines) return;
      var hasTopic = false;
      var numberLevel = 1;

      lines.forEach(function (line) {
        var text = line.textContent.trim();
        if (!text) return;
        var isNumber = hasNumberedLines && circledNumber.test(text);
        var isLetter = hasNumberedLines && letterNumber.test(text);
        var level = 1;
        if (isNumber) {
          numberLevel = hasTopic ? 2 : 1;
          level = numberLevel;
        } else if (isLetter) {
          level = numberLevel + 1;
        } else {
          hasTopic = true;
        }
        line.classList.add('history-outline-line');
        line.classList.toggle('history-outline-item', isNumber || isLetter);
        line.dataset.outlineLevel = String(level);
      });
    });
  }

  global.DocReadHistoryOutline = { mount: mount };
}(window));
