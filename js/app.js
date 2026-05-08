// ===== 导航 =====
let currentPanel = 'home';

function switchPanel(name) {
  if (currentPanel === 'notes' && name !== 'notes') {
    if (isNoteDirty() && !confirm('笔记有未保存的修改，是否放弃？')) {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-panel="notes"]').classList.add('active');
      return;
    }
    stopAutoSave();
  }
  currentPanel = name;
  location.hash = name;
  try{localStorage.setItem('lastPanel',name)}catch{}
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-panel="${name}"]`).classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'files') { loadFiles(); updateStorageBar(); }
  if (name === 'notes') loadNotesList();
  if (name === 'scrape') loadScrapeSessions();
  if (name === 'read') loadReaderBooks();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
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
const TOAST_ICONS = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
function toast(msg, type = 'info', duration = 3000) {
  const t = document.getElementById('toast');
  const icon = TOAST_ICONS[type] || '';
  t.innerHTML = icon ? '<span style="margin-right:6px">' + icon + '</span>' + msg : msg;
  t.classList.add('show');
  t.style.pointerEvents = 'auto';
  t.style.cursor = 'pointer';
  t.onclick = function() { this.classList.remove('show'); this.onclick = null; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { t.classList.remove('show'); setTimeout(function() { t.onclick = null; }, 300); }, duration);
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


// ===== 键盘快捷键 =====
document.addEventListener('keydown', e => {
  if (e.ctrlKey && !e.shiftKey && !e.metaKey) {
    const panels = ['home','files','notes','scrape','read'];
    const idx = parseInt(e.key) - 1;
    if (idx >= 0 && idx < panels.length) { e.preventDefault(); switchPanel(panels[idx]); }
  }
  if (e.ctrlKey && e.key === 's') {
    if (currentPanel === 'notes' && document.getElementById('noteEditor').style.display !== 'none') { e.preventDefault(); saveNote(); }
  }
  if (e.ctrlKey && (e.key === 'b' || e.key === 'B') && currentPanel === 'notes') {
    const ta = document.getElementById('noteContent');
    if (ta && document.activeElement === ta) { e.preventDefault(); insertMd('**','**'); }
  }
  if (e.ctrlKey && (e.key === 'i' || e.key === 'I') && currentPanel === 'notes') {
    const ta = document.getElementById('noteContent');
    if (ta && document.activeElement === ta) { e.preventDefault(); insertMd('*','*'); }
  }
    if (e.ctrlKey && e.shiftKey && e.key === 'N') { e.preventDefault(); if (currentPanel === 'notes') newNote(); else { switchPanel('notes'); setTimeout(newNote, 100); } }
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    const searchMap = { files:'fileSearch', notes:'noteSearch', scrape:'scrapeUrls' };
    const el = document.getElementById(searchMap[currentPanel] || '');
    if (el) { el.focus(); el.select(); }
  }
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey) {
    const modal = document.getElementById('previewModal');
    if (modal?.classList.contains('show')) return;
    if (currentPanel !== 'home') { e.preventDefault(); switchPanel('home'); }
  }
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
        try { const e = await r.json(); toast(e.error, 'error'); } catch {}
        return false;
      })
    );
    results.forEach(r => { if (r.value === true) ok++; });
    done += batch.length;
    prog.textContent = `上传中... ${done}/${fileList.length}`;
    await updateStorageBar();
  }
  prog.textContent = '';
  if (ok > 0) toast(`${ok} 个文件上传成功`, 'success');
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
  const extFilter = document.getElementById('fileExtFilter')?.value || '';
  const imgExts = ['jpg','jpeg','png','gif','webp','svg','bmp','ico'];
    let filtered = q ? files.filter(f => f.name.toLowerCase().includes(q)) : files;
  if (imgFilterOn) filtered = filtered.filter(f => !f.isDir && imgExts.includes(f.name.split('.').pop().toLowerCase()));
  if (extFilter) filtered = filtered.filter(f => !f.isDir && f.name.toLowerCase().endsWith('.' + extFilter));

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
        <div class="file-row" style="cursor:default;" onclick="toggleFileCheck(this,event)"
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
        <div class="file-row" style="cursor:default;" onclick="toggleFileCheck(this,event)">
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
    var imgExts2 = ['jpg','jpeg','png','gif','webp','svg','bmp','ico'];
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

// ===== 新建文件 =====
async function newFile() {
  const name = prompt('文件名（如: 笔记.md）:');
  if (!name) return;
  const content = prompt('初始内容（可选）:', '');
  try {
    const blob = new Blob([content || ''], {type:'text/plain'});
    const fd = new FormData(); fd.append('file', blob, name);
    const r = await fetch('/api/files' + (currentDir ? '?dir=' + encodeURIComponent(currentDir) : ''), {method:'POST', body:fd});
    if (!r.ok) { toast('创建失败', 'error'); return; }
    toast(name + ' 已创建', 'success'); loadFiles();
  } catch(e) { toast('创建失败: ' + e.message, 'error'); }
}

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
  navigator.clipboard.writeText(url).then(() => toast('链接已复制', 'success')).catch(() => toast('复制失败', 'error'));
}
function downloadFile(name) { window.open('/api/dl/' + encodeURIComponent(name), '_blank'); }
async function delFile(name) {
  if (!confirm(`确定删除「${name}」？`)) return;
  const r = await fetch('/api/files/' + encodeURIComponent(name), { method: 'DELETE' });
  if (r.ok) { toast('已移入回收站', 'success'); loadFiles(); updateStorageBar(); } else { toast('删除失败', 'error'); }
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
let lastCheckedFile = null;

function toggleFileCheck(row, e) {
  const cb = row.querySelector('.file-check');
  if (!cb) return;
  // Shift+click range selection
  if (e && e.shiftKey && lastCheckedFile) {
    const allCbs = [...document.querySelectorAll('.file-check')];
    const idx1 = allCbs.indexOf(cb);
    const idx2 = allCbs.indexOf(lastCheckedFile);
    if (idx1 !== -1 && idx2 !== -1) {
      const start = Math.min(idx1, idx2);
      const end = Math.max(idx1, idx2);
      for (let i = start; i <= end; i++) {
        allCbs[i].checked = cb.checked || lastCheckedFile.checked;
      }
      updateBatchBar();
      return;
    }
  }
  cb.checked = !cb.checked;
  lastCheckedFile = cb;
  updateBatchBar();
}

function clearSelection() {
  document.querySelectorAll('.file-check').forEach(cb => cb.checked = false);
  document.getElementById('selectAll').checked = false;
  updateBatchBar();
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
  toast(`${ok}/${valid.length} 个文件已移动`, 'success');
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
  toast(`${ok} 个已删除` + (fail ? `，${fail} 个失败` : ''), ok === (ok+fail) ? 'success' : 'warning');
  loadFiles(); updateStorageBar();
}

// ===== 文件夹 & 回收站 =====
let fileViewMode = localStorage.getItem('fileView') || 'list';

let imgFilterOn = false;
function toggleImgFilter() { imgFilterOn = !imgFilterOn; loadFiles(); }

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
  if (data.error) { toast(data.error, 'error'); return; }
  toast('文件夹已创建', 'success');
  loadFiles();
}

async function deleteFolder(name) {
  if (!confirm('确定删除文件夹「' + name + '」？内容将移入回收站')) return;
  await fetch('/api/folders/' + encodeURIComponent(name), { method: 'DELETE' });
  toast('文件夹已移入回收站', 'success');
  loadFiles(); updateStorageBar();
}

async function renameFolder(name) {
  const newName = prompt('新名称:', name);
  if (!newName || !newName.trim()) return;
  const r = await fetch('/api/folders/rename/' + encodeURIComponent(name), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newName: newName.trim() }) });
  const data = await r.json();
  if (data.error) { toast(data.error, 'error'); return; }
  toast('已重命名', 'success');
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
  toast('回收站已清空', 'success');
  loadTrash(); updateStorageBar();
}

async function restoreTrash(name) {
  const r = await fetch('/api/trash/restore/' + encodeURIComponent(name), { method: 'POST' });
  if (r.ok) { toast('已恢复', 'success'); loadTrash(); loadFiles(); updateStorageBar(); }
  else { toast('恢复失败', 'error'); }
}

// ===== 笔记 =====
let currentNoteId = null, noteDirty = false, autoSaveTimer = null;
function isNoteDirty() { return noteDirty; }
function markDirty() { noteDirty = true; document.getElementById('saveIndicator').textContent = '● 未保存'; }
function markClean() { noteDirty = false; document.getElementById('saveIndicator').textContent = ''; }

function md2html(md) {
  let s = (md || '');
  
  // ① 保护代码块和行内代码（防止内部内容被后续替换破坏）
  const codeBlocks = [];
  const inlineCodes = [];
  
  // 先保护行内代码
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    inlineCodes.push(c);
    return '\x01' + (inlineCodes.length - 1) + '\x01';
  });
  
  // 再保护代码块
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push({ lang, code });
    return '\x00' + (codeBlocks.length - 1) + '\x00';
  });
  
  // ② HTML 转义（不在代码块/行内代码内的内容）
  s = s.replace(/&(?!\w+;)/g, '&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  
  // ③ 表格 — 在块级处理之前
  s = s.replace(/^\|(.+)\|\s*$\n\|[-: |]+\|\s*$(?:\n\|.+\|\s*$)*/gm, (match) => {
    const lines = match.trim().split('\n');
    if (lines.length < 2) return match;
    const head = lines[0];
    const body = lines.slice(2);
    const hc = head.split('|').filter(c => c.trim()).map(c => '<th>' + c.trim() + '</th>').join('');
    const rc = body.map(r => '<tr>' + r.split('|').filter(c => c.trim()).map(c => '<td>' + c.trim() + '</td>').join('') + '</tr>').join('');
    return '<table><thead><tr>' + hc + '</tr></thead><tbody>' + rc + '</tbody></table>';
  });
  
  // ④ 水平线
  s = s.replace(/^(?:[-\*_]){3,}\s*$/gm, '<hr>');
  
  // ⑤ 标题
  s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // ⑥ 引用块（支持多行、嵌套）
  s = s.replace(/^(?:&gt;\s?.+\n?)+/gm, (match) => {
    const inner = match.replace(/^&gt;\s?/gm, '').trim();
    return '<blockquote>' + inner.replace(/\n{2,}/g, '<br><br>') + '</blockquote>';
  });
  
  // ⑦ 任务列表
  s = s.replace(/^[*-] \[x\] (.+)$/gim, '<li class="task done"><input type="checkbox" checked onclick="return false"> $1</li>');
  s = s.replace(/^[*-] \[ \] (.+)$/gim, '<li class="task"><input type="checkbox" onclick="return false"> $1</li>');
  
  // ⑧ 有序列表（支持嵌套缩进）
  // 先把有序列表项标记
  s = s.replace(/^(\d+)\.\s+(.+)$/gm, '<li class="olitem">$2</li>');
  
  // ⑨ 无序列表
  s = s.replace(/^[*-]\s+(.+)$/gm, '<li class="ulitem">$1</li>');
  
  // 用 ul/ol 包裹连续的列表项
  // 有序列表
  s = s.replace(/((?:<li class="olitem">.*<\/li>\n?)+)/g, '<ol>$1</ol>');
  // 无序列表和任务列表
  s = s.replace(/((?:<li class="ulitem">.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  // 清理临时 class
  s = s.replace(/ class="(?:ol|ul)item"/g, '');
  
  // ⑩ 用连续空行分隔段落，避免块级元素被再包装
  const lines = s.split('\n');
  let result = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlock = /^<(h[1-6]|hr|table|blockquote|ul|ol|pre|div|p)\b/.test(line) || /^<\/(ul|ol|table|blockquote)>/.test(line);
    if (isBlock) {
      if (inBlock) { result[result.length-1] += '\n' + line; }
      else { result.push(line); inBlock = true; }
    } else if (line.trim() === '') {
      inBlock = false;
    } else {
      if (inBlock) { result[result.length-1] += '\n' + line; }
      else { result.push(line); inBlock = true; }
    }
  }
  s = result.map(block => {
    if (/^<\/?/.test(block.trim())) return block;
    return '<p>' + block.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
  
  // ⑪ 行内格式
  // 注意：代码块占位符   和行内代码占位符  不应该被处理
  // 反转义后处理行内格式
  s = s.replace(/==(.+?)==/g, '<mark>$1</mark>');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/~(.+?)~/g, '<sub>$1</sub>');
  s = s.replace(/\^(.+?)\^/g, '<sup>$1</sup>');
  
  // ⑫ 行内代码恢复
  s = s.replace(/\x01(\d+)\x01/g, (_, i) => {
    const code = inlineCodes[+i];
    return '<code>' + code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code>';
  });
  
  // ⑬ 链接和图片（支持 title）
  s = s.replace(/!\[([^\]]*)\]\(([^)"\s]+)(?:\s+"([^"]+)")?\)/g, '<img src="$2" alt="$1" title="$3" style="max-width:100%">');
  s = s.replace(/\[([^\]]+)\]\(([^)"\s]+)(?:\s+"([^"]+)")?\)/g, '<a href="$2" target="_blank" title="$3">$1</a>');
  
  // ⑭ 自动链接 URL
  s = s.replace(/(?<!")(https?:\/\/[^\s<]+)(?!")/g, '<a href="$1" target="_blank">$1</a>');
  
  // ⑮ 恢复代码块（最后处理）
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => {
    const b = codeBlocks[+i];
    const lang = b.lang || '';
    const code = b.code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return '<pre><code' + (lang ? ' class="language-' + lang + '"' : '') + '>' + code + '</code></pre>';
  });
  
  return s;
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
  document.getElementById('notePreview').innerHTML = content ? md2html(content) : '';
  document.getElementById('noteTagsInput').value = '';
  document.getElementById('notePinBtn')?.classList.remove('pinned');
  document.getElementById('noteTitle').focus();
  document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
  markClean(); startAutoSave();
}

async function openNote(id) {
  if (noteDirty && id !== currentNoteId && !confirm('当前笔记未保存，是否放弃？')) return;
  try {
    const note = await (await fetch('/api/notes/' + id)).json();
    currentNoteId = id;
    try{localStorage.setItem('lastNote',id)}catch{}
    document.getElementById('noteEditor').style.display = 'flex';
    document.getElementById('noteTitle').value = note.title;
    document.getElementById('noteContent').value = note.content;
    const tagsEl = document.getElementById('noteTagsInput');
    if (tagsEl) tagsEl.value = (note.tags||[]).join(', ');
    const pinBtn = document.getElementById('notePinBtn');
    if (pinBtn) { pinBtn.classList.toggle('pinned', !!note.pinned); pinBtn.title = note.pinned ? '取消置顶' : '置顶'; }
    renderLive(); markClean();
    document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.note-list-item').forEach(el => { if (el.getAttribute('onclick')?.includes(id)) el.classList.add('active'); });
    startAutoSave();
  } catch(e) { console.error(e); }
}

document.addEventListener('DOMContentLoaded', () => { const t = document.getElementById('noteTitle'); if (t) t.addEventListener('input', markDirty); });
// Selection word count in notes
document.getElementById('noteContent')?.addEventListener('mouseup', updateSelectionCount);
document.getElementById('noteContent')?.addEventListener('keyup', updateSelectionCount);
function updateSelectionCount() {
  const ta = document.getElementById('noteContent');
  const wc = document.getElementById('wordCount');
  if (!ta || !wc) return;
  const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
  if (sel) {
    const cn = (sel.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)||[]).length;
    const en = sel.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g,'').split(/\s+/).filter(Boolean).length;
    wc.textContent += ' | 选中: ' + (cn + en) + ' 字符';
  }
}
document.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items || currentPanel !== 'files') return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) {
        const name = 'paste_' + Date.now() + '.' + item.type.split('/')[1].replace('jpeg','jpg');
        const fd = new FormData(); fd.append('file', file, name);
        fetch('/api/files' + (currentDir ? '?dir=' + encodeURIComponent(currentDir) : ''), { method: 'POST', body: fd })
          .then(r => { if (r.ok) { toast('截图已上传', 'success'); loadFiles(); } })
          .catch(() => toast('上传失败', 'error'));
      }
      break;
    }
  }
});

async function saveNote() {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value;
  if (!title && !content) { toast('标题和内容不能都为空', 'warning'); return; }
  const tagsEl = document.getElementById('noteTagsInput');
  const tags = tagsEl ? tagsEl.value.split(/[,，\s]+/).filter(Boolean) : [];
  const pinned = document.getElementById('notePinBtn')?.classList.contains('pinned') || false;
  const body = { title: title || '无标题', content, tags, pinned };
  if (currentNoteId) body.id = currentNoteId;
  try {
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    currentNoteId = data.id; markClean();
    toast('已保存', 'success'); loadNotesList();
  } catch(e) { toast('保存失败', 'error'); }
}


function filterTag(tag) {
  const inp = document.getElementById('noteSearch');
  inp.value = tag.startsWith('tag:') ? tag : ('tag:' + tag);
  loadNotesList();
}

async function delNote(id) {
  if (!confirm('删除笔记？')) return;
  await fetch('/api/notes/' + id, { method: 'DELETE' });
  if (currentNoteId === id) { currentNoteId = null; document.getElementById('noteEditor').style.display = 'none'; }
  loadNotesList();
}

function togglePin() {
  const btn = document.getElementById('notePinBtn');
  if (!btn) return;
  btn.classList.toggle('pinned');
  btn.title = btn.classList.contains('pinned') ? '取消置顶' : '置顶';
}

function copyNoteContent() {
  const content = document.getElementById('noteContent').value;
  if (!content) { toast('内容为空', 'warning'); return; }
  navigator.clipboard.writeText(content).then(() => toast('已复制', 'success')).catch(() => toast('复制失败', 'error'));
}

let noteFullscreen = false;
function toggleNoteFullscreen() {
  const editor = document.getElementById('noteEditor');
  const sidebar = document.querySelector('.notes-sidebar');
  const layout = document.querySelector('.notes-layout');
  if (!noteFullscreen) { sidebar.style.display = 'none'; layout.style.height = 'calc(100vh - 160px)'; noteFullscreen = true; }
  else { sidebar.style.display = ''; layout.style.height = ''; noteFullscreen = false; }
}

async function deleteNote() {
  if (!currentNoteId) { toast('还没有保存的笔记', 'warning'); return; }
  if (!confirm('确定删除这篇笔记？')) return;
  try {
    await fetch('/api/notes/' + currentNoteId, { method: 'DELETE' });
    currentNoteId = null; noteDirty = false;
    document.getElementById('noteEditor').style.display = 'none';
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
    markClean(); stopAutoSave();
    toast('已删除', 'success'); loadNotesList();
  } catch(e) { toast('删除失败', 'error'); }
}

function startAutoSave() { stopAutoSave(); autoSaveTimer = setInterval(() => { if (noteDirty) saveNoteSilent(); }, 30000); }
function stopAutoSave() { if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; } }

async function saveNoteSilent() {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value;
  if (!title && !content) return;
  const tagsEl = document.getElementById('noteTagsInput');
  const tags = tagsEl ? tagsEl.value.split(/[,，\s]+/).filter(Boolean) : [];
  const pinned = document.getElementById('notePinBtn')?.classList.contains('pinned') || false;
  const body = { title: title || '无标题', content, tags, pinned };
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
  if (!ta) return;
  const s = ta.selectionStart, e = ta.selectionEnd, txt = ta.value.substring(s, e);
  const beforeLen = before.length;
  ta.focus();
  // Use execCommand fallback for simple cases
  if (ta.setRangeText) {
    ta.setRangeText(before + txt + after);
  } else {
    ta.value = ta.value.substring(0, s) + before + txt + after + ta.value.substring(e);
  }
  const newPos = s + beforeLen + txt.length + after.length;
  ta.selectionStart = ta.selectionEnd = newPos;
  renderLive();
  markDirty();
}

function insertTable() {
  const rows = prompt('行数（不含表头）:', '3');
  const cols = prompt('列数:', '4');
  if (!rows || !cols) return;
  const n = parseInt(rows), m = parseInt(cols);
  if (n < 1 || m < 1) return;
  let table = '| ' + Array(m).fill('标题').join(' | ') + ' |\n';
  table += '| ' + Array(m).fill('---').join(' | ') + ' |\n';
  for (let i = 0; i < n; i++) {
    table += '| ' + Array(m).fill('').join(' | ') + ' |\n';
  }
  const ta = document.getElementById('noteContent');
  if (!ta) return;
  const s = ta.selectionStart;
  ta.value = ta.value.substring(0, s) + table + ta.value.substring(ta.selectionEnd);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + table.length;
  renderLive();
  markDirty();
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
      return '<div class="book-card" style="position:relative;" onclick="openBook(\'' + escAttr(b.name) + '\')">' +
        '<button class="book-del-btn" onclick="event.stopPropagation();delReaderBook(' + escAttr(b.name) + ')" title="移除">&times;</button><span class="cover">' + (icons[ext]||'📘') + '</span>' +
        '<span class="btitle">' + escHtml(b.name) + '</span>' +
        '<span class="bprogress">' + fmtFileSize(b.size) + pct + '</span></div>';
    }).join('');
  } catch(e) { console.error(e); }
}

function delReaderBook(name) { if (!confirm('从书架移除 ' + name.split('/').pop() + '？')) return; localStorage.removeItem('read-' + name); toast('已移除', 'info'); loadReaderBooks(); }

function fmtFileSize(b) { return b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'K':(b/1048576).toFixed(1)+'M'; }

async function openBook(name) {
  const ext = name.split('.').pop().toLowerCase();
  currentBook = name;
  readerType = ext;
  try{localStorage.setItem('lastReaderBook',name)}catch{}
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
      toast('已到末尾', 'info');
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
      toast('已保存到笔记', 'success');
    } catch(e) { toast('保存失败', 'error'); }
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
      toast('图片上传失败', 'error');
    }
  } catch(e) {
    ta.value = ta.value.replace(placeholder, '');
    toast('上传失败：' + e.message, 'error');
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
