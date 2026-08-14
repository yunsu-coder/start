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

  // 图表空数据回退：在 canvas 容器中显示提示文本
  function emptyChart(canvasId, msg) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.style.display = 'none';
    var parent = canvas.parentElement;
    var placeholder = parent.querySelector('.chart-empty');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'chart-empty';
      placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;color:var(--sub);font-size:.8rem;';
      parent.appendChild(placeholder);
    }
    placeholder.textContent = msg || '暂无数据';
    placeholder.style.display = 'flex';
  }
  function showChart(canvasId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    canvas.style.display = '';
    var placeholder = canvas.parentElement.querySelector('.chart-empty');
    if (placeholder) placeholder.style.display = 'none';
  }

  // ---- 在线时长 ----
  function renderOnlineChart(stats) {
    var ctx = document.getElementById('chartOnline'); if (!ctx) return;
    var ts = stats.onlineTime.timeSeries || {};
    var entries = Object.entries(ts).sort(function(a, b) { return a[0] > b[0] ? 1 : -1; });
    if (!entries.length) { emptyChart('chartOnline', '暂无在线数据'); return; }
    showChart('chartOnline');
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
    if (!entries.length) { emptyChart('chartFiles', '暂无文件'); return; }
    showChart('chartFiles');
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
    if (!sorted.length) { emptyChart('chartNotes', '暂无写作数据'); return; }
    showChart('chartNotes');
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
    if (!sorted.length) { emptyChart('chartTranslate', '暂无翻译数据'); return; }
    showChart('chartTranslate');
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
    if (!sorted.length) { emptyChart('chartChat', '暂无对话数据'); return; }
    showChart('chartChat');
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
    if (!rf && !rn) { emptyChart('chartReading', '暂无阅读记录'); return; }
    showChart('chartReading');
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

  // 检查是否完全无数据
  function hasAnyData(stats, chat) {
    var onlineOk = stats.onlineTime && stats.onlineTime.total > 0;
    var filesOk = stats.files && stats.files.total > 0;
    var notesOk = stats.notes && stats.notes.total > 0;
    var translateOk = stats.translate && stats.translate.total > 0;
    var chatOk = chat && chat.totalMessages > 0 && chat.totalMessages > 0;
    return onlineOk || filesOk || notesOk || translateOk || chatOk;
  }

  function showEmptyState(show) {
    var grid = document.querySelector('.analytics-grid');
    var empty = document.getElementById('analyticsEmpty');
    if (show) {
      if (!empty) {
        empty = document.createElement('div');
        empty.id = 'analyticsEmpty';
        empty.style.cssText = 'grid-column:1/-1;text-align:center;padding:3rem 1rem;color:var(--sub);';
        empty.innerHTML = '<span class="mi" style="font-size:2.5rem;display:block;margin-bottom:.8rem;opacity:.5;">monitoring</span><p style="font-size:.9rem;margin:0;">暂无使用数据</p><p style="font-size:.75rem;margin:.3rem 0 0;opacity:.7;">开始使用各模块后，统计数据会自动出现在这里</p>';
        grid.appendChild(empty);
      }
      empty.style.display = '';
    } else {
      if (empty) empty.style.display = 'none';
    }
  }

  async function renderAll(range) {
    refreshColors();
    destroyCharts();
    var stats = await loadStats(range);
    if (!stats) { showEmptyState(true); return; }
    var chat = await loadChatStats();
    if (!hasAnyData(stats, chat)) { showEmptyState(true); return; }
    showEmptyState(false);
    renderOverview(stats);
    renderOnlineChart(stats);
    renderFilesChart(stats);
    renderNotesChart(stats);
    renderTranslateChart(stats);
    renderChatChart(chat);
    renderReadingChart(stats);
    // 触发 AI 点评
    setTimeout(function() { if (typeof loadAICommentary === 'function') loadAICommentary(); }, 1500);
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

// ===== AI 智能点评 =====
var aiCommentaryCache = null, aiCommentaryLoading = false;

async function loadAICommentary() {
  var el = document.getElementById('aiCommentaryContent');
  if (!el) return;
  if (aiCommentaryCache) { el.textContent = aiCommentaryCache; el.style.opacity = '1'; return; }
  if (aiCommentaryLoading) return;
  aiCommentaryLoading = true;
  el.textContent = '🤔 AI 正在分析你的使用数据...';
  el.style.opacity = '0.7';

  try {
    // 收集简要统计
    var stats = await (await fetch('/api/analytics/stats?range=week')).json();
    var chatStats = typeof ChatDB !== 'undefined' ? await ChatDB.getAll() : [];
    var pomoState = JSON.parse(localStorage.getItem('yiwei_pomodo') || '{}');
    var tasksState = JSON.parse(localStorage.getItem('yiwei_tasks') || '[]');

    var summary = {
      onlineTime: stats.onlineTime?.total || 0,
      topModule: Object.entries(stats.onlineTime?.byPanel || {}).sort(function(a,b){return b[1]-a[1];})[0] || ['未知',0],
      files: stats.files?.total || 0,
      notes: stats.notes?.total || 0, words: stats.notes?.totalWords || 0,
      conversations: chatStats.length,
      messages: chatStats.reduce(function(s,c){return s+(c.messages||[]).length;}, 0),
      pomoSessions: pomoState.sessions || 0,
      tasks: Array.isArray(tasksState) ? tasksState.length : 0,
      tasksDone: Array.isArray(tasksState) ? tasksState.filter(function(t){return t.status==='done';}).length : 0,
    };

    // 通过对话 API 获取点评
    var apiKey = localStorage.getItem('yiwei_chat_apikey') || localStorage.getItem('yiwei_apikey');
    if (!apiKey) {
      el.textContent = genLocalCommentary(summary);
      el.style.opacity = '1';
      aiCommentaryCache = el.textContent;
      aiCommentaryLoading = false;
      return;
    }

    var prompt = '你是一个数据分析助手。以下是用户过去一周的使用数据，请用2-3句话点评，语气轻松幽默，中文，不超过150字。数据：在线' + summary.onlineTime + '分钟，最常用「' + summary.topModule[0] + '」，文件' + summary.files + '个，笔记' + summary.notes + '篇' + summary.words + '字，对话' + summary.conversations + '个' + summary.messages + '条，番茄钟' + summary.pomoSessions + '个，任务完成' + summary.tasksDone + '/' + summary.tasks + '。';

    var resp = await fetch('https://vip.apiyi.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: localStorage.getItem('yiwei_chat_model') || 'grok-4.3',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200, temperature: 0.9
      })
    });
    var data = await resp.json();
    var comment = data.choices?.[0]?.message?.content || genLocalCommentary(summary);
    el.textContent = comment;
    el.style.opacity = '1';
    aiCommentaryCache = comment;
  } catch(e) {
    el.textContent = '💫 数据看起来不错，继续保持！（AI 点评暂不可用）';
    el.style.opacity = '1';
  }
  aiCommentaryLoading = false;
}

function genLocalCommentary(summary) {
  var lines = [];
  if (summary.pomoSessions > 5) lines.push('🍅 ' + summary.pomoSessions + '个番茄钟，专注力爆表！');
  if (summary.words > 1000) lines.push('✍️ 写了' + summary.words + '字，创作之魂在燃烧。');
  if (summary.files > 20) lines.push('📁 文件管理井井有条，归档达人。');
  if (summary.tasksDone > summary.tasks * 0.6 && summary.tasks > 0) lines.push('✅ 任务完成率很高，执行力满分。');
  if (summary.onlineTime > 300) lines.push('⏰ 在线' + summary.onlineTime + '分钟，今天也是充实的一天。');
  if (!lines.length) lines.push('🚀 刚刚起步，未来可期！多用用数据会更丰富。');
  return lines.join(' ');
}

// AI 点评由 renderAll() 自动调用
