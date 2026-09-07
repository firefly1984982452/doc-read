(function (global) {
  'use strict';

  function isTarget() {
    var route = (global.location.hash || '').split('?')[0];
    try { route = decodeURIComponent(route); } catch (error) { return false; }
    return /^#\/docs\/other\/若华阅读笔记(?:\.md)?$/.test(route);
  }

  function textOf(node) {
    if (node.nodeType === 3) return node.textContent;
    if (/^(BUTTON|SCRIPT|STYLE|HR)$/.test(node.tagName)) return '';
    if (node.tagName === 'BR') return '\n';
    var text = Array.from(node.childNodes || []).map(textOf).join('');
    return text + (/^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|TR)$/.test(node.tagName) ? '\n' : '');
  }

  function sectionText(heading) {
    var parts = [textOf(heading).trim()];
    var node = heading.nextElementSibling;
    while (node && !/^(H1|H2)$/.test(node.tagName)) {
      if (node.classList.contains('docsify-pagination-container') || node.classList.contains('pagination-item')) break;
      var text = textOf(node).trim();
      if (node.classList.contains('ruohua-body-paragraph')) {
        text = text.split('\n').map(function (line) {
          return line.trim() ? '\u3000\u3000' + line.replace(/^[ \t\u3000]+/, '') : '';
        }).join('\n');
      }
      if (text) parts.push(text);
      node = node.nextElementSibling;
    }
    return parts.join('\n\n');
  }

  function mount() {
    if (!isTarget()) return;
    var article = global.document.querySelector('.markdown-section');
    if (!article) return;
    Array.from(article.children).filter(function (node) { return node.tagName === 'H2'; }).forEach(function (heading) {
      if (heading.querySelector('.ruohua-copy-button')) return;
      var button = global.document.createElement('button');
      button.type = 'button';
      button.className = 'title-copy-button ruohua-copy-button';
      button.textContent = '复制';
      button.title = '复制本篇标题和全部内容';
      button.setAttribute('aria-label', '复制“' + textOf(heading).trim() + '”的标题和内容');
      button.setAttribute('aria-live', 'polite');
      heading.classList.add('has-ruohua-copy');
      heading.appendChild(button);
      button.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled) return;
        button.disabled = true;
        global.DocReadTitleCopy.copyText(sectionText(heading)).then(function () {
          button.textContent = '已复制';
        }).catch(function () {
          button.textContent = '复制失败';
        }).finally(function () {
          global.setTimeout(function () {
            button.disabled = false;
            button.textContent = '复制';
          }, 1500);
        });
      });
    });
  }

  global.DocReadRuohuaCopy = { mount: mount, sectionText: sectionText, isTarget: isTarget };
  global.document.addEventListener('doc-read:rendered', mount);
  mount();
}(window));
