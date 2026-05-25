// js/wallpaper.js - 壁纸管理前端

let wpList = [];
let wpCurrent = null;

async function loadWallpapers() {
  try {
    const r = await fetch('/api/wallpapers');
    const data = await r.json();
    wpList = data.list || [];
    wpCurrent = data.current || null;
  } catch(e) { wpList = []; wpCurrent = null; }
  renderWallpapers();
  applyWallpaperToHome();
}

function renderWallpapers() {
  const grid = document.getElementById('wpGrid');
  const empty = document.getElementById('wpEmpty');
  const current = document.getElementById('wpCurrent');
  if (!grid) return;

  if (!wpList.length) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    if (current) current.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';

  if (current && wpCurrent) {
    current.style.display = 'block';
    const img = document.getElementById('wpCurrentImg');
    if (img) img.src = wpCurrent.path + '?t=' + Date.now();
  }

  grid.innerHTML = wpList.map(wp => `
    <div class="wp-card ${wp.current ? 'wp-active' : ''}" onclick="setWallpaper('${wp.id}')">
      <div style="position:relative;">
        <img src="${wp.path}?t=${Date.now()}" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;display:block;">
        ${wp.current ? '<div style="position:absolute;top:4px;right:4px;font-size:.65rem;background:var(--accent);color:#fff;padding:1px 5px;border-radius:4px;">使用中</div>' : ''}
      </div>
      <div style="display:flex;gap:.3rem;margin-top:.3rem;">
        <button class="btn-sm" onclick="event.stopPropagation();setWallpaper('${wp.id}')" title="设为壁纸"><span class="mi">wallpaper</span></button>
        <button class="btn-sm" onclick="event.stopPropagation();delWallpaper('${wp.id}')" title="删除"><span class="mi">delete</span></button>
      </div>
    </div>
  `).join('');
}

function applyWallpaperToHome() {
  const home = document.getElementById('panel-home');
  if (!home) return;
  if (!wpCurrent) {
    home.style.backgroundImage = '';
    home.style.opacity = '';
    return;
  }
  const url = wpCurrent.path + '?t=' + Date.now();
  const opacity = localStorage.getItem('wpOpacity') || '100';
  home.style.backgroundImage = `url('${url}')`;
  home.style.backgroundSize = 'cover';
  home.style.backgroundPosition = 'center';
  home.style.backgroundRepeat = 'no-repeat';
  home.style.opacity = opacity / 100;
}

async function setWallpaper(id) {
  const r = await fetch('/api/wallpaper/current', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await r.json();
  if (data.ok) {
    wpCurrent = data.wallpaper;
    wpList = wpList.map(w => ({ ...w, current: w.id === id }));
    renderWallpapers();
    applyWallpaperToHome();
    toast('✅ 壁纸已更换');
  }
}

async function shuffleWallpaper() {
  const r = await fetch('/api/wallpaper/random', { method: 'POST' });
  const data = await r.json();
  if (data.ok) {
    wpCurrent = data.wallpaper;
    wpList = wpList.map(w => ({ ...w, current: w.id === wpCurrent.id }));
    renderWallpapers();
    applyWallpaperToHome();
    toast('🎲 随机切换');
  } else {
    toast('⚠️ ' + (data.error || '壁纸库为空'));
  }
}

async function delWallpaper(id) {
  if (!confirm('确定删除这张壁纸？')) return;
  const r = await fetch('/api/wallpaper/del/' + id, { method: 'DELETE' });
  const data = await r.json();
  if (data.ok) {
    wpList = wpList.filter(w => w.id !== id);
    if (wpCurrent && wpCurrent.id === id) wpCurrent = wpList[0] || null;
    renderWallpapers();
    applyWallpaperToHome();
    toast('🗑️ 已删除');
  }
}

function setWallpaperOpacity() {
  const slider = document.getElementById('wpOpacitySlider');
  if (!slider) return;
  slider.style.display = slider.style.display === 'none' ? 'flex' : 'none';
}

function applyWallpaperOpacity(val) {
  localStorage.setItem('wpOpacity', val);
  const home = document.getElementById('panel-home');
  if (home) home.style.opacity = val / 100;
  const valEl = document.getElementById('wpOpacityVal');
  if (valEl) valEl.textContent = val + '%';
}

async function openWpGallery() {
  const modal = document.getElementById('wpGalleryModal');
  if (!modal) return;
  modal.style.display = 'flex';
  loadGalleryFiles();
}

function closeWpGallery() {
  const modal = document.getElementById('wpGalleryModal');
  if (modal) modal.style.display = 'none';
}

function openWpGallery2() {
  document.getElementById('wpFileInput').click();
}

async function loadGalleryFiles() {
  const list = document.getElementById('wpGalleryList');
  if (!list) return;
  list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--sub);">⏳ 加载中...</div>';
  try {
    const r = await fetch('/api/files');
    const files = await r.json();
    const imgs = files.filter(f => !f.isDir && /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name));
    if (!imgs.length) {
      list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--sub);">暂无图片文件</div>';
      return;
    }
    list.innerHTML = imgs.map(f => `
      <label style="cursor:pointer;display:block;">
        <img src="/api/dl/${encodeURIComponent(f.relPath)}" loading="lazy"
          style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;display:block;"
          onclick="saveWpFromFile('${f.relPath.replace(/'/g, "\\'")}')">
        <div style="font-size:.7rem;color:var(--sub);margin-top:.2rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${f.name}">${f.name}</div>
      </label>
    `).join('');
  } catch(e) {
    list.innerHTML = '<div style="grid-column:1/-1;color:var(--danger);">❌ 加载失败</div>';
  }
}

async function saveWpFromFile(relPath) {
  closeWpGallery();
  toast('⏳ 正在添加...');
  try {
    const r = await fetch('/api/wallpapers/save-file?path=' + encodeURIComponent(relPath));
    const data = await r.json();
    if (data.ok) {
      wpList.unshift(data.wallpaper);
      renderWallpapers();
      toast('✅ 壁纸已添加');
    } else {
      toast('❌ ' + (data.error || '添加失败'));
    }
  } catch(e) {
    toast('❌ ' + e.message);
  }
}

async function uploadWallpaperFiles(files) {
  if (!files || !files.length) return;
  toast('⏳ 上传中...');
  let ok = 0;
  for (const f of files) {
    const form = new FormData();
    form.append('file', f);
    const r = await fetch('/api/wallpapers/upload', { method: 'POST', body: form });
    if (r.ok) ok++;
  }
  await loadWallpapers();
  toast('✅ 已添加 ' + ok + ' 张壁纸');
}

// 从采集结果保存到壁纸库
async function saveToWallpaper(sid, fname) {
  try {
    const r = await fetch('/api/scrape/save-wallpaper/' + sid, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: fname }),
    });
    const data = await r.json();
    if (data.ok) {
      wpList.unshift(data.wallpaper);
      renderWallpapers();
      toast('✅ 已存为壁纸');
    } else {
      toast('❌ ' + (data.error || '失败'));
    }
  } catch(e) { toast('❌ ' + e.message); }
}
