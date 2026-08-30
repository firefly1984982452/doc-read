(function () {
  'use strict';

  var button = document.getElementById('xhs-export');
  var toast = document.getElementById('xhs-export-toast') || document.getElementById('wechat-copy-toast');
  var statusText = document.getElementById('xhs-export-status-text') || toast;
  var progressBar = document.getElementById('xhs-export-progress');
  var activeJob = '';
  var pollTimer = 0;
  var jsonpSequence = 0;
  var jsonpCallbacks = window.DocReadXhsJsonp = window.DocReadXhsJsonp || {};
  var idleLabel = button ? (button.getAttribute('aria-label') || '发布到小红书') : '发布到小红书';

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
    if (window.location.protocol === 'file:') {
      var localEntry = new URL(window.location.href);
      localEntry.hash = '';
      localEntry.search = '';
      return localEntry.href;
    }
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

  function scriptRequest(pathname, values, timeout) {
    return new Promise(function (resolve, reject) {
      var callback = 'docReadXhs' + Date.now().toString(36) + String(++jsonpSequence);
      var target = new URL(helperUrl(pathname));
      var script = document.createElement('script');
      var timer = 0;
      var settled = false;

      target.searchParams.set('callback', callback);
      Object.keys(values || {}).forEach(function (key) {
        target.searchParams.set(key, String(values[key] == null ? '' : values[key]));
      });

      function cleanup() {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        delete jsonpCallbacks[callback];
        script.onerror = null;
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      jsonpCallbacks[callback] = function (body) {
        cleanup();
        if (body && body.error) {
          var error = new Error(body.error);
          error.status = body.status;
          reject(error);
          return;
        }
        resolve(body);
      };
      script.async = true;
      script.src = target.href;
      script.onerror = function () {
        cleanup();
        reject(new Error('无法连接小红书本地助手'));
      };
      timer = window.setTimeout(function () {
        cleanup();
        var error = new Error('连接超时');
        error.name = 'AbortError';
        reject(error);
      }, timeout || 10_000);
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function startJob(payload) {
    if (window.location.protocol === 'file:') {
      return scriptRequest('/__doc_read/xhs/file/jobs', payload, 15_000);
    }
    return apiRequest('/__doc_read/xhs/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 15_000);
  }

  function readJob(id) {
    var encodedId = encodeURIComponent(id);
    if (window.location.protocol === 'file:') {
      return scriptRequest('/__doc_read/xhs/file/jobs/' + encodedId, {}, 12_000);
    }
    return apiRequest('/__doc_read/xhs/jobs/' + encodedId, {}, 12_000);
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
    if (job.status === 'completed' || job.status === 'completed_with_warnings') {
      var warning = job.warning ? ' 提示：' + job.warning + '。' : '';
      setButtonState('success', '小红书截图已生成');
      showStatus('已保存 ' + job.screenshotCount + ' 张 1080×1440 截图。' + warning + folder, 'success', false, 100);
      resetSoon('success');
      return;
    }
    setButtonState('error', '小红书截图生成失败');
    showStatus((job.error || '生成没有完成。') + folder, 'error');
    resetSoon('error');
  }

  function pollJob() {
    if (!activeJob) return;
    readJob(activeJob).then(function (job) {
      if (job.status === 'completed' || job.status === 'completed_with_warnings' || job.status === 'failed') {
        finish(job);
        return;
      }
      var progressValue = normalizedProgress(job.progress);
      var progress = progressValue === null ? '' : ' ' + Math.round(progressValue) + '%';
      setButtonState('loading', job.stage || '正在生成小红书截图…');
      showStatus((job.stage || '正在生成小红书截图…') + progress, 'loading', true, progressValue);
      pollTimer = window.setTimeout(pollJob, 1500);
    }).catch(function (error) {
      activeJob = '';
      setButtonState('error', '无法读取生成进度');
      showStatus('无法读取生成进度：' + (error.message || '请确认本地助手仍在运行。'), 'error');
      resetSoon('error');
    });
  }

  function startExport() {
    var path = currentMarkdownPath();
    if (!path) {
      showStatus('当前页面不是阅读笔记，无法生成小红书截图。', 'error');
      return;
    }
    var siteOrigin = currentSiteOrigin();
    if (!siteOrigin) {
      showStatus('当前页面地址不受支持，请使用本地 index.html 或本机 Docsify 地址。', 'error');
      return;
    }
    setButtonState('loading', '正在准备小红书截图…');
    showStatus('正在连接本地助手，请稍候…', 'loading', true, 0);
    startJob({ path: path, title: articleTitle(), siteOrigin: siteOrigin }).then(function (job) {
      activeJob = job.id;
      showStatus('任务已经开始，正在生成 1080×1440 移动端截图…', 'loading', true, normalizedProgress(job.progress) ?? 0);
      pollJob();
    }).catch(function (error) {
      setButtonState('error', '小红书本地助手未连接');
      var detail = error && error.name === 'AbortError' ? '连接超时' : (error.message || '连接失败');
      showStatus('没有连接到小红书本地助手（' + detail + '）。请在项目目录执行一次 npm run xhs:install 后重试。', 'error');
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
