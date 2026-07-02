// ===== 文件 =====
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); uploadFiles(e.dataTransfer.files); });
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

// ===== 文件模块（支持目录导航）=====
let currentDir = '';

function navigateTo(dir) {
  currentDir = dir || '';
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

    // 搜索过滤
    const q = (document.getElementById('fileSearch')?.value || '').trim().toLowerCase();
    let filtered = q ? files.filter(f => f.name.toLowerCase().includes(q)) : files;

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

// 统一文件项点击：单击打开，Ctrl/Shift+点击多选
function handleFileClick(event, row, actionType, path) {
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    handleFileRowClick(event, row);
    return;
  }
  // 普通单击 → 打开
  if (actionType === 'navigateTo') navigateTo(path);
  else if (actionType === 'previewFile') previewFile(path);
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

async function batchDelete() {
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

function batchDownload() {
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

function toggleFileTrash() {
  const drawer = document.getElementById('trashDrawer');
  const visible = drawer.style.display === 'block';
  drawer.style.display = visible ? 'none' : 'block';
  if (!visible) loadTrash();
}

async function createFolder() {
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
