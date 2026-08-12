(function () {
  'use strict';

  var state = { year: null, sound: false, audio: null };

  function formatNumber(value) {
    return new Intl.NumberFormat('zh-CN').format(value);
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
    var latest = data.years[data.years.length - 1];
    var yearButtons = data.years.map(function (item) {
      var active = String(state.year) === String(item.year);
      return '<button type="button" data-reading-year="' + item.year + '" aria-pressed="' + active + '">' + item.year + '</button>';
    }).join('');
    return [
      '<div class="reading-dashboard-head">',
        '<div><p class="reading-dashboard-eyebrow">READING IN NUMBERS</p><h3>九年阅读轨迹</h3></div>',
        '<button class="reading-sound" type="button" aria-pressed="false" aria-label="开启图表交互声效"><span aria-hidden="true">♪</span> 声效关闭</button>',
      '</div>',
      '<div class="reading-year-controls" role="group" aria-label="选择统计年份">',
        '<button type="button" data-reading-year="all" aria-pressed="' + (state.year === 'all') + '">全部</button>', yearButtons,
      '</div>',
      '<div class="reading-metrics">',
        '<div><div class="reading-metric-value"><span data-metric="entries">0</span><em>本</em></div><small>年度清单阅读记录</small></div>',
        '<div><div class="reading-metric-value"><span data-metric="words">—</span><em>万</em></div><small>已记录阅读字数</small></div>',
        '<div><div class="reading-metric-value"><span data-metric="daily">—</span><em>字</em></div><small>平均每天阅读</small></div>',
        '<div><div class="reading-metric-value"><span data-metric="active">0</span><em>月</em></div><small>有阅读记录的月份</small></div>',
      '</div>',
      '<div class="reading-chart-block">',
        '<div class="reading-chart-title"><strong>年度阅读节奏</strong><span>点击柱形选择年份</span></div>',
        '<div class="reading-bars" role="img" aria-label="2018 至 ' + latest.year + ' 年每年阅读书目数量"></div>',
      '</div>',
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
      '<p class="reading-insight" data-reading-insight></p>'
    ].join('');
  }

  function selectedRows(data) {
    return state.year === 'all' ? data.years : data.years.filter(function (item) { return String(item.year) === String(state.year); });
  }

  function animateMetric(element, target, suffix) {
    if (typeof target !== 'number') {
      element.textContent = '—';
      return;
    }
    var start = performance.now();
    var duration = 420;
    function frame(now) {
      var progress = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = formatNumber(Math.round(target * eased)) + (suffix || '');
      if (progress < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function renderBars(root, data) {
    var max = Math.max.apply(null, data.years.map(function (item) { return item.entries; }));
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
    var dailyWords = words === null ? null : Math.round(words * 10000 / days);
    var months = Array(12).fill(0).map(function (_, index) {
      return rows.reduce(function (sum, item) { return sum + item.months[index]; }, 0);
    });
    var activeMonths = months.filter(Boolean).length;
    var peak = months.indexOf(Math.max.apply(null, months)) + 1;
    animateMetric(root.querySelector('[data-metric="entries"]'), entries);
    animateMetric(root.querySelector('[data-metric="words"]'), words);
    animateMetric(root.querySelector('[data-metric="daily"]'), dailyWords);
    animateMetric(root.querySelector('[data-metric="active"]'), activeMonths);
    root.querySelectorAll('[data-reading-year]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.readingYear) === String(state.year));
    });
    root.querySelector('[data-habit-caption]').textContent = state.year === 'all' ? '全部年份累计' : state.year + ' 年';
    root.querySelector('[data-reading-insight]').textContent = state.year === 'all'
      ? '从现有记录看，' + peak + ' 月是最常集中阅读的月份；字数统计自 2023 年开始有完整记录。'
      : state.year + ' 年共留下 ' + entries + ' 本阅读记录，活跃于 ' + activeMonths + ' 个月，阅读最集中在 ' + peak + ' 月。';
    renderBars(root, data);
    renderHeatmap(root, months);
    renderWordChart(root, data);
  }

  function mountDashboard() {
    var root = document.getElementById('reading-dashboard');
    var data = window.DOC_READ_STATS;
    if (!root || !data || root.dataset.mounted === 'true') return;
    if (state.year === null && data.years.length) state.year = String(data.years[data.years.length - 1].year);
    root.dataset.mounted = 'true';
    root.innerHTML = dashboardMarkup(data);
    root.addEventListener('click', function (event) {
      var yearButton = event.target.closest('[data-reading-year]');
      var soundButton = event.target.closest('.reading-sound');
      if (yearButton) {
        state.year = yearButton.dataset.readingYear;
        createTone();
        update(root, data);
      }
      if (soundButton) {
        state.sound = !state.sound;
        soundButton.setAttribute('aria-pressed', state.sound);
        soundButton.innerHTML = '<span aria-hidden="true">♪</span> 声效' + (state.sound ? '开启' : '关闭');
        soundButton.setAttribute('aria-label', (state.sound ? '关闭' : '开启') + '图表交互声效');
        createTone();
      }
    });
    update(root, data);
  }

  window.addEventListener('hashchange', function () { setTimeout(mountDashboard, 80); });
  document.addEventListener('doc-read:rendered', mountDashboard);
  document.addEventListener('DOMContentLoaded', function () { setTimeout(mountDashboard, 80); });
  setTimeout(mountDashboard, 300);
}());
