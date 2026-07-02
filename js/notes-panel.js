// ===== 笔记 =====
let currentNoteId = null, noteDirty = false, autoSaveTimer = null;

// ===== markdown-it 渲染器（单例，替代 marked.js）=====
var mdRenderer = null;
function getMdRenderer() {
  if (mdRenderer) return mdRenderer;
  if (typeof markdownit === 'undefined') return null;

  var md = markdownit({
    html: true, linkify: true, typographer: true, breaks: true,
    highlight: function(str, lang) {
      if (typeof hljs !== 'undefined') {
        // 已知语言 → 精确高亮
        if (lang && hljs.getLanguage(lang)) {
          try { return hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; } catch(__) {}
        }
        // 未知语言或无标记 → 自动检测（覆盖 cpp/markdown/go/rust 等）
        try { return hljs.highlightAuto(str).value; } catch(__) {}
      }
      return ''; // hljs 不可用时默认转义
    }
  });

  // 挂载插件（由 index.html CDN 加载）
  if (typeof markdownitEmoji !== 'undefined') md.use(markdownitEmoji);
  if (typeof markdownitSub !== 'undefined')   md.use(markdownitSub);
  if (typeof markdownitSup !== 'undefined')   md.use(markdownitSup);
  if (typeof markdownitFootnote !== 'undefined') md.use(markdownitFootnote);
  if (typeof markdownitMark !== 'undefined')  md.use(markdownitMark);
  if (typeof markdownitIns !== 'undefined')   md.use(markdownitIns);
  if (typeof markdownitTaskLists !== 'undefined') md.use(markdownitTaskLists);

  mdRenderer = md;
  return mdRenderer;
}
function isNoteDirty() { return noteDirty; }
function markDirty() { noteDirty = true; if (document.getElementById('saveIndicator')) document.getElementById('saveIndicator').textContent = '● 未保存'; }
function markClean() { noteDirty = false; if (document.getElementById('saveIndicator')) document.getElementById('saveIndicator').textContent = ''; }

// ===== Callout 容器预处理 =====
// 语法: ::: note|warning|tip|danger|info \n 内容 \n :::
// 内层内容先通过 markdown-it 渲染，再包裹为 callout HTML
var CALLOUT_LABELS = { note: '📝 笔记', warning: '⚠️ 警告', tip: '💡 提示', danger: '🔥 注意', info: 'ℹ️ 信息', details: '📋 详情' };
var CALLOUT_RE = /^:::\s*(note|warning|tip|danger|info|details)\s*\n([\s\S]*?)^:::\s*$/gm;

function preprocessCallouts(mdText) {
  var renderer = getMdRenderer();
  if (!renderer) return mdText;
  return mdText.replace(CALLOUT_RE, function(_, type, content) {
    var label = CALLOUT_LABELS[type] || type;
    var innerHtml = renderer.render(content.trim());
    return '<div class="callout callout-' + type + '">' +
           '<div class="callout-title">' + label + '</div>' +
           '<div class="callout-body">' + innerHtml + '</div>' +
           '</div>';
  });
}

// ===== MD → HTML 渲染（向后兼容，reader/files 面板也调用）=====
function md2html(md) {
  if (!md) return '<p></p>';
  var renderer = getMdRenderer();
  if (renderer) {
    try {
      // 0. 提取脚注定义（markdown-it-footnote 不识别 HTML block 后的定义）
      var footnoteDefs = '';
      var mdClean = md.replace(/^\[\^[^\]]+\]:\s*.+(\n\s{2,}.+)*/gm, function(m) {
        footnoteDefs += (footnoteDefs ? '\n' : '') + m.trim();
        return '';
      });
      // 1. 预处理 callout 容器
      var processed = preprocessCallouts(mdClean);
      // 2. 将脚注定义插到第一个 callout HTML block 之前（否则不被识别）
      if (footnoteDefs) {
        var firstCallout = processed.indexOf('<div class="callout');
        if (firstCallout > -1) {
          processed = processed.slice(0, firstCallout) + footnoteDefs + '\n\n' + processed.slice(firstCallout);
        } else {
          processed += '\n\n' + footnoteDefs;
        }
      }
      // 3. 主渲染
      var h = renderer.render(processed);
      // 4. 后处理
      h = h.replace(/<img /g, '<img loading="lazy" ');
      h = h.replace(/<a /g, '<a target="_blank" rel="noopener" ');
      h = h.replace(/<pre><code class="language-(\w+)">/g, '<pre data-lang="$1"><code class="language-$1">');
      return h || '<p></p>';
    } catch(e) { console.warn('[md2html] render error', e); }
  }
  // 降级：纯文本转义
  return '<p>' + (md || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>') + '</p>';
}

function renderLive() {
  var preview = document.getElementById('notePreview');
  var md = document.getElementById('noteContent').value;
  preview.innerHTML = md2html(md);
  // mermaid 图表渲染（按需懒加载）
  var mermaidBlocks = preview.querySelectorAll('pre code.language-mermaid');
  if (mermaidBlocks.length && typeof ensureMermaid === 'function') {
    ensureMermaid(function() {
      mermaidBlocks.forEach(function(el) {
        var id = 'm-' + Math.random().toString(36).slice(2, 8);
        try {
          mermaid.render(id, el.textContent).then(function(result) {
            var div = document.createElement('div');
            div.className = 'mermaid-rendered'; div.innerHTML = result.svg;
            div.style.cssText = 'text-align:center;margin:.8em 0;padding:.8rem;background:rgba(255,255,255,.03);border-radius:10px;border:1px solid var(--border);overflow-x:auto;';
            var pre = el.closest('pre');
            if (pre) pre.replaceWith(div);
          }).catch(function(err) {
            var pre = el.closest('pre');
            if (pre) {
              pre.insertAdjacentHTML('afterend', '<div class="mermaid-error-msg" style="color:#e74c3c;font-size:.8rem;padding:.4rem .8rem;border-left:3px solid #e74c3c;margin:.4rem 0;background:rgba(231,76,60,.08);border-radius:4px;">⚠️ Mermaid: ' + err.message.replace(/</g,'&lt;') + '</div>');
            }
          });
        } catch(e) {
          var pre = el.closest('pre');
          if (pre) {
            pre.insertAdjacentHTML('afterend', '<div class="mermaid-error-msg" style="color:#e74c3c;font-size:.8rem;padding:.4rem .8rem;border-left:3px solid #e74c3c;margin:.4rem 0;background:rgba(231,76,60,.08);border-radius:4px;">⚠️ Mermaid: ' + e.message.replace(/</g,'&lt;') + '</div>');
          }
        }
      });
    });
  }
  markDirty();
}

// ===== 笔记拖拽排序 =====
let noteDragId = null, noteDragOverId = null;

function noteDragStart(e, id) {
  noteDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  e.currentTarget.classList.add('dragging');
  setTimeout(function() { if (e.currentTarget) e.currentTarget.style.opacity = '0.4'; }, 0);
}

function noteDragOver(e, id) {
  e.preventDefault();
  if (id === noteDragId) return;
  e.dataTransfer.dropEffect = 'move';
  if (noteDragOverId && noteDragOverId !== id) {
    var prev = document.querySelector('.note-list-item[data-note-id="' + noteDragOverId + '"]');
    if (prev) prev.classList.remove('drag-over');
  }
  noteDragOverId = id;
  e.currentTarget.classList.add('drag-over');
}

function noteDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function noteDrop(e, targetId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!noteDragId || noteDragId === targetId) { noteDragId = null; noteDragOverId = null; return; }
  var items = document.querySelectorAll('#noteList .note-list-item');
  var ids = Array.from(items).map(function(el) { return el.getAttribute('data-note-id'); }).filter(Boolean);
  var fromIdx = ids.indexOf(noteDragId);
  var toIdx = ids.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  ids.splice(fromIdx, 1);
  ids.splice(toIdx, 0, noteDragId);
  var orders = ids.map(function(id, i) { return { id: id, sortOrder: i * 1000 }; });
  reorderNotes(orders);
  noteDragId = null; noteDragOverId = null;
}

function noteDragEnd(e) {
  e.currentTarget.style.opacity = '';
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('#noteList .note-list-item').forEach(function(el) { el.classList.remove('drag-over'); });
  noteDragId = null; noteDragOverId = null;
}

async function reorderNotes(orders) {
  try {
    await fetch('/api/notes/reorder', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orders: orders }) });
    if (typeof loadNotesList === 'function') loadNotesList();
  } catch(e) { console.error('[Notes] reorder failed', e); }
}
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
  localStorage.removeItem('last_note_id');
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
    localStorage.setItem('last_note_id', id);
    document.getElementById('noteEditor').style.display = 'flex';
    document.getElementById('noteTitle').value = note.title;
    document.getElementById('noteContent').value = note.content;
    renderLive(); markClean();
    document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.note-list-item').forEach(el => { if (el.getAttribute('onclick')?.includes(id)) el.classList.add('active'); });
    startAutoSave();
  } catch(e) { localStorage.removeItem('last_note_id'); console.error(e); }
}

document.addEventListener('DOMContentLoaded', () => { const t = document.getElementById('noteTitle'); if (t) t.addEventListener('input', markDirty); });

async function saveNote() {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value;
  if (!title && !content) { toast('⚠️ 标题和内容不能都为空', 'warning'); return; }
  const body = { title: title || '无标题', content };
  if (currentNoteId) body.id = currentNoteId;
  try {
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    currentNoteId = data.id; markClean();
    toast('✅ 已保存'); loadNotesList();
  } catch(e) { toast('❌ 保存失败', 'error'); }
}

async function deleteNote() {
  if (!currentNoteId) { toast('⚠️ 还没有保存的笔记', 'warning'); return; }
  try {
    await fetch('/api/notes/' + currentNoteId, { method: 'DELETE' });
    currentNoteId = null; noteDirty = false;
    document.getElementById('noteEditor').style.display = 'none';
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
    markClean(); stopAutoSave();
    toast('🗑️ 已删除'); loadNotesList();
  } catch(e) { toast('❌ 删除失败', 'error'); }
}

function startAutoSave() { stopAutoSave(); autoSaveTimer = setInterval(() => { if (noteDirty) saveNoteSilent(); }, 30000); }
function stopAutoSave() { if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; } }

let previewVisible = true, previewOnly = false;
function togglePreview() {
  previewVisible = !previewVisible;
  if (previewVisible) previewOnly = false;
  const sp = document.querySelector('#noteEditor .split-pane');
  const btn = document.getElementById('btnTogglePreview');
  if (sp) { sp.classList.toggle('no-preview', !previewVisible); sp.classList.toggle('preview-only', previewOnly); }
  if (btn) btn.innerHTML = previewOnly ? '<span class="mi">edit_off</span>' : (previewVisible ? '<span class="mi">visibility</span>' : '<span class="mi">visibility_off</span>');
  updatePreviewHint();
}
function togglePreviewOnly() {
  previewOnly = !previewOnly;
  if (previewOnly) previewVisible = true;
  const sp = document.querySelector('#noteEditor .split-pane');
  const btn = document.getElementById('btnTogglePreview');
  if (sp) { sp.classList.toggle('preview-only', previewOnly); sp.classList.toggle('no-preview', false); }
  if (btn) btn.innerHTML = previewOnly ? '<span class="mi">edit_off</span>' : '<span class="mi">visibility</span>';
  updatePreviewHint();
}
function updatePreviewHint() {
  const hint = document.getElementById('previewHint');
  if (!hint) return;
  if (previewOnly) hint.innerHTML = '<kbd>Ctrl+.</kbd> 退出预览';
  else if (!previewVisible) hint.innerHTML = '<kbd>Ctrl+\\</kbd> 显示预览';
  else hint.innerHTML = '<kbd>Ctrl+\\</kbd> 隐藏预览 · <kbd>Ctrl+.</kbd> 纯预览';
}

// ===== 侧栏 Dock 智能隐藏 =====
let dockTimer = null, dockEnabled = window.matchMedia('(hover: hover)').matches;
function initSidebarDock() {
  if (!dockEnabled) return;
  const layout = document.querySelector('.notes-layout');
  const sidebar = document.querySelector('.notes-sidebar');
  const editor = document.getElementById('noteEditor');
  if (!layout || !sidebar || !editor) return;

  function hideSidebar() {
    if (dockManualOff) return;
    clearDockTimer();
    dockTimer = setTimeout(() => layout.classList.add('dock-hidden'), 600);
  }
  function showSidebar() {
    clearDockTimer();
    layout.classList.remove('dock-hidden');
  }
  function clearDockTimer() {
    if (dockTimer) { clearTimeout(dockTimer); dockTimer = null; }
  }

  // 鼠标进入编辑区 → 延迟隐藏侧栏
  editor.addEventListener('mouseenter', () => { if (dockEnabled) hideSidebar(); });
  editor.addEventListener('mouseleave', () => { showSidebar(); });

  // 鼠标移到侧栏 → 立即显示
  sidebar.addEventListener('mouseenter', () => { showSidebar(); });
  // 鼠标离开侧栏 → 如果还在编辑区则重新隐藏
  sidebar.addEventListener('mouseleave', () => {
    const inEditor = editor.matches(':hover');
    if (inEditor && dockEnabled) hideSidebar();
  });

  // 初始状态：如果编辑器可见，自动隐藏侧栏
  layout.classList.add('dock-anim');
  if (editor.style.display !== 'none') hideSidebar();
}
// 手动切换侧栏折叠
let dockManualOff = false;
function toggleNotesSidebar() {
  const layout = document.querySelector('.notes-layout');
  if (!layout) return;
  if (dockManualOff) {
    // 恢复自动 dock
    dockManualOff = false;
    layout.classList.remove('dock-hidden');
    const btn = document.getElementById('btnToggleSidebar');
    if (btn) btn.style.color = 'var(--sub)';
  } else {
    // 手动固定侧栏状态
    dockManualOff = true;
    layout.classList.toggle('dock-hidden');
    const btn = document.getElementById('btnToggleSidebar');
    if (btn) btn.style.color = layout.classList.contains('dock-hidden') ? 'var(--accent)' : 'var(--sub)';
  }
}
// 页面加载后初始化

// ===== 可拖拽分隔条 =====
function initResizeHandles() {
  const layout = document.querySelector('.notes-layout');
  const sidebar = document.querySelector('.notes-sidebar');
  const splitPane = document.querySelector('.split-pane');
  if (!layout) return;

  // ---- 拖拽核心 ----
  function drag(handle, opts) {
    // opts: { getSize, setSize, min, max, onEnd, onReset }
    let active = false, sx, ss;
    function down(e) {
      e.preventDefault();
      if (opts.onStart) opts.onStart();
      active = true;
      sx = e.touches ? e.touches[0].clientX : e.clientX;
      ss = opts.getSize();
      handle.classList.add('resizing');
      document.body.classList.add('resizing');
      layout.classList.remove('dock-anim'); // 拖拽时禁用动画
    }
    function move(e) {
      if (!active) return;
      let x = e.touches ? e.touches[0].clientX : e.clientX;
      let v = Math.max(opts.min, Math.min(opts.max, ss + (x - sx)));
      opts.setSize(v);
    }
    function up() {
      if (!active) return;
      active = false;
      handle.classList.remove('resizing');
      document.body.classList.remove('resizing');
      layout.classList.add('dock-anim'); // 恢复动画
      if (opts.onEnd) opts.onEnd();
    }
    handle.addEventListener('mousedown', down);
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    handle.addEventListener('touchstart', down, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
    handle.addEventListener('dblclick', function() { if (opts.onReset) opts.onReset(); });
  }

  // ---- 侧栏分隔条 ----
  const sh = document.getElementById('resizeSidebar');
  if (sh && sidebar) {
    let saved = localStorage.getItem('notes_sidebar_w');
    if (saved) layout.style.setProperty('--sidebar-w', saved + 'px');
    drag(sh, {
      getSize: function() { return sidebar.getBoundingClientRect().width; },
      onStart: function() {
        layout.classList.remove('dock-hidden');
        // 使用已保存的宽度作为起始值，而非 dock-hidden 的 8px
        var saved = localStorage.getItem('notes_sidebar_w');
        if (saved) layout.style.setProperty('--sidebar-w', saved + 'px');
      },
      setSize: function(w) { layout.style.setProperty('--sidebar-w', Math.round(w) + 'px'); },
      min: 60, max: 400,
      onEnd: function() {
        localStorage.setItem('notes_sidebar_w', sidebar.getBoundingClientRect().width);
      },
      onReset: function() {
        layout.style.setProperty('--sidebar-w', '180px');
        localStorage.removeItem('notes_sidebar_w');
      }
    });
  }

  // ---- 编辑/预览分隔条 ----
  const ph = document.getElementById('resizePane');
  if (ph && splitPane) {
    let saved = localStorage.getItem('notes_split_ratio');
    let ratio = saved ? parseFloat(saved) : 0.5;
    applyPaneRatio(splitPane, ratio);
    drag(ph, {
      getSize: function() {
        let pw = splitPane.querySelector('.pane');
        return pw ? pw.getBoundingClientRect().width : splitPane.getBoundingClientRect().width * 0.5;
      },
      setSize: function(w) {
        let total = splitPane.getBoundingClientRect().width - 5; // 减去 handle 宽度
        let r = Math.max(0.2, Math.min(0.8, w / (total || 1)));
        applyPaneRatio(splitPane, r);
      },
      min: 0, max: Infinity,
      onEnd: function() {
        let pw = splitPane.querySelector('.pane');
        if (!pw) return;
        let total = splitPane.getBoundingClientRect().width - 5;
        let r = pw.getBoundingClientRect().width / (total || 1);
        localStorage.setItem('notes_split_ratio', Math.max(0.2, Math.min(0.8, r)));
      },
      onReset: function() {
        applyPaneRatio(splitPane, 0.5);
        localStorage.removeItem('notes_split_ratio');
      }
    });
  }
}

function applyPaneRatio(sp, ratio) {
  var panes = sp.querySelectorAll(':scope > .pane');
  if (panes.length < 2) return;
  panes[0].style.flex = '0 0 ' + (ratio * 100) + '%';
  panes[1].style.flex = '0 0 ' + ((1 - ratio) * 100) + '%';
}
document.addEventListener('DOMContentLoaded', function() {
  initSidebarDock();
  initResizeHandles();
});
// 防止浏览器自动填充搜索框（Chrome 在面板激活/页面加载时异步填充，需多次清除）
(function(){
  function clearNoteSearch() {
    const s = document.getElementById('noteSearch');
    if (!s) return;
    // 多次清除对抗 Chrome 异步 autofill
    [50, 150, 400].forEach(function(ms) {
      setTimeout(function() { if (s.value && document.getElementById('panel-notes')?.classList.contains('active')) s.value = ''; }, ms);
    });
  }
  // 首次页面加载
  document.addEventListener('DOMContentLoaded', function() { setTimeout(clearNoteSearch, 50); });
  // 面板切换时（监听 panel-notes 的 active class 变化）
  var panelEl = document.getElementById('panel-notes');
  if (panelEl) {
    new MutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        if (m.attributeName === 'class' && panelEl.classList.contains('active')) {
          clearNoteSearch();
          guideActive = false;
          var gbtn = document.getElementById('btnToggleGuide');
          if (gbtn) gbtn.style.color = 'var(--sub)';
        }
      });
    }).observe(panelEl, { attributes: true, attributeFilter: ['class'] });
  }
})();
// 打开/新建笔记时的 dock 隐藏逻辑已整合到 works-panel.js 的 openNote/newNote 覆写中

async function saveNoteSilent() {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value;
  if (!title && !content) return;
  const body = { title: title || '无标题', content };
  if (currentNoteId) body.id = currentNoteId;
  // 发送作品关联字段，防止自动保存清空关联
  const workId = document.getElementById('noteWorkId')?.value || '';
  const chapterOrder = parseInt(document.getElementById('noteChapterOrder')?.value || '0', 10);
  body.workId = workId;
  if (chapterOrder > 0) body.chapterOrder = chapterOrder;
  try {
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    currentNoteId = data.id; markClean();
    document.getElementById('saveIndicator').textContent = '● 已自动保存';
    setTimeout(() => { if (!noteDirty) document.getElementById('saveIndicator').textContent = ''; }, 2000);
    loadNotesList();
  } catch(e) { console.warn('[Notes] autoSave failed', e.message); }
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
      toast('❌ 图片上传失败', 'error');
    }
  } catch(e) {
    ta.value = ta.value.replace(placeholder, '');
    toast('❌ 上传失败：' + e.message);
  }
  renderLive();
}

// ===== 字数统计 =====
var editorOpenTime = Date.now();
function updateWordCount() {
  const text = document.getElementById('noteContent')?.value || '';
  const el = document.getElementById('wordCount');
  const rt = document.getElementById('readTime');
  if (!el) return;

  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const englishWords = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').split(/\s+/).filter(function(w) { return /[a-zA-Z]/.test(w); }).length;
  const totalWords = chineseChars + englishWords;
  // 阅读速度：峰值800字/分，起步即90%峰值，轻微心流→缓慢疲劳
  var t = (Date.now() - editorOpenTime) / 60000;
  var warmup = 0.9 + 0.1 * (1 - Math.exp(-t / 8));
  var fatigue = t > 30 ? Math.exp(-(t - 30) / 90) : 1;
  var speed = Math.max(400, Math.round(800 * warmup * fatigue));
  var totalSec = Math.round(totalWords / speed * 60);
  var readMin = Math.floor(totalSec / 60);
  var readSec = totalSec % 60;

  el.textContent = '📊 ' + totalWords + ' 字' + (chineseChars > 0 && englishWords > 0 ? '（中' + chineseChars + ' / 英' + englishWords + '）' : '');
  if (totalSec < 60) rt.textContent = '~' + totalSec + '秒';
  else if (readMin < 5) rt.textContent = '~' + readMin + '分' + readSec + '秒';
  else rt.textContent = '~' + readMin + '分钟';
}

// ===== 键盘快捷键 =====
document.addEventListener('keydown', e => {
  // Ctrl+S / Cmd+S → 保存（阻止浏览器默认保存网页行为）
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    if (S.currentPanel === 'notes' || document.activeElement?.closest('#panel-notes')) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof saveNote === 'function') saveNote();
    }
  }
  // Ctrl+\ → 切换预览面板（隐藏/显示预览）
  if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
    if (S.currentPanel === 'notes' || document.activeElement?.closest('#panel-notes')) {
      e.preventDefault();
      togglePreview();
    }
  }
  // Ctrl+. → 纯预览模式（只显示渲染结果）
  if ((e.ctrlKey || e.metaKey) && (e.key === '.' || e.code === 'Period')) {
    if (S.currentPanel === 'notes' || document.activeElement?.closest('#panel-notes')) {
      e.preventDefault();
      e.stopPropagation();
      togglePreviewOnly();
    }
  }
});


  // ===== 编辑器 Tab 缩进 + 代码块智能换行 =====
  document.addEventListener('keydown', function(e) {
    var ta = document.getElementById('noteContent');
    if (!ta || document.activeElement !== ta) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      var start = ta.selectionStart, end = ta.selectionEnd;
      if (start !== end) {
        var before = ta.value.substring(0, start), sel = ta.value.substring(start, end), after = ta.value.substring(end);
        var lines = sel.split('\n');
        if (lines.every(function(l) { return l.trim() === ''; })) {
          ta.value = before + '  ' + after;
          ta.selectionStart = ta.selectionEnd = start + 2;
        } else {
          var indented = lines.map(function(l) { return '  ' + l; }).join('\n');
          ta.value = before + indented + after;
          ta.selectionStart = start; ta.selectionEnd = start + indented.length;
        }
      } else {
        ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(end);
        ta.selectionStart = ta.selectionEnd = start + 2;
      }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (e.key === 'Enter') {
      var pos = ta.selectionStart, text = ta.value, before = text.substring(0, pos);
      var backtickCount = (before.match(/```/g) || []).length;
      if (backtickCount % 2 === 1) {
        var lineStart = before.lastIndexOf('\n') + 1;
        var currentLine = before.substring(lineStart);
        var indent = currentLine.match(/^(\s*)/)[1];
        var extra = currentLine.trimEnd().endsWith('{') ? '  ' : '';
        e.preventDefault();
        var after = text.substring(pos);
        ta.value = before + '\n' + indent + extra + after;
        ta.selectionStart = ta.selectionEnd = pos + 1 + indent.length + extra.length;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
    }
  });

// ===== 从文件中转站导入文本文件 =====
let noteImportDir = '';

function openNoteImport() {
  noteImportDir = '';
  document.getElementById('noteImportModal').classList.add('show');
  loadNoteImportFiles();
}

function closeNoteImport() {
  document.getElementById('noteImportModal').classList.remove('show');
}

function noteImportNav(dir) {
  noteImportDir = dir || '';
  loadNoteImportFiles();
}

async function loadNoteImportFiles() {
  const list = document.getElementById('noteImportList');
  if (!list) return;
  list.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--sub);">⏳ 加载中...</div>';
  try {
    const params = new URLSearchParams();
    if (noteImportDir) params.set('dir', noteImportDir);
    const r = await fetch('/api/files?' + params.toString());
    const data = await r.json();
    const files = data.files || [];
    const crumbs = data.breadcrumb || [];

    // 面包屑
    const bc = document.getElementById('noteImportCrumbs');
    if (bc) {
      bc.innerHTML = crumbs.map((c, i) => {
        const sep = i > 0 ? ' <span style="color:var(--sub);">/</span> ' : '';
        const isLast = i === crumbs.length - 1;
        if (isLast) return sep + '<span style="color:var(--accent);font-weight:600;">' + escHtml(c.name) + '</span>';
        return sep + '<a href="#" onclick="noteImportNav(\'' + escAttr(c.path) + '\');return false;" style="color:var(--accent);text-decoration:none;">' + escHtml(c.name) + '</a>';
      }).join('');
    }

    const textExts = ['md','txt','json','csv','log','html','css','js','jsx','ts','tsx','xml','yaml','yml','toml','ini','cfg','conf','sh','bash','zsh','py','rb','go','rs','java','c','cpp','h','hpp','sql','vue','svelte','tex','bib'];
    const isTextFile = f => {
      if (f.isDir) return true; // 保留目录
      const ext = (f.name || '').split('.').pop().toLowerCase();
      return textExts.includes(ext);
    };

    const dirs = files.filter(f => f.isDir);
    const textFiles = files.filter(f => !f.isDir && isTextFile(f));

    if (!dirs.length && !textFiles.length) {
      list.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--sub);">此目录暂无支持的文本文件</div>';
      return;
    }

    const sz = b => b < 1024 ? b + 'B' : b < 1024*1024 ? (b/1024).toFixed(1)+'KB' : (b/1024/1024).toFixed(1)+'MB';

    // 目录条目
    const dirItems = dirs.map(d => `
      <div class="file-row" style="cursor:pointer;" onclick="noteImportNav('${escAttr(d.relPath)}')">
        <span class="fname"><span class="mi" style="font-size:14px;vertical-align:middle;">folder</span> ${escHtml(d.name)}</span>
        <span class="fsize"></span>
        <span class="fsize"></span>
      </div>
    `).join('');

    // 文件条目
    const fileItems = textFiles.map(f => `
      <div class="file-row" style="cursor:pointer;" onclick="importNoteFromFile('${escAttr(f.relPath)}','${escAttr(f.name.replace(/'/g, "\\'"))}')"
           onmouseover="this.style.background='var(--hover)';this.style.borderColor='var(--accent)';" onmouseout="this.style.background='';this.style.borderColor='';">
        <span class="fname"><span class="mi" style="font-size:14px;vertical-align:middle;">description</span> ${escHtml(f.name)}</span>
        <span class="fsize">${sz(f.size)}</span>
        <span class="fsize">${new Date(f.mtime).toLocaleDateString('zh-CN')}</span>
      </div>
    `).join('');

    list.innerHTML = dirItems + fileItems;
  } catch(e) {
    list.innerHTML = '<div style="color:var(--danger);text-align:center;">❌ 加载失败</div>';
  }
}

async function importNoteFromFile(relPath, filename) {
  closeNoteImport();
  // 新建笔记（如果当前有内容，先保存）
  if (currentNoteId && noteDirty) { try { await saveNote(); } catch {} }
  try {
    const r = await fetch('/api/preview/' + encodeURIComponent(relPath));
    if (!r.ok) { toast('❌ 读取文件失败', 'error'); return; }
    const text = await r.text();
    // 提取标题：md 文件取第一个 # 标题，否则用文件名
    let title = filename.replace(/\.[^.]+$/, '');
    if (/\.md$/i.test(filename)) {
      const m = text.match(/^#\s+(.+)$/m);
      if (m) title = m[1].trim();
    }
    document.getElementById('noteTitle').value = title;
    document.getElementById('noteContent').value = text;
    currentNoteId = null;
    markDirty();
    renderLive();
    updateWordCount();
    toast('✅ 已导入: ' + filename);
  } catch(e) {
    toast('❌ 导入失败: ' + e.message, 'error');
  }
}

// ===== 语法指南（内嵌预览，不跳转新标签页）=====
var guideCache = null, guideActive = false;

async function toggleGuide() {
  var preview = document.getElementById('notePreview');
  var btn = document.getElementById('btnToggleGuide');
  if (!preview) return;

  if (guideActive) {
    // 关闭指南，从编辑区重新渲染预览
    guideActive = false;
    if (btn) btn.style.color = 'var(--sub)';
    renderLive();
    if (!previewVisible) togglePreview(); // 确保预览面板可见
    updatePreviewHint();
    return;
  }

  // 确保编辑器可见（未打开笔记时也能看到指南）
  var editor = document.getElementById('noteEditor');
  if (editor && editor.style.display === 'none') {
    editor.style.display = 'flex';
    if (editor.style.flexDirection !== 'column') editor.style.flexDirection = 'column';
  }

  // 确保预览面板可见
  if (!previewVisible) togglePreview();

  guideActive = true;
  if (btn) btn.style.color = 'var(--accent)';
  preview.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--sub);">⏳ 加载语法指南...</div>';
  preview.style.overflowY = 'auto';

  if (guideCache) { preview.innerHTML = guideCache; return; }

  try {
    var resp = await fetch('/docs/notes-guide.html');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var fullHTML = await resp.text();
    var m = fullHTML.match(/<body>([\s\S]*)<\/body>/i);
    guideCache = m ? m[1] : fullHTML;
    preview.innerHTML = guideCache;
  } catch(e) {
    preview.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--danger);">❌ 加载失败</div>';
    guideActive = false;
    if (btn) btn.style.color = 'var(--sub)';
  }
}
