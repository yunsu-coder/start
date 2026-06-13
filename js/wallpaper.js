// js/wallpaper.js - 壁纸管理前端

S.wpList = [];
S.wpCurrent = null;
S.carouselTimer = null;
const carouselInterval = 600000; // 10min

async function loadWallpapers() {
  try {
    const r = await fetch('/api/wallpapers');
    const data = await r.json();
    S.wpList = data.list || [];
    S.wpCurrent = data.current || null; // 可能 null
  } catch(e) { S.wpList = []; S.wpCurrent = null; }
  renderWallpapers();
  applyWallpaper();
}

// ===== 全屏壁纸：overlay 铺在 body 上 =====
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
  if (!S.wpCurrent) {
    overlay.style.opacity = '0';
    overlay.style.backgroundImage = '';
    document.body.style.backgroundColor = '';
    return;
  }
  document.body.style.backgroundColor = '#f0f0f0';
  const url = '/api/wallpaper/' + encodeURIComponent(S.wpCurrent.filename) + '?t=' + Date.now();
  const opacity = parseInt(localStorage.getItem('wpOpacity') || '100') / 100;
  const img = new Image();
  img.onload = () => {
    overlay.style.backgroundImage = `url('${url}')`;
    overlay.style.opacity = opacity;
  };
  img.onerror = () => {
    overlay.style.backgroundImage = `url('${url}')`;
    overlay.style.opacity = opacity;
  };
  img.src = url;
}

function renderWallpapers() {
  const grid = document.getElementById('wpGrid');
  const empty = document.getElementById('wpEmpty');
  const current = document.getElementById('wpCurrent');
  if (!grid) return;

  if (!S.wpList.length) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'block';
    if (current) current.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';

  if (current) {
    if (S.wpCurrent) {
      current.style.display = 'block';
      const img = document.getElementById('wpCurrentImg');
      if (img) img.src = '/api/wallpaper/' + encodeURIComponent(S.wpCurrent.filename) + '?t=' + Date.now();
    } else {
      current.style.display = 'none';
    }
  }

  grid.innerHTML = S.wpList.map(wp => `
    <div class="wp-card ${wp.current ? 'wp-active' : ''}" onclick="setWallpaper('${wp.id}')">
      <div style="position:relative;">
        <img src="/api/wallpaper/thumb/${encodeURIComponent(wp.filename)}" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;display:block;">
        ${wp.current ? '<div style="position:absolute;top:4px;right:4px;font-size:.65rem;background:var(--accent);color:#fff;padding:1px 5px;border-radius:4px;">使用中</div>' : ''}
      </div>
      <div style="display:flex;gap:.3rem;margin-top:.3rem;">
        <button class="btn-sm" onclick="event.stopPropagation();setWallpaper('${wp.id}')" title="设为壁纸"><span class="mi">wallpaper</span></button>
        <button class="btn-sm" onclick="event.stopPropagation();delWallpaper('${wp.id}')" title="删除"><span class="mi">delete</span></button>
        <button class="btn-sm" onclick="event.stopPropagation();upscaleWallpaper('${wp.id}')" title="AI 超清（服务端处理）"><span class="mi">auto_fix_high</span></button>
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
    S.wpCurrent = data.wallpaper;
    S.wpList = S.wpList.map(w => ({ ...w, current: w.id === id }));
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
    S.wpCurrent = data.wallpaper;
    S.wpList = S.wpList.map(w => ({ ...w, current: w.id === S.wpCurrent.id }));
    renderWallpapers();
    applyWallpaper();
    toast('🎲 随机切换');
  } else {
    toast('⚠️ ' + (data.error || '壁纸库为空'), 'warning');
  }
}

async function delWallpaper(id) {
  if (!confirm('确定删除这张壁纸？')) return;
  const r = await fetch('/api/wallpaper/del/' + id, { method: 'DELETE' });
  const data = await r.json();
  if (data.ok) {
    await loadWallpapers();
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

let wpGalleryDir = '';

function openWpGallery() {
  const modal = document.getElementById('wpGalleryModal');
  if (modal) modal.classList.add('show');
  wpGalleryDir = '';
  loadGalleryFiles();
}

function closeWpGallery() {
  const modal = document.getElementById('wpGalleryModal');
  if (modal) modal.classList.remove('show');
}

function wpGalleryNav(dir) {
  wpGalleryDir = dir || '';
  loadGalleryFiles();
}

async function loadGalleryFiles() {
  const list = document.getElementById('wpGalleryList');
  if (!list) return;
  list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--sub);">⏳ 加载中...</div>';
  try {
    const params = new URLSearchParams();
    if (wpGalleryDir) params.set('dir', wpGalleryDir);
    const r = await fetch('/api/files?' + params.toString());
    const data = await r.json();
    const files = data.files || [];
    const crumbs = data.breadcrumb || [];

    // 面包屑
    const bc = document.getElementById('wpGalleryCrumbs');
    if (bc) {
      bc.innerHTML = crumbs.map((c, i) => {
        const sep = i > 0 ? ' <span style="color:var(--sub);">/</span> ' : '';
        const isLast = i === crumbs.length - 1;
        if (isLast) return sep + '<span style="color:var(--accent);font-weight:600;">' + escHtml(c.name) + '</span>';
        return sep + '<a href="#" onclick="wpGalleryNav(\'' + escAttr(c.path) + '\');return false;" style="color:var(--accent);text-decoration:none;">' + escHtml(c.name) + '</a>';
      }).join('');
    }

    // 没有图片也没有子目录时
    const imgs = files.filter(f => !f.isDir && /\.(jpg|jpeg|png|gif|webp)$/i.test(f.name));
    const dirs = files.filter(f => f.isDir);
    if (!imgs.length && !dirs.length) {
      list.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--sub);">此目录暂无图片</div>';
      return;
    }

    // 子目录卡片
    const dirCards = dirs.map(d => `
      <div style="cursor:pointer;border-radius:8px;overflow:hidden;border:2px dashed var(--border);transition:border-color .2s;display:flex;flex-direction:column;align-items:center;justify-content:center;aspect-ratio:1;"
           onclick="wpGalleryNav('${escAttr(d.relPath)}')"
           onmouseover="this.style.borderColor='var(--accent)';this.style.background='var(--hover)';" onmouseout="this.style.borderColor='var(--border)';this.style.background='';">
        <span class="mi" style="font-size:2rem;color:var(--accent);">folder</span>
        <div style="font-size:.7rem;color:var(--sub);padding:.2rem .3rem;text-align:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;">${escHtml(d.name)}</div>
      </div>
    `).join('');

    // 图片卡片
    const imgCards = imgs.map(f => `
      <div style="cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid var(--border);transition:border-color .2s;"
           onclick="saveWpFromFile('${escAttr(f.relPath)}')"
           onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
        <img src="/api/dl/${encodeURIComponent(f.relPath)}" loading="lazy"
          style="width:100%;aspect-ratio:1;object-fit:cover;display:block;">
        <div style="font-size:.7rem;color:var(--sub);padding:.2rem .3rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;">${escHtml(f.name)}</div>
      </div>
    `).join('');

    list.innerHTML = dirCards + imgCards;
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
      S.wpList.unshift(data.wallpaper);
      renderWallpapers();
      toast('✅ 壁纸已添加');
    } else {
      toast('❌ ' + (data.error || '添加失败'), 'error');
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
      S.wpList.unshift(data.wallpaper);
      renderWallpapers();
      toast('✅ 已存为壁纸');
    } else {
      toast('❌ ' + (data.error || '失败'), 'error');
    }
  } catch(e) { toast('❌ ' + e.message, 'error'); }
}

// ===== AI 超清（服务端：Bigjpg API → sharp 兜底）=====
// Bigjpg 免费 20 张/月，AI 深度学习超分，国内服务速度快
// 配置：在 .env 中设置 BIGJPG_API_KEY=你的Key（登录 bigjpg.com 获取）
async function upscaleWallpaper(id, _unused) {
  const wp = S.wpList.find(w => w.id === id);
  if (!wp) { toast('壁纸不存在', 'error'); return; }
  const ext = (wp.filename || '').split('.').pop().toLowerCase();
  if (ext === 'svg' || ext === 'gif') { toast('SVG/GIF 不支持 AI 超清', 'error'); return; }

  if (!confirm('将用 AI 超分辨率增强这张壁纸\n（Bigjpg 深度学习模型 · 服务端处理）\n继续？')) return;

  const overlay = document.getElementById('wpUpscaleOverlay');
  const barEl = document.getElementById('wpUpscaleBar');
  const pctEl = document.getElementById('wpUpscalePercent');
  const resEl = document.getElementById('wpUpscaleRes');
  const labelEl = document.getElementById('wpUpscaleLabel');
  if (overlay) overlay.classList.add('show');
  if (barEl) { barEl.style.width = '0%'; barEl.classList.remove('done'); }
  if (pctEl) pctEl.textContent = '0%';
  if (labelEl) labelEl.textContent = '🔮 AI 超清处理中...';
  if (resEl) resEl.textContent = 'Bigjpg 深度学习模型';

  const progress = (pct, label, res) => {
    if (barEl) barEl.style.width = Math.round(pct) + '%';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
    if (label && labelEl) labelEl.textContent = label;
    if (res !== undefined && resEl) resEl.textContent = res;
  };
  const closeOverlay = () => { if (overlay) overlay.classList.remove('show'); };

  function refreshWallpaper(updated) {
    if (S.wpCurrent && S.wpCurrent.id === id) { S.wpCurrent = updated; applyWallpaper(); }
    const idx = S.wpList.findIndex(w => w.id === id);
    if (idx >= 0) S.wpList[idx] = updated;
    renderWallpapers();
  }

  try {
    progress(30, '🤖 调用 AI 模型...', 'Bigjpg 深度神经网络超分');
    const r = await fetch('/api/wallpaper/upscale/' + id, { method: 'POST' });
    const data = await r.json();
    progress(90);

    if (data.ok) {
      progress(100, '✅ 超清完成', data.resolution || '');
      if (barEl) barEl.classList.add('done');
      await new Promise(r => setTimeout(r, 600));
      closeOverlay();
      refreshWallpaper(data.wallpaper);
      toast('✅ 超清完成' + (data.resolution.includes('Bigjpg') ? ' (AI)' : ''));
    } else {
      closeOverlay();
      toast('❌ ' + (data.error || '处理失败'), 'error');
    }
  } catch (e) {
    closeOverlay();
    toast('❌ 超清失败: ' + (e.message || '').slice(0, 100), 'error');
  }
}

// ===== 壁纸轮播 =====
function toggleCarousel() {
  const btn = document.getElementById('carouselBtn');
  if (S.carouselTimer) {
    stopCarousel();
    localStorage.setItem('wpCarousel', 'off');
    if (btn) btn.textContent = 'play_circle';
    toast('⏸️ 轮播已停止');
    return;
  }
  if (S.wpList.length < 2) {
    toast('⚠️ 至少需要 2 张壁纸', 'warning');
    return;
  }
  startCarousel();
  localStorage.setItem('wpCarousel', 'on');
  if (btn) btn.textContent = 'pause_circle';
  toast('▶️ 轮播已开始（每 ' + (carouselInterval / 1000) + 's 切换）');
}

function startCarousel() {
  stopCarousel();
  S.carouselTimer = setInterval(async () => {
    const r = await fetch('/api/wallpaper/next', { method: 'POST' });
    const data = await r.json();
    if (data.ok) {
      S.wpCurrent = data.wallpaper;
      S.wpList = S.wpList.map(w => ({ ...w, current: w.id === S.wpCurrent.id }));
      renderWallpapers();
      applyWallpaper();
    }
  }, carouselInterval);
}

function stopCarousel() {
  if (S.carouselTimer) {
    clearInterval(S.carouselTimer);
    S.carouselTimer = null;
  }
  const btn = document.getElementById('carouselBtn');
  if (btn) btn.textContent = 'play_circle';
}

// 页面加载时恢复轮播状态
function restoreCarousel() {
  if (localStorage.getItem('wpCarousel') !== 'on') return;
  if (S.wpList.length < 2) return;
  startCarousel();
  const btn = document.getElementById('carouselBtn');
  if (btn) btn.textContent = 'pause_circle';
}

// 页面离开时暂停轮播
document.addEventListener('visibilitychange', () => {
  if (document.hidden && S.carouselTimer) stopCarousel();
});

// 页面加载时自动恢复壁纸 + 轮播状态
document.addEventListener('DOMContentLoaded', async () => {
  await loadWallpapers();
  restoreCarousel();
});
