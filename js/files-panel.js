// ===== 文件 =====
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); Yiwei.sound.play('file-drop'); uploadFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });

function formatSpeed(bytesPerSec) {
  if (bytesPerSec < 1024) return Math.round(bytesPerSec) + 'B/s';
  if (bytesPerSec < 1024*1024) return (bytesPerSec/1024).toFixed(1)+'KB/s';
  return (bytesPerSec/1024/1024).toFixed(1)+'MB/s';
}
function formatETA(seconds) {
  if (seconds < 60) return Math.round(seconds)+'秒';
  if (seconds < 3600) return Math.round(seconds/60)+'分'+Math.round(seconds%60)+'秒';
  return Math.round(seconds/3600)+'时'+Math.round((seconds%3600)/60)+'分';
}

async function uploadFiles(fileList) {
  if (!fileList.length) return;
  const files = Array.from(fileList);
  const uploadUrl = '/api/files' + (currentDir ? '?dir=' + encodeURIComponent(currentDir) : '');
  const CONCUR = 3;

  // Build progress UI
  const container = document.getElementById('uploadProgress');
  container.innerHTML = '<div class="upload-progress-header"><strong>📤 上传中…</strong><span class="upload-summary" style="color:var(--sub);font-size:.72rem;"></span></div>';
  const summaryEl = container.querySelector('.upload-summary');

  const trackers = files.map(f => {
    const div = document.createElement('div');
    div.className = 'upload-file-progress';
    div.innerHTML = '<div class="ufp-top"><span class="ufp-name">' + escHtml(f.name) + '</span><span class="ufp-info">等待中</span></div><div class="ufp-bar-track"><div class="ufp-bar-fill"></div></div>';
    container.appendChild(div);
    return { file: f, bar: div.querySelector('.ufp-bar-fill'), info: div.querySelector('.ufp-info') };
  });

  // Upload one file via XHR with progress
  const uploadOne = (tracker) => new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', tracker.file);

    let startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;
    let speedSamples = [];

    xhr.upload.addEventListener('progress', e => {
      if (!e.lengthComputable) return;
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      if (dt < 0.2) return; // throttle to ~5 updates/sec
      const dl = e.loaded - lastLoaded;
      const speed = dt > 0 ? dl / dt : 0;
      speedSamples.push(speed);
      if (speedSamples.length > 10) speedSamples.shift();
      const avgSpeed = speedSamples.reduce((a,b)=>a+b,0) / speedSamples.length;

      const pct = Math.round((e.loaded / e.total) * 100);
      const remaining = avgSpeed > 0 ? (e.total - e.loaded) / avgSpeed : 0;

      tracker.bar.style.width = pct + '%';
      tracker.info.textContent = pct + '% · ' + formatSpeed(avgSpeed) + ' · 剩余' + formatETA(remaining);
      lastLoaded = e.loaded;
      lastTime = now;
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        tracker.bar.style.width = '100%';
        tracker.bar.classList.add('done');
        tracker.info.textContent = '✅ 完成';
        resolve(true);
      } else {
        let errMsg = '❌ HTTP ' + xhr.status;
        try { const r = JSON.parse(xhr.responseText); if (r.error) errMsg = '❌ ' + r.error; } catch(e) {}
        tracker.info.textContent = errMsg;
        tracker.bar.classList.add('error');
        resolve(false);
      }
    });

    xhr.addEventListener('error', () => {
      tracker.info.textContent = '❌ 网络错误';
      tracker.bar.classList.add('error');
      resolve(false);
    });

    xhr.addEventListener('abort', () => {
      tracker.info.textContent = '⏹ 已取消';
      resolve(false);
    });

    xhr.open('POST', uploadUrl);
    xhr.send(form);
  });

  let ok = 0;
  for (let i = 0; i < trackers.length; i += CONCUR) {
    const batch = trackers.slice(i, i + CONCUR);
    const results = await Promise.all(batch.map(uploadOne));
    results.forEach(r => { if (r === true) ok++; });
    summaryEl.textContent = ok + '/' + files.length + ' 完成';
    await updateStorageBar();
  }

  // Keep progress visible briefly then clear
  setTimeout(() => { container.innerHTML = ''; }, 1500);
  if (ok > 0) toast('✅ ' + ok + ' 个文件上传成功');
  const failed = files.length - ok;
  if (failed > 0) toast('⚠️ ' + failed + ' 个上传失败', 'error');
  loadFiles();
}

// ===== 文件模块（支持目录导航；根目录 = 文件站根，取消 home 虚拟层）=====
let currentDir = '';

function navigateTo(dir) {
  if (!dir || dir === '.' || dir === '/') {
    currentDir = '';
  } else if (dir === '..') {
    // 正常向上，不越过根
    if (currentDir) currentDir = currentDir.split('/').slice(0, -1).join('/');
  } else {
    currentDir = dir.replace(/^\/+/, '');
  }
  loadFiles();
}

async function loadFiles() {
  try {
    const params = new URLSearchParams();
    if (currentDir) params.set('dir', currentDir);
    const resp = await (await fetch('/api/files?' + params.toString())).json();
    const files = resp.files || [];
    const crumbs = resp.breadcrumb || [];
    currentDir = resp.currentDir || '';

    // 面包屑（可点击跳转）
    const bc = document.getElementById('fileBreadcrumb');
    bc.innerHTML = crumbs.map((c, i) => {
      const sep = i > 0 ? '<span style="color:var(--sub);margin:0 .1rem;">/</span>' : '';
      const isLast = i === crumbs.length - 1;
      const clickable = !isLast ? 'style="color:var(--accent);cursor:pointer;text-decoration:none;" onmouseenter="this.style.textDecoration=\'underline\'" onmouseleave="this.style.textDecoration=\'none\'" onclick="event.preventDefault();navigateTo(\'' + escAttr(c.path) + '\')"' : 'style="font-weight:600;color:var(--text);"';
      const drag = !isLast ? `ondragover="event.preventDefault();event.currentTarget.style.outline='2px solid var(--accent)'" ondragleave="event.currentTarget.style.outline=''" ondrop="event.currentTarget.style.outline='';handleDrop(event, '${escAttr(c.path)}')"` : '';
      return sep + '<span ' + drag + ' ' + clickable + '>' + escHtml(c.name) + '</span>';
    }).join('');

    // 搜索过滤 — 碎片匹配（fuzzy）: 每个字符按顺序出现即可匹配
    const q = (document.getElementById('fileSearch')?.value || '').trim().toLowerCase();
    let filtered = files;
    if (q) {
      filtered = files.filter(function(f) {
        var name = f.name.toLowerCase(), qi = 0;
        for (var i = 0; i < name.length && qi < q.length; i++) {
          if (name[i] === q[qi]) qi++;
        }
        return qi === q.length;
      });
    }

    // 排序
    const sort = document.getElementById('fileSort')?.value || 'date-desc';
    const sorters = {
      'date-desc': (a,b) => new Date(b.mtime) - new Date(a.mtime),
      'date-asc': (a,b) => new Date(a.mtime) - new Date(b.mtime),
      'name-asc': (a,b) => a.name.localeCompare(b.name),
      'name-desc': (a,b) => b.name.localeCompare(a.name),
      'size-desc': (a,b) => b.size - a.size,
      'size-asc': (a,b) => a.size - b.size,
    };
    filtered.sort(sorters[sort] || sorters['date-desc']);

    const list = document.getElementById('fileList'), empty = document.getElementById('filesEmpty');
    if (!filtered.length) { list.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const sz = b => b < 1024 ? b + 'B' : b < 1024*1024 ? (b/1024).toFixed(1)+'KB' : b < 1024*1024*1024 ? (b/1024/1024).toFixed(1)+'MB' : (b/1024/1024/1024).toFixed(2)+'GB';

    list.innerHTML = filtered.map((f, idx) => {
      if (f.isDir) {
        return `
        <div class="file-row" data-index="${idx}" style="cursor:default;"
             onclick="handleFileClick(event, this, 'navigateTo', '${escAttr(f.relPath)}')"
             ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${escAttr(f.relPath)}')">
          <input type="checkbox" class="file-check" data-name="${escAttr(f.relPath)}" onclick="event.stopPropagation();updateBatchBar();updateSelectionVisuals();" style="flex-shrink:0;">
          <span class="fname"><span class="fname-text" title="点击进入目录"><span class="mi" style="font-size:14px;vertical-align:middle;">folder</span> ${escHtml(f.name)}</span></span>
          <span class="fsize"></span>
          <span class="fsize">${new Date(f.mtime).toLocaleDateString('zh-CN')}</span>
          <div class="actions" onclick="event.stopPropagation();">
            <button class="btn-sm" onclick="renameFolder('${escAttr(f.relPath)}')">✏️</button>
            <button class="btn-sm danger" onclick="deleteFolder('${escAttr(f.relPath)}')">🗑</button>
          </div>
        </div>`;
      }
      return `
        <div class="file-row" data-index="${idx}" style="cursor:default;"
             onclick="handleFileClick(event, this, 'previewFile', '${escAttr(f.relPath)}')">
          <input type="checkbox" class="file-check" data-name="${escAttr(f.relPath)}" onclick="event.stopPropagation();updateBatchBar();updateSelectionVisuals();" style="flex-shrink:0;">
          <span class="fname"><span class="fname-text"
                draggable="true" ondragstart="handleDragStart(event, '${escAttr(f.relPath)}')" ondragend="handleDragEnd(event)" title="点击预览 · 拖拽移动"><span class="mi" style="font-size:14px;vertical-align:middle;">description</span> ${escHtml(f.name)}</span></span>
          <span class="fsize">${f.isDir ? '' : sz(f.size)}</span>
          <span class="fsize">${new Date(f.mtime).toLocaleDateString('zh-CN')}</span>
          <div class="actions" onclick="event.stopPropagation();">
            <button class="btn-sm" onclick="copyLink('${escAttr(f.relPath)}')">复制链接</button>
            <button class="btn-sm" onclick="downloadFile('${escAttr(f.relPath)}')">下载</button>
            ${/\.(mp4|webm|mov|mkv|avi|flv|wmv|m4v)$/i.test(f.name) ? `<button class="btn-sm" style="color:var(--accent2);" onclick="extractAudio('${escAttr(f.relPath)}')">提取音频</button>` : ''}
            <button class="btn-sm danger" onclick="delFile('${escAttr(f.relPath)}')">删除</button>
          </div>
        </div>`;
    }).join('');

    // 网格视图
    const grid = document.getElementById('fileGrid');
    const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico'];
    grid.innerHTML = filtered.map((f, idx) => {
      if (f.isDir) {
        return `<div class="file-card" data-index="${idx}"
             onclick="handleFileClick(event, this, 'navigateTo', '${escAttr(f.relPath)}')"
             ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${escAttr(f.relPath)}')"
             oncontextmenu="showFileMenu(event, '${escAttr(f.relPath)}', true);return false;">
          <input type="checkbox" class="file-card-check" data-name="${escAttr(f.relPath)}" onclick="event.stopPropagation();updateBatchBar();updateSelectionVisuals();">
          <div class="file-card-icon"><span class="mi" style="font-size:24px;">folder</span></div>
          <div class="file-card-name" title="点击进入目录">${escHtml(f.name)}</div>
        </div>`;
      }
      const ext = (f.name||'').split('.').pop().toLowerCase();
      const isImg = imgExts.includes(ext);
      const preview = isImg ? `<img src="/api/view/${encodeURIComponent(f.relPath)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">` : `<div class="file-card-icon"><span class="mi" style="font-size:24px;">description</span></div>`;
      return `<div class="file-card" data-index="${idx}"
             onclick="handleFileClick(event, this, 'previewFile', '${escAttr(f.relPath)}')"
             oncontextmenu="showFileMenu(event, '${escAttr(f.relPath)}', false);return false;">
        <input type="checkbox" class="file-card-check" data-name="${escAttr(f.relPath)}" onclick="event.stopPropagation();updateBatchBar();updateSelectionVisuals();">
        <div class="file-card-preview" draggable="true"
             ondragstart="handleDragStart(event, '${escAttr(f.relPath)}')" ondragend="handleDragEnd(event)">${preview}</div>
        <div class="file-card-name" title="点击预览">${escHtml(f.name)}</div>
        <div class="file-card-size" style="display:flex;align-items:center;justify-content:space-between;">
          <span>${sz(f.size)}</span>
          ${/\.(mp4|webm|mov|mkv|avi|flv|wmv|m4v)$/i.test(f.name) ? `<button class="btn-sm" style="color:var(--accent2);font-size:.58rem;padding:.1rem .3rem;" onclick="event.stopPropagation();extractAudio('${escAttr(f.relPath)}')">提取音频</button>` : ''}
        </div>
      </div>`;
    }).join('');

    // 初始化视图模式
    if (fileViewMode === 'grid') {
      document.getElementById('fileList').style.display = 'none';
      document.getElementById('fileGrid').style.display = '';
    }
  } catch(e) { console.error(e); }
}

// ===== 文件预览 =====
async function previewFile(name) {
  const modal = document.getElementById('previewModal');
  const title = document.getElementById('previewTitle');
  const body = document.getElementById('previewBody');
  title.textContent = name;
  body.innerHTML = '<div class="file-info"><div class="fi-icon"><span class="mi" style="font-size:2rem;animation:spin 1s linear infinite;">refresh</span></div>加载中...</div>';
  modal.classList.add('show');
  Yiwei.sound.play('modal-open');

  const ext = name.split('.').pop().toLowerCase();
  const imgExts = ['jpg','jpeg','png','gif','webp','svg','ico','bmp'];

  if (imgExts.includes(ext)) {
    body.innerHTML = `
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.8rem;flex-wrap:wrap;">
        <span style="font-weight:600;color:var(--accent);">🖼️ ${escHtml(name)}</span>
        <button class="btn-sm" onclick="ocrImage('${escAttr(name)}')" id="ocrBtn">🔍 OCR 识别</button>
        <a href="/api/dl/` + encodeURIComponent(name) + `" class="btn-sm" style="text-decoration:none;">⬇ 下载</a>
      </div>
      <img src="/api/view/` + encodeURIComponent(name) + `" alt="${escHtml(name)}" style="max-width:100%;max-height:70vh;display:block;margin:0 auto;" onerror="this.parentElement.innerHTML='<div class=file-info><div class=fi-icon>❌</div>无法加载图片</div>'">
      <div id="ocrResult" style="margin-top:.8rem;padding:.8rem;background:var(--card);border:1px solid var(--border);border-radius:8px;font-size:.85rem;white-space:pre-wrap;word-break:break-word;display:none;"></div>
    `;
    return;
  }

  if (ext === 'pdf') {
    const dlUrl = location.origin + '/api/dl/' + encodeURIComponent(name);
    body.innerHTML = '<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.8rem;flex-wrap:wrap;"><span style="font-weight:600;color:var(--accent);">📄 ' + escHtml(name) + '</span><a href="' + dlUrl + '" class="btn-sm" style="text-decoration:none;">⬇ 下载</a></div><iframe src="/api/view/' + encodeURIComponent(name) + '" style="width:100%;height:75vh;border:none;border-radius:6px;"></iframe>';
    return;
  }

  const videoExts = ['mp4','webm','mov','avi','mkv'];
  const audioExts = ['mp3','wav','ogg','flac','aac'];
  const docExts = ['doc','docx','xls','xlsx','ppt','pptx'];
  const archiveExts = ['zip','tar','gz','7z','rar'];
  const dlUrl = location.origin + '/api/dl/' + encodeURIComponent(name);

  const mediaBar = '<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.8rem;flex-wrap:wrap;">' +
    '<span style="font-weight:600;color:var(--accent);">🎬 ' + escHtml(name) + '</span>' +
    '<a href="/api/m3u/' + encodeURIComponent(name) + '" class="btn-sm" style="text-decoration:none;background:#f97316;color:#fff;border-color:#f97316;">📺 外部播放器</a>' +
    '<a href="' + dlUrl + '" class="btn-sm" style="text-decoration:none;">⬇ 下载</a>' +
    '</div>';

  if (videoExts.includes(ext)) {
    body.innerHTML = mediaBar + '<video controls style="max-width:100%;max-height:65vh;display:block;margin:0 auto;border-radius:6px;"><source src="/api/view/' + encodeURIComponent(name) + '"></video>';
    return;
  }

  if (audioExts.includes(ext)) {
    body.innerHTML = mediaBar + '<div style="text-align:center;padding:1rem;"><div class="fi-icon" style="font-size:3rem;">🎵</div><audio controls style="width:100%;max-width:400px;margin-top:1rem;"><source src="/api/view/' + encodeURIComponent(name) + '"></audio></div>';
    return;
  }

  // Office 文档 & 归档文件：不支持预览，但可下载
  if (docExts.includes(ext) || archiveExts.includes(ext)) {
    const iconMap = { doc:'📄', docx:'📄', xls:'📊', xlsx:'📊', ppt:'📽️', pptx:'📽️', zip:'📦', tar:'📦', gz:'📦', '7z':'📦', rar:'📦' };
    const icon = iconMap[ext] || '📄';
    body.innerHTML = '<div style="text-align:center;padding:2rem;"><div class="fi-icon" style="font-size:4rem;">' + icon + '</div><p style="margin:1rem 0;color:var(--sub);">' + escHtml(name) + '</p><p style="font-size:.8rem;color:var(--sub);margin-bottom:1rem;">此文件类型不支持在线预览</p><a href="' + dlUrl + '" class="btn accent" style="text-decoration:none;display:inline-block;padding:.5rem 1.5rem;">⬇ 下载文件</a></div>';
    return;
  }

  try {
    const r = await fetch('/api/preview/' + encodeURIComponent(name));
    if (!r.ok) { body.innerHTML = '<div class="file-info"><div class="fi-icon">📄</div>此文件类型不支持预览<br><small>请下载后查看</small></div>'; return; }
    const ct = r.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      const json = await r.json();
      body.innerHTML = '<pre>' + escHtml(JSON.stringify(json, null, 2)) + '</pre>';
      return;
    }
    if (ct.includes('text')) {
      const text = await r.text();
      if (ext === 'md') {
        body.innerHTML = '<div class="preview" style="padding:0;">' + md2html(text) + '</div>';
      } else {
        body.innerHTML = '<pre>' + escHtml(text.slice(0, 200000)) + (text.length > 200000 ? '\n\n... (内容过长，已截断)' : '') + '</pre>';
      }
      return;
    }
    body.innerHTML = '<div class="file-info"><div class="fi-icon">📄</div>此文件类型不支持预览<br><small>请下载后查看</small></div>';
  } catch(e) {
    body.innerHTML = '<div class="file-info"><div class="fi-icon">❌</div>预览失败</div>';
  }
}

function closePreview() {
  Yiwei.sound.play('modal-close');
  document.getElementById('previewModal').classList.remove('show');
}

// 全局键盘快捷键
document.addEventListener('keydown', e => {
  // Escape: 优先关闭预览，其次取消多选
  if (e.key === 'Escape') {
    const previewOpen = document.getElementById('previewModal').classList.contains('show');
    if (previewOpen) { closePreview(); return; }
    deselectAll();
    return;
  }
  // Ctrl/Cmd+A: 文件面板全选（仅在文件面板可见时）
  if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
    if (S && S.currentPanel === 'files') {
      e.preventDefault();
      document.querySelectorAll('.file-check, .file-card-check').forEach(cb => { cb.checked = true; });
      updateBatchBar();
      updateSelectionVisuals();
    }
  }
  // Delete: 批量删除选中文件
  if (e.key === 'Delete' && S && S.currentPanel === 'files') {
    const previewOpen = document.getElementById('previewModal').classList.contains('show');
    const focused = document.activeElement;
    if (!previewOpen && (!focused || focused.tagName === 'BODY')) {
      batchDelete();
    }
  }
  // Space: 预览第一个选中的文件
  if (e.key === ' ' && S && S.currentPanel === 'files') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    const checked = document.querySelectorAll('.file-check:checked, .file-card-check:checked');
    if (checked.length) {
      var name = checked[0].value || checked[0].closest('[data-name]')?.dataset?.name;
      if (name) { if (typeof previewFile === 'function') previewFile(name); }
    }
  }
  // Enter: 下载第一个选中的文件
  if (e.key === 'Enter' && S && S.currentPanel === 'files') {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
    const checked = document.querySelectorAll('.file-check:checked, .file-card-check:checked');
    if (checked.length) {
      e.preventDefault();
      var name = checked[0].value || checked[0].closest('[data-name]')?.dataset?.name;
      if (name) downloadFile(name);
    }
  }
});

function copyLink(name) {
  const url = location.origin + '/api/dl/' + encodeURIComponent(name);
  navigator.clipboard.writeText(url).then(() => toast('📋 链接已复制')).catch(() => toast('❌ 复制失败', 'error'));
}
function downloadFile(name) { window.open('/api/dl/' + encodeURIComponent(name), '_blank'); }
async function extractAudio(name) {
  toast('⏳ 正在提取音频...', 'info');
  try {
    var r = await fetch('/api/extract-audio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) });
    var data = await r.json();
    if (data.name) { toast('✅ 音频已提取: ' + data.name + (data.cached ? ' (已有)' : ''), 'success'); loadFiles(); }
    else toast('❌ ' + (data.error || '提取失败'), 'error');
  } catch(e) { toast('❌ 提取失败', 'error'); }
}
async function delFile(name) {
  if (!confirm(`确定删除「${name}」？`)) return;
  const r = await fetch('/api/files/' + encodeURIComponent(name), { method: 'DELETE' });
  if (r.ok) { toast('🗑️ 已移入回收站'); loadFiles(); updateStorageBar(); } else { toast('❌ 删除失败', 'error'); }
}

// ===== OCR 识别 =====
async function ocrImage(name) {
  const btn = document.getElementById('ocrBtn');
  const resultDiv = document.getElementById('ocrResult');
  btn.disabled = true;
  btn.textContent = '⏳ 识别中...';
  resultDiv.style.display = 'block';
  resultDiv.textContent = '正在识别文字，请稍候...';
  try {
    const r = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await r.json();
    if (data.error) { resultDiv.textContent = '❌ ' + data.error; return; }
    resultDiv.textContent = data.text || '（未识别到文字）';
  } catch(e) {
    resultDiv.textContent = '❌ 请求失败：' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 OCR 识别';
  }
}

// ===== 智能多选 =====
let dragItems = [];
window._lastFileClickIndex = -1;

// 文件项点击：点文件名→预览，点行→选中，Ctrl/Shift→多选
function handleFileClick(event, row, actionType, path) {
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    handleFileRowClick(event, row);
    return;
  }
  // 点击文件名 → 预览/打开（列表用 .fname-text，网格用 .file-card-name）
  if (event.target.closest('.fname-text') || event.target.closest('.file-card-name')) {
    if (actionType === 'navigateTo') { Yiwei.sound.play('file-select'); navigateTo(path); }
    else if (actionType === 'previewFile') { Yiwei.sound.play('file-select'); previewFile(path); }
    return;
  }
  // 点击行/卡片其他区域 → 选中/取消
  handleFileRowClick(event, row);
}

function handleFileRowClick(event, row) {
  const index = parseInt(row.dataset.index);
  if (isNaN(index)) return;
  const isGrid = row.classList.contains('file-card');
  const cb = row.querySelector(isGrid ? '.file-card-check' : '.file-check');
  if (!cb) return;

  // 仅操作当前视图类型的复选框
  const selAll = isGrid ? '.file-card[data-index] .file-card-check' : '.file-row[data-index] .file-check';
  const selParent = isGrid ? '.file-card[data-index]' : '.file-row[data-index]';

  if (event.ctrlKey || event.metaKey) {
    // Ctrl/Cmd+Click: 切换当前项
    cb.checked = !cb.checked;
    window._lastFileClickIndex = index;
  } else if (event.shiftKey && window._lastFileClickIndex >= 0) {
    // Shift+Click: 范围选择（仅当前视图）
    const start = Math.min(window._lastFileClickIndex, index);
    const end = Math.max(window._lastFileClickIndex, index);
    document.querySelectorAll(selAll).forEach(checkbox => {
      const parent = checkbox.closest(selParent.split(' ')[0]);
      const i = parseInt(parent?.dataset.index);
      if (!isNaN(i)) checkbox.checked = (i >= start && i <= end);
    });
  } else {
    // 普通点击: 仅选中当前项，取消其他
    document.querySelectorAll(isGrid ? '.file-card-check' : '.file-check').forEach(c => c.checked = false);
    cb.checked = true;
    window._lastFileClickIndex = index;
  }

  updateBatchBar();
  updateSelectionVisuals();
}

function updateSelectionVisuals() {
  document.querySelectorAll('.file-row, .file-card').forEach(el => {
    const cb = el.querySelector('.file-check, .file-card-check');
    if (cb && cb.checked) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  });
}

function handleDragStart(e, name) {
  // 只取可见视图的选中项
  const listVisible = document.getElementById('fileList').style.display !== 'none';
  const gridVisible = document.getElementById('fileGrid').style.display !== 'none';
  const sel = listVisible ? '.file-check:checked' : '.file-card-check:checked';
  const checked = document.querySelectorAll(sel);
  if (checked.length > 0) {
    dragItems = Array.from(checked).map(cb => cb.dataset.name);
  } else {
    dragItems = [name];
  }
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragItems.join('\n'));
}

function handleDragEnd(e) {
  dragItems = [];
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

async function handleDrop(e, targetDir) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!dragItems.length) return;

  const valid = dragItems.filter(name => {
    const srcDir = name.includes('/') ? name.split('/').slice(0, -1).join('/') : '';
    return srcDir !== targetDir;
  });
  if (!valid.length) return;

  let ok = 0;
  for (const name of valid) {
    try {
      const r = await fetch('/api/files/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, targetDir, overwrite: true }),
      });
      if (r.ok) ok++;
    } catch(e) { console.warn('[Files] move failed', e.message); }
  }
  toast(`✅ ${ok}/${valid.length} 个文件已移动`);
  loadFiles();
}

function getActiveCheckSelector() {
  // 返回当前可见视图的复选框选择器
  const listVisible = document.getElementById('fileList').style.display !== 'none';
  return listVisible ? '.file-check' : '.file-card-check';
}

function getActiveCheckboxes(checkedOnly) {
  const sel = getActiveCheckSelector();
  return document.querySelectorAll(checkedOnly ? sel + ':checked' : sel);
}

function updateBatchBar() {
  const checked = getActiveCheckboxes(true);
  const total = getActiveCheckboxes(false);
  const bar = document.getElementById('batchBar');
  const count = document.getElementById('selectedCount');
  const selectAll = document.getElementById('selectAll');
  if (checked.length > 0) {
    bar.style.display = 'flex';
    count.textContent = '已选 ' + checked.length + ' 个';
    if (selectAll) selectAll.checked = (checked.length === total.length && total.length > 0);
  } else {
    bar.style.display = 'none';
    if (selectAll) selectAll.checked = false;
  }
}

function toggleSelectAll() {
  const all = document.getElementById('selectAll').checked;
  getActiveCheckboxes(false).forEach(cb => { cb.checked = all; });
  window._lastFileClickIndex = all ? 0 : -1;
  updateBatchBar();
  updateSelectionVisuals();
}

function deselectAll() {
  getActiveCheckboxes(false).forEach(cb => { cb.checked = false; });
  window._lastFileClickIndex = -1;
  updateBatchBar();
  updateSelectionVisuals();
}

async function batchDelete() { Yiwei.sound.play("file-delete");
  const checked = getActiveCheckboxes(true);
  if (!checked.length) return;
  if (!confirm(`确定删除选中的 ${checked.length} 个文件？`)) return;
  let ok = 0, fail = 0;
  for (const cb of checked) {
    const r = await fetch('/api/files/' + encodeURIComponent(cb.dataset.name), { method: 'DELETE' });
    if (r.ok) ok++; else fail++;
  }
  toast(`🗑️ ${ok} 个已删除` + (fail ? `，${fail} 个失败` : ''));
  loadFiles(); updateStorageBar();
}

async function batchMove() {
  const checked = getActiveCheckboxes(true);
  if (!checked.length) return;
  const targetDir = prompt('移动到哪个目录？\n（输入路径，如 "images"，留空 = 根目录）', currentDir || '');
  if (targetDir === null) return;
  let ok = 0, fail = 0;
  for (const cb of checked) {
    const name = cb.dataset.name;
    try {
      const r = await fetch('/api/files/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, targetDir: targetDir.trim(), overwrite: true }),
      });
      if (r.ok) ok++; else fail++;
    } catch(e) { fail++; }
  }
  toast(`✅ ${ok} 个已移动` + (fail ? `，${fail} 个失败` : ''));
  if (ok > 0) { loadFiles(); updateStorageBar(); }
}

function batchDownload() { Yiwei.sound.play("file-download");
  const checked = getActiveCheckboxes(true);
  if (!checked.length) return;
  if (checked.length === 1) {
    downloadFile(checked[0].dataset.name);
    return;
  }
  toast('📥 开始下载 ' + checked.length + ' 个文件...');
  checked.forEach((cb, i) => {
    setTimeout(() => downloadFile(cb.dataset.name), i * 300);
  });
}

// ===== 文件夹 & 回收站 =====
let fileViewMode = localStorage.getItem('fileView') || 'list';

function toggleFileView() {
  fileViewMode = fileViewMode === 'list' ? 'grid' : 'list';
  localStorage.setItem('fileView', fileViewMode);
  const btn = document.getElementById('viewToggle');
  const icon = btn.querySelector('.mi');
  icon.textContent = fileViewMode === 'list' ? 'grid_view' : 'list';
  document.getElementById('fileList').style.display = fileViewMode === 'list' ? '' : 'none';
  document.getElementById('fileGrid').style.display = fileViewMode === 'grid' ? '' : 'none';
  loadFiles();
}

function toggleFileTrash() { Yiwei.sound.play("btn-click");
  const drawer = document.getElementById('trashDrawer');
  const visible = drawer.style.display === 'block';
  drawer.style.display = visible ? 'none' : 'block';
  if (!visible) loadTrash();
}

async function createFolder() { Yiwei.sound.play("file-new-folder");
  const name = prompt('请输入文件夹名称:');
  if (!name || !name.trim()) return;
  const folderPath = currentDir ? currentDir + '/' + name.trim() : name.trim();
  const r = await fetch('/api/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: folderPath }) });
  const data = await r.json();
  if (data.error) { toast('❌ ' + data.error); return; }
  toast('✅ 文件夹已创建');
  loadFiles();
}

async function deleteFolder(name) {
  if (!confirm('确定删除文件夹「' + name + '」？内容将移入回收站')) return;
  await fetch('/api/folders/' + encodeURIComponent(name), { method: 'DELETE' });
  toast('🗑️ 文件夹已移入回收站');
  loadFiles(); updateStorageBar();
}

async function renameFolder(name) {
  const newName = prompt('新名称:', name);
  if (!newName || !newName.trim()) return;
  const r = await fetch('/api/folders/rename/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName: newName.trim() }) });
  const data = await r.json();
  if (data.error) { toast('❌ ' + data.error); return; }
  toast('✅ 已重命名');
  loadFiles();
}

async function loadTrash() {
  try {
    const items = await (await fetch('/api/trash')).json();
    const el = document.getElementById('trashList');
    const empty = document.getElementById('trashEmpty');
    const count = document.getElementById('trashCount');
    if (count) count.textContent = items.length + ' 个项目';
    if (!items.length) { el.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    const sz = b => b < 1024 ? b + 'B' : b < 1024*1024 ? (b/1024).toFixed(1)+'KB' : (b/1024*1024).toFixed(1)+'MB';
    el.innerHTML = items.map(f => {
      const displayName = f.name.replace(/^\d+_/, '');
      const ext = displayName.split('.').pop()?.toLowerCase();
      const icon = f.isDir ? '<span class="mi" style="font-size:13px;vertical-align:middle;">folder</span>' : (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext) ? '<span class="mi" style="font-size:13px;vertical-align:middle;">image</span>' : ['mp4','webm','mov','mkv'].includes(ext) ? '<span class="mi" style="font-size:13px;vertical-align:middle;">smart_display</span>' : ['mp3','wav','ogg','flac','aac'].includes(ext) ? '<span class="mi" style="font-size:13px;vertical-align:middle;">music_note</span>' : '<span class="mi" style="font-size:13px;vertical-align:middle;">description</span>');
      return `
        <div class="file-row">
          <span class="fname">${icon} ${escHtml(displayName)}</span>
          <span class="fsize">${f.isDir ? '' : sz(f.size)}</span>
          <span class="fsize">${new Date(f.mtime).toLocaleDateString('zh-CN')}</span>
          <div class="actions">
            <button class="btn-sm" onclick="restoreTrash('${escAttr(f.name)}')">↩ 恢复</button>
          </div>
        </div>`;
    }).join('');
  } catch(e) { console.error(e); }
}

async function emptyTrash() {
  if (!confirm('确定清空回收站？此操作不可恢复！')) return;
  await fetch('/api/trash', { method: 'DELETE' });
  toast('🗑️ 回收站已清空');
  loadTrash(); updateStorageBar();
}

async function restoreTrash(name) {
  const r = await fetch('/api/trash/restore/' + encodeURIComponent(name), { method: 'POST' });
  if (r.ok) { toast('✅ 已恢复'); loadTrash(); loadFiles(); updateStorageBar(); }
  else { toast('❌ 恢复失败', 'error'); }
}

// ===== 文件右键菜单 =====
function showFileMenu(e, name, isDir) {
  e.preventDefault();
  const old = document.querySelector('.file-menu');
  if (old) old.remove();
  const menu = document.createElement('div');
  menu.className = 'file-menu';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.3rem;box-shadow:0 8px 24px rgba(0,0,0,0.4);min-width:140px;`;
  const items = [
    { label: '👁️ 预览', action: `previewFile('${escAttr(name)}')` },
    { label: '⬇ 下载', action: `downloadFile('${escAttr(name)}')` },
    { label: '📋 复制链接', action: `copyLink('${escAttr(name)}')` },
    { label: '🗑 删除', action: `if(confirm('确定删除？'))delFile('${escAttr(name)}')`, danger: true },
  ];
  if (isDir) {
    items.splice(0, 3,
      { label: '📂 打开', action: `navigateTo('${escAttr(name)}')` },
      { label: '✏️ 重命名', action: `renameFolder('${escAttr(name)}')` },
      { label: '🗑 删除', action: `if(confirm('确定删除？'))deleteFolder('${escAttr(name)}')`, danger: true },
    );
  }
  items.forEach(item => {
    const div = document.createElement('div');
    div.style.cssText = `padding:.4rem .8rem;cursor:pointer;border-radius:6px;font-size:.8rem;white-space:nowrap;color:${item.danger?'var(--danger)':'var(--text)'};`;
    div.textContent = item.label;
    div.onmouseenter = () => div.style.background = 'var(--hover)';
    div.onmouseleave = () => div.style.background = '';
    div.onclick = () => { eval(item.action); menu.remove(); };
    menu.appendChild(div);
  });
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

// ===== 自动清空废纸篓（30天过期，倒数3天提醒）=====
(function() {
  var TRASH_DAYS = 30;
  var WARN_DAYS = 3;

  async function checkTrashExpiry() {
    try {
      var items = await (await fetch('/api/trash')).json();
      if (!items || !items.length) return;
      var now = Date.now();
      var expired = [];
      var warning = [];

      items.forEach(function(item) {
        // 文件名格式: timestamp_originalname
        var tsMatch = item.name.match(/^(\d+)_/);
        if (!tsMatch) return;
        var ts = parseInt(tsMatch[1]);
        if (!ts) return;
        var ageDays = (now - ts) / (1000 * 60 * 60 * 24);
        if (ageDays >= TRASH_DAYS) {
          expired.push(item);
        } else if (ageDays >= TRASH_DAYS - WARN_DAYS) {
          warning.push({ item: item, daysLeft: Math.ceil(TRASH_DAYS - ageDays) });
        }
      });

      // 删除过期项
      if (expired.length > 0) {
        for (var i = 0; i < expired.length; i++) {
          try {
            await fetch('/api/trash/item/' + encodeURIComponent(expired[i].name), { method: 'DELETE' });
          } catch(e) {}
        }
        if (typeof toast === 'function') {
          toast('🗑️ 回收站已自动清理 ' + expired.length + ' 个过期文件（超过30天）', 'info');
        }
        if (typeof loadTrash === 'function') loadTrash();
        if (typeof updateStorageBar === 'function') updateStorageBar();
      }

      // 警告即将过期
      if (warning.length > 0) {
        var msg = warning.map(function(w) {
          var dn = w.item.name.replace(/^\d+_/, '');
          return dn + '（' + w.daysLeft + '天后删除）';
        }).join('、');
        if (typeof toast === 'function') {
          toast('⚠️ 以下文件即将过期：' + msg, 'warning');
        }
      }
    } catch(e) { /* 静默 */ }
  }

  // 页面加载5秒后检查
  setTimeout(checkTrashExpiry, 5000);
  // 每天检查一次
  setInterval(checkTrashExpiry, 86400000);
})();

// ===== 存储进度条游戏主题适配 =====
(function() {
  function themeStorageBar() {
    var fill = document.getElementById('storageFill');
    if (!fill) return;
    // 读取当前百分比
    var pct = parseFloat(fill.style.width) || 0;
    fill.style.background = pct > 90 ? 'linear-gradient(90deg, var(--danger), #ff4444)' :
                            pct > 70 ? 'linear-gradient(90deg, var(--warn), #ffaa00)' :
                            'linear-gradient(90deg, var(--accent2), var(--accent))';
    fill.style.boxShadow = pct > 90 ? '0 0 8px var(--danger)' :
                           pct > 70 ? '0 0 8px var(--warn)' :
                           '0 0 6px var(--accent2)';
    fill.style.height = '100%';
    fill.style.borderRadius = '2px';
    fill.style.transition = 'width .3s, background .3s, box-shadow .3s';
  }
  // 在 updateStorageBar 之后调用
  var origUpdate = window.updateStorageBar;
  if (origUpdate) {
    window.updateStorageBar = function() {
      origUpdate();
      setTimeout(themeStorageBar, 100);
    };
  }
  // 初始应用
  setTimeout(themeStorageBar, 500);
})();

// ===== 批量重命名 =====
var renameMode = 'replace';
var renameFiles = [];
var renamePreviewData = [];

function batchRename() {
  var checked = getActiveCheckboxes(true);
  if (!checked.length) { toast('请先选择文件', 'warning'); return; }
  renameFiles = Array.from(checked).map(function(cb) { return cb.dataset.name; });
  renamePreviewData = [];
  document.getElementById('renameFileCount').textContent = '已选 ' + renameFiles.length + ' 个文件';
  document.getElementById('renamePreview').innerHTML = '<span style="color:var(--sub);">点击预览查看重命名结果</span>';
  document.getElementById('renamePreviewCount').textContent = '';
  document.getElementById('renameModal').classList.add('show');
  Yiwei.sound.play('modal-open');
  switchRenameMode('replace');
}

function closeRenameModal() {
  Yiwei.sound.play('modal-close');
  document.getElementById('renameModal').classList.remove('show');
}

function switchRenameMode(mode) {
  renameMode = mode;
  document.querySelectorAll('.rename-mode-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  ['Replace','Prefix','Seq','Ai'].forEach(function(m) {
    var panel = document.getElementById('renamePanel' + m);
    if (panel) panel.style.display = m === mode.charAt(0).toUpperCase() + mode.slice(1) ? '' : 'none';
  });
  renamePreviewData = [];
  document.getElementById('renamePreview').innerHTML = '<span style="color:var(--sub);">点击预览查看重命名结果</span>';
}

function dirOf(name) {
  var i = name.lastIndexOf('/');
  return i >= 0 ? name.slice(0, i) : '';
}

function nameOf(name) {
  var i = name.lastIndexOf('/');
  return i >= 0 ? name.slice(i + 1) : name;
}

function getExt(name) {
  var i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i) : '';
}

function getBase(name) {
  var i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function previewRename() {
  renamePreviewData = [];
  if (!renameFiles.length) return;
  var lines = [];

  if (renameMode === 'replace') {
    var find = document.getElementById('renameFind').value;
    var replace = document.getElementById('renameReplace').value;
    if (!find) { toast('请输入查找文本', 'warning'); return; }
    renameFiles.forEach(function(f) {
      var dir = dirOf(f), fname = nameOf(f);
      var base = getBase(fname), ext = getExt(fname);
      var newFname = base.split(find).join(replace) + ext;
      var display = (dir ? dir + '/' : '') + fname + '  →  ' + (dir ? dir + '/' : '') + newFname;
      lines.push(display);
      renamePreviewData.push({ old: f, new: newFname });
    });
  } else if (renameMode === 'prefix') {
    var prefix = document.getElementById('renamePrefix').value;
    var suffix = document.getElementById('renameSuffix').value;
    renameFiles.forEach(function(f) {
      var dir = dirOf(f), fname = nameOf(f);
      var base = getBase(fname), ext = getExt(fname);
      var newFname = prefix + base + suffix + ext;
      var display = (dir ? dir + '/' : '') + fname + '  →  ' + (dir ? dir + '/' : '') + newFname;
      lines.push(display);
      renamePreviewData.push({ old: f, new: newFname });
    });
  } else if (renameMode === 'seq') {
    var seqName = document.getElementById('renameSeqName').value || 'file';
    var start = parseInt(document.getElementById('renameSeqStart').value) || 1;
    var pad = parseInt(document.getElementById('renameSeqPad').value) || 3;
    renameFiles.forEach(function(f, i) {
      var dir = dirOf(f), fname = nameOf(f);
      var ext = getExt(fname);
      var num = String(start + i).padStart(pad, '0');
      var newFname = seqName + '_' + num + ext;
      var display = (dir ? dir + '/' : '') + fname + '  →  ' + (dir ? dir + '/' : '') + newFname;
      lines.push(display);
      renamePreviewData.push({ old: f, new: newFname });
    });
  } else if (renameMode === 'ai') {
    document.getElementById('renamePreview').innerHTML = '<span style="color:var(--accent);">点击 🤖 开始分析 生成 AI 命名预览</span>';
    return;
  }

  document.getElementById('renamePreview').innerHTML = lines.map(function(l) {
    return '<div style="padding:1px 0;border-bottom:1px solid var(--border);">' + escHtml(l) + '</div>';
  }).join('') || '<span style="color:var(--sub);">无变化</span>';
  document.getElementById('renamePreviewCount').textContent = renamePreviewData.length + ' 个文件待重命名';
}

async function executeRename() {
  if (!renamePreviewData.length) { toast('请先预览重命名结果', 'warning'); return; }
  var ok = 0, fail = 0;
  for (var i = 0; i < renamePreviewData.length; i++) {
    var item = renamePreviewData[i];
    if (nameOf(item.old) === item.new) { ok++; continue; }
    try {
      var r = await fetch('/api/files/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.old, newName: item.new })
      });
      if (r.ok) ok++; else fail++;
    } catch(e) { fail++; }
  }
  toast('✅ ' + ok + ' 个已重命名' + (fail ? '，' + fail + ' 个失败' : ''));
  closeRenameModal();
  loadFiles();
}

async function executeAiRename() {
  var apiKey = localStorage.getItem('yiwei_apikey');
  if (!apiKey) { toast('请先在 AK 设置中配置 API Key', 'error'); return; }
  var baseUrl = localStorage.getItem('yiwei_baseurl') || 'https://vip.apiyi.com/v1/chat/completions';
  var model = localStorage.getItem('yiwei_model') || 'grok-4.3';

  var statusEl = document.getElementById('renameAiStatus');
  var btn = document.getElementById('btnAiRename');
  btn.disabled = true; btn.textContent = '⏳ 分析中...';
  statusEl.textContent = '⏳ 正在分析文件内容...';
  renamePreviewData = [];
  var lines = [];

  for (var i = 0; i < renameFiles.length; i++) {
    var f = renameFiles[i];
    var dir = dirOf(f), fname = nameOf(f);
    statusEl.textContent = '⏳ 分析中 (' + (i+1) + '/' + renameFiles.length + '): ' + fname;
    try {
      // 读取文件内容（取前 2000 字符）
      var contentSample = '';
      try {
        var cr = await fetch('/api/preview/' + encodeURIComponent(f));
        if (cr.ok) { var ct = await cr.text(); contentSample = ct.slice(0, 2000); }
      } catch(e) {}

      var prompt = document.getElementById('renameAiPrompt').value || '';
      var ext = getExt(fname);
      var aiPrompt = '你是一个文件命名助手。根据文件名和内容片段，生成一个简洁描述性的文件名（保留原扩展名 ' + ext + '）。' +
        '只返回新文件名，不要解释，不要引号。' + (prompt ? ' 额外要求：' + prompt : '') +
        '\n\n原文件名: ' + fname + '\n内容片段: ' + (contentSample || '(无法读取)');

      var resp = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey, baseUrl: baseUrl, model: model,
          messages: [{ role: 'user', content: aiPrompt }],
          compress: false
        })
      });

      if (resp.ok) {
        var fullText = '';
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          var text = decoder.decode(chunk.value, { stream: true });
          // 解析 SSE
          var events = text.split('\n');
          events.forEach(function(line) {
            if (line.startsWith('data: ')) {
              try {
                var d = JSON.parse(line.slice(6));
                if (d.delta) fullText += d.delta;
                if (d.text) fullText += d.text;
              } catch(e) {}
            }
          });
        }
        var aiName = fullText.trim().replace(/[\\/:*?"<>|]/g, '_').slice(0, 100);
        if (aiName && !aiName.endsWith(ext)) aiName += ext;
        var display = (dir ? dir + '/' : '') + fname;
        if (aiName && aiName !== fname) {
          lines.push(display + '  →  ' + (dir ? dir + '/' : '') + aiName);
          renamePreviewData.push({ old: f, new: aiName });
        } else {
          lines.push(display + '  →  (保持原名)');
          renamePreviewData.push({ old: f, new: fname });
        }
      } else {
        lines.push((dir ? dir + '/' : '') + fname + '  →  ❌ API 错误');
        renamePreviewData.push({ old: f, new: fname });
      }
    } catch(e) {
      lines.push((dir ? dir + '/' : '') + fname + '  →  ❌ ' + e.message);
      renamePreviewData.push({ old: f, new: nameOf(f) });
    }
  }

  btn.disabled = false; btn.textContent = '🤖 开始分析';
  statusEl.textContent = '✅ 分析完成，请检查预览后执行重命名';
  document.getElementById('renamePreview').innerHTML = lines.map(function(l) {
    return '<div style="padding:1px 0;border-bottom:1px solid var(--border);">' + escHtml(l) + '</div>';
  }).join('');
  document.getElementById('renamePreviewCount').textContent = renamePreviewData.filter(function(d) { return d.old !== d.new; }).length + ' 个文件待重命名';
}

// ===== 文件命令行终端 =====
window.execFileCLI = function() {
  var input = document.getElementById('fileCliInput');
  if (!input) return;
  var cmd = input.value.trim();
  if (!cmd) return;
  input.value = '';
  try { Yiwei.sound.play('input-submit'); } catch(e) {}

  var parts = cmd.split(/\s+/);
  var op = parts[0].toLowerCase();
  var args = parts.slice(1);
  var dir = currentDir || '';

  function cliOut(msg, type) { toast(msg, type || 'info'); }

  // ls [path] — 列出文件
  if (op === 'ls') {
    var target = args[0] || dir || '';
    fetch('/api/files?dir=' + encodeURIComponent(target)).then(function(r) { return r.json(); }).then(function(data) {
      var files = data.files || [];
      var lines = files.map(function(f) {
        return (f.isDir ? '📁 ' : '📄 ') + f.name + (f.isDir ? '/' : '  ' + (f.size < 1024 ? f.size + 'B' : f.size < 1024*1024 ? (f.size/1024).toFixed(1)+'K' : (f.size/1024/1024).toFixed(1)+'M'));
      });
      cliOut((target || '/') + '\n' + (lines.length ? lines.join('\n') : '(空目录)'));
    }).catch(function() { cliOut('ls: 无法读取目录', 'error'); });
  }
  // cd <dir>
  else if (op === 'cd') {
    var target = args[0] || '';
    navigateTo(target);
    setTimeout(function() { cliOut('📂 ' + (currentDir || '/')); }, 300);
  }
  // cat <file>
  else if (op === 'cat' || op === 'open') {
    if (!args[0]) { cliOut('用法: ' + op + ' <文件名>', 'warning'); return; }
    var catPath = dir ? dir + '/' + args[0] : args[0];
    previewFile(catPath);
  }
  // touch <filename>
  else if (op === 'touch') {
    if (!args[0]) { cliOut('用法: touch <文件名>', 'warning'); return; }
    fetch('/api/files/create', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name:args[0],content:'',dir:dir}) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.error) { cliOut('touch: ' + d.error, 'error'); } else { cliOut('✅ ' + args[0]); loadFiles(); } })
      .catch(function() { cliOut('touch: 创建失败', 'error'); });
  }
  // mkdir <name>
  else if (op === 'mkdir') {
    if (!args[0]) { cliOut('用法: mkdir <目录名>', 'warning'); return; }
    var mkName = dir ? dir + '/' + args[0] : args[0];
    fetch('/api/folders', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name:mkName}) })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.error) { cliOut('mkdir: ' + d.error, 'error'); } else { cliOut('✅ ' + args[0] + '/'); loadFiles(); } })
      .catch(function() { cliOut('mkdir: 创建失败', 'error'); });
  }
  // rm <filename>
  else if (op === 'rm') {
    if (!args[0]) { cliOut('用法: rm <文件名>', 'warning'); return; }
    if (!confirm('确定删除「' + args[0] + '」？')) return;
    var rmPath = dir ? dir + '/' + args[0] : args[0];
    fetch('/api/files/' + encodeURIComponent(rmPath), { method: 'DELETE' })
      .then(function() { cliOut('🗑️ ' + args[0]); loadFiles(); try { updateStorageBar(); } catch(e) {} })
      .catch(function() { cliOut('rm: 删除失败', 'error'); });
  }
  // rmdir <name>
  else if (op === 'rmdir') {
    if (!args[0]) { cliOut('用法: rmdir <目录名>', 'warning'); return; }
    if (!confirm('删除目录「' + args[0] + '」？')) return;
    var rdPath = dir ? dir + '/' + args[0] : args[0];
    fetch('/api/folders/' + encodeURIComponent(rdPath), { method: 'DELETE' })
      .then(function() { cliOut('🗑️ ' + args[0] + '/'); loadFiles(); try { updateStorageBar(); } catch(e) {} })
      .catch(function() { cliOut('rmdir: 删除失败', 'error'); });
  }
  // pwd
  else if (op === 'pwd') {
    cliOut(dir || '/');
  }
  // help
  else if (op === 'help' || op === '?') {
    cliOut('📋 ls [dir] | cd <dir> | pwd | cat <file> | touch <name> | mkdir <name> | rm <file> | rmdir <dir> | help');
  }
  else {
    cliOut('❓ ' + op + ' — 输入 help 查看帮助', 'warning');
  }
};

// ===== 终端面板 =====
(function() {
  var panel = null, body = null, input = null, trigger = null;
  var open = false, hoverTimer = null, cmdHistory = [], histIdx = -1;
  var termDir = '';

  function init() {
    panel = document.getElementById('termPanel');
    body = document.getElementById('termBody');
    input = document.getElementById('termGhostInput');
    trigger = document.getElementById('termTrigger');
    if (!panel || !trigger) return;

    // 右边界悬停 0.6 秒展开
    trigger.addEventListener('mouseenter', function() {
      hoverTimer = setTimeout(function() { if (!open) openTerm(); }, 600);
    });
    trigger.addEventListener('mouseleave', function() {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    });
    // 点击切换收放
    trigger.addEventListener('click', function(e) { e.stopPropagation(); if (open) closeTerm(); else openTerm(); });

    // 点击终端外部区域关闭
    document.addEventListener('click', function(e) {
      if (!open) return;
      if (!panel.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
        closeTerm();
      }
    });

    // 初始隐藏（默认首页，非文件面板）
    trigger.style.display = 'none';

    // macOS 原生终端体验：点击终端任意位置即输入，无固定输入框
    body.addEventListener('click', function() {
      if (open && input) { input.focus(); body.scrollTop = body.scrollHeight; }
    });

    // Tab 补全文件名
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var val = input.value;
        var lastWord = val.split(/\s+/).pop() || '';
        if (!lastWord) return;
        var dir = termDir || '';
        fetch('/api/files?dir=' + encodeURIComponent(dir))
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var files = (data.files || []).map(function(f) { return f.name; });
            var matches = files.filter(function(f) { return f.toLowerCase().indexOf(lastWord.toLowerCase()) === 0; });
            if (matches.length === 1) {
              var parts = val.split(/\s+/);
              parts[parts.length - 1] = matches[0];
              input.value = parts.join(' ');
              syncTyped();
            } else if (matches.length > 1) {
              termOut(matches.join('  '), 'info');
            }
          }).catch(function() {});
      }
    });

    // 欢迎语 + 活动输入行
    termOut('📟 文件管理终端 — 点击任意位置输入命令 · help 查看帮助', 'info');
    newActiveLine();
  }

  function openTerm() {
    open = true; panel.classList.add('open');
    if (trigger) trigger.classList.add('shifted');
    setTimeout(function() { if (input) input.focus(); }, 300);
    termDir = (typeof currentDir !== 'undefined') ? currentDir : '';
    updateTermDirLabel();
    try { Yiwei.sound.play('drawer-open'); } catch(e) {}
  }

  function closeTerm() {
    open = false; panel.classList.remove('open');
    if (trigger) trigger.classList.remove('shifted');
    try { Yiwei.sound.play('drawer-close'); } catch(e) {}
  }

  // 公开：外部可关闭终端（切换面板时调用）
  window.closeFileTerm = function() { if (open) closeTerm(); };

  function updateTermDirLabel() {
    var lbl = document.getElementById('termDirLabel');
    if (lbl) lbl.textContent = termDir || '/';
  }

  window.termToggle = function() { if (open) closeTerm(); else openTerm(); };

  var activeLine = null, activeTyped = null;

  // 输出（插入到活动输入行之前，输入行始终保持在底部）
  function termOut(msg, cls) {
    if (!body) return;
    var lines = String(msg == null ? '' : msg).split('\n');
    for (var li = 0; li < lines.length; li++) {
      var line = document.createElement('div');
      line.className = 'term-line ' + (cls || 'out');
      line.textContent = lines[li];
      if (activeLine) body.insertBefore(line, activeLine);
      else body.appendChild(line);
    }
    body.scrollTop = body.scrollHeight;
  }

  // 新建活动输入行（macOS 终端风格：提示符 + 内联输入 + 闪烁光标）
  function newActiveLine() {
    if (!body) return;
    activeLine = document.createElement('div');
    activeLine.className = 'term-line term-active-line';
    activeLine.innerHTML = '<span class="term-prompt">$</span><span class="term-typed"></span><span class="term-cursor"></span>';
    body.appendChild(activeLine);
    activeTyped = activeLine.querySelector('.term-typed');
    body.scrollTop = body.scrollHeight;
  }

  // 同步隐藏输入框内容到内联显示
  function syncTyped() {
    if (activeTyped) activeTyped.textContent = input ? input.value : '';
    if (body) body.scrollTop = body.scrollHeight;
  }

  // 提交当前行：转为历史命令行，再开新行
  function submitActiveLine() {
    if (activeLine) {
      var cur = activeLine.querySelector('.term-cursor');
      if (cur) cur.remove();
      activeLine.classList.remove('term-active-line');
      activeLine.classList.add('cmd');
      activeLine = null; activeTyped = null;
    }
    newActiveLine();
  }

  function termExec(raw) {
    var cmd = raw.trim(); if (!cmd) { newActiveLine(); return; }
    submitActiveLine(); // 活动输入行转为历史命令行（内联显示，无需重复回显）
    cmdHistory.push(cmd); histIdx = cmdHistory.length;

    var parts = cmd.split(/\s+/);
    var op = parts[0].toLowerCase();
    var args = parts.slice(1);
    var dir = termDir || '';

    // ls — 列出文件（支持 -l 详细模式）
    if (op === 'ls') {
      // 解析 flag 和目标目录
      var detail = false, target = dir;
      for (var ai = 0; ai < args.length; ai++) {
        if (args[ai] === '-l' || args[ai] === '-la' || args[ai] === '-al' || args[ai] === '-lah') detail = true;
        else if (!args[ai].startsWith('-')) target = args[ai];
      }
      fetch('/api/files?dir=' + encodeURIComponent(target)).then(function(r) { return r.json(); }).then(function(data) {
        var files = data.files || [];
        if (!files.length) { termOut('(空目录)', 'info'); return; }
        // 排序：目录优先，然后按名称
        files.sort(function(a, b) {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });
        var out;
        if (detail) {
          out = files.map(function(f) {
            var perm = f.isDir ? 'drwxr-xr-x' : '-rw-r--r--';
            var size = f.isDir ? '-' : fmtSize(f.size);
            var date = f.mtime ? new Date(f.mtime).toLocaleDateString('zh-CN') + ' ' + new Date(f.mtime).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'}) : '-';
            return perm + '  ' + String(size).padStart(8) + '  ' + date + '  ' + (f.isDir ? '📁 ' : '📄 ') + f.name + (f.isDir ? '/' : '');
          }).join('\n');
        } else {
          out = files.map(function(f) {
            return (f.isDir ? '📁 ' : '📄 ') + f.name + (f.isDir ? '/' : '  ' + fmtSize(f.size));
          }).join('\n');
        }
        termOut(out);
      }).catch(function() { termOut('ls: 读取失败', 'err'); });
    }
    // cd
    else if (op === 'cd') {
      var target = args[0] || '';
      if (typeof navigateTo === 'function') {
        if (target === '..') {
          navigateTo('..');
        } else if (target.startsWith('/')) {
          navigateTo(target.slice(1));
        } else if (target) {
          navigateTo(dir ? dir + '/' + target : target);
        } else {
          navigateTo('');
        }
        setTimeout(function() {
          termDir = (typeof currentDir !== 'undefined') ? currentDir : '';
          updateTermDirLabel();
          termOut('📂 ' + (termDir || '/'), 'info');
        }, 400);
      } else { termOut('cd: 导航功能不可用', 'err'); }
    }
    // pwd
    else if (op === 'pwd') {
      termOut(dir || '/');
    }
    // cat / open
    else if (op === 'cat' || op === 'open') {
      if (!args[0]) { termOut('用法: ' + op + ' <文件名>', 'err'); return; }
      var catPath = dir ? dir + '/' + args[0] : args[0];
      if (typeof previewFile === 'function') previewFile(catPath);
      else termOut(op + ': 预览功能不可用', 'err');
    }
    // touch
    else if (op === 'touch') {
      if (!args[0]) { termOut('用法: touch <文件名>', 'err'); return; }
      fetch('/api/files/create', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:args[0],content:'',dir:dir}) })
        .then(function(r) { return r.json(); })
        .then(function(d) { if(d.error){termOut('touch: '+d.error,'err');}else{termOut('✅ '+args[0],'info'); if(typeof loadFiles==='function')loadFiles();} })
        .catch(function() { termOut('touch: 创建失败', 'err'); });
    }
    // mkdir
    else if (op === 'mkdir') {
      if (!args[0]) { termOut('用法: mkdir <目录名>', 'err'); return; }
      var mkName = dir ? dir + '/' + args[0] : args[0];
      fetch('/api/folders', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:mkName}) })
        .then(function(r) { return r.json(); })
        .then(function(d) { if(d.error){termOut('mkdir: '+d.error,'err');}else{termOut('✅ '+args[0]+'/', 'info'); if(typeof loadFiles==='function')loadFiles();} })
        .catch(function() { termOut('mkdir: 创建失败', 'err'); });
    }
    // rm
    else if (op === 'rm') {
      if (!args[0]) { termOut('用法: rm <文件名>', 'err'); return; }
      if (!confirm('确定删除「' + args[0] + '」？')) return;
      var rmPath = dir ? dir + '/' + args[0] : args[0];
      fetch('/api/files/' + encodeURIComponent(rmPath), { method:'DELETE' })
        .then(function() { termOut('🗑️ ' + args[0], 'info'); if(typeof loadFiles==='function')loadFiles(); try{updateStorageBar();}catch(e){} })
        .catch(function() { termOut('rm: 删除失败', 'err'); });
    }
    // rmdir
    else if (op === 'rmdir') {
      if (!args[0]) { termOut('用法: rmdir <目录名>', 'err'); return; }
      if (!confirm('删除目录「' + args[0] + '」？内容移入回收站')) return;
      var rdPath = dir ? dir + '/' + args[0] : args[0];
      fetch('/api/folders/' + encodeURIComponent(rdPath), { method:'DELETE' })
        .then(function() { termOut('🗑️ ' + args[0] + '/', 'info'); if(typeof loadFiles==='function')loadFiles(); try{updateStorageBar();}catch(e){} })
        .catch(function() { termOut('rmdir: 删除失败', 'err'); });
    }
    // clear
    else if (op === 'clear') { if (body) { body.innerHTML = ''; newActiveLine(); } }
    // mv / cp
    else if (op === 'mv') {
      if (args.length < 2) { termOut('用法: mv <源文件> <目标路径>', 'err'); return; }
      var src = dir ? dir + '/' + args[0] : args[0];
      var dst = args[1];
      fetch('/api/files/move', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:src, targetDir:dst}) })
        .then(function(r) { return r.json(); })
        .then(function(d) { if(d.error){termOut('mv: '+d.error,'err');}else{termOut('✅ '+args[0]+' → '+dst, 'info'); if(typeof loadFiles==='function')loadFiles();} })
        .catch(function() { termOut('mv: 移动失败', 'err'); });
    }
    else if (op === 'cp') {
      if (args.length < 2) { termOut('用法: cp <源文件> <目标路径>', 'err'); return; }
      var cpSrc = dir ? dir + '/' + args[0] : args[0];
      var cpDst = args[1];
      fetch('/api/files/copy', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:cpSrc, targetDir:cpDst}) })
        .then(function(r) { return r.json(); })
        .then(function(d) { if(d.error){termOut('cp: '+d.error,'err');}else{termOut('✅ '+args[0]+' → '+cpDst, 'info'); if(typeof loadFiles==='function')loadFiles();} })
        .catch(function() { termOut('cp: 复制失败', 'err'); });
    }
    // du — 磁盘使用
    else if (op === 'du') {
      fetch('/api/status').then(function(r) { return r.json(); }).then(function(d) {
        termOut('存储: ' + (d.storage_used_h || '?') + ' / ' + (d.storage_total || '20GB'), 'info');
        termOut('文件数: ' + (d.storage_files || '?'), 'info');
        termOut('使用率: ' + (d.storage_pct || '?') + '%', 'info');
      }).catch(function() { termOut('du: 获取失败', 'err'); });
    }
    // find — 搜索文件（递归搜索当前目录及子目录）
    else if (op === 'find') {
      if (!args[0]) { termOut('用法: find <关键字>', 'err'); return; }
      var kw = args.join(' ').toLowerCase();
      // 递归获取所有文件
      function fetchRecursive(fetchDir) {
        return fetch('/api/files?dir=' + encodeURIComponent(fetchDir))
          .then(function(r) { return r.json(); })
          .then(function(data) {
            var results = [];
            var dirs = [];
            (data.files || []).forEach(function(f) {
              if (f.isDir) {
                dirs.push(f.relPath);
              } else if (f.name.toLowerCase().indexOf(kw) !== -1) {
                results.push({ name: f.relPath || f.name, size: f.size, isDir: false });
              }
            });
            // 递归子目录
            return Promise.all(dirs.map(function(d) { return fetchRecursive(d); }))
              .then(function(childResults) {
                childResults.forEach(function(cr) { results = results.concat(cr); });
                return results;
              });
          });
      }
      fetchRecursive(dir).then(function(found) {
        if (!found.length) { termOut('未找到匹配 "' + kw + '" 的文件', 'info'); return; }
        termOut(found.map(function(f) { return '📄 ' + f.name + '  ' + fmtSize(f.size); }).join('\n'));
      }).catch(function() { termOut('find: 搜索失败', 'err'); });
    }
    // stat — 文件详情
    else if (op === 'stat') {
      if (!args[0]) { termOut('用法: stat <文件名>', 'err'); return; }
      var sp = dir ? dir + '/' + args[0] : args[0];
      fetch('/api/files?dir=' + encodeURIComponent(dir))
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var f = (data.files || []).find(function(x) { return x.name === args[0] || x.relPath === sp; });
          if (!f) { termOut('stat: 文件不存在: ' + args[0], 'err'); return; }
          termOut('名称: ' + f.name, 'info');
          termOut('类型: ' + (f.isDir ? '目录' : '文件'), 'info');
          termOut('大小: ' + (f.isDir ? '-' : fmtSize(f.size || 0)), 'info');
          termOut('修改: ' + (f.mtime ? new Date(f.mtime).toLocaleString('zh-CN') : '-'), 'info');
        }).catch(function() { termOut('stat: 获取失败', 'err'); });
    }
    // echo — 写入/追加文本到文件
    else if (op === 'echo') {
      // 解析 echo "text" > file 或 echo "text" >> file
      var raw2 = cmd.slice(5).trim(); // 跳过 "echo "
      var append = raw2.indexOf('>>') > -1;
      var redirect = append ? '>>' : (raw2.indexOf('>') > -1 ? '>' : '');
      if (!redirect) {
        // 没有重定向，直接输出文本
        var txtOut = raw2.replace(/^["']|["']$/g, '');
        termOut(txtOut);
        return;
      }
      var redirectIdx = raw2.indexOf(redirect);
      var text = raw2.slice(0, redirectIdx).trim().replace(/^["']|["']$/g, '');
      var fileName = raw2.slice(redirectIdx + redirect.length).trim();
      if (!fileName) { termOut('echo: 用法: echo "text" > file', 'err'); return; }
      var echoPath = dir ? dir + '/' + fileName : fileName;
      fetch('/api/files/write', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:echoPath, content:text + '\n', append:append}) })
        .then(function(r) { return r.json(); })
        .then(function(d) { if(d.error){termOut('echo: '+d.error,'err');}else{termOut('✅ 已写入 ' + fileName + ' (' + fmtSize(d.size) + ')', 'info'); if(typeof loadFiles==='function')loadFiles();} })
        .catch(function() { termOut('echo: 写入失败', 'err'); });
    }
    // head — 查看文件前 N 行
    else if (op === 'head') {
      var n = 10; var headFile = '';
      for (var hi = 0; hi < args.length; hi++) {
        if (args[hi] === '-n' && args[hi+1]) { n = parseInt(args[hi+1]); hi++; }
        else if (!args[hi].startsWith('-')) headFile = args[hi];
      }
      if (!headFile) { termOut('用法: head [-n N] <文件名>', 'err'); return; }
      var headPath = dir ? dir + '/' + headFile : headFile;
      fetch('/api/preview/' + encodeURIComponent(headPath)).then(function(r) {
        if (!r.ok) { termOut('head: 文件不存在或不可读: ' + headFile, 'err'); return; }
        return r.text();
      }).then(function(text) {
        if (!text && text !== '') return;
        var lines = text.split('\n').slice(0, n);
        termOut(lines.join('\n'));
      }).catch(function() { termOut('head: 读取失败', 'err'); });
    }
    // tail — 查看文件后 N 行
    else if (op === 'tail') {
      var n = 10; var tailFile = '';
      for (var ti = 0; ti < args.length; ti++) {
        if (args[ti] === '-n' && args[ti+1]) { n = parseInt(args[ti+1]); ti++; }
        else if (!args[ti].startsWith('-')) tailFile = args[ti];
      }
      if (!tailFile) { termOut('用法: tail [-n N] <文件名>', 'err'); return; }
      var tailPath = dir ? dir + '/' + tailFile : tailFile;
      fetch('/api/preview/' + encodeURIComponent(tailPath)).then(function(r) {
        if (!r.ok) { termOut('tail: 文件不存在或不可读: ' + tailFile, 'err'); return; }
        return r.text();
      }).then(function(text) {
        if (!text && text !== '') return;
        var lines = text.split('\n').slice(-n);
        termOut(lines.join('\n'));
      }).catch(function() { termOut('tail: 读取失败', 'err'); });
    }
    // wc — 统计行数、词数、字符数
    else if (op === 'wc') {
      if (!args[0]) { termOut('用法: wc <文件名>', 'err'); return; }
      var wcPath = dir ? dir + '/' + args[0] : args[0];
      fetch('/api/preview/' + encodeURIComponent(wcPath)).then(function(r) {
        if (!r.ok) { termOut('wc: 文件不存在: ' + args[0], 'err'); return; }
        return r.text();
      }).then(function(text) {
        if (!text && text !== '') return;
        var lines = text.split('\n').length;
        var words = text.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
        var chars = text.length;
        termOut('  ' + lines + ' 行  ' + words + ' 词  ' + chars + ' 字符  ' + args[0]);
      }).catch(function() { termOut('wc: 读取失败', 'err'); });
    }
    // grep — 在文件内容中搜索
    else if (op === 'grep') {
      if (args.length < 2) { termOut('用法: grep <模式> <文件名>', 'err'); return; }
      var pattern = args[0]; var grepFile = args[1];
      var grepPath = dir ? dir + '/' + grepFile : grepFile;
      fetch('/api/preview/' + encodeURIComponent(grepPath)).then(function(r) {
        if (!r.ok) { termOut('grep: 文件不存在: ' + grepFile, 'err'); return; }
        return r.text();
      }).then(function(text) {
        if (!text && text !== '') return;
        var lines = text.split('\n');
        var matches = [];
        for (var gi = 0; gi < lines.length; gi++) {
          if (lines[gi].indexOf(pattern) !== -1) matches.push((gi + 1) + ': ' + lines[gi].slice(0, 200));
        }
        if (!matches.length) { termOut('(无匹配)', 'info'); return; }
        termOut(matches.join('\n'));
      }).catch(function() { termOut('grep: 读取失败', 'err'); });
    }
    // edit — 在笔记编辑器中打开文件
    else if (op === 'edit') {
      if (!args[0]) { termOut('用法: edit <文件名>', 'err'); return; }
      var editPath = dir ? dir + '/' + args[0] : args[0];
      if (typeof importNoteFromFile === 'function') {
        importNoteFromFile(editPath, args[0]);
        termOut('📝 已在笔记编辑器中打开: ' + args[0], 'info');
      } else {
        termOut('edit: 编辑器不可用，请先切换到笔记面板', 'err');
      }
    }
    // ai — AI 辅助文件管理
    else if (op === 'ai') {
      var aiPrompt = args.join(' ').trim();
      if (!aiPrompt) { termOut('用法: ai <自然语言指令>\n示例: ai 把图片文件移到 images 目录', 'err'); return; }
      var apiKey = localStorage.getItem('yiwei_apikey');
      if (!apiKey) { termOut('❌ 请先在 AK 设置中配置 API Key', 'err'); return; }
      var baseUrl = localStorage.getItem('yiwei_baseurl') || 'https://vip.apiyi.com/v1/chat/completions';
      var model = localStorage.getItem('yiwei_model') || 'grok-4.3';
      termOut('🤖 AI 思考中...', 'info');
      // 收集当前目录信息
      fetch('/api/files?dir=' + encodeURIComponent(dir)).then(function(r) { return r.json(); }).then(function(data) {
        var files = (data.files || []).map(function(f) {
          return (f.isDir ? '📁 ' : '📄 ') + f.name + (f.isDir ? '/' : '  ' + fmtSize(f.size || 0));
        }).join('\n');
        var cwdInfo = '当前工作目录: ' + (dir || '/') + '\n文件列表:\n' + (files || '(空)');
        var sysPrompt = '你是文件管理助手。用户会用自然语言描述需求，你给出具体可执行的终端命令。\n' +
          '可用命令: ls, cd, pwd, cat, touch, mkdir, rm, rmdir, mv, cp, echo, head, tail, wc, grep, find, stat, edit, du, clear, exit\n' +
          '回复格式:\n' +
          '1. 先简要说明方案（1-2句）\n' +
          '2. 用 ```sh 代码块给出命令\n' +
          '根目录是 /，路径相对于文件站根目录。';
        return fetch('/api/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            apiKey: apiKey, baseUrl: baseUrl, model: model,
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: cwdInfo + '\n\n用户需求: ' + aiPrompt }
            ],
            compress: false, keepRecent: 6
          })
        });
      }).then(function(resp) {
        if (!resp || !resp.ok) { termOut('❌ AI 请求失败', 'err'); return; }
        var fullText = '';
        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        function pump() {
          return reader.read().then(function(chunk) {
            if (chunk.done) { if (fullText.trim()) termOut(fullText.trim()); return; }
            var text = decoder.decode(chunk.value, { stream: true });
            var events = text.split('\n');
            events.forEach(function(line) {
              if (line.startsWith('data: ')) {
                try {
                  var d = JSON.parse(line.slice(6));
                  if (d.delta) fullText += d.delta;
                } catch(e) {}
              }
            });
            return pump();
          });
        }
        return pump();
      }).catch(function(e) { termOut('❌ AI 错误: ' + e.message, 'err'); });
    }
    // help
    else if (op === 'help' || op === '?') {
      termOut('═══ 文件管理命令 ═══', 'info');
      termOut('  ls [dir] [-l]   列出文件（-l 详细列表）', 'info');
      termOut('  cd <dir>        切换目录', 'info');
      termOut('  pwd             当前路径', 'info');
      termOut('  cat <file>      预览文件内容', 'info');
      termOut('  edit <file>     在编辑器中打开文件', 'info');
      termOut('  touch <name>    创建空文件', 'info');
      termOut('  echo "txt">file 写入文本到文件', 'info');
      termOut('  mkdir <name>    创建目录', 'info');
      termOut('  rm <file>       删除文件', 'info');
      termOut('  rmdir <dir>     删除目录', 'info');
      termOut('  mv <src> <dst>  移动文件', 'info');
      termOut('  cp <src> <dst>  复制文件', 'info');
      termOut('═══ 查看与搜索 ═══', 'info');
      termOut('  head [-n N] <f> 查看文件前 N 行', 'info');
      termOut('  tail [-n N] <f> 查看文件后 N 行', 'info');
      termOut('  wc <file>       统计行数/词数/字符', 'info');
      termOut('  grep <pat> <f>  搜索文件内容', 'info');
      termOut('  find <kw>       按名称搜索文件', 'info');
      termOut('  stat <file>     文件详细信息', 'info');
      termOut('═══ AI 与终端 ═══', 'info');
      termOut('  ai <指令>       AI 辅助文件管理（自然语言）', 'info');
      termOut('  du              磁盘使用情况', 'info');
      termOut('  clear           清屏', 'info');
      termOut('  exit            关闭终端', 'info');
      termOut('  Ctrl+L          清屏 · Ctrl+C 中断', 'info');
    }
    // exit
    else if (op === 'exit') { closeTerm(); }
    else { termOut('未知命令: ' + op + ' — 输入 help 查看帮助', 'err'); }
  }

  window.termKey = function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      var cmd = input.value; input.value = '';
      syncTyped();
      termExec(cmd);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histIdx > 0) { histIdx--; input.value = cmdHistory[histIdx] || ''; syncTyped(); }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIdx < cmdHistory.length - 1) { histIdx++; input.value = cmdHistory[histIdx] || ''; syncTyped(); }
      else { histIdx = cmdHistory.length; input.value = ''; syncTyped(); }
    } else if (e.key === 'Escape') {
      closeTerm();
    } else if (e.key === 'l' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (body) { body.innerHTML = ''; newActiveLine(); }
    } else if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
      if (input.value) { e.preventDefault(); input.value = ''; syncTyped(); termOut('^C', 'info'); }
    }
  };

  // 输入框内容变化 → 同步内联显示
  window.termTyping = function() { syncTyped(); };

  function fmtSize(b) {
    return b < 1024 ? b + 'B' : b < 1024*1024 ? (b/1024).toFixed(1)+'K' : b < 1024*1024*1024 ? (b/1024/1024).toFixed(1)+'M' : (b/1024/1024/1024).toFixed(2)+'G';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { setTimeout(init, 200); }

  // 暴露旧 execFileCLI 避免报错（兼容旧按钮引用）
  window.execFileCLI = function() { openTerm(); if (input) { setTimeout(function() { input.focus(); }, 350); } };
})();
