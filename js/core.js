// ===== 导航 =====
let currentPanel = 'home';

function switchPanel(name) {
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
  const target = document.querySelector(`[data-panel="${name}"]`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (name === 'files') { loadFiles(); updateStorageBar(); }
  if (name === 'notes') {
    loadNotesList();
    if (typeof loadWorks === 'function') loadWorks();
  }
  if (name === 'scrape') loadScrapeSessions();
  if (name === 'read') loadReaderBooks();
  if (name === 'translate' && typeof loadHistory === 'function') loadHistory();
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
    `<a class="link tilt-card" href="${l.url}" target="_blank" rel="noopener"><span class="icon">${l.icon}</span><span class="name">${l.name}</span></a>`
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

// ===== 工具函数 =====
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escAttr(s) { return s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"'); }
function fmtFileSize(b) { return b<1024?b+'B':b<1048576?(b/1024).toFixed(1)+'K':(b/1048576).toFixed(1)+'M'; }

// ===== Del 键全局删除（跨面板）=====
document.addEventListener('keydown', e => {
  if (e.key !== 'Delete') return;
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

// ===== 刷新恢复面板 =====
(function(){
  const hash = location.hash.slice(1);
  const valid = ['home','files','notes','scrape','read','translate','monitors','workflows'];
  if (hash && valid.includes(hash)) switchPanel(hash);
})();


// ===== 背景环境光晕 =====
(function(){
  if (document.getElementById('ambient-orbs')) return;
  const container = document.createElement('div');
  container.id = 'ambient-orbs';
  for (let i = 0; i < 3; i++) {
    const orb = document.createElement('div');
    orb.className = 'ambient-orb';
    container.appendChild(orb);
  }
  document.body.prepend(container);
})();

// ===== 卡片 3D 倾斜效果 =====
(function(){
  let ticking = false;
  document.addEventListener('mousemove', (e) => {
    if (!ticking) {
      requestAnimationFrame(() => {
        const cards = document.querySelectorAll('.tilt-card:hover');
        for (const card of cards) {
          const rect = card.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = (e.clientY - rect.top) / rect.height;
          const tiltX = (y - 0.5) * -12;
          const tiltY = (x - 0.5) * 12;
          card.style.transform = `perspective(600px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
        }
        ticking = false;
      });
      ticking = true;
    }
  });
  document.addEventListener('mouseleave', () => {
    document.querySelectorAll('.tilt-card').forEach(c => c.style.transform = '');
  });
})();


// ===== 鼠标粒子特效 =====
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

// ===== 壁纸弹窗 =====
function openWallpaperModal() {
  const modal = document.getElementById('wpModal');
  if (modal) modal.classList.add('show');
  if (typeof loadWallpapers === 'function') loadWallpapers();
}
function closeWallpaperModal() {
  const modal = document.getElementById('wpModal');
  if (modal) modal.classList.remove('show');
}
