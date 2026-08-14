// ===== 全局命名空间 =====
window.Yiwei = window.Yiwei || {};
window.Yiwei.state = window.Yiwei.state || {};
window.Yiwei.config = window.Yiwei.config || {};
const S = Yiwei.state; // 状态读写快捷方式

// ===== 平台检测（快捷键标签适配）=====
S.isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || (navigator.userAgentData && navigator.userAgentData.platform) || '');
S.modKey = S.isMac ? '⌘' : 'Ctrl';
S.delKey = S.isMac ? '⌘⌫' : 'Del';

// ===== 活跃状态追踪（用于在线时长统计）=====
S.lastActivity = Date.now();
S.isIdle = false;
(function initActivityTrack() {
  var events = ['mousemove','keydown','scroll','click','touchstart'];
  function mark() { S.lastActivity = Date.now(); S.isIdle = false; }
  events.forEach(function(ev) { document.addEventListener(ev, mark, { passive: true }); });
  // 检测系统休眠：页面恢复时如果时间跳跃 > 2 分钟，重置活动时间
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      if (Date.now() - S.lastActivity > 120000) S.lastActivity = Date.now();
    }
  });
  // 每 30 秒检查闲置状态
  setInterval(function() {
    S.isIdle = (Date.now() - S.lastActivity) > 60000;
  }, 30000);
})();

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
  if (S.currentPanel === 'chat' && name !== 'chat') {
    if (typeof leaveChatPanel === 'function') leaveChatPanel();
  }
  S.currentPanel = name;
  Yiwei.sound.play('nav-switch');
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
  if (name === 'files') {
    loadFiles(); updateStorageBar();
    // 显示终端触发区（仅文件面板）
    var tt = document.getElementById('termTrigger');
    if (tt) tt.style.display = '';
  } else {
    // 离开文件面板时关闭终端并隐藏触发区
    if (typeof closeFileTerm === 'function') closeFileTerm();
    var tt2 = document.getElementById('termTrigger');
    if (tt2) tt2.style.display = 'none';
  }
  // 小鸡仅笔记面板可见
  if (typeof setChickPanelVisible === 'function') {
    setChickPanelVisible(name === 'notes');
  }
  if (name === 'notes') {
    if (typeof loadNotesList === 'function') loadNotesList();
    if (typeof loadWorks === 'function') loadWorks();
    // 自动恢复上次浏览的笔记
    var lastId = localStorage.getItem('last_note_id');
    if (lastId && typeof openNote === 'function') setTimeout(function() { openNote(lastId); }, 50);
  }
  if (name === 'scrape') loadScrapeSessions();
  if (name === 'read') loadReaderBooks();
  if (name === 'translate' && typeof loadHistory === 'function') loadHistory();
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => { Yiwei.sound.play('nav-click'); switchPanel(btn.dataset.panel); });
  btn.addEventListener('mouseenter', () => Yiwei.sound.play('nav-hover'));
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
      if (!mouseNearTop && window.scrollY > 5) hide();
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
const themes = ['dark','light'];
const themeBtn = document.getElementById('themeBtn');
S.theme = localStorage.getItem('theme') || 'dark';
applyTheme(S.theme);
themeBtn.addEventListener('click', () => {
  Yiwei.sound.play('theme-toggle');
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
  const names = {dark:'🌙 暗夜', light:'☀️ 晨曦'};
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
  Yiwei.sound.play(type === 'error' ? 'toast-err' : type === 'warning' ? 'toast-warn' : 'toast-ok');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), type === 'error' ? 4000 : 2000);
}

// ===== 时钟 =====
var GREETINGS = [
  '代码写完了吗？没写完也没关系，先摸摸鱼 🐟',
  '今天也是元气满满的一天呢（大概）✨',
  '咖啡机在召唤你...☕ 听到了吗？',
  '嘘——这里藏着一个彩蛋 🥚',
  '你的专注力+10，拖延症-5 🎮',
  '隔壁工位的零食闻起来真香 🤤',
  'Bug 退散！Bug 退散！🔮',
  'Ctrl+S 是你的好朋友，别忘了 📝',
  '灵感就像WiFi，时有时无 📶',
  '别卷了，站起来扭扭腰 🕺',
  '今天的小目标：不被 Deadline 追上 🏃',
  '脑子：我学会了。手：不，你没有 🤡',
  '多喝水，少熬夜，记得吃饭 🍚',
  '生产队的驴都不敢这么歇 🐴',
  '你的键盘说它累了，想休息 😮‍💨',
  '来都来了，写两行再走？👀',
  '该摸鱼时就摸鱼，别委屈自己 🌊',
  '假如生活欺骗了你，重启一下试试 🔄',
  '你今天真好看（对，就是你）💫',
  '404: 动力未找到，但你可以的 🚀',
];
var lastGreetingIdx = -1;
function getGreeting() {
  var idx;
  do { idx = Math.floor(Math.random() * GREETINGS.length); } while (idx === lastGreetingIdx && GREETINGS.length > 1);
  lastGreetingIdx = idx;
  return GREETINGS[idx];
}
function tick() {
  var now = new Date();
  var is24h = Yiwei.customize ? Yiwei.customize.get('clockFormat') === '24h' : true;
  // 表盘内时间
  var clockEl = document.getElementById('clock');
  if (clockEl) clockEl.textContent = now.toLocaleTimeString('zh-CN', { hour12: !is24h, hour:'2-digit', minute:'2-digit' });
  // 表盘内日期
  var dateEl = document.getElementById('date');
  if (dateEl) {
    var weekNames = ['日','一','二','三','四','五','六'];
    dateEl.textContent = (now.getMonth()+1) + '/' + now.getDate() + ' 周' + weekNames[now.getDay()];
  }
  // 问候语（30秒随机变换）
  if (!tick._lastGreet || now - tick._lastGreet > 30000) {
    tick._lastGreet = now;
    var g = document.getElementById('greeting');
    if (g) {
      var show = Yiwei.customize ? Yiwei.customize.get('greeting') : true;
      g.style.display = show ? '' : 'none';
      if (show) { g.textContent = getGreeting(); g.classList.add('greeting-pop'); setTimeout(function() { g.classList.remove('greeting-pop'); }, 500); }
    }
  }
}
tick(); setInterval(tick, 1000);

// ===== 天气 (服务端代理 wttr.in) =====
async function loadWeather() {
  var el = document.getElementById('weather'); if (!el) return;
  var city = localStorage.getItem('weather_city') || '';
  try {
    var r = await fetch('/api/weather?city=' + encodeURIComponent(city), { signal: AbortSignal.timeout(5000) });
    var text = (await r.text()).trim();
    if (text && !text.startsWith('Unknown')) el.textContent = text;
  } catch { el.textContent = '--'; }
}
loadWeather(); setInterval(loadWeather, 900000); // 15 分钟刷新

// ===== 搜索 =====
document.getElementById('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  Yiwei.sound.play('search-go');
  const q = document.getElementById('q').value.trim();
  if (q) window.open('https://www.bing.com/search?q=' + encodeURIComponent(q), '_blank');
});
document.getElementById('q').addEventListener('focus', () => Yiwei.sound.play('search-focus'));

// ===== 书签 — localStorage 持久化 + 编辑 + 拖拽 =====
const DEFAULT_BOOKMARKS = {
  categories: [
    { id: 'ai', name: 'AI', icon: 'smart_toy' },
    { id: 'common', name: '常用', icon: 'language' },
    { id: 'dev', name: '开发', icon: 'code' },
    { id: 'tools', name: '工具', icon: 'build' },
  ],
  links: [
    { id: 'l1', catId: 'ai', name: 'DeepSeek', url: 'https://chat.deepseek.com', icon: 'psychology' },
    { id: 'l2', catId: 'ai', name: '豆包', url: 'https://www.doubao.com', icon: 'auto_awesome' },
    { id: 'l3', catId: 'ai', name: 'ChatGPT', url: 'https://chat.openai.com', icon: 'smart_toy' },
    { id: 'l4', catId: 'ai', name: 'Kimi', url: 'https://kimi.moonshot.cn', icon: 'dark_mode' },
    { id: 'l5', catId: 'ai', name: '通义千问', url: 'https://tongyi.aliyun.com', icon: 'cloud' },
    { id: 'l6', catId: 'ai', name: 'Claude', url: 'https://claude.ai', icon: 'experiment' },
    { id: 'l7', catId: 'common', name: '哔哩哔哩', url: 'https://www.bilibili.com', icon: 'play_circle' },
    { id: 'l8', catId: 'common', name: '知乎', url: 'https://www.zhihu.com', icon: 'forum' },
    { id: 'l9', catId: 'common', name: 'YouTube', url: 'https://www.youtube.com', icon: 'smart_display' },
    { id: 'l10', catId: 'common', name: 'GitHub', url: 'https://github.com', icon: 'code' },
    { id: 'l11', catId: 'common', name: '小红书', url: 'https://www.xiaohongshu.com', icon: 'collections_bookmark' },
    { id: 'l12', catId: 'common', name: 'CSDN', url: 'https://www.csdn.net', icon: 'article' },
    { id: 'l13', catId: 'dev', name: 'MDN 前端', url: 'https://developer.mozilla.org/zh-CN/', icon: 'menu_book' },
    { id: 'l14', catId: 'dev', name: '菜鸟教程', url: 'https://www.runoob.com', icon: 'school' },
    { id: 'l15', catId: 'dev', name: 'W3School', url: 'https://www.w3school.com.cn', icon: 'public' },
    { id: 'l16', catId: 'dev', name: 'Vue.js', url: 'https://cn.vuejs.org', icon: 'layers' },
    { id: 'l17', catId: 'dev', name: 'Python 教程', url: 'https://www.liaoxuefeng.com', icon: 'terminal' },
    { id: 'l18', catId: 'dev', name: 'LeetCode', url: 'https://leetcode.cn', icon: 'bolt' },
    { id: 'l19', catId: 'tools', name: 'Convertio', url: 'https://convertio.co/zh/', icon: 'swap_horiz' },
    { id: 'l20', catId: 'tools', name: 'Photopea', url: 'https://www.photopea.com', icon: 'palette' },
    { id: 'l21', catId: 'tools', name: 'TinyPNG', url: 'https://tinypng.com', icon: 'compress' },
    { id: 'l22', catId: 'tools', name: '工具集合', url: 'https://tool.lu', icon: 'build' },
    { id: 'l23', catId: 'tools', name: '草料二维码', url: 'https://cli.im', icon: 'qr_code_2' },
    { id: 'l24', catId: 'tools', name: 'Excalidraw', url: 'https://excalidraw.com', icon: '✏️' },
  ]
};
var _linkCounter = 100;

function loadBookmarks() {
  try {
    var raw = localStorage.getItem('yiwei_bookmarks');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  // 首次使用，迁移默认数据
  var data = JSON.parse(JSON.stringify(DEFAULT_BOOKMARKS));
  saveBookmarks(data);
  return data;
}

function saveBookmarks(data) {
  localStorage.setItem('yiwei_bookmarks', JSON.stringify(data));
}

var BM = loadBookmarks();
var editMode = false;

function nextLinkId() { return 'l' + (++_linkCounter) + '_' + Date.now().toString(36); }

var ICON_COLORS = ['#ff6b9d','#64f0ff','#ffd700','#c084fc','#ff8264','#44dd88','#fbbf24','#a78bfa','#ff5580','#38bdf8','#f472b6','#a3e635'];

function renderBookmarks() {
  var grid = document.getElementById('bookmarkGrid');
  if (!grid) return;
  var colorIdx = 0;
  var allLinks = BM.links.slice();
  // 随机打乱
  if (!editMode) {
    for (var i = allLinks.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = allLinks[i]; allLinks[i] = allLinks[j]; allLinks[j] = tmp;
    }
  }
  grid.innerHTML = allLinks.map(function(l) {
    var cat = BM.categories.find(function(c) { return c.id === l.catId; });
    var href = editMode ? 'javascript:void(0)' : ('href="' + escHtml(l.url) + '" target="_blank" rel="noopener"');
    // 可变高度尺寸
    var size = l.size || 'm'; // s=small, m=medium, l=large
    return '<a class="link bm-tile bm-size-' + size + (editMode ? ' bm-link-edit' : '') + '" ' + href + ' data-id="' + l.id + '" draggable="' + editMode + '"' +
      (editMode ? ' onclick="event.preventDefault();"' : '') + '>' +
      '<span class="icon mi" style="color:' + ICON_COLORS[colorIdx++ % ICON_COLORS.length] + '">' + escHtml(l.icon) + '</span>' +
      '<span class="name">' + escHtml(l.name) + '</span>' +
      (editMode ? '<span class="bm-link-actions"><button class="bm-edit-link" data-id="' + l.id + '" title="编辑">✎</button><button class="bm-del-link" data-id="' + l.id + '" title="删除">✕</button></span>' : '') +
      '</a>';
  }).join('');
  if (editMode && allLinks.length === 0) {
    grid.innerHTML = '<div class="bm-empty-state" style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--sub);border:1px dashed var(--border);border-radius:8px;">拖拽链接到此处 · 点击下方 + 添加</div>';
  }
  // 编辑模式下显示添加按钮
  var existingAdd = document.getElementById('bmAddLinkBtn');
  if (editMode && !existingAdd) {
    var addBtn = document.createElement('button');
    addBtn.id = 'bmAddLinkBtn';
    addBtn.className = 'btn-sm';
    addBtn.style.cssText = 'display:block;margin:1rem auto 0;';
    addBtn.textContent = '+ 添加链接';
    addBtn.onclick = function() { showLinkDialog(BM.categories[0] ? BM.categories[0].id : ''); };
    grid.after(addBtn);
  }
  if (!editMode && existingAdd) existingAdd.remove();
}

// 编辑模式切换
function toggleEditMode() {
  editMode = !editMode;
  document.getElementById('bmEditBtn').textContent = editMode ? '✓ 完成' : '✎ 编辑';
  renderBookmarks();
  if (editMode) bindEditEvents();
}

// 绑定编辑事件（拖拽、按钮）— 适配随机网格
function bindEditEvents() {
  var grid = document.getElementById('bookmarkGrid');
  if (!grid) return;

  // 拖拽排序
  var links = document.querySelectorAll('.bm-link-edit');
  links.forEach(function(el) {
    el.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', function(e) { el.classList.remove('dragging'); });
  });

  // Drop target
  grid.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  grid.addEventListener('drop', function(e) {
    e.preventDefault();
    var linkId = e.dataTransfer.getData('text/plain');
    var link = BM.links.find(function(l) { return l.id === linkId; });
    if (!link) return;
    // 拖到网格中：随机改变排序位置
    var idx = BM.links.indexOf(link);
    if (idx >= 0) {
      BM.links.splice(idx, 1);
      BM.links.push(link); // 移到末尾，打乱顺序
    }
    saveBookmarks(BM); renderBookmarks(); bindEditEvents();
  });

  // 编辑链接
  document.querySelectorAll('.bm-edit-link').forEach(function(btn) {
    btn.onclick = function(e) { e.stopPropagation(); Yiwei.sound.play('bookmark-edit'); showLinkDialog(null, btn.dataset.id); };
  });
  // 删除链接
  document.querySelectorAll('.bm-del-link').forEach(function(btn) {
    btn.onclick = function(e) { e.stopPropagation();
      if (!confirm('删除此链接？')) return;
      Yiwei.sound.play('bookmark-del');
      BM.links = BM.links.filter(function(l) { return l.id !== btn.dataset.id; });
      saveBookmarks(BM); renderBookmarks(); bindEditEvents();
    };
  });
}

// 链接编辑弹窗（简易 prompt）
function showLinkDialog(catId, linkId) {
  var link = linkId ? BM.links.find(function(l) { return l.id === linkId; }) : null;
  var name = prompt('名称', link ? link.name : '');
  if (name === null) return;
  var url = prompt('网址', link ? link.url : 'https://');
  if (url === null) return;
  var icon = prompt('Material 图标名（如 smart_toy, code, public）', link ? link.icon : 'link');
  if (icon === null) return;

  if (link) {
    link.name = name; link.url = url; link.icon = icon;
  } else {
    BM.links.push({ id: nextLinkId(), catId: catId, name: name, url: url, icon: icon });
  }
  saveBookmarks(BM); renderBookmarks(); bindEditEvents();
}

// 分类编辑弹窗
// 右键菜单（编辑模式下也能用）
document.addEventListener('contextmenu', function(e) {
  var linkEl = e.target.closest('.link');
  if (!linkEl || editMode) return;
  e.preventDefault();
  var id = linkEl.dataset.id;
  if (!id) return;
  var link = BM.links.find(function(l) { return l.id === id; });
  if (!link) return;
  var menu = document.createElement('div');
  menu.className = 'bm-context-menu';
  menu.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY + 'px;z-index:9999;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:.3rem 0;min-width:140px;box-shadow:0 8px 24px rgba(0,0,0,.2);backdrop-filter:blur(var(--glass-blur));';
  menu.innerHTML = '<div class="bm-cm-item" data-action="open" style="padding:.4rem .8rem;cursor:pointer;font-size:.8rem;">🔗 打开</div>' +
    '<div class="bm-cm-item" data-action="edit" style="padding:.4rem .8rem;cursor:pointer;font-size:.8rem;">✎ 编辑</div>' +
    '<div class="bm-cm-item" data-action="delete" style="padding:.4rem .8rem;cursor:pointer;font-size:.8rem;color:var(--danger);">🗑 删除</div>';
  document.body.appendChild(menu);
  menu.querySelectorAll('.bm-cm-item').forEach(function(item) {
    item.onmouseenter = function() { item.style.background = 'var(--bg)'; };
    item.onmouseleave = function() { item.style.background = ''; };
    item.onclick = function() {
      var action = item.dataset.action;
      if (action === 'open') window.open(link.url, '_blank');
      else if (action === 'edit') showLinkDialog(null, id);
      else if (action === 'delete') { if (confirm('删除此链接？')) { BM.links = BM.links.filter(function(l) { return l.id !== id; }); saveBookmarks(BM); renderBookmarks(); } }
      menu.remove();
    };
  });
  var closeMenu = function(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } };
  setTimeout(function() { document.addEventListener('click', closeMenu); }, 0);
});

// 初始化渲染
renderBookmarks();

// 编辑按钮（插在自定义按钮旁）
(function() {
  var custFab = document.getElementById('custFab');
  if (custFab) {
    var editBtn = document.createElement('button');
    editBtn.id = 'bmEditBtn';
    editBtn.textContent = '✎';
    editBtn.title = '编辑书签';
    editBtn.onclick = toggleEditMode;
    custFab.parentElement.insertBefore(editBtn, custFab);
  }
})();

// ===== 状态 =====
S.lastStatus = null;

async function loadStatus() {
  try {
    S.lastStatus = await (await fetch('/api/status')).json();
    updateStorageBar(S.lastStatus);
    // 分析心跳：仅当页面可见 + 用户活跃 + 无多签重复
    if (!document.hidden && !S.isIdle) {
      var now = Date.now();
      var lastHb = parseInt(localStorage.getItem('analytics_last_hb') || '0', 10);
      if (now - lastHb > 13000) { // 13s 窗口防止多签重复
        localStorage.setItem('analytics_last_hb', now);
        fetch('/api/analytics/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ panel: S.currentPanel }) }).catch(function(){});
      }
    }
  } catch { /* 状态获取失败，静默 */ }
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

// ===== ⌘/Ctrl + 数字键切换面板 =====
(function() {
  var panels = ['home','files','notes','scrape','read','translate','chat','tasks','analytics'];
  document.addEventListener('keydown', function(e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    var tag = document.activeElement && document.activeElement.tagName;
    var isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
    var key = e.key;
    // ⌘/Ctrl + 1-9 → 面板切换（输入框内不拦截）
    if (key >= '1' && key <= '9' && !isInput) {
      e.preventDefault();
      var idx = parseInt(key, 10) - 1;
      if (panels[idx]) switchPanel(panels[idx]);
    }
  });
})();

// ===== Mac ⌘⌫ 补充（Mac 键盘无独立 Delete 键）=====
document.addEventListener('keydown', function(e) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace') {
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable)) return;
    e.preventDefault();
    // 模拟 Delete 键行为
    if (S.currentPanel === 'files') {
      var drawer = document.getElementById('trashDrawer');
      if (drawer && drawer.style.display === 'block') { if (typeof emptyTrash === 'function') emptyTrash(); return; }
      var checked = document.querySelectorAll('.file-check:checked');
      if (checked.length) { if (typeof batchDelete === 'function') batchDelete(); return; }
    }
    if (S.currentPanel === 'notes' && typeof currentNoteId !== 'undefined' && currentNoteId) {
      if (typeof deleteNote === 'function') deleteNote(); return;
    }
    if (S.currentPanel === 'scrape') {
      var scChecked = document.querySelectorAll('.scrape-check:checked');
      if (scChecked.length) { if (typeof batchDelScrape === 'function') batchDelScrape(); return; }
    }
    if (S.currentPanel === 'read' && typeof currentBook !== 'undefined' && currentBook) {
      if (typeof closeReader === 'function') closeReader(); return;
    }
  }
});

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

// ===== 刷新恢复面板（延迟到所有脚本加载完成后执行）=====
document.addEventListener('DOMContentLoaded', function(){
  const hash = location.hash.slice(1);
  const valid = ['home','files','notes','scrape','read','translate','chat','tasks'];
  if (hash && valid.includes(hash)) switchPanel(hash);
});


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
          const mult = 12; // normal tilt — always on
          const tiltX = (y - 0.5) * -mult;
          const tiltY = (x - 0.5) * mult;
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
  const colors = ['#ff6b9d','#64f0ff','#ffd700','#c084fc','#ff8264','#44dd88'];

  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', e => {
    mouseX = e.clientX; mouseY = e.clientY;
    addParticle();
    // 性能优化：有粒子时启动 RAF，空闲时自动停止
    if (!animId) animId = requestAnimationFrame(draw);
  });

  function getMaxParticles() {
    return 30; // normal particles — always on
  }

  function addParticle() {
    const max = getMaxParticles();
    if (max === 0) { particles.length = 0; return; }
    if (particles.length >= max) particles.shift();
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
    var hasParticles = particles.length > 0;
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
    // 性能优化：无活跃粒子时停止 RAF 循环，避免持续消耗 GPU
    if (particles.length > 0) {
      animId = requestAnimationFrame(draw);
    } else {
      animId = null;
    }
  }
  let animId = null;
  // 首次不自动启动；由 mousemove 触发
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (animId) { cancelAnimationFrame(animId); animId = null; }
    }
  });
})();

// ===== 自定义设置系统 =====
(function(){
  const KEY = 'yiwei_customize';
  const DEFAULTS = {
    font: 'system',
    uiStyle: 'outlined',   // outlined | rounded | sharp | filled
    glassBlur: 'medium',   // light | medium | heavy
    animIntensity: 'normal', // reduced | normal | playful
    greeting: true,
    clockFormat: '24h',    // 24h | 12h
    pomodoro: true,
    pomodoOpacity: 90,
    music: true,
  };
  let _cfg = {};
  try { _cfg = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  Object.keys(DEFAULTS).forEach(k => { if (!(k in _cfg)) _cfg[k] = DEFAULTS[k]; });

  function save() { localStorage.setItem(KEY, JSON.stringify(_cfg)); }
  function get(k) { return _cfg[k] ?? DEFAULTS[k]; }
  function set(k, v) { _cfg[k] = v; save(); apply(k); }

  // Google Fonts 字体映射（12 种，按风格排序）
  const FONT_MAP = {
    system:     { name: '系统默认', css: '', family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
    kuaile:     { name: '快乐体', css: 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap', family: '"ZCOOL KuaiLe", sans-serif' },
    xiaowei:    { name: '小薇体', css: 'https://fonts.googleapis.com/css2?family=ZCOOL+XiaoWei&display=swap', family: '"ZCOOL XiaoWei", sans-serif' },
    hunyin:     { name: '粉圆体', css: 'https://fonts.googleapis.com/css2?family=Noto+Sans+HK:wght@400;500;700&display=swap', family: '"Noto Sans HK", sans-serif' },
    qingke:     { name: '黄油体', css: 'https://fonts.googleapis.com/css2?family=ZCOOL+QingKe+HuangYou&display=swap', family: '"ZCOOL QingKe HuangYou", sans-serif' },
    wenkai:     { name: '霞鹜文楷', css: 'https://fonts.googleapis.com/css2?family=LXGW+WenKai&display=swap', family: '"LXGW WenKai", sans-serif' },
    'wenkai-mono': { name: '文楷等宽', css: 'https://fonts.googleapis.com/css2?family=LXGW+WenKai+Mono&display=swap', family: '"LXGW WenKai Mono", monospace' },
    longcang:   { name: '龙藏体', css: 'https://fonts.googleapis.com/css2?family=Long+Cang&display=swap', family: '"Long Cang", serif' },
    mashan:     { name: '马山正', css: 'https://fonts.googleapis.com/css2?family=Ma+Shan+Zheng&display=swap', family: '"Ma Shan Zheng", serif' },
    liujian:    { name: '柳建毛草', css: 'https://fonts.googleapis.com/css2?family=Liu+Jian+Mao+Cao&display=swap', family: '"Liu Jian Mao Cao", serif' },
    zhimang:    { name: '志莽行', css: 'https://fonts.googleapis.com/css2?family=Zhi+Mang+Xing&display=swap', family: '"Zhi Mang Xing", serif' },
    noto:       { name: '思源黑体', css: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;700&display=swap', family: '"Noto Sans SC", sans-serif' },
    'noto-serif': { name: '思源宋体', css: 'https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;700&display=swap', family: '"Noto Serif SC", serif' },
  };

  let fontLinkEl = null;
  function applyFont(key) {
    const font = FONT_MAP[key] || FONT_MAP.system;
    // 动态加载 Google Font
    if (fontLinkEl) { fontLinkEl.remove(); fontLinkEl = null; }
    if (font.css) {
      fontLinkEl = document.createElement('link');
      fontLinkEl.rel = 'stylesheet';
      fontLinkEl.href = font.css;
      document.head.appendChild(fontLinkEl);
    }
    document.body.style.fontFamily = font.family;
    // 强制全局继承（覆盖组件自身字体设定）
    document.body.style.setProperty('--font-body', font.family);
    // 保存到独立的 key，方便其他模块读取
    localStorage.setItem('yiwei_font', key);
  }

  function applyUIStyle(val) {
    document.body.setAttribute('data-ui-style', val);
    // 动态加载对应的 Material Symbols 字体变体
    loadIconFont(val);
  }

  const iconFontLoaded = {};
  function loadIconFont(style) {
    if (style === 'outlined' || style === 'filled' || iconFontLoaded[style]) return;
    const urls = {
      rounded: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
      sharp: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Sharp:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200',
    };
    const url = urls[style];
    if (!url) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
    iconFontLoaded[style] = true;
  }

  function applyGlassBlur(val) {
    document.body.setAttribute('data-glass-blur', val);
  }

  function applyAnimIntensity(val) {
    document.body.setAttribute('data-anim', val);
  }

  function applyGreeting(val) {
    document.body.setAttribute('data-greeting', val ? 'on' : 'off');
    const el = document.getElementById('greeting');
    if (el) el.style.display = val ? '' : 'none';
  }

  function applyClockFormat(val) {
    tick();
  }

  function apply(k) {
    if (k === 'font') applyFont(get('font'));
    if (k === 'uiStyle') applyUIStyle(get('uiStyle'));
    if (k === 'glassBlur') applyGlassBlur(get('glassBlur'));
    if (k === 'animIntensity') applyAnimIntensity(get('animIntensity'));
    if (k === 'greeting') applyGreeting(get('greeting'));
    if (k === 'clockFormat') applyClockFormat(get('clockFormat'));
    if (k === 'pomodoro' && window.Yiwei.pomodoro) Yiwei.pomodoro.setEnabled(get('pomodoro'));
    if (k === 'pomodoOpacity' && window.Yiwei.pomodoro) Yiwei.pomodoro.setOpacity(get('pomodoOpacity'));
    if (k === 'music') { var w = document.getElementById('ambientWidget'); if (w) w.style.display = get('music') ? '' : 'none'; }
  }

  function applyAll() { Object.keys(DEFAULTS).forEach(k => apply(k)); }

  function resetAll() {
    Object.keys(DEFAULTS).forEach(k => {
      _cfg[k] = DEFAULTS[k];
    });
    save();
    applyAll();
    localStorage.setItem('wpOpacity', 100);
    if (typeof applyWallpaperOpacity === 'function') applyWallpaperOpacity(100);
    // Re-open modal to refresh UI
    openCustomizeModal();
  }

  // 初始化：恢复所有设置
  applyAll();

  window.Yiwei.customize = { get, set, save, applyAll, resetAll, DEFAULTS, FONT_MAP };
})();

// ===== 点击涟漪特效 =====
(function(){
  const canvas = document.createElement('canvas');
  canvas.id = 'rippleCanvas';
  canvas.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:9998;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let w, h;
  const ripples = [];

  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('click', e => {
    // ripple always on
    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#89b4fa';
    ripples.push({ x: e.clientX, y: e.clientY, radius: 0, maxRadius: 38, life: 1, color: accent });
    // 性能优化：有涟漪时启动 RAF，空闲时自动停止
    if (!rippleAnimId) rippleAnimId = requestAnimationFrame(drawRipple);
  });

  function drawRipple() {
    ctx.clearRect(0, 0, w, h);
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.radius += 1.4;
      r.life = 1 - r.radius / r.maxRadius;
      if (r.life <= 0) { ripples.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
      ctx.strokeStyle = r.color + Math.floor(r.life * 70).toString(16).padStart(2, '0');
      ctx.lineWidth = 2.2 * r.life;
      ctx.stroke();
    }
    // 性能优化：无活跃涟漪时停止 RAF 循环
    if (ripples.length > 0) {
      rippleAnimId = requestAnimationFrame(drawRipple);
    } else {
      rippleAnimId = null;
    }
  }
  let rippleAnimId = null;
  // 不自动启动，由 click 触发
})();

// ===== 全局音效事件委托 =====
document.addEventListener('mouseenter', function(e) {
  if (!e.target.closest) return;
  var card = e.target.closest('.link, .file-card, .file-row, .book-card, .scrape-card, .work-card, .note-list-item');
  if (card) Yiwei.sound.play('card-hover');
}, true);
document.addEventListener('click', function(e) {
  if (!e.target.closest) return;
  var btn = e.target.closest('.btn, .btn-sm, .btn-new, .wp-fab, .cust-fab');
  if (btn) { Yiwei.sound.play('btn-click'); return; }
  var card = e.target.closest('.link, .file-card, .file-row, .book-card, .scrape-card, .work-card, .note-list-item, .tilt-card');
  if (card) Yiwei.sound.play('card-click');
}, true);

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
  if (modal) { modal.classList.add('show'); Yiwei.sound.play('modal-open'); }
  if (typeof loadWallpapers === 'function') loadWallpapers();
}
function closeWallpaperModal() {
  const modal = document.getElementById('wpModal');
  if (modal) { modal.classList.remove('show'); Yiwei.sound.play('modal-close'); }
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

// ===== 自定义面板 (字体/特效/动画参数) =====
window.openCustomizeModal = function() {
  try {
    Yiwei.sound.play('modal-open');
    const modal = document.getElementById('customizeModal');
    if (!modal) return;
    // 同步 UI
    const cfg = Yiwei.customize;
    ['font','uiStyle','glassBlur','animIntensity','clockFormat'].forEach(k => {
      const el = document.getElementById('cfg-'+k);
      if (el) el.value = cfg.get(k);
    });
    const greetingEl = document.getElementById('cfg-greeting');
    if (greetingEl) greetingEl.checked = cfg.get('greeting');
    const pomodoroEl = document.getElementById('cfg-pomodoro');
    if (pomodoroEl) pomodoroEl.checked = cfg.get('pomodoro');
    const soundEl = document.getElementById('cfg-sound');
    if (soundEl) soundEl.checked = Yiwei.sound.isEnabled();
    const musicEl = document.getElementById('cfg-music');
    if (musicEl) musicEl.checked = cfg.get('music');
    const pomdoOpacityEl = document.getElementById('cfg-pomodoOpacity');
    if (pomdoOpacityEl) { pomdoOpacityEl.value = cfg.get('pomodoOpacity'); document.getElementById('cfgPomodoOpacityVal').textContent = cfg.get('pomodoOpacity') + '%'; }
    const opacityEl = document.getElementById('cfg-wpOpacity');
    if (opacityEl) opacityEl.value = localStorage.getItem('wpOpacity') || 100;
    updateWpOpacityLabel();
    modal.classList.add('show');
  } catch(e) { console.error('[Yiwei] openCustomizeModal:', e); }
};

window.closeCustomizeModal = function() {
  Yiwei.sound.play('modal-close');
  document.getElementById('customizeModal').classList.remove('show');
};

// 设置变更事件
document.addEventListener('change', e => {
  if (!e.target.id || !e.target.id.startsWith('cfg-')) return;
  const key = e.target.id.replace('cfg-', '');
  if (key === 'greeting') {
    Yiwei.customize.set(key, e.target.checked);
    Yiwei.sound.play(e.target.checked ? 'btn-toggle-on' : 'btn-toggle-off');
  } else if (key === 'pomodoro') {
    Yiwei.customize.set(key, e.target.checked);
    Yiwei.sound.play(e.target.checked ? 'btn-toggle-on' : 'btn-toggle-off');
  } else if (key === 'music') {
    Yiwei.customize.set(key, e.target.checked);
    Yiwei.sound.play(e.target.checked ? 'btn-toggle-on' : 'btn-toggle-off');
  } else if (key === 'sound') {
    Yiwei.sound.toggle();
    e.target.checked = Yiwei.sound.isEnabled(); // toggle 已翻转，同步 UI
    Yiwei.sound.syncWidget();
    toast(Yiwei.sound.isEnabled() ? '🔊 音效已开启' : '🔇 音效已关闭', 'info');
  } else if (key === 'wpOpacity') {
    localStorage.setItem('wpOpacity', e.target.value);
    applyWallpaperOpacity(e.target.value);
    updateWpOpacityLabel();
  } else if (key === 'pomodoOpacity') {
    Yiwei.customize.set(key, e.target.value);
    document.getElementById('cfgPomodoOpacityVal').textContent = e.target.value + '%';
  } else {
    // All select fields — 保存并立即应用
    Yiwei.customize.set(key, e.target.value);
    if (Yiwei.customize.apply) Yiwei.customize.apply(key, e.target.value);
  }
});

function updateWpOpacityLabel() {
  const el = document.getElementById('cfgWpOpacityVal');
  if (el) el.textContent = (localStorage.getItem('wpOpacity') || 100) + '%';
}

// 壁纸透明度初始化恢复（依赖 wallpaper.js 的 applyWallpaperOpacity 全局函数）
(function(){
  const saved = localStorage.getItem('wpOpacity');
  if (saved) {
    setTimeout(() => { if (typeof applyWallpaperOpacity === 'function') applyWallpaperOpacity(saved); }, 500);
  }
})();

// 恢复字体（页面加载时，在 customize 系统初始化后）
(function(){
  const fontKey = localStorage.getItem('yiwei_font') || 'system';
  if (fontKey !== 'system') {
    const font = Yiwei.customize.FONT_MAP[fontKey];
    if (font && font.css) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = font.css;
      document.head.appendChild(link);
    }
    if (font) {
      document.body.style.fontFamily = font.family;
      document.body.style.setProperty('--font-body', font.family);
    }
  }
})();

// ESC 关闭自定义面板
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const m = document.getElementById('customizeModal');
    if (m && m.classList.contains('show')) { closeCustomizeModal(); e.stopPropagation(); }
  }
});

// ===== API 设置（对话 + 翻译双 Tab）=====
(function () {
  const CHAT_KEY = 'yiwei_api_v2';
  const TRANS_KEY = 'yiwei_trans_api';
  const CHAT_BASE = 'https://vip.apiyi.com/v1/chat/completions';
  const CHAT_MODEL = 'grok-4.3';
  const TRANS_BASE = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  const TRANS_MODEL = 'glm-4-flash';

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; }
    catch { return {}; }
  }
  function save(key, cfg) { localStorage.setItem(key, JSON.stringify(cfg)); }

  // 对话 AI 配置（chat.js 使用）；未填自定义 Key 时交给服务端 .env（CHAT_API_KEY/CHAT_MODEL/CHAT_BASE_URL）
  window.getChatApiConfig = function () {
    const cfg = load(CHAT_KEY);
    return { apiKey: cfg.apiKey || '', baseUrl: cfg.apiKey ? CHAT_BASE : '', model: cfg.model || '' };
  };

  // 翻译配置（translate-panel.js 使用）；未填自定义 Key 时交给服务端 .env（TRANS_API_KEY/TRANS_MODEL/TRANS_BASE_URL）
  window.getApiConfig = function () {
    const cfg = load(TRANS_KEY);
    return { apiKey: cfg.apiKey || '', baseUrl: cfg.baseUrl || '', model: cfg.model || '' };
  };

  // API 按钮绿点（自定义 Key 或服务器内置 Key 任一可用即点亮）
  var serverCfg = null;
  function fetchServerCfg() {
    fetch('/api/config/status').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j) { serverCfg = j; updateDot(); }
    }).catch(function () {});
  }
  function updateDot() {
    const dot = document.getElementById('apiDot');
    if (!dot) return;
    const hasCustom = !!load(CHAT_KEY).apiKey || !!load(TRANS_KEY).apiKey;
    const hasServer = !!(serverCfg && (serverCfg.chat.hasServerKey || serverCfg.trans.hasServerKey));
    if (hasCustom || hasServer) dot.classList.add('set'); else dot.classList.remove('set');
  }
  updateDot();
  fetchServerCfg();

  // Tab 切换
  window.switchApiTab = function (tab) {
    Yiwei.sound.play('api-tab-sw');
    document.querySelectorAll('.api-tab').forEach(function(b) { b.classList.remove('active'); });
    var activeTab = document.querySelector('[data-api-tab="' + tab + '"]');
    if (activeTab) activeTab.classList.add('active');
    var chatPanel = document.getElementById('apiTabChat');
    var transPanel = document.getElementById('apiTabTranslate');
    if (chatPanel) chatPanel.style.display = tab === 'translate' ? 'none' : 'block';
    if (transPanel) transPanel.style.display = tab === 'translate' ? 'block' : 'none';
  };

  // 填充 UI
  function fillUI() {
    var chat = load(CHAT_KEY);
    var trans = load(TRANS_KEY);
    var ck = document.getElementById('apiChatKey');
    var cm = document.getElementById('apiChatModel');
    var tk = document.getElementById('apiTransKey');
    var tu = document.getElementById('apiTransUrl');
    var tm = document.getElementById('apiTransModel');
    if (ck) ck.value = chat.apiKey || '';
    if (cm) { cm.value = chat.model || ''; cm.placeholder = CHAT_MODEL; }
    if (tk) tk.value = trans.apiKey || '';
    if (tu) { tu.value = trans.baseUrl || ''; tu.placeholder = TRANS_BASE; }
    if (tm) { tm.value = trans.model || ''; tm.placeholder = TRANS_MODEL; }
    // 默认显示对话 Tab
    window.switchApiTab('chat');
  }

  window.openApiModal = function () {
    fillUI();
    Yiwei.sound.play('modal-open');
    document.getElementById('apiModal').classList.add('show');
  };
  document.getElementById('apiBtn').addEventListener('click', function() { window.openApiModal(); });

  window.closeApiModal = function () {
    Yiwei.sound.play('modal-close');
    document.getElementById('apiModal').classList.remove('show');
  };

  // 保存
  document.getElementById('apiSave').addEventListener('click', function() {
    Yiwei.sound.play('api-save');
    var chatKey = document.getElementById('apiChatKey').value.trim();
    var chatModel = document.getElementById('apiChatModel').value.trim();
    var transKey = document.getElementById('apiTransKey').value.trim();
    var transUrl = document.getElementById('apiTransUrl').value.trim();
    var transModel = document.getElementById('apiTransModel').value.trim();
    save(CHAT_KEY, { apiKey: chatKey, model: chatModel });
    save(TRANS_KEY, { apiKey: transKey, baseUrl: transUrl, model: transModel });
    updateDot();
    toast('✅ API 配置已保存');
    closeApiModal();
  });

  // 清除
  document.getElementById('apiReset').addEventListener('click', function() {
    Yiwei.sound.play('api-reset');
    document.getElementById('apiChatKey').value = '';
    document.getElementById('apiChatModel').value = '';
    document.getElementById('apiTransKey').value = '';
    document.getElementById('apiTransUrl').value = '';
    document.getElementById('apiTransModel').value = '';
    save(CHAT_KEY, { apiKey: '', model: '' });
    save(TRANS_KEY, { apiKey: '', baseUrl: '', model: '' });
    updateDot();
    toast('↩ 已清除');
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      var modal = document.getElementById('apiModal');
      if (modal && modal.classList.contains('show')) closeApiModal();
    }
  });
})();

// ===== 快捷键标签 Mac 适配 =====
(function adaptShortcutLabels() {
  if (!S.isMac) return;
  function adapt(el) {
    if (!el) return;
    // 文本节点替换
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(function(node) {
      if (node.textContent.indexOf('Ctrl') !== -1 || node.textContent.indexOf('Del') !== -1) {
        node.textContent = node.textContent.replace(/Ctrl/g, '⌘').replace(/\bDel\b/g, '⌘⌫');
      }
    });
    // title 属性替换
    if (el.title && (el.title.indexOf('Ctrl') !== -1 || el.title.indexOf('Del') !== -1)) {
      el.title = el.title.replace(/Ctrl/g, '⌘').replace(/\bDel\b/g, '⌘⌫');
    }
  }
  // 适配所有 kbd 元素和有 title 的元素
  document.querySelectorAll('kbd,[title]').forEach(adapt);
  // 适配后续动态插入的节点（MutationObserver）
  new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          if (node.matches && (node.matches('kbd') || node.hasAttribute && node.hasAttribute('title'))) adapt(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('kbd,[title]').forEach(adapt);
          }
        }
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();
