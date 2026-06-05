// ===== 全局命名空间 =====
window.Yiwei = window.Yiwei || { state: {}, config: {} };
const S = Yiwei.state; // 状态读写快捷方式

// ===== 导航 =====
S.currentPanel = 'home';

function switchPanel(name) {
  if (S.currentPanel === 'notes' && name !== 'notes') {
    if (typeof isNoteDirty === 'function' && isNoteDirty() && !confirm('笔记有未保存的修改，是否放弃？')) {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-panel="notes"]').classList.add('active');
      return;
    }
    if (typeof stopAutoSave === 'function') stopAutoSave();
  }
  S.currentPanel = name;
  location.hash = name;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const target = document.querySelector(`[data-panel="${name}"]`);
  if (target) target.classList.add('active');
  const newPanel = document.getElementById('panel-' + name);
  document.querySelectorAll('.panel').forEach(p => { if (p !== newPanel) p.classList.remove('active'); });
  if (newPanel) {
    newPanel.classList.add('active');
    // 确保动画触发（首次渲染时强制重排）
    newPanel.offsetHeight;
    newPanel.style.opacity = '';
    newPanel.style.transform = '';
  }
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

// ===== 智能导航栏隐藏（macOS Dock 式 + 滚动方向感知） =====
(function () {
  const nav = document.querySelector('.navbar');
  let lastY = window.scrollY;
  let direction = '';
  let ticking = false;
  let hideTimer = null;
  let mouseNearTop = false;

  const TOP_ZONE = 50;   // 鼠标距顶该距离内视为"贴近导航栏"
  const DELAY = 1500;     // 鼠标离开顶部后多久自动隐藏

  function show() {
    nav.classList.remove('nav-hidden');
    clearTimeout(hideTimer);
  }

  function hide() {
    nav.classList.add('nav-hidden');
    clearTimeout(hideTimer);
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!mouseNearTop) hide();
    }, DELAY);
  }

  function update() {
    const y = window.scrollY;
    const atBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 2;

    if (!atBottom) {
      direction = y > lastY ? 'down' : 'up';
    }

    if (y <= 5) {
      // 页面顶部：始终显示
      show();
    } else if (direction === 'up') {
      // 向上滚动：立即显示，再根据鼠标位置决定是否计时
      show();
      if (!mouseNearTop) scheduleHide();
    } else if (direction === 'down' && y > nav.offsetHeight) {
      // 向下滚动超过导航栏高度：立即隐藏
      hide();
    }

    lastY = y;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });

  window.addEventListener('mousemove', (e) => {
    const wasNearTop = mouseNearTop;
    mouseNearTop = e.clientY <= TOP_ZONE;

    if (mouseNearTop) {
      show();
    } else if (wasNearTop && !mouseNearTop) {
      // 鼠标刚离开顶部：开始倒计时
      scheduleHide();
    }
  }, { passive: true });

  // 页面加载后即开始倒计时（鼠标初始位置不在顶部则自动隐藏）
  scheduleHide();
})();

// ===== 主题 =====
const themes = ['azure','emerald','ember','snow','midnight'];
const themeBtn = document.getElementById('themeBtn');
S.theme = localStorage.getItem('theme') || 'azure';
applyTheme(S.theme);
themeBtn.addEventListener('click', () => {
  const idx = themes.indexOf(S.theme);
  S.theme = themes[(idx + 1) % themes.length];
  localStorage.setItem('theme', S.theme);
  applyTheme(S.theme);
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
    item.onclick = () => { S.theme = t; localStorage.setItem('theme', t); applyTheme(t); themeMenu.remove(); themeMenu = null; };
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
  S.theme = t;
  document.body.setAttribute('data-theme', t);
  themeBtn.textContent = 'palette';
  themeBtn.title = '左键切换主题 | 右键打开菜单';
}

// ===== Toast =====
let toastTimer;
function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast ' + type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), type === 'error' ? 4000 : 2000);
}

// ===== 时钟 =====
function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了，注意休息 🌙';
  if (h < 9) return '早上好，新的一天 ☀️';
  if (h < 12) return '上午好，专注时刻 💪';
  if (h < 14) return '中午好，别忘了吃饭 🍜';
  if (h < 18) return '下午好，效率拉满 ⚡';
  if (h < 22) return '晚上好，放松一下 🌆';
  return '夜深了，早点休息 🌙';
}
function tick() {
  const now = new Date();
  document.getElementById('clock').textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  document.getElementById('date').textContent = now.toLocaleDateString('zh-CN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const g = document.getElementById('greeting');
  if (g) g.textContent = getGreeting();
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
S.lastStatus = null;

async function loadStatus() {
  const el = document.getElementById('status');
  try {
    S.lastStatus = await (await fetch('/api/status')).json();
    el.innerHTML = [
      `<span><span class="dot ${S.lastStatus.mem_pct < 80 ? 'green' : (S.lastStatus.mem_pct < 90 ? 'yellow' : 'red')}"></span>内存 ${S.lastStatus.mem_used}/${S.lastStatus.mem_total}</span>`,
      `<span><span class="dot green"></span>CPU ${S.lastStatus.cpu}%</span>`,
      `<span><span class="dot green"></span>磁盘 ${S.lastStatus.disk_free}</span>`,
      `<span><span class="dot green"></span>运行 ${S.lastStatus.uptime}</span>`,
    ].join(' · ');
    updateStorageBar(S.lastStatus);
  } catch { el.innerHTML = '<span>⚙️ 状态暂不可用</span>'; }
}
loadStatus();
setInterval(loadStatus, 15000);

function updateStorageBar(s) {
  if (!s) {
    if (S.lastStatus) s = S.lastStatus;
    else { loadStatus().then(() => updateStorageBar(S.lastStatus)); return; }
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

  if (S.currentPanel === 'files') {
    const drawer = document.getElementById('trashDrawer');
    if (drawer && drawer.style.display === 'block') { emptyTrash(); return; }
    const checked = document.querySelectorAll('.file-check:checked');
    if (checked.length) { batchDelete(); return; }
  }
  if (S.currentPanel === 'notes' && currentNoteId) { deleteNote(); return; }
  if (S.currentPanel === 'scrape') {
    const checked = document.querySelectorAll('.scrape-check:checked');
    if (checked.length) { batchDelScrape(); return; }
    const first = document.querySelector('.scrape-check');
    if (first) { first.checked = true; updateScrapeBatchBar(); batchDelScrape(); return; }
  }
  if (S.currentPanel === 'read' && currentBook) { closeReader(); return; }
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
    animId = requestAnimationFrame(draw);
  }
  let animId = requestAnimationFrame(draw);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(animId); animId = null; }
    else if (!animId) animId = requestAnimationFrame(draw);
  });
})();

// ===== 全局错误捕获 =====
window.addEventListener('error', function(e) {
  console.error('[Yiwei]', e.error?.stack || e.message);
  if (e.target === window) toast('出错了，按 F12 查看详情', 'error');
});
window.addEventListener('unhandledrejection', function(e) {
  console.error('[Yiwei Promise]', e.reason?.stack || e.reason);
});

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

// ===== 离线检测 =====
(function() {
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.textContent = '⚡ 网络连接已断开';
  banner.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;z-index:10000;background:#eab308;color:#000;text-align:center;padding:.35rem;font-size:.78rem;font-weight:500;';
  document.body.prepend(banner);
  function updateOnline() {
    if (navigator.onLine) { banner.style.display = 'none'; }
    else { banner.style.display = 'block'; }
  }
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
})();

// ===== API 设置 =====
(function () {
  const PRESETS = {
    zhipu: {
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: 'glm-4-flash',
      hint: '推荐<strong>智谱 GLM-4-Flash</strong>（永久免费），<a href="https://open.bigmodel.cn" target="_blank">注册获取 Key →</a>',
    },
    deepseek: {
      baseUrl: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat',
      hint: 'DeepSeek 官方 API，<a href="https://platform.deepseek.com" target="_blank">获取 Key →</a>',
    },
    silicon: {
      baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      model: 'Qwen/Qwen2.5-7B-Instruct',
      hint: 'SiliconFlow 聚合平台，9B 以下模型永久免费，<a href="https://siliconflow.cn" target="_blank">获取 Key →</a>',
    },
    alibaba: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen-plus',
      hint: '阿里百炼，新用户千万 Token 免费额度，<a href="https://dashscope.aliyun.com" target="_blank">获取 Key →</a>',
    },
  };

  const STORAGE_KEY = 'yiwei_api_config';

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  }

  function save(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function getConfig() {
    const cfg = load();
    return {
      apiKey: cfg.apiKey || '',
      baseUrl: cfg.baseUrl || PRESETS.zhipu.baseUrl,
      model: cfg.model || PRESETS.zhipu.model,
    };
  }

  // 暴露给翻译面板使用
  window.getApiConfig = getConfig;

  // 更新 A 按钮状态点
  function updateDot() {
    const dot = document.getElementById('apiDot');
    if (!dot) return;
    const cfg = load();
    if (cfg.apiKey) dot.classList.add('set');
    else dot.classList.remove('set');
  }
  updateDot();

  // 填入 UI
  function fillUI() {
    const cfg = load();
    const keyEl = document.getElementById('apiKeyInput');
    const baseEl = document.getElementById('apiBaseInput');
    const modelEl = document.getElementById('apiModelInput');
    if (keyEl) keyEl.value = cfg.apiKey || '';
    if (baseEl) baseEl.value = cfg.baseUrl || PRESETS.zhipu.baseUrl;
    if (modelEl) modelEl.value = cfg.model || PRESETS.zhipu.model;
    // 高亮当前预设
    highlightPreset(cfg.baseUrl, cfg.model);
  }

  function highlightPreset(baseUrl, model) {
    document.querySelectorAll('.api-presets button').forEach(btn => {
      btn.classList.remove('active');
      const preset = PRESETS[btn.dataset.api];
      if (preset && preset.baseUrl === baseUrl && preset.model === model) {
        btn.classList.add('active');
      }
    });
  }

  // 打开弹窗
  window.openApiModal = function () {
    fillUI();
    document.getElementById('apiModal').classList.add('show');
  };

  document.getElementById('apiBtn').addEventListener('click', window.openApiModal);

  // 关闭弹窗
  window.closeApiModal = function () {
    document.getElementById('apiModal').classList.remove('show');
  };

  // 预设按钮
  document.querySelectorAll('.api-presets button').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = PRESETS[btn.dataset.api];
      if (!preset) return;
      const baseEl = document.getElementById('apiBaseInput');
      const modelEl = document.getElementById('apiModelInput');
      const hintEl = document.getElementById('apiHintText');
      if (baseEl) baseEl.value = preset.baseUrl;
      if (modelEl) modelEl.value = preset.model;
      if (hintEl) hintEl.innerHTML = preset.hint;
      highlightPreset(preset.baseUrl, preset.model);
    });
  });

  // 保存
  document.getElementById('apiSave').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKeyInput').value.trim();
    const baseUrl = document.getElementById('apiBaseInput').value.trim();
    const model = document.getElementById('apiModelInput').value.trim();
    save({ apiKey, baseUrl, model });
    updateDot();
    toast('✅ API 配置已保存');
    closeApiModal();
  });

  // 重置
  document.getElementById('apiReset').addEventListener('click', () => {
    document.getElementById('apiKeyInput').value = '';
    document.getElementById('apiBaseInput').value = PRESETS.zhipu.baseUrl;
    document.getElementById('apiModelInput').value = PRESETS.zhipu.model;
    document.getElementById('apiHintText').innerHTML = PRESETS.zhipu.hint;
    save({ apiKey: '', baseUrl: PRESETS.zhipu.baseUrl, model: PRESETS.zhipu.model });
    updateDot();
    highlightPreset(PRESETS.zhipu.baseUrl, PRESETS.zhipu.model);
    toast('↩ 已恢复默认（智谱 GLM-4-Flash）');
  });

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('apiModal');
      if (modal && modal.classList.contains('show')) closeApiModal();
    }
  });
})();
