// ===== 背景音乐播放器 — 播放本地音频文件 =====
window.Yiwei = window.Yiwei || {};
(function() {
  'use strict';

  var STORAGE_KEY = 'yiwei_ambient';
  var state = { current: -1, playlist: [], volume: 80, x: null, y: null };
  try { var s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (s) Object.assign(state, s); } catch {}

  var audio = new Audio();
  audio.volume = state.volume / 100;
  audio.loop = false;
  audio.addEventListener('ended', nextTrack);
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('play', function() { updatePlayBtn(); });
  audio.addEventListener('pause', function() { updatePlayBtn(); });

  var el, panel, playBtn, progressBar, timeEl, titleEl, playlistEl, volSlider;

  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }

  // ---- 播放控制 ----
  function loadTrack(idx) {
    if (idx < 0 || idx >= state.playlist.length) { audio.src = ''; state.current = -1; updateUI(); save(); return; }
    state.current = idx;
    var f = state.playlist[idx];
    audio.src = '/api/stream/' + encodeURIComponent(f.name) + '?q=orig';
    audio.play().catch(function() {});
    updateUI();
    save();
  }

  function playPause() {
    if (!audio.src && state.playlist.length) { loadTrack(0); return; }
    if (audio.paused) audio.play().catch(function(){});
    else audio.pause();
  }

  function nextTrack() {
    if (!state.playlist.length) return;
    loadTrack((state.current + 1) % state.playlist.length);
  }
  function prevTrack() {
    if (!state.playlist.length) return;
    loadTrack(state.current <= 0 ? state.playlist.length - 1 : state.current - 1);
  }

  function setVolume(val) {
    state.volume = parseInt(val);
    audio.volume = state.volume / 100;
    save();
  }

  function seekTo(e) {
    if (!audio.duration) return;
    var rect = e.target.getBoundingClientRect();
    var pct = (e.clientX - rect.left) / rect.width;
    audio.currentTime = pct * audio.duration;
  }

  function updatePlayBtn() {
    if (playBtn) playBtn.innerHTML = audio.paused ? '<span class="mi">play_arrow</span>' : '<span class="mi">pause</span>';
  }
  function updateProgress() {
    if (!progressBar || !audio.duration) return;
    var pct = (audio.currentTime / audio.duration) * 100;
    progressBar.style.width = pct + '%';
    if (timeEl) timeEl.textContent = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
  }
  function fmtTime(s) { var m = Math.floor(s / 60), sec = Math.floor(s % 60); return m + ':' + String(sec).padStart(2, '0'); }

  // ---- UI ----
  function updateUI() {
    if (titleEl && state.current >= 0 && state.playlist[state.current]) {
      titleEl.textContent = state.playlist[state.current].name;
    } else if (titleEl) {
      titleEl.textContent = '未选择音乐';
    }
    updatePlayBtn();
    updateProgress();
    if (volSlider) volSlider.value = state.volume;
    renderPlaylist();
  }

  function renderPlaylist() {
    if (!playlistEl) return;
    playlistEl.innerHTML = state.playlist.map(function(f, i) {
      return '<div class="ambient-pl-item' + (i === state.current ? ' active' : '') + '" onclick="Yiwei.ambient.playIdx(' + i + ')">' +
        '<span class="ambient-pl-name">' + escHtml(f.name) + '</span>' +
        '<button class="ambient-pl-del" onclick="event.stopPropagation();Yiwei.ambient.removeIdx(' + i + ')">✕</button>' +
        '</div>';
    }).join('') || '<div class="ambient-pl-empty">点击 + 从文件添加音乐</div>';
  }

  function togglePanel(e) {
    if (e.target.closest('.ambient-panel') || e.target.closest('#ambientFileModal')) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) updateUI();
  }

  // ---- 文件选择 ----
  var filePickerDir = '';
  function openFilePicker() { filePickerDir = ''; document.getElementById('ambientFileModal').classList.add('show'); loadAmbientFiles(); }
  function closeFilePicker() { document.getElementById('ambientFileModal').classList.remove('show'); }
  function filePickerNav(dir) { filePickerDir = dir || ''; loadAmbientFiles(); }

  async function loadAmbientFiles() {
    var list = document.getElementById('ambientFileList');
    if (!list) return;
    list.innerHTML = '<div style="text-align:center;padding:1rem;color:var(--sub);">加载中...</div>';
    try {
      var p = new URLSearchParams(); if (filePickerDir) p.set('dir', filePickerDir);
      var data = await (await fetch('/api/files?' + p.toString())).json();
      var files = data.files || [];
      var crumbs = data.breadcrumb || [];
      var bc = document.getElementById('ambientFileCrumbs');
      if (bc) bc.innerHTML = crumbs.map(function(c, i) {
        var sep = i > 0 ? ' / ' : '';
        return i === crumbs.length - 1 ? sep + '<span style="color:var(--accent);">' + escHtml(c.name) + '</span>' :
          sep + '<a href="#" onclick="Yiwei.ambient.filePickerNav(\'' + escAttr(c.path) + '\');return false;">' + escHtml(c.name) + '</a>';
      }).join('');

      var audioExts = ['mp3','wav','ogg','flac','aac','m4a','wma','opus'];
      var dirs = files.filter(function(f) { return f.isDir; });
      var audioFiles = files.filter(function(f) { return !f.isDir && audioExts.includes((f.name.split('.').pop()||'').toLowerCase()); });

      var html = dirs.map(function(d) {
        return '<div class="file-row" style="cursor:pointer;" onclick="Yiwei.ambient.filePickerNav(\'' + escAttr(d.relPath) + '\')"><span class="fname"><span class="mi">folder</span> ' + escHtml(d.name) + '</span></div>';
      }).join('');
      html += audioFiles.map(function(f) {
        return '<div class="file-row" style="cursor:pointer;" onclick="Yiwei.ambient.addFile(\'' + escAttr(JSON.stringify({name: f.name, relPath: f.relPath}).replace(/'/g,"\\'")) + '\')"><span class="fname"><span class="mi" style="color:var(--accent2);">music_note</span> ' + escHtml(f.name) + '</span><span class="fsize">' + (f.size > 1048576 ? (f.size/1048576).toFixed(1)+'MB' : (f.size/1024).toFixed(1)+'KB') + '</span></div>';
      }).join('');

      list.innerHTML = html || '<div style="text-align:center;padding:2rem;color:var(--sub);">此目录无音频文件</div>';
    } catch(e) { list.innerHTML = '<div style="color:var(--danger);text-align:center;">加载失败</div>'; }
  }

  function addFile(jsonStr) {
    var f = JSON.parse(jsonStr);
    // 去重
    if (state.playlist.some(function(p) { return p.name === f.name; })) { toast?.('已在列表中', 'info'); return; }
    state.playlist.push(f);
    save();
    updateUI();
    closeFilePicker();
    if (state.current < 0) loadTrack(0);
    toast?.('✅ 已添加: ' + f.name, 'success');
  }

  function playIdx(i) { loadTrack(i); }
  function removeIdx(i) {
    state.playlist.splice(i, 1);
    if (state.current === i) { audio.pause(); audio.src = ''; state.current = -1; }
    else if (state.current > i) state.current--;
    save();
    updateUI();
    if (state.current < 0 && state.playlist.length) loadTrack(0);
  }

  // ---- 拖拽 ----
  function initDrag() {
    var active = false, sx, sy, ox, oy, moved = 0;
    function down(e) {
      if (e.target.closest('.ambient-panel') || e.target.closest('#ambientFileModal')) return;
      active = true; moved = 0;
      var pt = e.touches ? e.touches[0] : e; sx = pt.clientX; sy = pt.clientY;
      var r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
      document.body.classList.add('resizing'); el.style.transition = 'none';
    }
    function move(e) {
      if (!active) return;
      var pt = e.touches ? e.touches[0] : e;
      moved += Math.abs(pt.clientX - sx) + Math.abs(pt.clientY - sy);
      if (moved < 4) return;
      el.style.left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, ox + pt.clientX - sx)) + 'px';
      el.style.top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, oy + pt.clientY - sy)) + 'px';
      el.style.right = 'auto';
    }
    function up() { if (!active) return; active = false; document.body.classList.remove('resizing'); el.style.transition = ''; var r = el.getBoundingClientRect(); state.x = r.left; state.y = r.top; save(); }
    el.addEventListener('mousedown', down); document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    el.addEventListener('touchstart', down, { passive: false }); document.addEventListener('touchmove', move, { passive: false }); document.addEventListener('touchend', up);
  }

  document.addEventListener('click', function(e) { if (!el.contains(e.target) && !document.getElementById('ambientFileModal').contains(e.target)) panel.classList.remove('open'); });

  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function escAttr(s) { return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;'); }

  // ---- 初始化 ----
  function init() {
    el = document.getElementById('ambientWidget');
    panel = document.getElementById('ambientPanel');
    playBtn = document.getElementById('ambientPlayBtn');
    progressBar = document.getElementById('ambientProgressFill');
    timeEl = document.getElementById('ambientTime');
    titleEl = document.getElementById('ambientTitle');
    playlistEl = document.getElementById('ambientPlaylist');
    volSlider = document.getElementById('ambientVolume');
    if (!el) return;

    if (state.x !== null) { el.style.left = state.x + 'px'; el.style.top = state.y + 'px'; }

    el.querySelector('.ambient-toggle').addEventListener('click', togglePanel);
    playBtn.addEventListener('click', function(e) { e.stopPropagation(); playPause(); });
    document.getElementById('ambientPrevBtn').addEventListener('click', function(e) { e.stopPropagation(); prevTrack(); });
    document.getElementById('ambientNextBtn').addEventListener('click', function(e) { e.stopPropagation(); nextTrack(); });
    document.getElementById('ambientProgressTrack').addEventListener('click', function(e) { e.stopPropagation(); seekTo(e); });
    volSlider.addEventListener('input', function() { setVolume(volSlider.value); });
    volSlider.addEventListener('click', function(e) { e.stopPropagation(); });
    document.getElementById('ambientAddBtn').addEventListener('click', function(e) { e.stopPropagation(); openFilePicker(); });

    updateUI();
    initDrag();

    window.Yiwei.ambient = { playIdx: playIdx, removeIdx: removeIdx, filePickerNav: filePickerNav, addFile: addFile };
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
  else { init(); }
})();
