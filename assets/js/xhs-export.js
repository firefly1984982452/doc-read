(function () {
  'use strict';

  var button = document.getElementById('xhs-export');
  var toast = document.getElementById('xhs-export-toast') || document.getElementById('wechat-copy-toast');
  var statusText = document.getElementById('xhs-export-status-text') || toast;
  var progressBar = document.getElementById('xhs-export-progress');
  var activeJob = '';
  var pollTimer = 0;
  var idleLabel = button ? (button.getAttribute('aria-label') || '生成小红书素材') : '生成小红书素材';

  function currentMarkdownPath() {
    var route = (window.location.hash || '').split('?')[0].replace(/^#\//, '');
    try { route = decodeURIComponent(route); } catch (error) { /* Keep the encoded route. */ }
    return route && /^(?:docs\/read|docs\/read-history)\//.test(route) ? route.replace(/\.md$/, '') + '.md' : '';
  }

  function helperUrl(pathname) {
    var base = window.DOC_READ_XHS_API_URL || 'http://127.0.0.1:3002';
    return new URL(pathname, String(base).replace(/\/?$/, '/')).href;
  }

  function currentSiteOrigin() {
    if (!/^https?:$/.test(window.location.protocol || '')) return '';
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname || '')) return '';
    return window.location.origin || new URL(window.location.href).origin;
  }

  function apiRequest(pathname, options, timeout) {
    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, timeout || 10_000);
    return fetch(helperUrl(pathname), Object.assign({ signal: controller.signal }, options || {})).then(function (response) {
      return response.text().then(function (payload) {
        var body;
        try { body = JSON.parse(payload); }
        catch (error) { throw new Error('小红书本地助手返回了无法识别的数据'); }
        if (!response.ok) throw new Error(body.error || '小红书本地助手暂时不可用');
        return body;
      });
    }).finally(function () { window.clearTimeout(timer); });
  }

  function normalizedProgress(value) {
    var number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
  }

  function setProgress(value) {
    var progress = normalizedProgress(value);
    if (!progressBar) return progress;
    if (progress === null) {
      progressBar.hidden = true;
      progressBar.removeAttribute('aria-valuenow');
      progressBar.removeAttribute('aria-valuetext');
      return null;
    }
    var rounded = Math.round(progress);
    progressBar.hidden = false;
    progressBar.value = progress;
    progressBar.setAttribute('aria-valuenow', String(rounded));
    progressBar.setAttribute('aria-valuetext', rounded + '%');
    return progress;
  }

  function showStatus(message, state, persistent, progress) {
    if (!toast) return;
    setProgress(progress);
    statusText.textContent = message;
    toast.dataset.state = state || '';
    toast.hidden = false;
    window.clearTimeout(toast.docReadTimer);
    if (!persistent) {
      toast.docReadTimer = window.setTimeout(function () {
        toast.hidden = true;
        if (progressBar) progressBar.hidden = true;
      }, 6200);
    }
  }

  function setButtonState(state, label) {
    if (!button) return;
    var busy = state === 'loading';
    button.disabled = busy;
    if (state) button.dataset.copyState = state;
    else delete button.dataset.copyState;
    if (busy) button.setAttribute('aria-busy', 'true');
    else button.removeAttribute('aria-busy');
    button.setAttribute('aria-label', label || idleLabel);
    button.dataset.tooltip = label || idleLabel;
    document.documentElement.classList.toggle('xhs-export-busy', busy);
  }

  function articleTitle() {
    var heading = document.querySelector('.markdown-section h1');
    return heading ? heading.textContent.trim() : '阅读笔记';
  }

  function resetSoon(state) {
    window.setTimeout(function () { setButtonState('', idleLabel); }, state === 'success' ? 1800 : 0);
  }

  function finish(job) {
    activeJob = '';
    window.clearTimeout(pollTimer);
    var folder = job.outputDirectory ? ' 保存位置：' + job.outputDirectory : '';
    if (job.status === 'completed') {
      var coverCount = Math.max(0, Number(job.coverCount) || 0);
      setButtonState('success', '小红书素材已生成');
      showStatus('已保存 ' + job.screenshotCount + ' 张正文截图、' + coverCount + ' 张手绘封面和小红书文案。' + folder, 'success', false, 100);
      resetSoon('success');
      return;
    }
    if (job.status === 'completed_with_warnings') {
      setButtonState('error', '小红书素材部分完成');
      showStatus('正文截图和文案已保存，但手绘封面未生成。' + folder, 'error', false, 100);
      resetSoon('error');
      return;
    }
    setButtonState('error', '小红书素材生成失败');
    showStatus((job.error || '生成没有完成。') + folder, 'error');
    resetSoon('error');
  }

  function pollJob() {
    if (!activeJob) return;
    apiRequest('/__doc_read/xhs/jobs/' + encodeURIComponent(activeJob), {}, 12_000).then(function (job) {
      if (job.status === 'completed' || job.status === 'completed_with_warnings' || job.status === 'failed') {
        finish(job);
        return;
      }
      var progressValue = normalizedProgress(job.progress);
      var progress = progressValue === null ? '' : ' ' + Math.round(progressValue) + '%';
      setButtonState('loading', job.stage || '正在生成小红书素材…');
      showStatus((job.stage || '正在生成小红书素材…') + progress, 'loading', true, progressValue);
      pollTimer = window.setTimeout(pollJob, 1500);
    }).catch(function (error) {
      activeJob = '';
      setButtonState('error', '无法读取生成进度');
      showStatus('无法读取生成进度：' + (error.message || '请确认本地助手仍在运行。'), 'error');
      resetSoon('error');
    });
  }

  function startExport() {
    if (window.location.protocol === 'file:') {
      showStatus('小红书素材需要读取当前文章并保存本地文件，请通过 docsify serve 提供的 http://localhost 地址打开网站。', 'error');
      return;
    }
    var path = currentMarkdownPath();
    if (!path) {
      showStatus('当前页面不是阅读笔记，无法生成小红书素材。', 'error');
      return;
    }
    setButtonState('loading', '正在准备小红书素材…');
    showStatus('正在连接本地助手，请稍候…', 'loading', true, 0);
    apiRequest('/__doc_read/xhs/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: path, title: articleTitle(), siteOrigin: currentSiteOrigin() })
    }, 15_000).then(function (job) {
      activeJob = job.id;
      showStatus('任务已经开始，正在生成移动端截图…', 'loading', true, normalizedProgress(job.progress) ?? 0);
      pollJob();
    }).catch(function (error) {
      setButtonState('error', '小红书本地助手未连接');
      var detail = error && error.name === 'AbortError' ? '连接超时' : (error.message || '连接失败');
      showStatus('没有连接到小红书本地助手（' + detail + '）。请在项目目录执行一次 npm run xhs:install，之后继续使用 docsify serve 即可。', 'error');
      resetSoon('error');
    });
  }

  if (button) button.addEventListener('click', startExport);

  window.DocReadXhsExport = {
    currentMarkdownPath: currentMarkdownPath,
    currentSiteOrigin: currentSiteOrigin,
    helperUrl: helperUrl,
    startExport: startExport
  };
}());
