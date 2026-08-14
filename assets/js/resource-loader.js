(function (global) {
  'use strict';

  var jsonRequests = new Map();
  var scriptRequests = new Map();

  function asset(relative, retryNumber) {
    var url = new URL(relative, global.location.href.split('#')[0]);
    if (global.DOC_READ_BUILD) url.searchParams.set('v', global.DOC_READ_BUILD);
    if (retryNumber) url.searchParams.set('retry', retryNumber);
    return url.href;
  }

  function pause(milliseconds) {
    return new Promise(function (resolve) { global.setTimeout(resolve, milliseconds); });
  }

  function retry(task, attempts) {
    var current = 0;
    function run() {
      return task(current).catch(function (error) {
        current += 1;
        if (current >= attempts) throw error;
        return pause(180 * Math.pow(2, current - 1)).then(run);
      });
    }
    return run();
  }

  function json(relative, options) {
    if (jsonRequests.has(relative)) return jsonRequests.get(relative);
    var attempts = Math.max(1, Number(options && options.attempts) || 3);
    var request = retry(function (retryNumber) {
      return global.fetch(asset(relative, retryNumber), {
        cache: retryNumber ? 'reload' : 'default'
      }).then(function (response) {
        if (!response.ok) throw new Error('无法读取 ' + relative + '（HTTP ' + response.status + '）');
        return response.json();
      });
    }, attempts).catch(function (error) {
      jsonRequests.delete(relative);
      throw error;
    });
    jsonRequests.set(relative, request);
    return request;
  }

  function script(relative, options) {
    if (scriptRequests.has(relative)) return scriptRequests.get(relative);
    var attempts = Math.max(1, Number(options && options.attempts) || 3);
    var request = retry(function (retryNumber) {
      return new Promise(function (resolve, reject) {
        var element = global.document.createElement('script');
        element.src = asset(relative, retryNumber);
        element.async = true;
        element.onload = function () { resolve(relative); };
        element.onerror = function () {
          element.remove();
          reject(new Error('无法加载 ' + relative));
        };
        global.document.head.appendChild(element);
      });
    }, attempts).catch(function (error) {
      scriptRequests.delete(relative);
      throw error;
    });
    scriptRequests.set(relative, request);
    return request;
  }

  global.DocReadResources = { asset: asset, json: json, script: script };
}(window));
