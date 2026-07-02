// ===== 番茄钟 — 全局浮动计时器 =====
window.Yiwei = window.Yiwei || {};
(function() {
  'use strict';

  // ---- 常量 ----
  var STORAGE_KEY = 'yiwei_pomodo';
  var DEFAULTS = {
    mode: 'pomodoro',
    remaining: 25 * 60,
    running: false,
    expanded: false,
    x: null,
    y: null,
    enabled: true,
    opacity: 90,
    sessions: 0
  };

  var PRESETS = {
    pomodoro:   25 * 60,
    shortBreak:  5 * 60,
    longBreak:  15 * 60,
    stopwatch:   0
  };

  var MODE_LABELS = { pomodoro: '🍅 专注', shortBreak: '☕ 短休', longBreak: '🌿 长休', stopwatch: '⏱ 计时' };

  // ---- 状态 ----
  var state = {};
  var timerId = null;
  var dragged = false;

  // ---- DOM 引用 ----
  var el, pill, timeEl, labelEl, indicator, panel;
  var startBtn, pauseBtn, resetBtn, modeBtns, sessionsEl;

  // ---- AudioContext (懒初始化) ----
  var audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  // ---- 提示音 ----
  function playAlarm() {
    try {
      var ctx = getAudioCtx();
      [0, 0.15, 0.3, 0.45].forEach(function(offset, i) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(i % 2 === 0 ? 880 : 660, ctx.currentTime + offset);
        gain.gain.setValueAtTime(0.3, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + offset + 0.12);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.12);
      });
    } catch(e) { /* Web Audio 不支持 */ }
  }

  // ---- 工具 ----
  function formatTime(sec) {
    var m = Math.floor(Math.abs(sec) / 60);
    var s = Math.abs(sec) % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function getProgress() {
    if (state.mode === 'stopwatch') {
      return Math.min(state.remaining / 3600, 1);
    }
    var total = PRESETS[state.mode] || PRESETS.pomodoro;
    if (total <= 0) return 0;
    return 1 - (state.remaining / total);
  }

  // ---- 渲染 ----
  function render() {
    timeEl.textContent = formatTime(state.remaining);
    labelEl.textContent = MODE_LABELS[state.mode] || '';

    // 进度条：pill 底部渐变背景
    var pct = Math.round(getProgress() * 100);
    var accentColor = state.mode === 'stopwatch' ? 'var(--ok)' :
      (state.mode === 'shortBreak' || state.mode === 'longBreak') ? 'var(--accent2)' : 'var(--accent)';
    pill.style.background = 'linear-gradient(to right, ' + accentColor + '20 ' + pct + '%, var(--card) ' + pct + '%)';

    // 指示点颜色
    indicator.style.background = accentColor;
    // 运行时脉冲
    indicator.style.animation = state.running ? 'pomodoPulse 1s ease-in-out infinite' : '';

    modeBtns.forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.mode === state.mode);
    });

    sessionsEl.textContent = state.sessions;

    if (state.running) {
      startBtn.style.display = 'none';
      pauseBtn.style.display = '';
    } else {
      startBtn.style.display = '';
      pauseBtn.style.display = 'none';
    }

    el.setAttribute('data-mode', state.mode);
    el.style.display = state.enabled ? '' : 'none';
  }

  // ---- 持久化 ----
  function load() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      Object.keys(DEFAULTS).forEach(function(k) {
        state[k] = (k in saved) ? saved[k] : DEFAULTS[k];
      });
    } catch(e) { Object.assign(state, DEFAULTS); }
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
  }

  // ---- 计时引擎 ----
  function tick() {
    if (!state.running) return;
    if (state.mode === 'stopwatch') {
      state.remaining++;
    } else {
      state.remaining = Math.max(0, state.remaining - 1);
      if (state.remaining <= 0) {
        state.running = false;
        stopTimer();
        state.sessions++;
        save();
        render();
        playAlarm();
        if (typeof toast === 'function') toast('🍅 番茄钟结束！', 'success');
        return;
      }
    }
    save();
    render();
  }

  function startTimer() {
    if (state.running) return;
    if (state.remaining <= 0 && state.mode !== 'stopwatch') resetTimer();
    state.running = true;
    timerId = setInterval(tick, 1000);
    render();
  }

  function pauseTimer() {
    state.running = false;
    stopTimer();
    render();
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  function resetTimer() {
    state.running = false;
    stopTimer();
    state.remaining = PRESETS[state.mode] || PRESETS.pomodoro;
    save();
    render();
  }

  function setMode(mode) {
    if (!PRESETS.hasOwnProperty(mode)) return;
    if (state.mode === mode && state.remaining > 0) return;
    state.running = false;
    stopTimer();
    state.mode = mode;
    state.remaining = PRESETS[mode];
    save();
    render();
  }

  // ---- 展开/折叠 ----
  function togglePanel(e) {
    if (dragged) return;
    state.expanded = !state.expanded;
    panel.classList.toggle('open', state.expanded);
  }

  function outsideClick(e) {
    if (state.expanded && !el.contains(e.target)) {
      state.expanded = false;
      panel.classList.remove('open');
    }
  }

  // ---- 拖拽 (整个 pill 可拖) ----
  function initDrag() {
    var active = false;
    var sx, sy, ox, oy, movedTotal;

    function down(e) {
      if (e.target.closest('.pomodo-panel')) return;
      dragged = false; movedTotal = 0;
      active = true;
      var pt = e.touches ? e.touches[0] : e;
      sx = pt.clientX; sy = pt.clientY;
      var rect = el.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      document.body.classList.add('resizing');
      el.style.transition = 'none';
      el.style.transform = 'none';
    }

    function move(e) {
      if (!active) return;
      var pt = e.touches ? e.touches[0] : e;
      var dx = pt.clientX - sx, dy = pt.clientY - sy;
      movedTotal += Math.abs(dx) + Math.abs(dy);
      if (movedTotal > 4) dragged = true;
      if (!dragged) return;

      var pw = el.offsetWidth, ph = el.offsetHeight;
      var nx = Math.max(8, Math.min(window.innerWidth - pw - 8, ox + dx));
      var ny = Math.max(8, Math.min(window.innerHeight - ph - 8, oy + dy));
      el.style.left = nx + 'px';
      el.style.top = ny + 'px';
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }

    function up() {
      if (!active) return;
      active = false;
      document.body.classList.remove('resizing');
      el.style.transition = '';
      var rect = el.getBoundingClientRect();
      state.x = rect.left; state.y = rect.top;
      save();
      setTimeout(function() { dragged = false; }, 50);
    }

    pill.addEventListener('mousedown', down);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    pill.addEventListener('touchstart', down, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
  }

  // ---- 公开 API ----
  function setEnabled(val) {
    state.enabled = !!val;
    if (!state.enabled) { state.running = false; stopTimer(); }
    save();
    render();
  }

  function setOpacity(val) {
    state.opacity = parseInt(val) || 90;
    el.style.setProperty('--pomodo-opacity', (state.opacity / 100));
    save();
  }

  // ---- 初始化 ----
  function init() {
    el = document.getElementById('pomodo');
    pill = document.getElementById('pomodoPill');
    timeEl = document.getElementById('pomodoTime');
    labelEl = document.getElementById('pomodoLabel');
    indicator = document.getElementById('pomodoIndicator');
    panel = document.getElementById('pomodoPanel');
    startBtn = document.getElementById('pomodoStartBtn');
    pauseBtn = document.getElementById('pomodoPauseBtn');
    resetBtn = document.getElementById('pomodoResetBtn');
    sessionsEl = document.getElementById('pomodoSessions');
    modeBtns = document.querySelectorAll('.pomodo-mode-btn');

    if (!el) return;

    load();

    // 恢复位置
    if (state.x !== null) {
      el.style.left = state.x + 'px';
      el.style.top = state.y + 'px';
      el.style.transform = 'none';
    }

    // 恢复透明度
    setOpacity(state.opacity);

    // 事件
    pill.addEventListener('click', togglePanel);
    startBtn.addEventListener('click', function(e) { e.stopPropagation(); startTimer(); });
    pauseBtn.addEventListener('click', function(e) { e.stopPropagation(); pauseTimer(); });
    resetBtn.addEventListener('click', function(e) { e.stopPropagation(); resetTimer(); });
    modeBtns.forEach(function(btn) {
      btn.addEventListener('click', function(e) { e.stopPropagation(); setMode(btn.dataset.mode); });
    });
    document.addEventListener('click', outsideClick);

    initDrag();
    render();

    window.Yiwei.pomodoro = {
      setEnabled: setEnabled,
      setOpacity: setOpacity,
      getState: function() { return state; }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
