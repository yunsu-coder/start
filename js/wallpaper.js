// js/wallpaper.js - 壁纸管理前端

let wpList = [];
let wpCurrent = null;
let carouselTimer = null;
let carouselInterval = 600000; // 10min

async function loadWallpapers() {
  try {
    const r = await fetch('/api/wallpapers');
    const data = await r.json();
    wpList = data.list || [];
    wpCurrent = data.current || null; // 可能 null
  } catch(e) { wpList = []; wpCurrent = null; }
  renderWallpapers();
  applyWallpaper();
}

// ===== 全屏壁纸：用一个 overlay 铺在 body 上 =====
(function initWallpaperOverlay() {
  if (document.getElementById('wpOverlay')) return;
  const div = document.createElement('div');
  div.id = 'wpOverlay';
  div.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    z-index: 0; pointer-events: none;
    background-size: cover; background-position: center; background-repeat: no-repeat;
    opacity: 0; transition: opacity .6s ease;
  `;
  document.body.prepend(div);
})();

function applyWallpaper() {
  const overlay = document.getElementById('wpOverlay');
  if (!overlay) return;
  if (!wpCurrent) {
    overlay.style.opacity = '0';
    overlay.style.backgroundImage = '';
    document.body.style.backgroundColor = '';
    return;
  }
  const url = wpCurrent.path + '?t=' + Date.now();
  const opacity = parseInt(localStorage.getItem('wpOpacity') || '100') / 100;
  overlay.style.backgroundImage = `url('${url}')`;
  overlay.style.opacity = opacity;
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

  if (current) {
    if (wpCurrent) {
      current.style.display = 'block';
      const img = document.getElementById('wpCurrentImg');
      if (img) img.src = wpCurrent.path + '?t=' + Date.now();
    } else {
      current.style.display = 'none';
    }
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

async function setWallpaper(id) {
  stopCarousel();
  const r = await fetch('/api/wallpaper/current', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const data = await r.json();
  if (data.ok) {
    wpCurrent = data.wallpaper;
    wpList = wpList.map(w => ({ ...w, current: w.id === id }));
    renderWallpapers();
    applyWallpaper();
    toast('✅ 壁纸已更换');
  }
}

async function shuffleWallpaper() {
  stopCarousel();
  const r = await fetch('/api/wallpaper/random', { method: 'POST' });
  const data = await r.json();
  if (data.ok) {
    wpCurrent = data.wallpaper;
    wpList = wpList.map(w => ({ ...w, current: w.id === wpCurrent.id }));
    renderWallpapers();
    applyWallpaper();
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
    const wasCurrent = wpCurrent && wpCurrent.id === id;
    wpList = wpList.filter(w => w.id !== id);
    if (wasCurrent) {
      wpCurrent = null;
    }
    renderWallpapers();
    applyWallpaper();
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
  const overlay = document.getElementById('wpOverlay');
  if (overlay) overlay.style.opacity = val / 100;
  const valEl = document.getElementById('wpOpacityVal');
  if (valEl) valEl.textContent = val + '%';
}

function openWpGallery() {
  const modal = document.getElementById('wpGalleryModal');
  if (modal) modal.classList.add('show');
  loadGalleryFiles();
}

function closeWpGallery() {
  const modal = document.getElementById('wpGalleryModal');
  if (modal) modal.classList.remove('show');
}

async function loadGalleryFiles() {
  const list = document.getElementById('wpGalleryList');
  if (!list) return;
  list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--sub);">⏳ 加载中...</div>';
  try {
    const r = await fetch('/api/files');
    const data = await r.json();
    const imgs = (data.files || []).filter(f => !f.isDir && /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name));
    if (!imgs.length) {
      list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--sub);">文件中转站暂无图片</div>';
      return;
    }
    list.innerHTML = imgs.map(f => `
      <div style="cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid var(--border);transition:border-color .2s;"
           onclick="saveWpFromFile('${f.relPath.replace(/'/g, "\\'")}')"
           onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
        <img src="/api/dl/${encodeURIComponent(f.relPath)}?t=${Date.now()}" loading="lazy"
          style="width:100%;aspect-ratio:1;object-fit:cover;display:block;">
        <div style="font-size:.7rem;color:var(--sub);padding:.2rem .3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;">${f.name}</div>
      </div>
    `).join('');
  } catch(e) {
    list.innerHTML = '<div style="grid-column:1/-1;color:var(--danger);text-align:center;">❌ 加载失败</div>';
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

// ===== 壁纸轮播 =====
function toggleCarousel() {
  const btn = document.getElementById('carouselBtn');
  if (carouselTimer) {
    stopCarousel();
    if (btn) btn.textContent = 'play_circle';
    toast('⏸️ 轮播已停止');
    return;
  }
  if (wpList.length < 2) {
    toast('⚠️ 至少需要 2 张壁纸');
    return;
  }
  startCarousel();
  if (btn) btn.textContent = 'pause_circle';
  toast('▶️ 轮播已开始（每 ' + (carouselInterval / 1000) + 's 切换）');
}

function startCarousel() {
  stopCarousel();
  carouselTimer = setInterval(async () => {
    const r = await fetch('/api/wallpaper/next', { method: 'POST' });
    const data = await r.json();
    if (data.ok) {
      wpCurrent = data.wallpaper;
      wpList = wpList.map(w => ({ ...w, current: w.id === wpCurrent.id }));
      renderWallpapers();
      applyWallpaper();
    }
  }, carouselInterval);
}

function stopCarousel() {
  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }
  const btn = document.getElementById('carouselBtn');
  if (btn) btn.textContent = 'play_circle';
}

// 页面离开时暂停轮播
document.addEventListener('visibilitychange', () => {
  if (document.hidden && carouselTimer) stopCarousel();
});
