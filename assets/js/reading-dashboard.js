(function () {
  'use strict';

  var state = { year: null, preference: null, sound: false, audio: null };
  var dataPromise = null;

  function discoverReadingData() {
    if (dataPromise) return dataPromise;
    dataPromise = window.DOC_READ_DATA && Array.isArray(window.DOC_READ_DATA.years)
      ? Promise.resolve(window.DOC_READ_DATA)
      : Promise.reject(new Error('阅读数据尚未生成，请先运行 npm run generate'));
    return dataPromise;
  }

  function chineseCount(value) {
    var digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (value < 10) return digits[value];
    if (value < 20) return '十' + (value === 10 ? '' : digits[value - 10]);
    return String(value);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(value);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }

  function latestRecords(data, limit) {
    for (var index = data.years.length - 1; index >= 0; index -= 1) {
      var records = data.years[index].records || [];
      if (!records.length) continue;
      var latestMonth = Math.max.apply(null, records.map(function (record) { return record.month || 0; }));
      return records.filter(function (record) { return record.month === latestMonth; }).reverse().slice(0, limit);
    }
    return [];
  }

  function readingRoute(path) {
    return '#' + path.replace(/\.md$/, '');
  }

  function recordMarkup(record, options) {
    var route = readingRoute(record.path);
    var author = record.author ? '<span> · ' + escapeHtml(record.author) + '</span>' : '';
    var date = options.showDate ? '<small>' + record.year + ' 年 ' + record.month + ' 月</small>' : '';
    return '<li><strong><a href="' + escapeHtml(route) + '">' + escapeHtml(record.title) + '</a></strong>' +
      author + date + '<a class="reading-note-link" href="' + escapeHtml(route) + '">阅读笔记 →</a></li>';
  }

  function mountRecentReading() {
    var root = document.getElementById('recent-reading-list');
    if (!root || root.dataset.mounted === 'true' || root.dataset.loading === 'true') return;
    root.dataset.loading = 'true';
    discoverReadingData().then(function (data) {
      if (!document.body.contains(root)) return;
      var records = latestRecords(data, 4);
      if (!records.length) throw new Error('没有找到最新阅读记录');
      root.dataset.loading = 'false';
      root.dataset.mounted = 'true';
      root.innerHTML = '<ul>' + records.map(function (record) { return recordMarkup(record, { showDate: true }); }).join('') + '</ul>';
    }).catch(function () {
      if (!document.body.contains(root)) return;
      root.dataset.loading = 'false';
      root.innerHTML = '<p class="reading-list-loading">最新阅读记录读取失败，请刷新页面重试。</p>';
    });
  }

  function mountLatestReadingPage() {
    var root = document.getElementById('latest-reading-page');
    if (!root || root.dataset.loading === 'true' || root.dataset.mounted === 'true') return;
    root.dataset.loading = 'true';
    discoverReadingData().then(function (data) {
      if (!document.body.contains(root)) return;
      var latestYear = data.years.slice().reverse().find(function (item) { return item.records && item.records.length; });
      if (!latestYear) throw new Error('没有找到最近阅读');
      var groups = [];
      latestYear.records.forEach(function (record) {
        var group = groups.find(function (item) { return item.month === record.month; });
        if (!group) { group = { month: record.month, records: [] }; groups.push(group); }
        group.records.push(record);
      });
      groups.sort(function (a, b) { return b.month - a.month; });
      root.innerHTML = groups.map(function (group) {
        return '<section class="latest-month"><h2>' + latestYear.year + ' 年 ' + group.month + ' 月</h2><ul>' +
          group.records.slice().reverse().map(function (record) { return recordMarkup(record, { showDate: false }); }).join('') +
          '</ul></section>';
      }).join('');
      root.dataset.loading = 'false';
      root.dataset.mounted = 'true';
    }).catch(function () {
      if (!document.body.contains(root)) return;
      root.dataset.loading = 'false';
      root.innerHTML = '<p class="reading-list-loading">最近阅读读取失败，请刷新页面重试。</p>';
    });
  }

  function mountYearWordTotal() {
    var routeMatch = window.location.hash.match(/^#\/docs\/years\/(\d{4})(?:\.md)?(?:[?#]|$)/);
    if (!routeMatch) return;
    var article = document.querySelector('.markdown-section');
    if (!article) return;
    discoverReadingData().then(function (data) {
      if (!document.body.contains(article)) return;
      var selected = data.years.find(function (item) { return String(item.year) === routeMatch[1]; });
      if (!selected || !selected.wordEquation) return;
      var heading = Array.from(article.querySelectorAll('h2')).find(function (element) {
        return /^(?:总)?字数$/.test(element.textContent.trim());
      });
      if (!heading) return;
      var total = heading.nextElementSibling;
      if (!total || total.tagName !== 'P') {
        total = document.createElement('p');
        heading.insertAdjacentElement('afterend', total);
      }
      total.classList.add('year-word-total');
      total.textContent = selected.wordEquation;
    });
  }

  function createTone() {
    if (!state.sound) return;
    try {
      state.audio = state.audio || new (window.AudioContext || window.webkitAudioContext)();
      var now = state.audio.currentTime;
      var oscillator = state.audio.createOscillator();
      var gain = state.audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(520, now);
      oscillator.frequency.exponentialRampToValueAtTime(360, now + 0.08);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.035, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      oscillator.connect(gain).connect(state.audio.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.13);
    } catch (error) {
      state.sound = false;
    }
  }

  function dashboardMarkup(data) {
    var first = data.years[0];
    var latest = data.years[data.years.length - 1];
    var yearButtons = data.years.map(function (item) {
      var active = String(state.year) === String(item.year);
      return '<button type="button" data-reading-year="' + item.year + '" aria-pressed="' + active + '">' + item.year + '</button>';
    }).join('');
    return [
      '<div class="reading-dashboard-head">',
        '<div><p class="reading-dashboard-eyebrow">READING IN NUMBERS</p><h3>' + chineseCount(data.years.length) + '年阅读轨迹</h3></div>',
        '<button class="reading-sound" type="button" aria-pressed="false" aria-label="开启图表交互声效"><span aria-hidden="true">♪</span> 声效关闭</button>',
      '</div>',
      '<div class="reading-year-controls" role="group" aria-label="选择统计年份">',
        '<button type="button" data-reading-year="all" aria-pressed="' + (state.year === 'all') + '">全部</button>', yearButtons,
      '</div>',
      '<div class="reading-metrics">',
        '<div><div class="reading-metric-value"><span data-metric="entries">0</span><em>本</em></div><small>年度清单阅读记录</small></div>',
        '<div><div class="reading-metric-value"><span data-metric="words">—</span><em>万</em></div><small>已记录阅读字数</small></div>',
        '<div><div class="reading-metric-value"><span data-metric="daily">—</span><em>万字</em></div><small>平均每天阅读</small></div>',
        '<div><div class="reading-metric-value"><span data-metric="active">0</span><em>月</em></div><small>有阅读记录的月份</small></div>',
      '</div>',
      '<div class="reading-chart-block">',
        '<div class="reading-chart-title"><strong>年度阅读节奏</strong><span>点击柱形选择年份</span></div>',
        '<div class="reading-bars" role="img" aria-label="' + first.year + ' 至 ' + latest.year + ' 年每年阅读书目数量"></div>',
      '</div>',
      '<details class="reading-dashboard-details">',
        '<summary><span>查看详细数据</span><small>月份、字数与阅读偏好</small></summary>',
        '<div class="reading-dashboard-detail-content">',
          '<div class="reading-chart-grid">',
            '<div class="reading-chart-block">',
              '<div class="reading-chart-title"><strong>月份习惯</strong><span data-habit-caption>全部年份累计</span></div>',
              '<div class="reading-heatmap" role="img" aria-label="每月阅读记录热力图"></div>',
              '<div class="reading-months" aria-hidden="true"><span>1月</span><span>2月</span><span>3月</span><span>4月</span><span>5月</span><span>6月</span><span>7月</span><span>8月</span><span>9月</span><span>10月</span><span>11月</span><span>12月</span></div>',
            '</div>',
            '<div class="reading-chart-block reading-words-block">',
              '<div class="reading-chart-title"><strong>阅读字数趋势</strong><span>仅展示有明确记录的年份</span></div>',
              '<svg class="reading-word-chart" viewBox="0 0 460 210" role="img" aria-label="年度阅读字数趋势图"></svg>',
            '</div>',
          '</div>',
          '<div class="reading-chart-block reading-preference-block">',
            '<div class="reading-chart-title"><strong>我的阅读偏好</strong><span data-preference-caption>按阅读记录统计</span></div>',
            '<div class="reading-preferences">',
              '<svg class="reading-preference-pie" viewBox="0 0 220 220" role="img" aria-label="阅读类型偏好饼图"></svg>',
              '<div class="reading-preference-legend" role="list" aria-label="阅读类型偏好图例"></div>',
            '</div>',
            '<div class="reading-preference-detail" data-preference-detail aria-live="polite">点击分类查看包含的书目</div>',
          '</div>',
          '<p class="reading-insight" data-reading-insight></p>',
        '</div>',
      '</details>'
    ].join('');
  }

  function selectedRows(data) {
    return state.year === 'all' ? data.years : data.years.filter(function (item) { return String(item.year) === String(state.year); });
  }

  function animateMetric(element, target, suffix, decimals) {
    if (typeof target !== 'number') {
      element.textContent = '—';
      return;
    }
    var start = performance.now();
    var duration = 420;
    function frame(now) {
      var progress = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      var value = target * eased;
      element.textContent = (decimals
        ? value.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
        : formatNumber(Math.round(value))) + (suffix || '');
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function renderBars(root, data) {
    var max = Math.max.apply(null, data.years.map(function (item) { return item.entries; }));
    root.querySelector('.reading-bars').style.setProperty('--reading-year-count', data.years.length);
    root.querySelector('.reading-bars').innerHTML = data.years.map(function (item) {
      var active = String(state.year) === String(item.year);
      var height = Math.max(12, Math.round(item.entries / max * 100));
      return '<button type="button" data-reading-year="' + item.year + '" aria-pressed="' + active + '" aria-label="' + item.year + ' 年，' + item.entries + ' 本阅读记录">' +
        '<span class="reading-bar-value">' + item.entries + '</span>' +
        '<span class="reading-bar-track"><i style="height:' + height + '%"></i></span>' +
        '<small>' + item.year + '</small>' +
      '</button>';
    }).join('');
  }

  function renderHeatmap(root, months) {
    var max = Math.max.apply(null, months.concat([1]));
    root.querySelector('.reading-heatmap').innerHTML = months.map(function (value, index) {
      var strength = value ? (0.16 + value / max * 0.84).toFixed(2) : 0.05;
      return '<div style="--heat:' + strength + '" title="' + (index + 1) + ' 月：' + value + ' 次记录"><span>' + value + '</span></div>';
    }).join('');
  }

  function renderWordChart(root, data) {
    var rows = data.years.filter(function (item) { return typeof item.wordWan === 'number'; });
    var svg = root.querySelector('.reading-word-chart');
    if (!rows.length) { svg.innerHTML = ''; return; }
    var width = 460, height = 210, left = 42, right = 18, top = 24, bottom = 38;
    var max = Math.max.apply(null, rows.map(function (item) { return item.wordWan; }));
    var x = function (index) { return left + index * ((width - left - right) / Math.max(rows.length - 1, 1)); };
    var y = function (value) { return top + (max - value) / max * (height - top - bottom); };
    var points = rows.map(function (item, index) { return x(index) + ',' + y(item.wordWan); }).join(' ');
    var grid = [0, .5, 1].map(function (ratio) {
      var yy = top + ratio * (height - top - bottom);
      return '<line x1="' + left + '" x2="' + (width - right) + '" y1="' + yy + '" y2="' + yy + '" class="word-grid" />';
    }).join('');
    var marks = rows.map(function (item, index) {
      var xx = x(index), yy = y(item.wordWan), active = String(state.year) === String(item.year);
      return '<g class="word-point' + (active ? ' is-active' : '') + '">' +
        '<circle cx="' + xx + '" cy="' + yy + '" r="6" />' +
        '<text x="' + xx + '" y="' + (yy - 13) + '" text-anchor="middle">' + item.wordWan + '</text>' +
        '<text x="' + xx + '" y="' + (height - 13) + '" text-anchor="middle">' + item.year + '</text>' +
      '</g>';
    }).join('');
    svg.innerHTML = grid + '<polyline class="word-line" points="' + points + '" />' + marks;
  }

  function renderPreferences(root, rows) {
    var records = rows.reduce(function (all, item) { return all.concat(item.records || []); }, []);
    var groups = new Map();
    records.forEach(function (record) {
      var category = record.preference || '其他';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(record);
    });
    var ranked = Array.from(groups.entries()).sort(function (a, b) {
      return b[1].length - a[1].length || a[0].localeCompare(b[0], 'zh-CN');
    });
    if (state.preference && !groups.has(state.preference)) state.preference = null;
    var total = records.length || 1;
    var startAngle = -90;
    var slices = ranked.map(function (item, index) {
      var category = item[0];
      var count = item[1].length;
      var active = state.preference === category;
      var percentage = Math.max(1, Math.round(count / total * 100));
      var sweep = count / total * 360;
      var endAngle = startAngle + sweep;
      var largeArc = sweep > 180 ? 1 : 0;
      var point = function (angle, radius) {
        var radians = angle * Math.PI / 180;
        return { x: 110 + radius * Math.cos(radians), y: 110 + radius * Math.sin(radians) };
      };
      var start = point(startAngle, 94);
      var end = point(endAngle, 94);
      var middle = point(startAngle + sweep / 2, 59);
      var shape = sweep >= 359.999
        ? '<circle cx="110" cy="110" r="94" />'
        : '<path d="M 110 110 L ' + start.x.toFixed(2) + ' ' + start.y.toFixed(2) + ' A 94 94 0 ' + largeArc + ' 1 ' + end.x.toFixed(2) + ' ' + end.y.toFixed(2) + ' Z" />';
      var label = percentage >= 7
        ? '<text x="' + middle.x.toFixed(2) + '" y="' + middle.y.toFixed(2) + '" text-anchor="middle" dominant-baseline="central">' + percentage + '%</text>'
        : '';
      startAngle = endAngle;
      return '<g class="reading-pie-slice pref-color-' + (index % 6) + (active ? ' is-active' : '') + '" data-reading-preference="' + escapeHtml(category) + '" tabindex="0" role="button" aria-pressed="' + active + '" aria-label="' + escapeHtml(category) + '，' + count + ' 本，占 ' + percentage + '%">' + shape + label + '</g>';
    }).join('');
    root.querySelector('.reading-preference-pie').innerHTML = slices || '<circle class="reading-pie-empty" cx="110" cy="110" r="94" />';
    root.querySelector('.reading-preference-legend').innerHTML = ranked.map(function (item, index) {
      var category = item[0];
      var count = item[1].length;
      var percentage = Math.max(1, Math.round(count / total * 100));
      var active = state.preference === category;
      return '<button type="button" role="listitem" data-reading-preference="' + escapeHtml(category) + '" aria-pressed="' + active + '">' +
        '<i class="pref-color-' + (index % 6) + '" aria-hidden="true"></i><span><strong>' + escapeHtml(category) + '</strong><small>' + count + ' 本 · ' + percentage + '%</small></span>' +
      '</button>';
    }).join('');
    var detail = root.querySelector('[data-preference-detail]');
    if (!state.preference) {
      detail.innerHTML = ranked.length ? '偏好最明显的是 <strong>' + escapeHtml(ranked[0][0]) + '</strong>，点击任一分类可查看书目。' : '当前范围没有可统计的阅读记录。';
      return;
    }
    var selected = groups.get(state.preference) || [];
    var uniqueTitles = Array.from(new Set(selected.map(function (record) { return record.title; })));
    var visibleTitles = uniqueTitles.slice(0, 16);
    detail.innerHTML = '<strong>' + escapeHtml(state.preference) + '</strong><span>' + visibleTitles.map(function (title) {
      return '<em>' + escapeHtml(title) + '</em>';
    }).join('') + (uniqueTitles.length > visibleTitles.length ? '<em>另有 ' + (uniqueTitles.length - visibleTitles.length) + ' 本</em>' : '') + '</span>';
  }

  function update(root, data) {
    var rows = selectedRows(data);
    var entries = rows.reduce(function (sum, item) { return sum + item.entries; }, 0);
    var knownWords = rows.filter(function (item) { return typeof item.wordWan === 'number'; });
    var words = knownWords.length ? knownWords.reduce(function (sum, item) { return sum + item.wordWan; }, 0) : null;
    var today = new Date();
    var days = knownWords.reduce(function (sum, item) {
      var isCurrentYear = item.year === today.getFullYear();
      var yearDays = isCurrentYear
        ? Math.floor((today - new Date(item.year, 0, 1)) / 86400000) + 1
        : (new Date(item.year, 1, 29).getMonth() === 1 ? 366 : 365);
      return sum + yearDays;
    }, 0);
    var dailyWordWan = words === null ? null : words / days;
    var months = Array(12).fill(0).map(function (_, index) {
      return rows.reduce(function (sum, item) { return sum + item.months[index]; }, 0);
    });
    var activeMonths = months.filter(Boolean).length;
    var peak = months.indexOf(Math.max.apply(null, months)) + 1;
    animateMetric(root.querySelector('[data-metric="entries"]'), entries);
    animateMetric(root.querySelector('[data-metric="words"]'), words);
    animateMetric(root.querySelector('[data-metric="daily"]'), dailyWordWan, '', 1);
    animateMetric(root.querySelector('[data-metric="active"]'), activeMonths);
    root.querySelectorAll('[data-reading-year]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.readingYear) === String(state.year));
    });
    root.querySelector('[data-habit-caption]').textContent = state.year === 'all' ? '全部年份累计' : state.year + ' 年';
    var firstWordYear = data.years.find(function (item) { return typeof item.wordWan === 'number'; });
    root.querySelector('[data-reading-insight]').textContent = state.year === 'all'
      ? '从现有记录看，' + peak + ' 月是最常集中阅读的月份；字数统计自 ' + (firstWordYear ? firstWordYear.year : '有记录的年份') + ' 年开始有完整记录。'
      : state.year + ' 年共留下 ' + entries + ' 本阅读记录，活跃于 ' + activeMonths + ' 个月，阅读最集中在 ' + peak + ' 月。';
    renderBars(root, data);
    renderHeatmap(root, months);
    renderWordChart(root, data);
    root.querySelector('[data-preference-caption]').textContent = state.year === 'all' ? '全部年份累计' : state.year + ' 年';
    renderPreferences(root, rows);
  }

  function mountDashboard() {
    var root = document.getElementById('reading-dashboard');
    if (!root || root.dataset.mounted === 'true' || root.dataset.loading === 'true') return;
    root.dataset.loading = 'true';
    discoverReadingData().then(function (data) {
      if (!data.years.length) throw new Error('没有找到年度阅读数据');
      if (!document.body.contains(root)) return;
      if (state.year === null || !data.years.some(function (item) { return String(item.year) === String(state.year); })) {
        state.year = String(data.years[data.years.length - 1].year);
      }
      root.dataset.mounted = 'true';
      root.dataset.loading = 'false';
      root.innerHTML = dashboardMarkup(data);
      root.addEventListener('click', function (event) {
        var yearButton = event.target.closest('[data-reading-year]');
        var soundButton = event.target.closest('.reading-sound');
        if (yearButton) {
          state.year = yearButton.dataset.readingYear;
          state.preference = null;
          createTone();
          update(root, data);
        }
        var preferenceButton = event.target.closest('[data-reading-preference]');
        if (preferenceButton) {
          state.preference = state.preference === preferenceButton.dataset.readingPreference ? null : preferenceButton.dataset.readingPreference;
          createTone();
          renderPreferences(root, selectedRows(data));
        }
        if (soundButton) {
          state.sound = !state.sound;
          soundButton.setAttribute('aria-pressed', state.sound);
          soundButton.innerHTML = '<span aria-hidden="true">♪</span> 声效' + (state.sound ? '开启' : '关闭');
          soundButton.setAttribute('aria-label', (state.sound ? '关闭' : '开启') + '图表交互声效');
          createTone();
        }
      });
      root.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var preferenceButton = event.target.closest('[data-reading-preference]');
        if (!preferenceButton) return;
        event.preventDefault();
        preferenceButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      update(root, data);
    }).catch(function () {
      if (!document.body.contains(root)) return;
      root.dataset.loading = 'false';
      root.innerHTML = '<p class="reading-dashboard-loading">年度数据读取失败，请刷新页面重试。</p>';
    });
  }

  function mountHomeWidgets() {
    mountRecentReading();
    mountLatestReadingPage();
    mountYearWordTotal();
    mountDashboard();
  }

  window.addEventListener('hashchange', function () { setTimeout(mountHomeWidgets, 80); });
  document.addEventListener('doc-read:rendered', mountHomeWidgets);
  document.addEventListener('doc-read:widgets-ready', mountHomeWidgets);
  document.addEventListener('DOMContentLoaded', function () { setTimeout(mountHomeWidgets, 80); });
  setTimeout(mountHomeWidgets, 300);
}());
