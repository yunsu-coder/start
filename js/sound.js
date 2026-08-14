// ===== 音效系统 v4 — 丰富合成器 + 全交互覆盖 + 细节拉满 =====
(function() {
  var ctx = null;
  var masterGain = null;
  var reverbBus = null; // { input, output }
  var enabled = localStorage.getItem('yiwei_sound_enabled') !== 'false';
  var vol = parseFloat(localStorage.getItem('yiwei_sound_vol') || '0.28');
  var comboState = {}; // 组合计数器 { soundName: { count, last } }

  function save() { localStorage.setItem('yiwei_sound_enabled', enabled); localStorage.setItem('yiwei_sound_vol', vol); }

  // === 初始化音频图（首次用户手势后调用）===
  function init() {
    if (masterGain) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);

    // 混响总线：3 条不同延迟的并行反馈延迟线，模拟小型房间
    var revIn = ctx.createGain(); revIn.gain.value = 0.35;
    var revOut = ctx.createGain(); revOut.gain.value = 1;
    var times = [0.031, 0.047, 0.059];
    times.forEach(function(dt) {
      var d = ctx.createDelay(0.08);
      d.delayTime.value = dt;
      var f = ctx.createGain(); f.gain.value = 0.12;
      var w = ctx.createGain(); w.gain.value = 0.22;
      revIn.connect(d);
      d.connect(f);
      f.connect(d);
      d.connect(w);
      w.connect(revOut);
    });

    // 低切混响输出，去掉浑浊低频
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6000;
    revOut.connect(lp);
    lp.connect(masterGain);

    reverbBus = { input: revIn, output: revOut };
  }

  function c() {
    if (!ctx || ctx.state === 'closed') init();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function t() { return c().currentTime; }

  // 音量缩放（x 为相对振幅，最终输出 = x * vol * masterGain）
  function v(x) { return Math.max(0, Math.min(1, (x || 0.06) * vol)); }

  // 微随机变化（±amt，返回倍率）
  function r(amt) { return 1 + (Math.random() - 0.5) * 2 * (amt || 0.003); }

  // === 路由辅助 ===
  // 将节点同时连接到 dry（直达输出）和 wet（混响发送）
  function route(node, wetAmt) {
    var dry = c().createGain(); dry.gain.value = 1;
    node.connect(dry);
    dry.connect(masterGain);
    if (wetAmt && wetAmt > 0 && reverbBus) {
      var send = c().createGain(); send.gain.value = wetAmt;
      node.connect(send);
      send.connect(reverbBus.input);
    }
    return { dry: dry, node: node };
  }

  // === 合成原语 ===

  // 单振荡器 — 可选滤波、混响、频率斜坡
  function osc(freq, type, gain, dur, opts) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t(), o = a.createOscillator(), g = a.createGain();
    var _ = opts || {};
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq * r(), T);
    if (_.detune) o.detune.setValueAtTime(_.detune * r(0.5), T);
    if (_.ramp) o.frequency.linearRampToValueAtTime(_.ramp * r(0.01), T + dur);

    // 可选滤波器
    var lastNode = o;
    if (_.filterFreq) {
      var filt = a.createBiquadFilter();
      filt.type = _.filterType || 'lowpass';
      filt.frequency.setValueAtTime(_.filterFreq, T);
      if (_.filterQ) filt.Q.setValueAtTime(_.filterQ, T);
      o.connect(filt);
      lastNode = filt;
    }

    g.gain.setValueAtTime(v(gain) * r(0.1), T);
    if (_.decay !== false) g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
    lastNode.connect(g);
    route(g, _.reverb || 0);
    o.start(T); o.stop(T + dur);
  }

  // 音符序列（旋律）
  function seq(notes, type, gain, gap, decay, opts) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t(), _ = opts || {};
    var gDur = gap || 0.07, dDur = decay || 0.28;
    notes.forEach(function(f, i) {
      var o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f * r(0.004), T + i * gDur);
      if (_.detunes && _[i]) o.detune.setValueAtTime(_.detunes[i], T + i * gDur);
      g.gain.setValueAtTime(v(gain), T + i * gDur);
      g.gain.exponentialRampToValueAtTime(0.0001, T + i * gDur + dDur);
      o.connect(g);
      route(g, _.reverb || (i === notes.length - 1 ? 0.18 : 0));
      o.start(T + i * gDur); o.stop(T + i * gDur + dDur + 0.05);
    });
  }

  // 和弦（同时发音，可错开形成琶音）
  function chord(notes, type, gain, dur, spread, opts) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t(), _ = opts || {};
    var s = spread || 0.006;
    notes.forEach(function(f, i) {
      var o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f * r(0.003), T + i * s);
      if (_.detunes && _[i]) o.detune.setValueAtTime(_.detunes[i], T + i * s);
      g.gain.setValueAtTime(v(gain / Math.sqrt(notes.length)) * r(0.08), T + i * s);
      g.gain.exponentialRampToValueAtTime(0.0001, T + i * s + dur);
      o.connect(g);
      route(g, _.reverb || 0.25);
      o.start(T + i * s); o.stop(T + i * s + dur + 0.03);
    });
  }

  // 敲击感瞬态 — 噪音短脉冲 + 音调主体
  function tap(freq, gain, dur, opts) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t(), _ = opts || {};
    var d = dur || 0.04;

    // 瞬态：高频短促噪音（模拟机械触感）
    var n = a.createOscillator(), ng = a.createGain();
    n.type = 'square';
    n.frequency.setValueAtTime(2000 + r(0.3) * 600, T);
    ng.gain.setValueAtTime(v((gain || 0.05) * 0.55), T);
    ng.gain.exponentialRampToValueAtTime(0.0001, T + 0.012);
    n.connect(ng);
    route(ng, 0);

    // 主体：暖音调
    var o = a.createOscillator(), og = a.createGain();
    o.type = _.type || 'triangle';
    o.frequency.setValueAtTime(freq * r(0.005), T + 0.004);
    if (_.harmonic) { var h = a.createOscillator(); h.type = 'sine'; h.frequency.setValueAtTime(freq * _.harmonic * r(0.005), T + 0.004); h.connect(og); h.start(T + 0.004); h.stop(T + d + 0.02); }
    og.gain.setValueAtTime(v(gain || 0.05), T + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, T + 0.004 + d);
    o.connect(og);
    route(og, _.reverb || 0.1);
    o.start(T + 0.004); o.stop(T + 0.004 + d + 0.02);
    n.start(T); n.stop(T + 0.015);
  }

  // 频率扫描 — 带混响的过渡音
  function sweep(f1, f2, gain, dur, opts) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t(), _ = opts || {};
    var o = a.createOscillator(), g = a.createGain();
    o.type = _.type || 'sine';
    o.frequency.setValueAtTime(f1 * r(0.005), T);
    o.frequency.exponentialRampToValueAtTime(f2 * r(0.005), T + dur);
    g.gain.setValueAtTime(v(gain) * r(0.05), T);
    g.gain.setValueAtTime(v(gain) * r(0.05), T + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
    o.connect(g);
    route(g, _.reverb || 0.4);
    o.start(T); o.stop(T + dur + 0.05);
  }

  // 噪声纹理 — 高频锯齿波拟噪
  function noise(dur, gain, band, opts) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t(), _ = opts || {};
    var o1 = a.createOscillator(), g1 = a.createGain();
    o1.type = 'sawtooth'; o1.frequency.setValueAtTime(band || 8000, T);
    o1.frequency.linearRampToValueAtTime((band || 8000) * 0.2, T + dur);
    g1.gain.setValueAtTime(v(gain || 0.03) * 0.6, T);
    g1.gain.exponentialRampToValueAtTime(0.0001, T + dur);
    o1.connect(g1); route(g1, _.reverb || 0.15);
    // 第二层：低通噪声增加厚度
    var o2 = a.createOscillator(), g2 = a.createGain();
    o2.type = 'square'; o2.frequency.setValueAtTime((band || 8000) * 0.5 * r(0.2), T);
    g2.gain.setValueAtTime(v(gain || 0.03) * 0.35, T);
    g2.gain.exponentialRampToValueAtTime(0.0001, T + dur * 0.8);
    o2.connect(g2); route(g2, 0);
    o1.start(T); o1.stop(T + dur); o2.start(T); o2.stop(T + dur);
  }

  // 气泡 — 极短升调 micro-blip（用于 hover）
  function bubble(freq, gain, dur) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t(), d = dur || 0.03;
    var o = a.createOscillator(), g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * 0.85, T);
    o.frequency.exponentialRampToValueAtTime(freq * 1.15, T + d);
    g.gain.setValueAtTime(v(gain || 0.012), T);
    g.gain.exponentialRampToValueAtTime(0.0001, T + d);
    o.connect(g);
    route(g, 0.08);
    o.start(T); o.stop(T + d);
  }

  // 冲击 — 低频撞击 + 音调衰减（用于确认/危险动作）
  function impact(freq, gain, dur, opts) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t(), _ = opts || {};
    var d = dur || 0.15;

    // 低频撞击
    var o1 = a.createOscillator(), g1 = a.createGain();
    o1.type = 'triangle';
    o1.frequency.setValueAtTime(freq * r(0.02), T);
    o1.frequency.exponentialRampToValueAtTime(freq * 0.3, T + d);
    g1.gain.setValueAtTime(v(gain || 0.07) * 1.2, T);
    g1.gain.exponentialRampToValueAtTime(0.0001, T + d);
    o1.connect(g1); route(g1, _.reverb || 0.3);

    // 高频谐波（金属感）
    if (_.metal !== false) {
      var o2 = a.createOscillator(), g2 = a.createGain();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(freq * 3.7, T);
      o2.frequency.exponentialRampToValueAtTime(freq * 5.2, T + d * 0.6);
      g2.gain.setValueAtTime(v((gain || 0.07) * 0.3), T);
      g2.gain.exponentialRampToValueAtTime(0.0001, T + d * 0.7);
      o2.connect(g2); route(g2, 0.1);
      o2.start(T); o2.stop(T + d);
    }

    o1.start(T); o1.stop(T + d + 0.03);
  }

  // 滤波扫描 — resonant filter sweep（用于 whoosh 类过渡）
  function filterSweep(f1, f2, res, gain, dur) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t();
    var o = a.createOscillator(), filt = a.createBiquadFilter(), g = a.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, T);
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(f1, T);
    filt.frequency.exponentialRampToValueAtTime(f2, T + dur);
    filt.Q.setValueAtTime(res || 5, T);
    g.gain.setValueAtTime(v(gain || 0.04), T);
    g.gain.setValueAtTime(v(gain || 0.04), T + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, T + dur);
    o.connect(filt); filt.connect(g);
    route(g, 0.5);
    o.start(T); o.stop(T + dur + 0.03);
  }

  // 叮叮声 — 高频金属感确认音
  function bell(freq, gain, dur) {
    if (!enabled || vol <= 0) return;
    var a = c(), T = t(), d = dur || 0.25;
    // 基频 + 三组非谐波泛音（模拟铃铛）
    var partials = [freq, freq * 2.4, freq * 4.1, freq * 6.3];
    partials.forEach(function(f, i) {
      var o = a.createOscillator(), g = a.createGain();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(f * r(0.002), T + i * 0.003);
      g.gain.setValueAtTime(v((gain || 0.04) * (1 - i * 0.22)), T + i * 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, T + i * 0.003 + d * (1 - i * 0.15));
      o.connect(g);
      route(g, 0.3);
      o.start(T + i * 0.003); o.stop(T + i * 0.003 + d + 0.02);
    });
  }

  // ===== 音效库（65+ 种，按交互类别分组）=======================================

  var S = {
    // --- 导航 ---
    'nav-click':      function() { tap(850, 0.05, 0.04); },
    'nav-hover':       function() { bubble(2200, 0.012, 0.025); },
    'nav-switch':      function() { sweep(420, 720, 0.045, 0.16); },

    // --- 按钮 ---
    'btn-click':       function() { tap(950, 0.05, 0.04); },
    'btn-hover':       function() { bubble(2400, 0.01, 0.025); },
    'btn-primary':     function() { tap(1100, 0.065, 0.05, {harmonic: 2.1}); },
    'btn-danger':      function() { tap(380, 0.06, 0.05); },
    'btn-toggle-on':   function() { seq([660, 880], 'triangle', 0.045, 0.06, 0.16); },
    'btn-toggle-off':  function() { osc(420, 'triangle', 0.04, 0.10, {ramp: 310, reverb: 0.2}); },

    // --- 卡片 ---
    'card-hover':      function() { bubble(2800, 0.011, 0.03); },
    'card-click':      function() { tap(1050, 0.045, 0.04, {type: 'sine', reverb: 0.15}); },
    'card-expand':     function() { sweep(300, 700, 0.04, 0.14); },
    'card-collapse':   function() { sweep(700, 300, 0.035, 0.10); },

    // --- 弹窗 & 抽屉 ---
    'modal-open':      function() { chord([261, 329, 392], 'triangle', 0.08, 0.20, 0.008); },
    'modal-close':     function() { chord([261, 311, 349], 'triangle', 0.05, 0.14, 0.005); },
    'drawer-open':     function() { sweep(250, 500, 0.04, 0.14); },
    'drawer-close':    function() { sweep(500, 250, 0.035, 0.10); },

    // --- 输入控件 ---
    'input-focus':     function() { bubble(1600, 0.01, 0.03); },
    'input-submit':    function() { tap(900, 0.055, 0.05, {harmonic: 1.6}); },
    'checkbox-on':     function() { seq([660, 830], 'triangle', 0.04, 0.05, 0.12); },
    'checkbox-off':    function() { osc(400, 'triangle', 0.03, 0.07, {reverb: 0.15}); },
    'select-open':     function() { sweep(500, 350, 0.03, 0.09); },
    'select-close':    function() { sweep(350, 500, 0.025, 0.07); },

    // --- 通知 ---
    'toast-ok':        function() { seq([523, 659, 784], 'sine', 0.07, 0.08, 0.28); },
    'toast-err':       function() { noise(0.15, 0.04); seq([370, 280], 'sawtooth', 0.035, 0.12, 0.24); },
    'toast-warn':      function() { seq([440, 554], 'triangle', 0.05, 0.14, 0.26); },
    'toast-info':      function() { osc(660, 'sine', 0.035, 0.14, {ramp: 880, reverb: 0.25}); },

    // --- 主题 ---
    'theme-toggle':    function() { chord([330, 392, 494], 'triangle', 0.07, 0.22, 0.01); },

    // --- 搜索 ---
    'search-go':       function() { sweep(550, 350, 0.045, 0.16); },
    'search-focus':    function() { bubble(1700, 0.012, 0.035); },

    // --- 文件操作 ---
    'file-upload':     function() { sweep(250, 900, 0.06, 0.28); },
    'file-download':   function() { sweep(900, 250, 0.055, 0.24); },
    'file-delete':     function() { noise(0.14, 0.04); impact(200, 0.05, 0.15, {metal: false}); },
    'file-new-folder': function() { bell(520, 0.05, 0.20); },
    'file-select':     function() { tap(850, 0.04, 0.035); },
    'file-drop':       function() { impact(150, 0.06, 0.12, {metal: false}); },

    // --- 笔记 ---
    'note-new':        function() { sweep(350, 660, 0.05, 0.16); },
    'note-save':       function() { seq([660, 880], 'triangle', 0.055, 0.10, 0.26); },
    'note-delete':     function() { noise(0.12, 0.035); seq([300, 230], 'triangle', 0.04, 0.09, 0.20); },
    'note-preview':    function() { sweep(600, 350, 0.035, 0.14); },
    'note-export':     function() { seq([440, 554, 660, 880], 'sine', 0.05, 0.07, 0.32); },
    'note-tab-sw':     function() { tap(780, 0.04, 0.04); },

    // --- 任务 ---
    'task-add':        function() { tap(720, 0.06, 0.05); },
    'task-done':       function() { seq([523, 659, 784, 1047], 'sine', 0.08, 0.07, 0.32); },
    'task-delete':     function() { noise(0.12, 0.035); impact(180, 0.05, 0.14, {metal: false}); },
    'task-overdue':    function() { seq([500, 440, 380], 'triangle', 0.05, 0.14, 0.34); },
    'task-status':     function() { osc(560, 'triangle', 0.05, 0.08, {ramp: 420, reverb: 0.2}); },
    'task-drag':       function() { sweep(800, 400, 0.03, 0.10); },

    // --- 对话 ---
    'chat-send':       function() { sweep(400, 1200, 0.045, 0.16); },
    'chat-rcv':        function() { seq([784, 988], 'sine', 0.025, 0.18, 0.24); },
    'chat-new':        function() { bell(660, 0.05, 0.20); },
    'chat-clear':      function() { noise(0.16, 0.04); impact(170, 0.05, 0.14); },
    'chat-lock':       function() { osc(500, 'triangle', 0.06, 0.12, {ramp: 300, reverb: 0.25}); },
    'chat-immersive':  function() { filterSweep(200, 3000, 8, 0.04, 0.25); },
    'chat-conv-sw':    function() { tap(700, 0.04, 0.04); },
    'chat-conv-del':   function() { noise(0.08, 0.03); osc(350, 'triangle', 0.04, 0.10, {reverb: 0.2}); },

    // --- 翻译 ---
    'translate-go':    function() { sweep(480, 980, 0.05, 0.24); },
    'translate-swap':  function() { chord([440, 554], 'triangle', 0.05, 0.14, 0.02); },
    'translate-save':  function() { seq([550, 730], 'triangle', 0.05, 0.10, 0.24); },

    // --- 阅读 ---
    'reader-open':     function() { seq([440, 554, 660], 'sine', 0.04, 0.12, 0.28); },
    'reader-close':    function() { chord([280, 330], 'triangle', 0.05, 0.14, 0.01); },
    'reader-page':     function() { sweep(600, 400, 0.03, 0.12); },

    // --- 采集 ---
    'scrape-start':    function() { sweep(220, 1200, 0.07, 0.34); },
    'scrape-done':     function() { seq([660, 880, 1100], 'sine', 0.07, 0.08, 0.32); },

    // --- 壁纸 ---
    'wallpaper-set':   function() { seq([440, 554], 'sine', 0.04, 0.16, 0.24); },
    'wallpaper-rand':  function() { tap(520, 0.05, 0.06); },
    'wallpaper-carousel': function() { sweep(400, 700, 0.04, 0.18); },

    // --- 番茄钟 ---
    'pomo-start':      function() { impact(300, 0.07, 0.18, {metal: true}); },
    'pomo-pause':      function() { osc(440, 'triangle', 0.05, 0.14, {ramp: 280, reverb: 0.3}); },
    'pomo-done':       function() { bell(523, 0.08, 0.35); seq([523, 659, 784, 1047], 'sine', 0.06, 0.12, 0.40); },
    'pomo-tick':       function() { osc(1200, 'sine', 0.008, 0.022); },
    'pomo-mode':       function() { tap(600, 0.04, 0.05); },

    // --- 音乐 ---
    'music-play':      function() { seq([440, 554, 660], 'sine', 0.035, 0.12, 0.26); },
    'music-pause':     function() { osc(280, 'triangle', 0.05, 0.10, {reverb: 0.25}); },
    'music-skip':      function() { sweep(550, 950, 0.035, 0.12); },
    'music-vol':       function() { osc(700, 'sine', 0.02, 0.05, {ramp: 850}); },

    // --- 收藏/书签 ---
    'bookmark-add':    function() { bell(580, 0.045, 0.18); },
    'bookmark-edit':   function() { tap(780, 0.04, 0.04); },
    'bookmark-del':    function() { noise(0.08, 0.03); osc(320, 'triangle', 0.04, 0.09, {reverb: 0.2}); },

    // --- 设置 ---
    'setting-save':    function() { seq([550, 730], 'triangle', 0.05, 0.09, 0.22); },
    'setting-reset':   function() { noise(0.12, 0.03); sweep(600, 250, 0.04, 0.12); },

    // --- 通用 ---
    'danger':          function() { noise(0.18, 0.06); impact(150, 0.07, 0.20, {metal: true}); },
    'undo':            function() { sweep(800, 400, 0.04, 0.12); },
    'startup':         function() { chord([330, 440, 554, 660], 'triangle', 0.06, 0.30, 0.015); },
    'easter-egg':      function() { seq([523, 659, 784, 1047, 1319, 1568], 'sine', 0.04, 0.05, 0.45); },
    'tick':            function() { osc(1000, 'sine', 0.008, 0.02); },
    'whoosh':          function() { filterSweep(200, 4000, 6, 0.04, 0.28); },
    'drop':            function() { impact(140, 0.07, 0.16, {metal: false}); },

    // --- 分析面板 ---
    'analytics-tab':   function() { tap(750, 0.04, 0.04); },
    'analytics-refresh': function() { sweep(600, 350, 0.035, 0.12); },

    // --- API 设置 ---
    'api-tab-sw':      function() { tap(720, 0.04, 0.04); },
    'api-save':        function() { seq([550, 730], 'triangle', 0.05, 0.09, 0.22); },
    'api-reset':       function() { noise(0.10, 0.03); sweep(550, 200, 0.035, 0.10); },

    // --- 稀有/特殊（低概率随机触发）---
    'rare-jingle':     function() { bell(660, 0.07, 0.32); seq([880, 1100], 'sine', 0.04, 0.14, 0.30); },
    'treasure':        function() { chord([392, 494, 587], 'triangle', 0.06, 0.30, 0.02); seq([659, 784, 988], 'sine', 0.05, 0.10, 0.36); },
    'level-up':        function() { chord([330, 440, 554, 660], 'triangle', 0.08, 0.38, 0.015); seq([660, 880, 1100, 1320], 'sine', 0.05, 0.10, 0.44); },
    'secret':          function() { sweep(300, 2400, 0.06, 0.32); bell(784, 0.06, 0.28); },
    'critical':        function() { noise(0.08, 0.08); impact(280, 0.09, 0.20, {metal: true}); },
    'magic-cast':      function() { filterSweep(200, 5000, 12, 0.06, 0.34); chord([330, 392, 494], 'sine', 0.05, 0.24, 0.02); },
    'heal':            function() { seq([330, 440, 554, 659], 'sine', 0.04, 0.12, 0.36); },
    'item-get':        function() { seq([523, 659, 784], 'triangle', 0.06, 0.08, 0.30); bell(784, 0.04, 0.18); },
    'quest-done':      function() { chord([330, 440, 554, 659], 'triangle', 0.08, 0.40, 0.015); seq([784, 988, 1175], 'sine', 0.05, 0.12, 0.40); },
    'chest-open':      function() { sweep(250, 700, 0.06, 0.22); seq([440, 554, 659], 'triangle', 0.06, 0.09, 0.30); },
    'portal':          function() { chord([261, 330, 392, 494], 'sine', 0.06, 0.36, 0.03); filterSweep(150, 6000, 14, 0.05, 0.44); },
    'victory':         function() { seq([523, 659, 784, 1047, 1319, 1568], 'sine', 0.06, 0.06, 0.45); chord([523, 659, 784, 1047], 'triangle', 0.05, 0.55, 0.01); },

    // --- 交互增强：点击/滑动/开关 ---
    'click-heavy':     function() { tap(550, 0.07, 0.06, {harmonic: 1.5}); },
    'click-light':     function() { bubble(3200, 0.008, 0.02); },
    'lock':            function() { osc(600, 'triangle', 0.06, 0.12, {ramp: 350, reverb: 0.25}); },
    'unlock':          function() { osc(350, 'triangle', 0.06, 0.12, {ramp: 600, reverb: 0.25}); },
    'equip':           function() { tap(720, 0.06, 0.06, {harmonic: 2.0}); },
    'tab-flip':        function() { sweep(450, 950, 0.03, 0.12); },
    'badge-pop':       function() { bubble(1800, 0.018, 0.04); tap(1200, 0.03, 0.03); },
    'count-up':        function() { osc(880, 'sine', 0.015, 0.04, {ramp: 1100}); },
    'count-down':      function() { osc(1100, 'sine', 0.015, 0.04, {ramp: 880}); },
    'sparkle':         function() { bell(1200, 0.04, 0.20); },
    'sparkle-double':  function() { bell(1000, 0.03, 0.15); bell(1400, 0.03, 0.18); },
    'whoosh-fast':     function() { filterSweep(400, 6000, 4, 0.03, 0.16); },
    'thud':            function() { impact(120, 0.06, 0.14, {metal: false}); },
    'thud-heavy':      function() { impact(80, 0.09, 0.20, {metal: false}); },
    'pop':             function() { bubble(600, 0.025, 0.045); },
    'pop-high':        function() { bubble(1200, 0.018, 0.035); },
    'blip':            function() { osc(1500, 'sine', 0.012, 0.03); },
    'blip-double':     function() { osc(1200, 'sine', 0.012, 0.025); osc(1600, 'sine', 0.01, 0.025); },
    'warp-in':         function() { sweep(2000, 300, 0.06, 0.24); },
    'warp-out':        function() { sweep(300, 2000, 0.06, 0.24); },
    'confirm':         function() { seq([660, 880], 'triangle', 0.06, 0.08, 0.22); },
    'cancel':          function() { seq([440, 330], 'triangle', 0.05, 0.10, 0.18); },
    'type-click':      function() { osc(2000, 'sine', 0.005, 0.015); },
    'type-enter':      function() { osc(600, 'sine', 0.015, 0.05, {ramp: 900, reverb: 0.15}); },
    'glitch':          function() { noise(0.08, 0.07); osc(300, 'square', 0.03, 0.06); osc(800, 'square', 0.02, 0.04); },
    'scan':            function() { sweep(400, 2000, 0.03, 0.12); },

    // --- 氛围音效 ---
    'ping':            function() { osc(1800, 'sine', 0.025, 0.10, {reverb: 0.4}); },
    'pulse':           function() { osc(200, 'sine', 0.03, 0.18, {filterFreq: 600, filterType: 'lowpass', reverb: 0.5}); },
    'ambient-hit':     function() { chord([330, 440, 554], 'sine', 0.04, 0.30, 0.03, {reverb: 0.5}); },
    'shimmer':         function() { bell(600, 0.04, 0.35); bell(900, 0.03, 0.30); },
  };

  // === 稀有变体：约 3% 概率触发更华丽的版本 ===
  var RARE = {
    'btn-click':      function() { seq([800, 1000, 1200], 'triangle', 0.04, 0.04, 0.14); },
    'btn-primary':    function() { tap(1100, 0.07, 0.06, {harmonic: 2.8}); bell(1300, 0.03, 0.12); },
    'toast-ok':       function() { seq([523, 659, 784, 1047], 'sine', 0.06, 0.06, 0.34); },
    'toast-info':     function() { sweep(500, 1200, 0.04, 0.18); osc(900, 'sine', 0.03, 0.12, {reverb: 0.3}); },
    'task-done':      function() { chord([330, 440, 554, 659], 'triangle', 0.07, 0.40, 0.02); },
    'task-add':       function() { tap(720, 0.06, 0.06); bell(900, 0.03, 0.15); },
    'modal-open':     function() { chord([261, 329, 392, 523], 'triangle', 0.08, 0.30, 0.01); sweep(200, 600, 0.04, 0.15); },
    'startup':        function() { chord([261, 330, 392, 523, 659], 'triangle', 0.07, 0.44, 0.02); },
    'note-save':      function() { seq([660, 880, 1100], 'triangle', 0.05, 0.08, 0.28); bell(880, 0.04, 0.18); },
    'file-upload':    function() { sweep(250, 900, 0.06, 0.30); seq([660, 880], 'triangle', 0.04, 0.12, 0.24); },
    'pomo-done':      function() { bell(523, 0.09, 0.40); seq([523, 659, 784, 1047, 1319], 'sine', 0.05, 0.10, 0.50); },
    'easter-egg':     function() { chord([261, 330, 392, 523, 659, 784], 'sine', 0.05, 0.60, 0.02); },
  };

  // === 别名：保持向后兼容，旧名称映射到新名称 ===
  var ALIAS = {
    'nav-tap': 'nav-click',
    'wp-set': 'wallpaper-set',
    'wp-random': 'wallpaper-rand',
    'wp-carousel': 'wallpaper-carousel',
    'read-close': 'reader-close',
    'read-open': 'reader-open',
    'read-page': 'reader-page',
    'scrape-go': 'scrape-start',
    'tl-go': 'translate-go',
    'tl-swap': 'translate-swap',
    'tl-save': 'translate-save',
    'file-newdir': 'file-new-folder',
  };

  // === 公开 API ===
  window.Yiwei = window.Yiwei || {};
  window.Yiwei.sound = {
    play: function(name) {
      if (!enabled || vol <= 0) return;
      // 别名解析
      var key = ALIAS[name] || name;

      // 组合计数器：600ms 内重复同一音效逐渐升级
      var now = Date.now();
      var cs = comboState[key] || { count: 0, last: 0 };
      if (now - cs.last < 600) { cs.count++; } else { cs.count = 0; }
      cs.last = now;
      comboState[key] = cs;

      // 选择音效函数：稀有>组合升级>基础
      var fn = null;
      if (Math.random() < 0.03 && RARE[key]) {
        fn = RARE[key]; // 3% 稀有变体
      } else if (cs.count >= 12 && S['rare-jingle']) {
        fn = S['rare-jingle']; cs.count = 0; // 12连击触发特殊音效
      } else if (cs.count >= 6 && (key === 'btn-click' || key === 'tick')) {
        fn = S['pop'] || S[key]; // 6连击升级
      } else {
        fn = S[key];
      }
      if (!fn) return;

      try {
        // 确保 AudioContext 在用户手势后已初始化
        if (!ctx || ctx.state === 'closed') init();
        if (ctx.state === 'suspended') ctx.resume();
        fn();
      } catch(e) {
        // 静默：防止 AudioContext 创建限制导致崩溃
      }
    },
    toggle: function() { enabled = !enabled; save(); if (enabled) { try { c(); } catch(e) {} } return enabled; },
    setVolume: function(x) { vol = Math.max(0, Math.min(1, x)); save(); if (masterGain) masterGain.gain.value = vol; return vol; },
    isEnabled: function() { return enabled; },
    getVolume: function() { return vol; },
    // 供面板脚本调用：确保 AudioContext 已初始化
    init: function() { try { c(); } catch(e) {} },
    // 同步浮动面板 UI（供 core.js 复选框变更时调用）
    syncWidget: function() {
      var w = document.getElementById('soundWidget');
      var pb = document.getElementById('soundPowerBtn');
      var vf = document.getElementById('soundVolFill');
      var vn = document.getElementById('soundVolNum');
      var pct = Math.round(vol * 100);
      if (w) { if (enabled) w.classList.remove('muted'); else w.classList.add('muted'); }
      if (pb) { if (enabled) pb.classList.add('on'); else pb.classList.remove('on'); }
      if (vf) vf.style.width = pct + '%';
      if (vn) vn.textContent = pct;
    },
  };

  // ===== 音效控制面板 UI（复古游戏风格）=====
  function initSoundWidget() {
    var widget = document.getElementById('soundWidget');
    var toggle = document.getElementById('soundToggle');
    var panel = document.getElementById('soundPanel');
    var powerBtn = document.getElementById('soundPowerBtn');
    var volTrack = document.getElementById('soundVolTrack');
    var volFill = document.getElementById('soundVolFill');
    var volNum = document.getElementById('soundVolNum');

    if (!widget || !toggle) return;

    // --- 状态同步 ---
    function syncUI() {
      var pct = Math.round(vol * 100);
      if (enabled) {
        widget.classList.remove('muted');
        powerBtn.classList.add('on');
      } else {
        widget.classList.add('muted');
        powerBtn.classList.remove('on');
      }
      if (volFill) { volFill.style.width = pct + '%'; }
      if (volNum) { volNum.textContent = pct; }
      // 同步自定义弹窗的复选框
      var cb = document.getElementById('cfg-sound');
      if (cb) cb.checked = enabled;
    }

    // --- 面板开关 ---
    toggle.addEventListener('click', function(e) {
      e.stopPropagation();
      Yiwei.sound.init();
      // 首次打开面板时同步 UI
      syncUI();
      panel.classList.toggle('open');
      Yiwei.sound.play(panel.classList.contains('open') ? 'modal-open' : 'modal-close');
    });

    // 点击外部关闭
    document.addEventListener('click', function(e) {
      if (panel.classList.contains('open') && !widget.contains(e.target)) {
        panel.classList.remove('open');
      }
    });

    // --- 电源按钮 ---
    powerBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      enabled = !enabled;
      save();
      syncUI();
      Yiwei.sound.play(enabled ? 'btn-toggle-on' : 'btn-toggle-off');
    });

    // --- 音量拖动 ---
    function setVolFromEvent(e) {
      var rect = volTrack.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      var pct = Math.max(0, Math.min(1, x / rect.width));
      vol = Math.round(pct * 100) / 100; // 2 位精度
      save();
      if (masterGain) masterGain.gain.value = vol;
      syncUI();
    }

    volTrack.addEventListener('mousedown', function(e) {
      e.preventDefault();
      setVolFromEvent(e);
      Yiwei.sound.play('tick');

      function onMove(ev) { setVolFromEvent(ev); }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    volTrack.addEventListener('touchstart', function(e) {
      e.preventDefault();
      setVolFromEvent(e);
      Yiwei.sound.play('tick');

      function onMove(ev) { setVolFromEvent(ev); }
      function onEnd() {
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
      }
      document.addEventListener('touchmove', onMove, {passive: false});
      document.addEventListener('touchend', onEnd);
    });

    // --- 音量 ± 按钮 ---
    var volBtns = document.querySelectorAll('.sound-vol-btn');
    volBtns.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var dir = parseInt(btn.getAttribute('data-dir'));
        vol = Math.max(0, Math.min(1, Math.round((vol + dir * 0.05) * 100) / 100));
        save();
        if (masterGain) masterGain.gain.value = vol;
        syncUI();
        Yiwei.sound.play('tick');
      });
    });

    // --- 试听按钮 ---
    var testBtns = document.querySelectorAll('.sound-test-btn');
    testBtns.forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var name = btn.getAttribute('data-sound');
        if (!name || !enabled) return;
        Yiwei.sound.init();
        Yiwei.sound.play(name);
        // 按钮高亮闪烁
        btn.classList.add('flash');
        setTimeout(function() { btn.classList.remove('flash'); }, 150);
      });
    });

    // --- 初始同步 ---
    syncUI();

    // --- 拖拽移动 ---
    var dragKey = 'yiwei_sound_pos';
    var saved = (function() {
      try { return JSON.parse(localStorage.getItem(dragKey)); } catch(e) { return null; }
    })();
    if (saved && saved.x !== null) {
      widget.style.left = saved.x + 'px';
      widget.style.top = saved.y + 'px';
      widget.style.right = 'auto';
    }

    var dragging = false, dsx, dsy, dox, doy, dmoved;
    function dragDown(e) {
      if (e.target.closest('.sound-panel')) return;
      dragging = true; dmoved = 0;
      var pt = e.touches ? e.touches[0] : e;
      dsx = pt.clientX; dsy = pt.clientY;
      var r = widget.getBoundingClientRect();
      dox = r.left; doy = r.top;
      document.body.classList.add('resizing');
      widget.style.transition = 'none';
    }
    function dragMove(e) {
      if (!dragging) return;
      var pt = e.touches ? e.touches[0] : e;
      dmoved += Math.abs(pt.clientX - dsx) + Math.abs(pt.clientY - dsy);
      if (dmoved < 3) return;
      widget.style.left = Math.max(4, Math.min(window.innerWidth - 40, dox + pt.clientX - dsx)) + 'px';
      widget.style.top = Math.max(4, Math.min(window.innerHeight - 40, doy + pt.clientY - dsy)) + 'px';
      widget.style.right = 'auto';
    }
    function dragUp() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing');
      widget.style.transition = '';
      var r = widget.getBoundingClientRect();
      localStorage.setItem(dragKey, JSON.stringify({ x: r.left, y: r.top }));
    }
    toggle.addEventListener('mousedown', dragDown);
    toggle.addEventListener('touchstart', dragDown, { passive: false });
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragUp);
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('touchend', dragUp);
  }

  // DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSoundWidget);
  } else {
    initSoundWidget();
  }

})();
