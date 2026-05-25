// ===== 导航 =====
let currentPanel = 'home';

function switchPanel(name, mode) {
  if (currentPanel === 'notes' && name !== 'notes') {
    if (typeof isNoteDirty === 'function' && isNoteDirty() && !confirm('笔记有未保存的修改，是否放弃？')) {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-panel="notes"]').classList.add('active');
      return;
    }
    if (typeof stopAutoSave === 'function') stopAutoSave();
  }
  currentPanel = name;
  location.hash = name;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  // 激活包含 data-panel="notes" 的按钮（笔记和小说都用 notes 面板）
  if (name === 'notes') {
    const target = document.querySelector(`[data-panel="notes"][data-mode="${mode || 'note'}"]`);
    if (target) target.classList.add('active');
  } else {
    const target = document.querySelector(`[data-panel="${name}"]`);
    if (target) target.classList.add('active');
  }
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'files') { loadFiles(); updateStorageBar(); }
  if (name === 'notes') {
    setWritingMode(mode || 'note');
    loadNotesList();
    if (typeof loadWorks === 'function') loadWorks();
  }
  if (name === 'scrape') loadScrapeSessions();
  if (name === 'read') loadReaderBooks();
  if (name === 'translate' && typeof loadHistory === 'function') loadHistory();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel, btn.dataset.mode));
});

// ===== 主题 =====
const themes = ['azure','emerald','ember','snow','midnight'];
const themeBtn = document.getElementById('themeBtn');
let currentTheme = localStorage.getItem('theme') || 'azure';
applyTheme(currentTheme);
themeBtn.addEventListener('click', () => {
  const idx = themes.indexOf(currentTheme);
  currentTheme = themes[(idx + 1) % themes.length];
  localStorage.setItem('theme', currentTheme);
  applyTheme(currentTheme);
});
let themeMenu = null;
themeBtn.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (themeMenu) { themeMenu.remove(); themeMenu = null; return; }
  themeMenu = document.createElement('div');
  themeMenu.style.cssText = 'position:fixed;z-index:9999;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.3rem;box-shadow:0 8px 24px rgba(0,0,0,0.4);';
  document.body.appendChild(themeMenu);
  const names = {azure:'① 青蓝科技',emerald:'② 暗夜绿',ember:'③ 暖橙棕',snow:'④ 极简白',midnight:'⑤ 墨绿金'};
  themes.forEach(t => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:.4rem .8rem;cursor:pointer;border-radius:6px;font-size:.8rem;white-space:nowrap;color:var(--text);';
    item.textContent = names[t];
    item.onmouseenter = () => item.style.background = 'var(--hover)';
    item.onmouseleave = () => item.style.background = '';
    item.onclick = () => { currentTheme = t; localStorage.setItem('theme', t); applyTheme(t); themeMenu.remove(); themeMenu = null; };
    themeMenu.appendChild(item);
  });
  // 定位：靠右对齐，避免溢出屏幕
  const mw = themeMenu.offsetWidth, mh = themeMenu.offsetHeight;
  let left = e.clientX, top = e.clientY;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
  if (left < 8) left = 8;
  themeMenu.style.left = left + 'px'; themeMenu.style.top = top + 'px';
  setTimeout(() => document.addEventListener('click', () => { if (themeMenu) { themeMenu.remove(); themeMenu = null; } }, { once: true }), 0);
});
function applyTheme(t) {
  currentTheme = t;
  document.body.setAttribute('data-theme', t);
  themeBtn.textContent = 'palette';
  themeBtn.title = '左键切换主题 | 右键打开菜单';
}

// ===== Toast =====
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2000);
}

// ===== 时钟 =====
function tick() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  document.getElementById('date').textContent = now.toLocaleDateString('zh-CN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
tick(); setInterval(tick, 1000);

// ===== 搜索 =====
document.getElementById('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const q = document.getElementById('q').value.trim();
  if (q) window.open('https://www.bing.com/search?q=' + encodeURIComponent(q), '_blank');
});

// ===== 书签 =====
const LINKS = {
  ai: [
    { name:'DeepSeek', url:'https://chat.deepseek.com', icon:'🤖' },
    { name:'豆包', url:'https://www.doubao.com', icon:'🫘' },
    { name:'ChatGPT', url:'https://chat.openai.com', icon:'🧠' },
    { name:'Kimi', url:'https://kimi.moonshot.cn', icon:'🌙' },
    { name:'通义千问', url:'https://tongyi.aliyun.com', icon:'☁️' },
    { name:'Claude', url:'https://claude.ai', icon:'🧪' },
  ],
  common: [
    { name:'哔哩哔哩', url:'https://www.bilibili.com', icon:'📺' },
    { name:'知乎', url:'https://www.zhihu.com', icon:'🔷' },
    { name:'YouTube', url:'https://www.youtube.com', icon:'▶️' },
    { name:'GitHub', url:'https://github.com', icon:'🐙' },
    { name:'小红书', url:'https://www.xiaohongshu.com', icon:'📕' },
    { name:'CSDN', url:'https://www.csdn.net', icon:'📄' },
  ],
  dev: [
    { name:'MDN 前端', url:'https://developer.mozilla.org/zh-CN/', icon:'📘' },
    { name:'菜鸟教程', url:'https://www.runoob.com', icon:'🐤' },
    { name:'W3School', url:'https://www.w3school.com.cn', icon:'🌐' },
    { name:'Vue.js', url:'https://cn.vuejs.org', icon:'💚' },
    { name:'Python教程', url:'https://www.liaoxuefeng.com', icon:'🐍' },
    { name:'LeetCode', url:'https://leetcode.cn', icon:'⚡' },
  ],
  tools: [
    { name:'Convertio', url:'https://convertio.co/zh/', icon:'🔄' },
    { name:'Photopea', url:'https://www.photopea.com', icon:'🎨' },
    { name:'TinyPNG', url:'https://tinypng.com', icon:'🗜️' },
    { name:'工具集合', url:'https://tool.lu', icon:'🧰' },
    { name:'草料二维码', url:'https://cli.im', icon:'📱' },
    { name:'Excalidraw', url:'https://excalidraw.com', icon:'✏️' },
  ],
};
Object.entries(LINKS).forEach(([cat, links]) => {
  const el = document.getElementById(cat);
  if (el) el.innerHTML = links.map(l =>
    `<a class="link" href="${l.url}" target="_blank" rel="noopener"><span class="icon">${l.icon}</span><span class="name">${l.name}</span></a>`
  ).join('');
});

// ===== 状态 =====
let lastStatus = null;

async function loadStatus() {
  const el = document.getElementById('status');
  try {
    lastStatus = await (await fetch('/api/status')).json();
    el.innerHTML = [
      `<span><span class="dot ${lastStatus.mem_pct < 80 ? 'green' : (lastStatus.mem_pct < 90 ? 'yellow' : 'red')}"></span>内存 ${lastStatus.mem_used}/${lastStatus.mem_total}</span>`,
      `<span><span class="dot green"></span>CPU ${lastStatus.cpu}%</span>`,
      `<span><span class="dot green"></span>磁盘 ${lastStatus.disk_free}</span>`,
      `<span><span class="dot green"></span>运行 ${lastStatus.uptime}</span>`,
    ].join(' · ');
    updateStorageBar(lastStatus);
  } catch { el.innerHTML = '<span>⚙️ 状态暂不可用</span>'; }
}
loadStatus();

function updateStorageBar(s) {
  if (!s) {
    if (lastStatus) s = lastStatus;
    else { loadStatus().then(() => updateStorageBar(lastStatus)); return; }
  }
  const usedEl = document.getElementById('storageUsed');
  const pctEl = document.getElementById('storagePct');
  const fill = document.getElementById('storageFill');
  if (!usedEl || !pctEl || !fill) return;
  usedEl.textContent = s.storage_used_h;
  const pct = Math.max(s.storage_pct, s.storage_used > 0 ? 0.5 : 0);
  pctEl.textContent = pct + '%';
  fill.style.width = Math.min(pct, 100) + '%';
  fill.className = 'fill ' + (s.storage_pct < 60 ? 'low' : (s.storage_pct < 85 ? 'mid' : 'high'));
}

// ===== 文件 =====
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); uploadFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', () => { uploadFiles(fileInput.files); fileInput.value = ''; });

async function uploadFiles(fileList) {
  if (!fileList.length) return;
  const prog = document.getElementById('uploadProgress');
  let ok = 0, done = 0;
  
  const uploadUrl = '/api/files' + (currentDir ? '?dir=' + encodeURIComponent(currentDir) : '');
  const CONCUR = 3;
  for (let i = 0; i < fileList.length; i += CONCUR) {
    const batch = Array.from(fileList).slice(i, i + CONCUR);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const form = new FormData(); form.append('file', file);
        const r = await fetch(uploadUrl, { method: 'POST', body: form });
        if (r.ok) return true;
        try { const e = await r.json(); toast('❌ ' + e.error); } catch {}
        return false;
      })
    );
    results.forEach(r => { if (r.value === true) ok++; });
    done += batch.length;
    prog.textContent = `上传中... ${done}/${fileList.length}`;
    await updateStorageBar();
  }
  prog.textContent = '';
  if (ok > 0) toast(`✅ ${ok} 个文件上传成功`);
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

    // 面包屑（所有节点都是拖放目标）
    const bc = document.getElementById('fileBreadcrumb');
    bc.innerHTML = crumbs.map((c, i) => {
      const sep = i > 0 ? '<span style="color:var(--sub);">/</span>' : '';
      const isLast = i === crumbs.length - 1;
      const cls = isLast ? 'style="font-weight:600;color:var(--accent);"' :
        'href="#" onclick="navigateTo(\'' + escAttr(c.path) + '\');return false;" style="color:var(--accent);text-decoration:none;"';
      const drag = `ondragover="event.preventDefault();event.currentTarget.style.outline='2px solid var(--accent)'" ondragleave="event.currentTarget.style.outline=''" ondrop="event.currentTarget.style.outline='';handleDrop(event, '${escAttr(c.path)}')"`;
      return sep + '<span ' + drag + ' ' + cls + '>' + c.name + '</span>';
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

    list.innerHTML = filtered.map(f => {
      if (f.isDir) {
        // 文件夹：点击进入目录
        return `
        <div class="file-row" style="cursor:default;" onclick="toggleFileCheck(this)"
             ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${escAttr(f.relPath)}')">
          <input type="checkbox" class="file-check" data-name="${escAttr(f.relPath)}" onclick="event.stopPropagation();updateBatchBar();" style="flex-shrink:0;">
          <span class="fname"><span class="fname-text" onclick="event.stopPropagation();navigateTo('${escAttr(f.relPath)}')" title="进入目录">📁 ${escHtml(f.name)}</span></span>
          <span class="fsize"></span>
          <span class="fsize">${new Date(f.mtime).toLocaleDateString('zh-CN')}</span>
          <div class="actions" onclick="event.stopPropagation();">
            <button class="btn-sm" onclick="renameFolder('${escAttr(f.relPath)}')">✏️</button>
            <button class="btn-sm danger" onclick="deleteFolder('${escAttr(f.relPath)}')">🗑</button>
          </div>
        </div>`;
      }
      // 文件：点击预览
      return `
        <div class="file-row" style="cursor:default;" onclick="toggleFileCheck(this)">
          <input type="checkbox" class="file-check" data-name="${escAttr(f.relPath)}" onclick="event.stopPropagation();updateBatchBar();" style="flex-shrink:0;">
          <span class="fname"><span class="fname-text" onclick="event.stopPropagation();previewFile('${escAttr(f.relPath)}')" 
                draggable="true" ondragstart="handleDragStart(event, '${escAttr(f.relPath)}')" ondragend="handleDragEnd(event)" title="点击预览 / 拖拽移动">📄 ${escHtml(f.name)}</span></span>
          <span class="fsize">${f.isDir ? '' : sz(f.size)}</span>
          <span class="fsize">${new Date(f.mtime).toLocaleDateString('zh-CN')}</span>
          <div class="actions" onclick="event.stopPropagation();">
            <button class="btn-sm" onclick="copyLink('${escAttr(f.relPath)}')">复制链接</button>
            <button class="btn-sm" onclick="downloadFile('${escAttr(f.relPath)}')">下载</button>
            <button class="btn-sm danger" onclick="delFile('${escAttr(f.relPath)}')">删除</button>
          </div>
        </div>`;
    }).join('');

    // 网格视图
    const grid = document.getElementById('fileGrid');
    const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico'];
    grid.innerHTML = filtered.map(f => {
      if (f.isDir) {
        return `<div class="file-card" onclick="navigateTo('${escAttr(f.relPath)}')"
             ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event, '${escAttr(f.relPath)}')"
             oncontextmenu="showFileMenu(event, '${escAttr(f.relPath)}', true);return false;">
          <div class="file-card-icon">📁</div>
          <div class="file-card-name">${escHtml(f.name)}</div>
        </div>`;
      }
      const ext = (f.name||'').split('.').pop().toLowerCase();
      const isImg = imgExts.includes(ext);
      const preview = isImg ? `<img src="/api/view/${encodeURIComponent(f.relPath)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;">` : `<div class="file-card-icon">📄</div>`;
      return `<div class="file-card" oncontextmenu="showFileMenu(event, '${escAttr(f.relPath)}', false);return false;">
        <div class="file-card-preview" draggable="true"
             ondragstart="handleDragStart(event, '${escAttr(f.relPath)}')" ondragend="handleDragEnd(event)"
             onclick="previewFile('${escAttr(f.relPath)}')">${preview}</div>
        <div class="file-card-name" onclick="previewFile('${escAttr(f.relPath)}')" title="点击预览">${escHtml(f.name)}</div>
        <div class="file-card-size">${sz(f.size)}</div>
      </div>`;
    }).join('');

    // 初始化视图模式
    if (fileViewMode === 'grid') {
      document.getElementById('fileList').style.display = 'none';
      document.getElementById('fileGrid').style.display = '';
    }
  } catch(e) { console.error(e); }
}

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"'); }

// ===== 文件预览 =====
async function previewFile(name) {
  const modal = document.getElementById('previewModal');
  const title = document.getElementById('previewTitle');
  const body = document.getElementById('previewBody');
  title.textContent = name;
  body.innerHTML = '<div class="file-info"><div class="fi-icon">⏳</div>加载中...</div>';
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
  const dlUrl = location.origin + '/api/dl/' + encodeURIComponent(name);
  
  // 媒体文件工具栏
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

document.addEventListener('keydown', e => { if (e.key === 'Escape') closePreview(); });

// ===== Del 键删除 =====
document.addEventListener('keydown', e => {
  if (e.key !== 'Delete') return;
  // 不在输入框内才触发
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) return;
  
  if (currentPanel === 'files') {
    const drawer = document.getElementById('trashDrawer');
    if (drawer && drawer.style.display === 'block') { emptyTrash(); return; }
    const checked = document.querySelectorAll('.file-check:checked');
    if (checked.length) { batchDelete(); return; }
  }
  if (currentPanel === 'notes' && currentNoteId) { deleteNote(); return; }
  if (currentPanel === 'scrape') {
    const checked = document.querySelectorAll('.scrape-check:checked');
    if (checked.length) { batchDelScrape(); return; }
    const first = document.querySelector('.scrape-check');
    if (first) { first.checked = true; updateScrapeBatchBar(); batchDelScrape(); return; }
  }
  if (currentPanel === 'read' && currentBook) { closeReader(); return; }
});

function copyLink(name) {
  const url = location.origin + '/api/dl/' + encodeURIComponent(name);
  navigator.clipboard.writeText(url).then(() => toast('📋 链接已复制')).catch(() => toast('❌ 复制失败'));
}
function downloadFile(name) { window.open('/api/dl/' + encodeURIComponent(name), '_blank'); }
async function delFile(name) {
  if (!confirm(`确定删除「${name}」？`)) return;
  const r = await fetch('/api/files/' + encodeURIComponent(name), { method: 'DELETE' });
  if (r.ok) { toast('🗑️ 已移入回收站'); loadFiles(); updateStorageBar(); } else { toast('❌ 删除失败'); }
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

// ===== 拖拽移动 =====
let dragItems = [];

function toggleFileCheck(row) {
  const cb = row.querySelector('.file-check');
  if (cb) { cb.checked = !cb.checked; updateBatchBar(); }
}

function handleDragStart(e, name) {
  // 如果有多选，拖拽所有选中的文件
  const checked = document.querySelectorAll('.file-check:checked');
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
  
  // 不能拖到自己所在的目录
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
    } catch {}
  }
  toast(`✅ ${ok}/${valid.length} 个文件已移动`);
  loadFiles();
}
function updateBatchBar() {
  const checked = document.querySelectorAll('.file-check:checked');
  const bar = document.getElementById('batchBar');
  const count = document.getElementById('selectedCount');
  if (checked.length > 0) {
    bar.style.display = 'flex';
    count.textContent = '已选 ' + checked.length + ' 个';
  } else {
    bar.style.display = 'none';
  }
}

function toggleSelectAll() {
  const all = document.getElementById('selectAll').checked;
  document.querySelectorAll('.file-check').forEach(cb => { cb.checked = all; });
  updateBatchBar();
}

async function batchDelete() {
  const checked = document.querySelectorAll('.file-check:checked');
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
      const icon = f.isDir ? '📁' : (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext) ? '🖼️' : ['mp4','webm','mov','mkv'].includes(ext) ? '🎬' : ['mp3','wav','ogg','flac','aac'].includes(ext) ? '🎵' : '📄');
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
  else { toast('❌ 恢复失败'); }
}

// ===== 笔记 =====
let currentNoteId = null, noteDirty = false, autoSaveTimer = null;
function isNoteDirty() { return noteDirty; }
function markDirty() { noteDirty = true; document.getElementById('saveIndicator').textContent = '● 未保存'; }
function markClean() { noteDirty = false; document.getElementById('saveIndicator').textContent = ''; }

function md2html(md) {
  let s = (md || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // 代码块（先处理，保护内部内容）
  const blocks = [];
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push({ lang, code: code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') });
    return '\x00' + (blocks.length - 1) + '\x00';
  });

  // 表格
  s = s.replace(/^\|(.+)\|\n\|[-: |]+\|\n((?:\|.+\|\n?)*)/gm, (_, head, rows) => {
    const hc = head.split('|').map(c => '<th>' + c.trim() + '</th>').join('');
    const rc = rows.trim().split('\n').map(r => '<tr>' + r.split('|').filter(c => c).map(c => '<td>' + c.trim() + '</td>').join('') + '</tr>').join('');
    return '<table><thead><tr>' + hc + '</tr></thead><tbody>' + rc + '</tbody></table>';
  });

  // 水平线
  s = s.replace(/^(---|\*\*\*|___)\s*$/gm, '<hr>');

  // 标题 h1-h6
  s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 引用块
  s = s.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');

  // 任务列表
  s = s.replace(/^[*-] \[x\] (.+)$/gim, '<li class="task done"><input type="checkbox" checked disabled> $1</li>');
  s = s.replace(/^[*-] \[ \] (.+)$/gim, '<li class="task"><input type="checkbox" disabled> $1</li>');

  // 有序列表 — 标记后用ol包裹
  s = s.replace(/^(\d+)\. (.+)$/gm, '<li data-n="$1">$2</li>');
  
  // 任务列表 — ul包裹
  s = s.replace(/(<li class="task.*?<\/li>\n?)+/g, '<ul class="task-list">$&</ul>');

  // 有序列表 — ol包裹
  s = s.replace(/(<li data-n=.*?<\/li>\n?)+/g, '<ol>$&</ol>');

  // 无序列表
  s = s.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>(?!<\/li>).*<\/li>\n?)+/g, '<ul>$&</ul>');

  // 段落
  s = s.replace(/\n\n+/g, '</p><p>');
  s = s.replace(/\n/g, '<br>');

  // 行内格式
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 链接和图片
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // 恢复代码块
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => {
    const b = blocks[+i];
    return '<pre><code class="' + (b.lang || '') + '">' + b.code + '</code></pre>';
  });

  return '<p>' + s + '</p>';
}

function renderLive() { document.getElementById('notePreview').innerHTML = md2html(document.getElementById('noteContent').value); markDirty(); }

async function loadNotesList() {
  try {
    const q = document.getElementById('noteSearch')?.value || '';
    const url = '/api/notes' + (q ? '?q=' + encodeURIComponent(q) : '');
    const notes = await (await fetch(url)).json();
    const list = document.getElementById('noteList');
    if (!notes.length) { list.innerHTML = '<div class="empty-state">' + (q ? '无匹配笔记' : '还没有笔记') + '</div>'; return; }
    list.innerHTML = notes.map(n => `<div class="note-list-item${currentNoteId === n.id ? ' active' : ''}" onclick="openNote('${n.id}')"><span class="ntitle">${escHtml(n.title || '无标题')}</span><span class="ndate">${new Date(n.updated).toLocaleDateString('zh-CN')}</span></div>`).join('');
  } catch(e) { console.error(e); }
}

async function newNote() {
  if (noteDirty && !confirm('当前笔记未保存，是否放弃？')) return;
  currentNoteId = null; noteDirty = false;
  document.getElementById('noteEditor').style.display = 'flex';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteContent').value = '';
  document.getElementById('notePreview').innerHTML = '';
  document.getElementById('noteTitle').focus();
  document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
  markClean(); startAutoSave();
}

async function openNote(id) {
  if (noteDirty && id !== currentNoteId && !confirm('当前笔记未保存，是否放弃？')) return;
  try {
    const note = await (await fetch('/api/notes/' + id)).json();
    currentNoteId = id;
    document.getElementById('noteEditor').style.display = 'flex';
    document.getElementById('noteTitle').value = note.title;
    document.getElementById('noteContent').value = note.content;
    renderLive(); markClean();
    document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.note-list-item').forEach(el => { if (el.getAttribute('onclick')?.includes(id)) el.classList.add('active'); });
    startAutoSave();
  } catch(e) { console.error(e); }
}

document.addEventListener('DOMContentLoaded', () => { const t = document.getElementById('noteTitle'); if (t) t.addEventListener('input', markDirty); });

async function saveNote() {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value;
  if (!title && !content) { toast('⚠️ 标题和内容不能都为空'); return; }
  const body = { title: title || '无标题', content };
  if (currentNoteId) body.id = currentNoteId;
  try {
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    currentNoteId = data.id; markClean();
    toast('✅ 已保存'); loadNotesList();
  } catch(e) { toast('❌ 保存失败'); }
}

async function deleteNote() {
  if (!currentNoteId) { toast('⚠️ 还没有保存的笔记'); return; }
  if (!confirm('确定删除这篇笔记？')) return;
  try {
    await fetch('/api/notes/' + currentNoteId, { method: 'DELETE' });
    currentNoteId = null; noteDirty = false;
    document.getElementById('noteEditor').style.display = 'none';
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
    markClean(); stopAutoSave();
    toast('🗑️ 已删除'); loadNotesList();
  } catch(e) { toast('❌ 删除失败'); }
}

function startAutoSave() { stopAutoSave(); autoSaveTimer = setInterval(() => { if (noteDirty) saveNoteSilent(); }, 30000); }
function stopAutoSave() { if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; } }

async function saveNoteSilent() {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value;
  if (!title && !content) return;
  const body = { title: title || '无标题', content };
  if (currentNoteId) body.id = currentNoteId;
  try {
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    currentNoteId = data.id; markClean();
    document.getElementById('saveIndicator').textContent = '● 已自动保存';
    setTimeout(() => { if (!noteDirty) document.getElementById('saveIndicator').textContent = ''; }, 2000);
    loadNotesList();
  } catch(e) {}
}

function exportPDF() {
  const title = document.getElementById('noteTitle').value || '笔记';
  const html = document.getElementById('notePreview').innerHTML;
  const style = 'body{font-family:sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.8;color:#333;}code{background:#f0f0f0;padding:2px 6px;border-radius:4px;}pre{background:#f5f5f5;padding:1rem;border-radius:8px;overflow-x:auto;}pre code{background:none;padding:0;}h1,h2,h3{margin-top:1.5em;}img{max-width:100%;}';
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${style}</style></head><body><h1>${title}</h1>${html}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function insertMd(before, after) {
  const ta = document.getElementById('noteContent');
  const s = ta.selectionStart, e = ta.selectionEnd, txt = ta.value.substring(s, e);
  ta.value = ta.value.substring(0, s) + before + txt + after + ta.value.substring(e);
  ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + txt.length);
  renderLive();
}

// ===== 阅读器 =====
const READABLE_EXTS = ['epub','pdf','txt','md','jpg','jpeg','png','gif','webp','svg','bmp','mp4','webm','mov','mkv','mp3','wav','ogg','flac','aac'];
let currentBook = null;
let readerEpubRendition = null; // EPUB 翻页用
let readerEpubBook = null;
let readerType = null; // 'epub' | 'pdf' | 'txt' | 'image' | 'video' | 'audio'

async function loadReaderBooks() {
  try {
    const resp = await (await fetch('/api/files')).json();
    const files = resp.files || [];
    const books = files.filter(f => !f.isDir && READABLE_EXTS.includes(f.name.split('.').pop().toLowerCase()));
    const el = document.getElementById('readerBooks');
    const empty = document.getElementById('readerEmpty');
    if (!books.length) { el.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    
    const icons = { epub:'📗', pdf:'📕', txt:'📄', md:'📝', jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', webp:'🖼️', svg:'🖼️', bmp:'🖼️', mp4:'🎬', webm:'🎬', mov:'🎬', mkv:'🎬', mp3:'🎵', wav:'🎵', ogg:'🎵', flac:'🎵', aac:'🎵' };
    el.innerHTML = books.map(b => {
      const ext = b.name.split('.').pop().toLowerCase();
      const progress = JSON.parse(localStorage.getItem('read-' + b.name) || '{}');
      const pct = progress.pct ? ' · ' + progress.pct + '%' : '';
      return '<div class="book-card" onclick="openBook(\'' + escAttr(b.name) + '\')">' +
        '<span class="cover">' + (icons[ext]||'📘') + '</span>' +
        '<span class="btitle">' + escHtml(b.name) + '</span>' +
        '<span class="bprogress">' + fmtFileSize(b.size) + pct + '</span></div>';
    }).join('');
  } catch(e) { console.error(e); }
}

function fmtFileSize(b) { return b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'K':(b/1048576).toFixed(1)+'M'; }

async function openBook(name) {
  const ext = name.split('.').pop().toLowerCase();
  currentBook = name;
  readerType = ext;
  readerEpubRendition = null;
  readerEpubBook = null;
  document.getElementById('readerShelf').style.display = 'none';
  document.getElementById('readerView').style.display = 'block';
  document.getElementById('readerTitle').textContent = name;
  
  // 恢复阅读进度
  const progress = JSON.parse(localStorage.getItem('read-' + name) || '{}');
  const theme = localStorage.getItem('reader-theme') || 'light';
  const fontSize = localStorage.getItem('reader-font') || '18';
  document.getElementById('readerTheme').value = theme;
  document.getElementById('readerFont').value = fontSize;
  
  const content = document.getElementById('readerContent');
  content.innerHTML = '<div style="text-align:center;padding:3rem;">⏳ 加载中...</div>';
  
  if (ext === 'pdf') {
    // PDF: browser's built-in viewer
    content.innerHTML = '<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem;"><a href="/api/dl/' + encodeURIComponent(name) + '" class="btn-sm" style="text-decoration:none;">⬇ 下载</a></div><iframe src="/api/view/' + encodeURIComponent(name) + '" style="width:100%;height:100%;border:none;"></iframe>';
  } else if (['jpg','jpeg','png','gif','webp','svg','bmp'].includes(ext)) {
    // 图片预览 + OCR
    content.innerHTML = `
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.8rem;flex-wrap:wrap;">
        <button class="btn-sm" onclick="ocrInReader('${escAttr(name)}')" id="readerOcrBtn">🔍 OCR 识别</button>
        <a href="/api/dl/${encodeURIComponent(name)}" class="btn-sm" style="text-decoration:none;">⬇ 下载</a>
      </div>
      <div style="overflow:auto;text-align:center;">
        <img src="/api/view/${encodeURIComponent(name)}" style="max-width:100%;max-height:70vh;" onerror="this.parentElement.innerHTML='<div style=text-align:center;padding:3rem;>❌ 无法加载图片</div>'">
      </div>
      <div id="readerOcrResult" style="margin-top:.8rem;padding:.8rem;background:var(--card);border:1px solid var(--border);border-radius:8px;font-size:.9rem;white-space:pre-wrap;word-break:break-word;display:none;"></div>
    `;
  } else if (['mp4','webm','mov','mkv'].includes(ext)) {
    content.innerHTML = `
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.8rem;flex-wrap:wrap;">
        <a href="/api/m3u/${encodeURIComponent(name)}" class="btn-sm" style="text-decoration:none;background:#f97316;color:#fff;">📺 外部播放器</a>
        <a href="/api/dl/${encodeURIComponent(name)}" class="btn-sm" style="text-decoration:none;">⬇ 下载</a>
      </div>
      <video controls style="max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:6px;"><source src="/api/view/${encodeURIComponent(name)}"></video>
    `;
  } else if (['mp3','wav','ogg','flac','aac'].includes(ext)) {
    content.innerHTML = `
      <div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.8rem;flex-wrap:wrap;">
        <a href="/api/dl/${encodeURIComponent(name)}" class="btn-sm" style="text-decoration:none;">⬇ 下载</a>
      </div>
      <div style="text-align:center;padding:2rem;"><div style="font-size:4rem;">🎵</div>
      <audio controls style="width:100%;max-width:400px;margin-top:1rem;"><source src="/api/view/${encodeURIComponent(name)}"></audio></div>
    `;
  } else if (ext === 'epub') {
    // EPUB: use epub.js
    if (typeof ePub === 'undefined') {
      content.innerHTML = '<div style="text-align:center;padding:3rem;">❌ epub.js 未加载，刷新页面重试</div>';
      return;
    }
    try {
      const url = location.origin + '/api/view/' + encodeURIComponent(name);
      const book = ePub(url);
      readerEpubBook = book;
      const rendition = book.renderTo(content, { 
        width: '100%', height: '100%', 
        flow: 'paginated',
        spread: 'none',
        manager: 'default'
      });
      readerEpubRendition = rendition;
      
      // 显示位置
      const pos = document.getElementById('readerPosition');
      pos.textContent = '第 1 页';
      
      // 进度更新
      rendition.on('relocated', function(loc) {
        if (loc.location && loc.location.start) {
          const cfi = loc.location.start.cfi;
          if (book.locations) {
            const pct = Math.round(book.locations.percentageFromCfi(cfi) * 100);
            const fill = document.getElementById('readerProgressFill');
            if (fill) fill.style.width = pct + '%';
            localStorage.setItem('read-' + name, JSON.stringify({ location: cfi, pct }));
          }
          // 页面信息
          if (loc.location.start.displayed) {
            pos.textContent = '第 ' + (loc.location.start.displayed.page + 1) + ' 页 / 共 ' + (loc.location.start.displayed.total || '?') + ' 页';
          }
        }
      });
      
      // Table of contents
      book.loaded.navigation.then(nav => {
        const toc = document.getElementById('readerTOC');
        toc.innerHTML = nav.toc.map(item => 
          '<div style="padding:.3rem .5rem;cursor:pointer;font-size:.8rem;border-radius:4px;" onclick="document.getElementById(\'readerTOC\').style.display=\'none\'" data-href="' + item.href + '">' + item.label + '</div>'
        ).join('');
        toc.querySelectorAll('div').forEach(el => {
          el.addEventListener('click', () => rendition.display(el.dataset.href));
        });
      });
      
      // Restore position
      book.ready.then(() => book.locations.generate(1000).then(() => {
        if (progress.location) rendition.display(progress.location);
        else rendition.display();
      }));
    } catch(e) {
      content.innerHTML = '<div style="text-align:center;padding:3rem;">❌ EPUB 加载失败<br><small>' + e.message + '</small></div>';
    }
  } else {
    // TXT/MD: fetch and render
    try {
      const r = await fetch('/api/preview/' + encodeURIComponent(name));
      const text = await r.text();
      const html = ext === 'md' ? md2html(text) : '<p>' + escHtml(text).replace(/\n/g, '<br>') + '</p>';
      content.innerHTML = '<div class="reader-content-inner">' + html + '</div>';
      // Restore scroll
      if (progress.scroll) content.scrollTop = progress.scroll;
      // Save progress on scroll
      content.addEventListener('scroll', () => {
        const pct = Math.round(content.scrollTop / (content.scrollHeight - content.clientHeight) * 100);
        localStorage.setItem('read-' + name, JSON.stringify({ scroll: content.scrollTop, pct }));
        const fill = document.getElementById('readerProgressFill');
        if (fill) fill.style.width = pct + '%';
        const pos = document.getElementById('readerPosition');
        if (pos) pos.textContent = pct + '%';
      });
    } catch(e) {
      content.innerHTML = '<div style="text-align:center;padding:3rem;">❌ 加载失败</div>';
    }
  }
  
  updateReaderSettings();
}

function closeReader() {
  document.getElementById('readerShelf').style.display = 'block';
  document.getElementById('readerView').style.display = 'none';
  document.getElementById('readerContent').innerHTML = '';
  readerEpubRendition = null;
  readerEpubBook = null;
  currentBook = null;
  readerType = null;
  if (document.fullscreenElement) document.exitFullscreen();
  loadReaderBooks();
}

// ===== 阅读器内 OCR =====
async function ocrInReader(name) {
  const btn = document.getElementById('readerOcrBtn');
  const resultDiv = document.getElementById('readerOcrResult');
  btn.disabled = true; btn.textContent = '⏳ 识别中...';
  resultDiv.style.display = 'block';
  resultDiv.textContent = '正在识别文字，请稍候...';
  try {
    const r = await fetch('/api/ocr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const data = await r.json();
    if (data.error) { resultDiv.textContent = '❌ ' + data.error; return; }
    resultDiv.textContent = data.text || '（未识别到文字）';
  } catch(e) { resultDiv.textContent = '❌ 请求失败：' + e.message; }
  finally { btn.disabled = false; btn.textContent = '🔍 OCR 识别'; }
}

// ===== 键盘控制 =====
document.addEventListener('keydown', function(e) {
  if (!currentBook) return;
  const content = document.getElementById('readerContent');
  
  if (e.key === 'Escape') { closeReader(); return; }
  
  // F: 全屏
  if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
    const view = document.getElementById('readerView');
    document.fullscreenElement ? document.exitFullscreen() : view.requestFullscreen();
    return;
  }
  
  // EPUB: ← → 翻页
  if (e.key === 'ArrowLeft' && readerEpubRendition) {
    e.preventDefault(); readerEpubRendition.prev(); return;
  }
  if (e.key === 'ArrowRight' && readerEpubRendition) {
    e.preventDefault(); readerEpubRendition.next(); return;
  }
  
  // TXT/MD: 空格/上下键滚动
  if (e.key === ' ') { e.preventDefault(); content.scrollBy({ top: content.clientHeight * 0.8, behavior: 'smooth' }); }
  if (e.key === 'ArrowDown') { e.preventDefault(); content.scrollBy({ top: 60, behavior: 'smooth' }); }
  if (e.key === 'ArrowUp') { e.preventDefault(); content.scrollBy({ top: -60, behavior: 'smooth' }); }
});

function updateReaderSettings() {
  const theme = document.getElementById('readerTheme').value;
  const fontSize = document.getElementById('readerFont').value;
  localStorage.setItem('reader-theme', theme);
  localStorage.setItem('reader-font', fontSize);
  
  const content = document.getElementById('readerContent');
  content.className = 'reader-' + theme;
  content.style.fontSize = fontSize + 'px';
  
  // Also update inner content
  const inner = content.querySelector('.reader-content-inner');
  if (inner) inner.style.fontSize = fontSize + 'px';
}

function toggleTOC() {
  const toc = document.getElementById('readerTOC');
  toc.style.display = toc.style.display === 'none' ? 'block' : 'none';
}

// ===== 自动滚屏 =====
let autoScrollTimer = null;
let autoScrollSpeed = 3; // 默认速度

function toggleAutoScroll() {
  const btn = document.getElementById('autoScrollBtn');
  if (autoScrollTimer) {
    clearInterval(autoScrollTimer); autoScrollTimer = null;
    btn.textContent = '⏯ 自动滚屏';
    btn.style.background = ''; btn.style.color = '';
    return;
  }
  autoScrollTimer = setInterval(() => {
    const content = document.getElementById('readerContent');
    if (!content || !currentBook) { clearInterval(autoScrollTimer); return; }
    content.scrollTop += autoScrollSpeed * 0.3;
    if (content.scrollTop >= content.scrollHeight - content.clientHeight - 10) {
      clearInterval(autoScrollTimer); autoScrollTimer = null;
      btn.textContent = '⏯ 自动滚屏'; btn.style.background = ''; btn.style.color = '';
      toast('📖 已到末尾');
    }
  }, 30);
  updateScrollBtn();
}

function updateScrollBtn() {
  const btn = document.getElementById('autoScrollBtn');
  if (!autoScrollTimer) return;
  const label = autoScrollSpeed <= 1 ? '🐢' : autoScrollSpeed <= 2 ? '🐌' : autoScrollSpeed <= 4 ? '🚶' : autoScrollSpeed <= 7 ? '🏃' : '🚀';
  btn.textContent = '⏸ ' + label + ' ×' + autoScrollSpeed;
  btn.style.background = 'var(--accent)'; btn.style.color = '#fff';
}

// 滚轮调速
const readerWheelHandler = function(e) {
  if (!autoScrollTimer) return;
  e.preventDefault();
  autoScrollSpeed = Math.max(1, Math.min(20, autoScrollSpeed + (e.deltaY > 0 ? 0.5 : -0.5)));
  updateScrollBtn();
};
document.getElementById('readerContent')?.addEventListener('wheel', readerWheelHandler, { passive: false });

// 键盘调速（+/- 键）
document.addEventListener('keydown', function(e) {
  if (!autoScrollTimer) return;
  if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    autoScrollSpeed = Math.min(20, autoScrollSpeed + 1);
    updateScrollBtn();
  }
  if (e.key === '-') {
    e.preventDefault();
    autoScrollSpeed = Math.max(1, autoScrollSpeed - 1);
    updateScrollBtn();
  }
});

// ===== 划词→笔记 =====
document.addEventListener('mouseup', function(e) {
  if (!currentBook) return;
  const sel = window.getSelection();
  const text = sel.toString().trim();
  if (!text || text.length < 3) return;
  
  // 创建浮动按钮
  const existing = document.getElementById('selectionPopup');
  if (existing) existing.remove();
  
  const popup = document.createElement('div');
  popup.id = 'selectionPopup';
  popup.style.cssText = 'position:fixed;z-index:999;background:var(--accent);color:#fff;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
  popup.textContent = '💾 保存到笔记';
  popup.style.left = Math.min(e.clientX + 10, window.innerWidth - 140) + 'px';
  popup.style.top = (e.clientY - 35) + 'px';
  popup.addEventListener('click', async function() {
    const title = text.slice(0, 30) + (text.length > 30 ? '...' : '');
    const note = {
      title: '📖 ' + title,
      content: '> ' + text.replace(/\n/g, '\n> ') + '\n\n---\n*来源：' + currentBook + '*',
    };
    try {
      await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      });
      toast('✅ 已保存到笔记');
    } catch(e) { toast('❌ 保存失败'); }
    popup.remove();
  });
  document.body.appendChild(popup);
  
  // 3秒后自动消失
  setTimeout(() => popup.remove(), 3000);
});

// ===== 刷新恢复面板 =====
(function(){
  const hash = location.hash.slice(1);
  const valid = ['home','files','notes','scrape','read'];
  if (hash && valid.includes(hash)) switchPanel(hash);
})();

// ===== 鼠标特效 =====
(function(){
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let w, h;
  const particles = [];
  const maxParticles = 30;
  let mouseX = -100, mouseY = -100;
  const colors = ['#818cf8','#a78bfa','#f472b6','#34d399','#fbbf24','#60a5fa'];

  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', e => {
    mouseX = e.clientX; mouseY = e.clientY;
    addParticle();
  });

  function addParticle() {
    if (particles.length >= maxParticles) particles.shift();
    particles.push({
      x: mouseX, y: mouseY,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      life: 1,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 4 + 2,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.floor(p.life * 255).toString(16).padStart(2,'0');
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  draw();
})();

// ===== 图片粘贴 & 拖拽 =====
(function(){
  const ta = document.getElementById('noteContent');
  if (!ta) return;

  ta.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const ext = item.type.split('/')[1] || 'png';
        const name = 'note_' + Date.now() + '.' + ext;
        await uploadNoteImage(item.getAsFile(), name);
        break;
      }
    }
  });

  ta.addEventListener('drop', async (e) => {
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        e.preventDefault();
        const name = 'note_' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.]/g, '_');
        await uploadNoteImage(file, name);
      }
    }
  });
  ta.addEventListener('dragover', (e) => { e.preventDefault(); });
})();

function insertImage() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) {
      const name = 'note_' + Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9.]/g, '_');
      await uploadNoteImage(file, name);
    }
  };
  input.click();
}

async function uploadNoteImage(blob, name) {
  const ta = document.getElementById('noteContent');
  const s = ta.selectionStart;
  const v = ta.value;
  const placeholder = '![上传中...]()';
  ta.value = v.slice(0, s) + placeholder + v.slice(s);
  renderLive();
  try {
    const form = new FormData();
    form.append('file', blob, name);
    const r = await fetch('/api/files?notes=1', { method: 'POST', body: form });
    const data = await r.json();
    if (data.uploaded?.length) {
      const fname = data.uploaded[0].name;
      const url = '/api/view/' + encodeURIComponent(fname);
      const md = '![](' + url + ')';
      ta.value = ta.value.replace(placeholder, md);
    } else {
      ta.value = ta.value.replace(placeholder, '');
      toast('❌ 图片上传失败');
    }
  } catch(e) {
    ta.value = ta.value.replace(placeholder, '');
    toast('❌ 上传失败：' + e.message);
  }
  renderLive();
}

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

// ===== 字数统计 =====
function updateWordCount() {
  const text = document.getElementById('noteContent')?.value || '';
  const el = document.getElementById('wordCount');
  const rt = document.getElementById('readTime');
  if (!el) return;

  // 统计中文字数 + 英文单词数
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const englishWords = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .split(/\s+/).filter(w => w.length > 0).length;
  const totalChars = text.length;
  const totalWords = chineseChars + englishWords;

  // 阅读时间：中文300字/分钟，英文200词/分钟
  const readMin = Math.max(1, Math.round(totalWords / 300));

  el.textContent = `📊 ${totalWords} 字${chineseChars > 0 && englishWords > 0 ? `（中${chineseChars} / 英${englishWords}）` : ''}`;
  rt.textContent = readMin <= 1 ? '〜1分钟' : `〜${readMin}分钟`;
}

// ===== 作品管理 =====
let currentWorkFilter = '';

async function loadWorks() {
  try {
    const works = await (await fetch('/api/works')).json();
    // 填充筛选下拉
    const filter = document.getElementById('workFilter');
    if (!filter) return;
    const currentVal = filter.value;
    filter.innerHTML = '<option value="">📚 全部笔记</option>' +
      works.map(w => `<option value="${escAttr(w.id)}">${escHtml(w.title)} (${w.chapterCount}章)</option>`).join('');
    if (currentVal) filter.value = currentVal;

    // 填充编辑器的作品下拉
    const sel = document.getElementById('noteWorkId');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">无作品</option>' +
        works.map(w => `<option value="${escAttr(w.id)}">${escHtml(w.title)}</option>`).join('');
      if (cur) sel.value = cur;
    }

    // 填充作品管理弹窗
    const list = document.getElementById('workList');
    if (!list) return;
    if (!works.length) { list.innerHTML = '<div class="empty-state">还没有作品，在上面创建一个吧</div>'; return; }

    list.innerHTML = await Promise.all(works.map(async w => {
      const full = await (await fetch('/api/works/' + w.id)).json();
      const chapters = full.chapters || [];
      // 获取章节标题
      const chapterNames = chapters.map(cid => {
        // 从本地加载过的笔记列表取标题
        return cid;
      });
      // 获取所有笔记来找标题
      let notes = [];
      try { notes = await (await fetch('/api/notes')).json(); } catch {}
      const noteMap = {};
      notes.forEach(n => { noteMap[n.id] = n; });

      const chapterHtml = chapters.map((cid, i) => {
        const note = noteMap[cid];
        return `<div class="work-chapter-item" draggable="true">
          <span class="ch-order">${i + 1}</span>
          <span class="ch-title">${escHtml(note?.title || '(已删除)')}</span>
          <span class="ch-del" onclick="removeChapterFromWork('${escAttr(w.id)}','${escAttr(cid)}')">✕</span>
        </div>`;
      }).join('') || '<div class="empty-state" style="font-size:.7rem;padding:.2rem;">暂无章节</div>';

      return `<div class="work-card">
        <div class="work-card-header">
          <div>
            <div class="work-card-title">${escHtml(w.title)}</div>
            <div class="work-card-meta">${w.fandom ? escHtml(w.fandom) + ' · ' : ''}${w.chapterCount} 章 · ${new Date(w.updated).toLocaleDateString('zh-CN')}</div>
          </div>
          <div class="work-card-actions">
            <button onclick="exportWork('${escAttr(w.id)}','md')" title="导出 Markdown">📥</button>
            <button onclick="exportWork('${escAttr(w.id)}','txt')" title="导出 TXT">📄</button>
            <button onclick="deleteWorkConfirm('${escAttr(w.id)}')" title="删除">🗑</button>
          </div>
        </div>
        <div class="work-chapter-list">${chapterHtml}</div>
      </div>`;
    })).then(arr => arr.join(''));
  } catch {}
}

function filterByWork(workId) {
  currentWorkFilter = workId;
  loadNotesList();
}

function showWorkDialog() {
  document.getElementById('workDialog').classList.add('show');
  document.getElementById('workTitleInput').value = '';
  document.getElementById('workFandomInput').value = '';
  document.getElementById('workDescInput').value = '';
  loadWorks();
}

function hideWorkDialog() {
  document.getElementById('workDialog').classList.remove('show');
}

async function saveWorkFromDialog() {
  const title = document.getElementById('workTitleInput').value.trim();
  if (!title) { toast('⚠️ 请输入作品标题'); return; }
  await fetch('/api/works', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      fandom: document.getElementById('workFandomInput').value.trim(),
      description: document.getElementById('workDescInput').value.trim(),
    }),
  });
  toast('✅ 作品已创建');
  loadWorks();
  loadWorkDropdowns();
}

async function loadWorkDropdowns() {
  await loadWorks(); // reloads the filter and editor dropdowns
}

async function deleteWorkConfirm(id) {
  if (!confirm('确定删除这个作品？（笔记不会被删除）')) return;
  await fetch('/api/works/' + id, { method: 'DELETE' });
  toast('🗑️ 已删除');
  loadWorks();
  loadWorkDropdowns();
}

async function removeChapterFromWork(workId, noteId) {
  if (!confirm('从作品中移除该章节？')) return;
  try {
    const work = await (await fetch('/api/works/' + workId)).json();
    work.chapters = (work.chapters || []).filter(c => c !== noteId);
    await fetch('/api/works/' + workId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(work),
    });
    toast('✅ 已移除');
    loadWorks();
  } catch { toast('❌ 移除失败'); }
}

async function exportWork(workId, format) {
  const a = document.createElement('a');
  a.href = '/api/works/' + workId + '/export?format=' + format;
  a.download = '';
  a.click();
  toast('📥 正在下载…');
}

// 重写 saveNote 以支持 workId 和 chapterOrder（扩展原有函数）
const _origSaveNote = saveNote;
saveNote = async function() {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value;
  if (!title && !content) { toast('⚠️ 标题和内容不能都为空'); return; }
  const body = { title: title || '无标题', content };
  if (currentNoteId) body.id = currentNoteId;

  // 作品关联
  const workId = document.getElementById('noteWorkId')?.value || '';
  const chapterOrder = parseInt(document.getElementById('noteChapterOrder')?.value || '0', 10);
  body.workId = workId;
  body.chapterOrder = chapterOrder;

  try {
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    currentNoteId = data.id;
    markClean();
    toast('✅ 已保存');
    loadNotesList();

    // 如果有作品关联，自动把笔记添加到作品的 chapters 列表中
    if (workId) {
      try {
        const work = await (await fetch('/api/works/' + workId)).json();
        if (work && !work.chapters.includes(data.id)) {
          work.chapters.push(data.id);
          // 按 chapterOrder 排序
          // 先获取所有笔记排序
          const allNotes = await (await fetch('/api/notes')).json();
          const workNotes = allNotes.filter(n => n.workId === workId);
          workNotes.sort((a, b) => (a.chapterOrder || 0) - (b.chapterOrder || 0));
          work.chapters = workNotes.map(n => n.id);
          // 确保当前笔记在列表中
          if (!work.chapters.includes(data.id)) work.chapters.push(data.id);
          await fetch('/api/works/' + workId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(work),
          });
          loadWorks();
        }
      } catch {}
    }
  } catch(e) { toast('❌ 保存失败'); }
};

// 重写 openNote 以加载作品关联
const _origOpenNote = openNote;
openNote = async function(id) {
  if (noteDirty && id !== currentNoteId && !confirm('当前笔记未保存，是否放弃？')) return;
  try {
    const note = await (await fetch('/api/notes/' + id)).json();
    currentNoteId = id;
    document.getElementById('noteEditor').style.display = 'flex';
    if (document.getElementById('noteEditor').style.flexDirection !== 'column')
      document.getElementById('noteEditor').style.flexDirection = 'column';
    document.getElementById('noteTitle').value = note.title;
    document.getElementById('noteContent').value = note.content;
    // 加载作品关联
    const workSel = document.getElementById('noteWorkId');
    if (workSel) {
      workSel.value = note.workId || '';
    }
    const orderSel = document.getElementById('noteChapterOrder');
    if (orderSel) {
      orderSel.value = note.chapterOrder || 0;
    }
    renderLive();
    updateWordCount();
    markClean();
    document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.note-list-item').forEach(el => { if (el.getAttribute('onclick')?.includes(id)) el.classList.add('active'); });
    startAutoSave();
  } catch(e) { console.error(e); }
};

// 重写 newNote 清空作品关联
const _origNewNote = newNote;
newNote = async function() {
  if (noteDirty && !confirm('当前笔记未保存，是否放弃？')) return;
  currentNoteId = null; noteDirty = false;
  document.getElementById('noteEditor').style.display = 'flex';
  if (document.getElementById('noteEditor').style.flexDirection !== 'column')
    document.getElementById('noteEditor').style.flexDirection = 'column';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteContent').value = '';
  document.getElementById('notePreview').innerHTML = '';
  const workSel = document.getElementById('noteWorkId');
  if (workSel) workSel.value = currentWorkFilter || '';
  const orderSel = document.getElementById('noteChapterOrder');
  if (orderSel) orderSel.value = 0;
  updateWordCount();
  document.getElementById('noteTitle').focus();
  document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
  markClean(); startAutoSave();
};

// 重写 loadNotesList 支持作品过滤
const _origLoadNotesList = loadNotesList;
loadNotesList = async function() {
  try {
    let url = '/api/notes';
    const q = document.getElementById('noteSearch')?.value || '';
    if (q) url += '?q=' + encodeURIComponent(q);
    let notes = await (await fetch(url)).json();

    // 按作品过滤
    if (currentWorkFilter) {
      notes = notes.filter(n => n.workId === currentWorkFilter);
    }

    const list = document.getElementById('noteList');
    if (!notes.length) {
      list.innerHTML = '<div class="empty-state">' +
        (q ? '无匹配笔记' : (currentWorkFilter ? '该作品下还没有笔记' : '还没有笔记')) +
        '</div>';
      return;
    }
    list.innerHTML = notes.map(n => {
      const orderStr = n.chapterOrder > 0 ? ` #${n.chapterOrder}` : '';
      return `<div class="note-list-item${currentNoteId === n.id ? ' active' : ''}" onclick="openNote('${n.id}')">
        <span class="ntitle">${escHtml(n.title || '无标题')}${orderStr}</span>
        <span class="ndate">${new Date(n.updated).toLocaleDateString('zh-CN')}</span>
      </div>`;
    }).join('');
  } catch(e) { console.error(e); }
};

// ===== 写作模式切换（笔记 / 小说）=====
let currentWritingMode = 'note';

function setWritingMode(mode) {
  currentWritingMode = mode;
  const titleEl = document.getElementById('writingModeTitle');
  const noteMode = document.getElementById('sidebarNoteMode');
  const novelMode = document.getElementById('sidebarNovelMode');

  if (!titleEl || !noteMode || !novelMode) return;

  if (mode === 'novel') {
    titleEl.textContent = '📖 小说';
    noteMode.style.display = 'none';
    novelMode.style.display = 'block';
  } else {
    titleEl.textContent = '📝 笔记';
    noteMode.style.display = 'block';
    novelMode.style.display = 'none';
  }
}

// 重写 loadNotesList 支持模式过滤
loadNotesList = async function() {
  try {
    let url = '/api/notes';
    const q = document.getElementById('noteSearch')?.value || '';
    if (q) url += '?q=' + encodeURIComponent(q);
    let notes = await (await fetch(url)).json();

    // 模式过滤
    if (currentWritingMode === 'novel') {
      // 小说模式：只显示有关联作品的笔记（章节）
      notes = notes.filter(n => n.workId && n.workId !== '');
    } else {
      // 笔记模式：只显示无作品关联的笔记
      notes = notes.filter(n => !n.workId || n.workId === '');
    }

    const list = document.getElementById('noteList');
    if (!notes.length) {
      list.innerHTML = '<div class="empty-state">' +
        (q ? '无匹配' : (currentWritingMode === 'novel' ? '还没有章节' : '还没有笔记')) +
        '</div>';
      return;
    }
    list.innerHTML = notes.map(n => {
      const orderStr = n.chapterOrder > 0 ? ` #${n.chapterOrder}` : '';
      return `<div class="note-list-item${currentNoteId === n.id ? ' active' : ''}" onclick="openNote('${n.id}')">
        <span class="ntitle">${escHtml(n.title || '无标题')}${orderStr}</span>
        <span class="ndate">${new Date(n.updated).toLocaleDateString('zh-CN')}</span>
      </div>`;
    }).join('');
  } catch(e) { console.error(e); }
};

// ===== 导出函数 =====
async function exportNote(format) {
  const title = document.getElementById('noteTitle')?.value.trim();
  const content = document.getElementById('noteContent')?.value;
  if (!title && !content) { toast('⚠️ 没有可导出的内容'); return; }

  try {
    const resp = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || '文档', content: content || '', format }),
    });
    if (!resp.ok) { toast('❌ 导出失败'); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const extMap = { md: '.md', txt: '.txt', pdf: '.pdf', docx: '.docx' };
    a.download = (title || '文档') + (extMap[format] || '.md');
    a.click();
    URL.revokeObjectURL(url);
    toast('📥 正在下载 ' + format.toUpperCase());
  } catch(e) {
    toast('❌ 导出失败: ' + e.message);
  }
}
