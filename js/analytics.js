// ===== 数据分析面板 — Chart.js 可视化 =====
window.Yiwei = window.Yiwei || {};
(function() {
  'use strict';

  var currentRange = 'week';
  var charts = {};

  function cssVar(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
  var C = {};
  function refreshColors() {
    C.accent  = cssVar('--accent'); C.accent2 = cssVar('--accent2');
    C.ok = cssVar('--ok'); C.warn = cssVar('--warn'); C.danger = cssVar('--danger');
    C.sub = cssVar('--sub'); C.text = cssVar('--text'); C.border = cssVar('--border'); C.card = cssVar('--card');
  }

  function destroyCharts() { Object.values(charts).forEach(function(c) { try { c.destroy(); } catch {} }); charts = {}; }

  async function loadStats(range) {
    try { return await (await fetch('/api/analytics/stats?range=' + range)).json(); } catch(e) { return null; }
  }

  async function loadChatStats() {
    try {
      if (typeof ChatDB === 'undefined') return { conversations: 0, totalMessages: 0, avgLength: 0, byDay: {} };
      var convs = await ChatDB.getAll(), totalMessages = 0, byDay = {};
      convs.forEach(function(c) {
        var msgs = (c.messages || []).filter(function(m) { return m.role === 'user'; });
        totalMessages += msgs.length;
        var d = new Date(c.updatedAt || Date.now()).toISOString().slice(0, 10);
        byDay[d] = (byDay[d] || 0) + msgs.length;
      });
      return { conversations: convs.length, totalMessages: totalMessages,
        avgLength: convs.length ? Math.round(totalMessages / convs.length) : 0, byDay: byDay };
    } catch(e) { return { conversations: 0, totalMessages: 0, avgLength: 0, byDay: {} }; }
  }

  // 读取进度详情
  function getReadingDetail() {
    var files = [], notes = [];
    Object.keys(localStorage).forEach(function(k) {
      if (k.startsWith('read-file-')) {
        try { var d = JSON.parse(localStorage.getItem(k)); files.push({ name: k.replace('read-file-',''), pct: d.pct || 0 }); } catch {}
      } else if (k.startsWith('read-note-')) {
        try { var d = JSON.parse(localStorage.getItem(k)); notes.push({ name: k.replace('read-note-',''), pct: d.pct || 0 }); } catch {}
      }
    });
    return { files: files, notes: notes };
  }

  // ---- 柱状图通用配置 ----
  function barOptions(showYLabel) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C.card, titleColor: C.text, bodyColor: C.sub,
          borderColor: C.border, borderWidth: 1,
          cornerRadius: 8, padding: 10,
          callbacks: {
            label: function(ctx) { return (showYLabel || '') + ctx.parsed.y + (showYLabel === ' 分钟' ? '' : ''); }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { color: C.sub }, grid: { color: C.border + '40' } },
        x: { ticks: { color: C.sub, font: { size: 9 }, maxTicksLimit: 20 }, grid: { display: false } }
      }
    };
  }

  // ---- 概览 ----
  function renderOverview(stats) {
    document.getElementById('ovOnline').textContent = stats.onlineTime.total || 0;
    var modules = Object.keys(stats.onlineTime.byPanel).filter(function(k) { return k !== 'total' && stats.onlineTime.byPanel[k] > 0; });
    document.getElementById('ovModules').textContent = modules.length;
    document.getElementById('ovFiles').textContent = stats.files.total || 0;
    document.getElementById('ovNotes').textContent = stats.notes.total || 0;
  }

  // ---- 在线时长 ----
  function renderOnlineChart(stats) {
    var ctx = document.getElementById('chartOnline'); if (!ctx) return;
    var ts = stats.onlineTime.timeSeries || {};
    var entries = Object.entries(ts).sort(function(a, b) { return a[0] > b[0] ? 1 : -1; });
    charts.online = new Chart(ctx, {
      type: 'bar',
      data: { labels: entries.map(function(e) { return e[0]; }), datasets: [{ data: entries.map(function(e) { return e[1]; }), backgroundColor: C.accent, borderRadius: 6, maxBarThickness: 24 }] },
      options: barOptions(' 分钟')
    });
    // 子信息
    var el = document.querySelector('#cardOnline .analytics-card-detail');
    if (el) {
      var top = Object.entries(stats.onlineTime.byPanel).filter(function(e) { return e[0] !== 'total'; }).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 3);
      el.innerHTML = top.map(function(e) { return '<span>' + e[0] + ' ' + e[1] + '分</span>'; }).join(' · ');
    }
  }

  // ---- 文件 ----
  function renderFilesChart(stats) {
    var ctx = document.getElementById('chartFiles'); if (!ctx) return;
    var types = stats.files.types || {};
    var entries = Object.entries(types).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 8);
    var colors = [C.accent, C.accent2, C.ok, C.warn, C.danger, C.sub, C.text, C.border];
    charts.files = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: entries.map(function(e) { return e[0]; }), datasets: [{ data: entries.map(function(e) { return e[1]; }), backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '55%',
        plugins: {
          legend: { position: 'right', labels: { color: C.sub, font: { size: 9 }, padding: 6, usePointStyle: true, boxWidth: 6 } },
          tooltip: { backgroundColor: C.card, titleColor: C.text, bodyColor: C.sub, borderColor: C.border, borderWidth: 1, cornerRadius: 8, padding: 10 }
        }
      }
    });
    var el = document.querySelector('#cardFiles .analytics-card-detail');
    if (el) el.innerHTML = '<span>共 ' + stats.files.total + ' 个文件</span> · <span>' + (stats.files.totalSizeStr || '') + '</span>';
  }

  // ---- 写作 ----
  function renderNotesChart(stats) {
    var ctx = document.getElementById('chartNotes'); if (!ctx) return;
    var daily = stats.notes.dailyWords || {};
    var sorted = Object.entries(daily).sort(function(a, b) { return a[0] > b[0] ? 1 : -1; });
    charts.notes = new Chart(ctx, {
      type: 'bar',
      data: { labels: sorted.map(function(e) { return e[0].slice(5); }), datasets: [{ data: sorted.map(function(e) { return e[1]; }), backgroundColor: C.accent, borderRadius: 6, maxBarThickness: 22 }] },
      options: barOptions(' 字')
    });
    var el = document.querySelector('#cardNotes .analytics-card-detail');
    if (el) el.innerHTML = '<span>总计 ' + (stats.notes.totalWords||0) + ' 字</span> · <span>' + (stats.notes.total||0) + ' 篇笔记</span> · <span>' + (stats.notes.chapters||0) + ' 章节</span>';
  }

  // ---- 翻译 ----
  function renderTranslateChart(stats) {
    var ctx = document.getElementById('chartTranslate'); if (!ctx) return;
    var byDay = stats.translate.byDay || {};
    var sorted = Object.entries(byDay).sort(function(a, b) { return a[0] > b[0] ? 1 : -1; });
    charts.translate = new Chart(ctx, {
      type: 'bar',
      data: { labels: sorted.map(function(e) { return e[0].slice(5); }), datasets: [{ data: sorted.map(function(e) { return e[1]; }), backgroundColor: C.accent2, borderRadius: 6, maxBarThickness: 22 }] },
      options: barOptions(' 次')
    });
    var el = document.querySelector('#cardTranslate .analytics-card-detail');
    if (el) {
      var pairs = stats.translate.byPair || {};
      var top = Object.entries(pairs).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 3);
      el.innerHTML = '<span>共 ' + (stats.translate.total||0) + ' 次</span> · ' + top.map(function(e) { return '<span>' + e[0] + ' ' + e[1] + '次</span>'; }).join(' · ');
    }
  }

  // ---- 对话 ----
  function renderChatChart(chat) {
    chat = chat || { conversations: 0, totalMessages: 0, avgLength: 0, byDay: {} };
    var ctx = document.getElementById('chartChat'); if (!ctx) return;
    var sorted = Object.entries(chat.byDay).sort(function(a, b) { return a[0] > b[0] ? 1 : -1; });
    charts.chat = new Chart(ctx, {
      type: 'bar',
      data: { labels: sorted.map(function(e) { return e[0].slice(5); }), datasets: [{ data: sorted.map(function(e) { return e[1]; }), backgroundColor: C.ok, borderRadius: 6, maxBarThickness: 22 }] },
      options: barOptions(' 条')
    });
    var el = document.querySelector('#cardChat .analytics-card-detail');
    if (el) el.innerHTML = '<span>' + (chat.conversations||0) + ' 个对话</span> · <span>' + (chat.totalMessages||0) + ' 条消息</span> · <span>均' + (chat.avgLength||0) + '条/对话</span>';
  }

  // ---- 阅读 ----
  function renderReadingChart(stats) {
    var ctx = document.getElementById('chartReading'); if (!ctx) return;
    var detail = getReadingDetail();
    var rf = detail.files.length, rn = detail.notes.length;
    // 阅读时长 = 在线时长中 read 面板的时间
    var readMin = stats.onlineTime.byPanel.read || 0;

    charts.reading = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['文件(' + rf + ')', '笔记(' + rn + ')'], datasets: [{ data: [rf, rn], backgroundColor: [C.accent, C.accent2], borderWidth: 0, borderRadius: 3 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '55%',
        plugins: {
          legend: { position: 'bottom', labels: { color: C.sub, font: { size: 9 }, usePointStyle: true, boxWidth: 6 } },
          tooltip: { backgroundColor: C.card, titleColor: C.text, bodyColor: C.sub, borderColor: C.border, borderWidth: 1, cornerRadius: 8, padding: 10 }
        }
      }
    });
    var el = document.querySelector('#cardReading .analytics-card-detail');
    if (el) {
      // 列出前几个阅读项
      var items = detail.files.concat(detail.notes).sort(function(a, b) { return b.pct - a.pct; }).slice(0, 4);
      var itemStr = items.map(function(i) { return i.name.slice(0, 20) + ' ' + i.pct + '%'; }).join(' · ');
      el.innerHTML = '<span>📖 ' + readMin + ' 分钟</span> · <span>' + (rf + rn) + ' 项</span>' + (itemStr ? ' · <span>' + itemStr + '</span>' : '');
    }
  }

  async function renderAll(range) {
    refreshColors();
    destroyCharts();
    var stats = await loadStats(range);
    if (!stats) return;
    var chat = await loadChatStats();
    renderOverview(stats);
    renderOnlineChart(stats);
    renderFilesChart(stats);
    renderNotesChart(stats);
    renderTranslateChart(stats);
    renderChatChart(chat);
    renderReadingChart(stats);
  }

  function initButtons() {
    document.querySelectorAll('.analytics-range-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.analytics-range-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentRange = btn.dataset.range;
        renderAll(currentRange);
      });
    });
  }

  function init() {
    initButtons();
    var panelEl = document.getElementById('panel-analytics');
    if (panelEl) {
      new MutationObserver(function(mutations) {
        mutations.forEach(function(m) {
          if (m.attributeName === 'class' && panelEl.classList.contains('active')) renderAll(currentRange);
        });
      }).observe(panelEl, { attributes: true, attributeFilter: ['class'] });
    }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
