(function () {
  'use strict';

  var tools = document.getElementById('reading-tools');
  var button = document.getElementById('typo-check');
  var dialog = document.getElementById('typo-dialog');
  var summary = document.getElementById('typo-dialog-summary');
  var results = document.getElementById('typo-results');
  var editNote = document.getElementById('typo-edit-note');
  var dismiss = document.getElementById('typo-dismiss');
  var apply = document.getElementById('typo-apply');
  var toast = document.getElementById('wechat-copy-toast');
  var state = { analysis: null, rules: [], source: '' };
  var idleButtonLabel = button.getAttribute('aria-label') || '检测错别字';

  function setButtonState(isBusy, label) {
    button.disabled = isBusy;
    button.classList.toggle('is-busy', isBusy);
    if (isBusy) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
    button.setAttribute('aria-label', label);
    button.dataset.tooltip = label;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function currentMarkdownPath() {
    var route = (window.location.hash || '').split('?')[0].replace(/^#\//, '');
    try { route = decodeURIComponent(route); } catch (error) { /* Keep the original route. */ }
    return route && /^(?:docs\/read|docs\/read-history)\//.test(route) ? route.replace(/\.md$/, '') + '.md' : '';
  }

  function searchableText(markdown) {
    return String(markdown || '')
      .replace(/```[\s\S]*?```/g, function (match) { return match.replace(/[^\n]/g, ' '); })
      .replace(/`[^`\n]+`/g, function (match) { return ' '.repeat(match.length); })
      .replace(/(!?\[[^\]\n]*\])(\([^\n)]*\))/g, function (match, label, target) {
        return label + target.replace(/[^\n]/g, ' ');
      })
      .replace(/https?:\/\/[^\s)]+/g, function (match) { return ' '.repeat(match.length); });
  }

  function matchesForRule(searchable, rule) {
    if (!rule.pattern) {
      var literalMatches = [];
      var from = 0;
      while (from < searchable.length) {
        var literalIndex = searchable.indexOf(rule.wrong, from);
        if (literalIndex < 0) break;
        literalMatches.push({ index: literalIndex, wrong: rule.wrong, correct: rule.correct });
        from = literalIndex + rule.wrong.length;
      }
      return literalMatches;
    }

    var flags = rule.flags && rule.flags.indexOf('g') >= 0 ? rule.flags : (rule.flags || '') + 'g';
    var expression = new RegExp(rule.pattern, flags);
    var patternMatches = [];
    var match;
    while ((match = expression.exec(searchable))) {
      patternMatches.push({
        index: match.index,
        wrong: match[0],
        correct: rule.replacement.replace(/\$&|\$(\d+)/g, function (token, group) {
          return token === '$&' ? match[0] : (match[Number(group)] || '');
        })
      });
      if (!match[0].length) expression.lastIndex += 1;
    }
    return patternMatches;
  }

  function detect(markdown, rules) {
    var source = String(markdown || '');
    var searchable = searchableText(source);
    var issues = [];
    rules.forEach(function (rule) {
      matchesForRule(searchable, rule).forEach(function (match) {
        var index = match.index;
        var before = source.slice(0, index);
        var line = before.split('\n').length;
        var lineStart = before.lastIndexOf('\n') + 1;
        var lineEnd = source.indexOf('\n', index);
        var fullLine = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd).trim();
        issues.push({
          id: rule.id + '-' + index,
          ruleId: rule.id,
          index: index,
          kind: rule.kind || 'literal',
          label: rule.label || '常见错别字',
          wrong: match.wrong,
          correct: match.correct,
          line: line,
          column: index - lineStart + 1,
          context: fullLine.length > 96 ? fullLine.slice(0, 93) + '…' : fullLine
        });
      });
    });
    return issues.sort(function (a, b) { return a.line - b.line || a.column - b.column; });
  }

  function applyRules(source, ruleIds) {
    var selected = new Set(ruleIds);
    return detect(source, state.rules)
      .filter(function (issue) { return selected.has(issue.ruleId); })
      .sort(function (a, b) { return b.index - a.index; })
      .reduce(function (content, issue) {
        return content.slice(0, issue.index) + issue.correct + content.slice(issue.index + issue.wrong.length);
      }, source);
  }

  function localApiUrl(pathname) {
    var isLocalHttp = /^https?:$/.test(window.location.protocol) && /^(?:localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    if (isLocalHttp) return new URL(pathname, window.location.origin).href;
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:3000' + pathname;
    return '';
  }

  function apiRequest(pathname, options) {
    var url = localApiUrl(pathname);
    if (!url) return Promise.reject(new Error('当前是线上只读页面'));
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, 1500);
    return fetch(url, Object.assign({ signal: controller.signal }, options || {})).then(function (response) {
      return response.text().then(function (payload) {
        var body;
        try { body = JSON.parse(payload); }
        catch (error) { throw new Error('当前静态服务不提供文件写入接口'); }
        if (!response.ok) throw new Error(body.error || '本地写入服务不可用');
        if (!body || typeof body !== 'object') throw new Error('本地服务返回了无效数据');
        return body;
      });
    }).finally(function () { window.clearTimeout(timer); });
  }

  function analyzeWithServer(path) {
    return apiRequest('/__doc_read/typos?path=' + encodeURIComponent(path)).then(function (analysis) {
      if (!Array.isArray(analysis.issues)) throw new Error('当前静态服务不提供错别字接口');
      return analysis;
    });
  }

  function highlightedContext(issue) {
    var escaped = escapeHtml(issue.context);
    var wrong = escapeHtml(issue.wrong);
    return escaped.replace(wrong, '<mark>' + wrong + '</mark>');
  }

  function renderAnalysis(analysis) {
    state.analysis = analysis;
    var count = analysis.issues.length;
    summary.textContent = count
      ? '发现 ' + count + ' 处明确的常见错别字，请确认后再修改。'
      : '没有发现规则库能够确认的常见错别字。';
    results.innerHTML = count ? '<ol>' + analysis.issues.map(function (issue) {
      var positionLabel = analysis.sourceKind === 'rendered'
        ? '页面正文第 ' + issue.line + ' 行'
        : 'Markdown 第 ' + issue.line + ' 行，第 ' + issue.column + ' 列';
      return '<li><div class="typo-change"><del>' + escapeHtml(issue.wrong) + '</del><span aria-hidden="true">→</span><ins>' + escapeHtml(issue.correct) + '</ins></div>' +
        '<p>' + highlightedContext(issue) + '</p><small>' + escapeHtml(issue.label || '常见错别字') + ' · ' + positionLabel + '</small></li>';
    }).join('') + '</ol>' : '<div class="typo-clean"><span aria-hidden="true">✓</span><strong>本次检查未发现明确错字</strong><p>检测采用保守规则，不会把古文、专名或表达习惯自动判为错误。</p></div>';
    apply.disabled = !count;
    if (analysis.editable) {
      editNote.textContent = '已连接本地写入服务。修改前会自动保存原文件备份。';
    } else if (window.showOpenFilePicker) {
      editNote.textContent = '当前页面为只读模式；点击修改后，请选择对应的 Markdown 原文件授权写入。';
    } else {
      editNote.textContent = '检测可以正常使用；当前浏览器不能直接写入磁盘，请根据上方建议手动修改 Markdown 原文。';
    }
  }

  function localAnalysis(path, source, rules) {
    return { path: path, issues: detect(source.text, rules), digest: '', editable: false, sourceKind: source.kind };
  }

  function capturedMarkdown(path) {
    var captured = window.DOC_READ_PAGE_SOURCE;
    if (!captured || captured.path !== path || typeof captured.markdown !== 'string') return null;
    return { text: captured.markdown, kind: 'markdown' };
  }

  function renderedArticleText() {
    var article = document.querySelector('.markdown-section');
    if (!article) throw new Error('当前文章还没有渲染完成');
    var clone = article.cloneNode(true);
    clone.querySelectorAll('.docsify-pagination-container, .word-count, script, style').forEach(function (element) {
      element.remove();
    });
    return { text: clone.innerText || clone.textContent || '', kind: 'rendered' };
  }

  function articleSource(path) {
    var captured = capturedMarkdown(path);
    if (captured) return Promise.resolve(captured);
    return window.DocReadResources.text(path)
      .then(function (text) { return { text: text, kind: 'markdown' }; })
      .catch(function () { return renderedArticleText(); });
  }

  function typoRuleData() {
    if (Array.isArray(window.DOC_READ_TYPO_RULES) && window.DOC_READ_TYPO_RULES.length) {
      return Promise.resolve(window.DOC_READ_TYPO_RULES);
    }
    return window.DocReadResources.json('assets/data/typo-rules.json');
  }

  function inspectArticle() {
    var path = currentMarkdownPath();
    if (!path) return Promise.reject(new Error('当前页面不是阅读笔记'));
    return Promise.all([
      articleSource(path),
      typoRuleData()
    ]).then(function (values) {
      state.source = values[0].text;
      state.rules = values[1];
      return localAnalysis(path, values[0], state.rules);
    });
  }

  function showStatus(message, status) {
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.state = status || '';
    toast.hidden = false;
    window.clearTimeout(toast.docReadTimer);
    toast.docReadTimer = window.setTimeout(function () { toast.hidden = true; }, 3600);
  }

  function enableServerEditing(analysis) {
    analyzeWithServer(analysis.path).then(function (serverAnalysis) {
      if (!dialog.open || !state.analysis || state.analysis.path !== analysis.path) return;
      if (serverAnalysis.issues.length !== state.analysis.issues.length) return;
      state.analysis.digest = serverAnalysis.digest || '';
      state.analysis.editable = Boolean(serverAnalysis.editable);
      if (state.analysis.editable) {
        editNote.textContent = '已连接本地写入服务。修改前会自动保存原文件备份。';
      }
    }).catch(function () { /* docsify serve and online pages use local detection. */ });
  }

  function inspectAndMaybeOpenDialog() {
    state.analysis = null;
    state.source = '';
    summary.textContent = '正在检查当前文章…';
    results.innerHTML = '<div class="typo-scanning" aria-label="正在扫描"><i></i><i></i><i></i></div>';
    editNote.textContent = '';
    apply.disabled = true;
    editNote.dataset.state = '';
    inspectArticle().then(function (analysis) {
      if (!analysis.issues.length) {
        button.classList.add('is-success');
        showStatus('校对完成：暂未发现规则库能够确认的问题。', 'success');
        window.setTimeout(function () { button.classList.remove('is-success'); }, 1500);
        return;
      }
      renderAnalysis(analysis);
      if (!dialog.open) dialog.showModal();
      enableServerEditing(analysis);
    }).catch(function (error) {
      var detail = error && error.message ? '：' + error.message : '';
      showStatus('检测没有完成' + detail, 'error');
    }).finally(function () {
      setButtonState(false, idleButtonLabel);
    });
  }

  function updateAfterWrite(count, backup) {
    summary.textContent = '已修改 ' + count + ' 处错别字。';
    results.innerHTML = '<div class="typo-clean"><span aria-hidden="true">✓</span><strong>原文件已经更新</strong><p>刷新文章页面即可看到修改后的内容。</p></div>';
    editNote.textContent = backup ? '原文件备份：' + backup : '修改已写入你授权选择的 Markdown 文件。';
    apply.disabled = true;
  }

  function applyWithServer(analysis, ruleIds) {
    return apiRequest('/__doc_read/apply-typos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: analysis.path, digest: analysis.digest, ruleIds: ruleIds })
    });
  }

  function applyWithFilePicker(ruleIds) {
    if (!window.showOpenFilePicker) return Promise.reject(new Error('请先运行 npm run dev，再从本地网址打开网站'));
    var expectedName = state.analysis.path.split('/').pop();
    return window.showOpenFilePicker({
      multiple: false,
      types: [{ description: 'Markdown 阅读笔记', accept: { 'text/markdown': ['.md'] } }]
    }).then(function (handles) {
      var handle = handles[0];
      if (!handle || handle.name !== expectedName) throw new Error('请选择当前文章对应的文件：' + expectedName);
      return handle.getFile().then(function (file) {
        return file.text().then(function (source) {
          var corrected = applyRules(source, ruleIds);
          if (corrected === source) throw new Error('所选文件中没有待修改的错别字');
          return handle.createWritable().then(function (writer) {
            return writer.write(corrected).then(function () { return writer.close(); });
          });
        });
      });
    }).then(function () { return { changed: state.analysis.issues.length, backup: '' }; });
  }

  button.addEventListener('click', function () {
    setButtonState(true, '正在检测错别字…');
    inspectAndMaybeOpenDialog();
  });

  dismiss.addEventListener('click', function () { dialog.close(); });
  apply.addEventListener('click', function () {
    if (!state.analysis || !state.analysis.issues.length) return;
    var ruleIds = Array.from(new Set(state.analysis.issues.map(function (issue) { return issue.ruleId; })));
    var originalText = apply.textContent;
    apply.disabled = true;
    apply.textContent = '正在写入…';
    var operation = state.analysis.editable
      ? applyWithServer(state.analysis, ruleIds)
      : applyWithFilePicker(ruleIds);
    operation.then(function (result) {
      updateAfterWrite(result.changed, result.backup);
    }).catch(function (error) {
      editNote.textContent = error.message || '没有获得文件写入权限。';
      editNote.dataset.state = 'error';
      apply.disabled = false;
    }).finally(function () { apply.textContent = originalText; });
  });

  dialog.addEventListener('close', function () {
    editNote.dataset.state = '';
    button.focus();
  });

  function updateVisibility() {
    var isReadingNote = Boolean(currentMarkdownPath());
    tools.hidden = !isReadingNote;
    if (!isReadingNote && dialog.open) dialog.close();
  }

  document.addEventListener('doc-read:rendered', updateVisibility);
  window.addEventListener('hashchange', function () { window.setTimeout(updateVisibility, 60); });
  document.addEventListener('DOMContentLoaded', updateVisibility);
  updateVisibility();
}());
