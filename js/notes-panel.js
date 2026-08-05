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
      // KaTeX 数学公式（$$ 块级 / $ 行内）
      if (typeof katex !== 'undefined') {
        try {
          h = h.replace(/\$\$([\s\S]*?)\$\$/g, function(m, f) {
            try { return katex.renderToString(f.trim(), { displayMode: true, throwOnError: false }); } catch(e) { return m; }
          });
          h = h.replace(/\$([^\$]+?)\$/g, function(m, f) {
            try { return katex.renderToString(f.trim(), { displayMode: false, throwOnError: false }); } catch(e) { return m; }
          });
        } catch(e) {}
      }
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

async function newNote() { Yiwei.sound.play("note-new");
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
  Yiwei.sound.play('card-click');
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

async function saveNote() { Yiwei.sound.play("note-save");
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

async function deleteNote() { Yiwei.sound.play("note-delete");
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
function clearPaneInlineFlex() {
  const panes = document.querySelectorAll('#noteEditor .split-pane > .pane');
  panes.forEach(function(p) { p.style.flex = ''; });
}
function restorePaneRatio() {
  const saved = localStorage.getItem('notes_split_ratio');
  const sp = document.querySelector('#noteEditor .split-pane');
  if (sp && saved) applyPaneRatio(sp, parseFloat(saved));
}
function togglePreview() { Yiwei.sound.play("note-preview");
  previewVisible = !previewVisible;
  if (previewVisible) previewOnly = false;
  const sp = document.querySelector('#noteEditor .split-pane');
  const btn = document.getElementById('btnTogglePreview');
  if (sp) {
    sp.classList.toggle('no-preview', !previewVisible);
    sp.classList.toggle('preview-only', false);
    // 最大化编辑时清除内联 flex，让 CSS class 规则生效（避免分隔条拖拽比例覆盖）
    if (!previewVisible) { clearPaneInlineFlex(); }
    else { restorePaneRatio(); }
  }
  if (btn) btn.innerHTML = previewOnly ? '<span class="mi">edit_off</span>' : (previewVisible ? '<span class="mi">visibility</span>' : '<span class="mi">visibility_off</span>');
  updatePreviewHint();
}
function togglePreviewOnly() {
  previewOnly = !previewOnly;
  if (previewOnly) previewVisible = true;
  const sp = document.querySelector('#noteEditor .split-pane');
  const btn = document.getElementById('btnTogglePreview');
  if (sp) {
    sp.classList.toggle('preview-only', previewOnly);
    sp.classList.toggle('no-preview', false);
    // 纯预览时清除内联 flex，让 CSS class 规则生效
    if (previewOnly) { clearPaneInlineFlex(); }
    else { restorePaneRatio(); }
  }
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
    Yiwei.sound.play('btn-toggle-off');

    const btn = document.getElementById('btnToggleSidebar');
    if (btn) btn.style.color = 'var(--sub)';
  } else {
    // 手动固定侧栏状态
    dockManualOff = true;
    layout.classList.toggle('dock-hidden');
    Yiwei.sound.play(layout.classList.contains('dock-hidden') ? 'btn-toggle-on' : 'btn-toggle-off');

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
  // Ctrl+\ → 切换预览面板（隐藏/显示预览），同时匹配 e.code 兼容中文键盘（该键输出 、）
  if ((e.ctrlKey || e.metaKey) && (e.key === '\\' || e.code === 'Backslash')) {
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
  // ⌘B 加粗 / ⌘I 斜体（仅笔记编辑器）
  if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B' || e.key === 'i' || e.key === 'I')) {
    if (S.currentPanel === 'notes' || document.activeElement?.closest('#panel-notes')) {
      var ta = document.getElementById('noteContent');
      if (!ta || document.activeElement !== ta) return;
      e.preventDefault();
      var start = ta.selectionStart, end = ta.selectionEnd;
      var sel = ta.value.substring(start, end);
      var wrap = e.key === 'b' || e.key === 'B' ? '**' : '*';
      ta.value = ta.value.substring(0, start) + wrap + sel + wrap + ta.value.substring(end);
      ta.selectionStart = start + wrap.length;
      ta.selectionEnd = end + wrap.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
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
    Yiwei.sound.play('modal-open');
  loadNoteImportFiles();
}

function closeNoteImport() {
    Yiwei.sound.play('modal-close');
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

// ===== 打字音效（全局标记 + 内联事件）=====
window._typeSoundEnabled = localStorage.getItem('yiwei_type_sound') === 'true';

window.toggleTypeSound = function() {
  window._typeSoundEnabled = !window._typeSoundEnabled;
  localStorage.setItem('yiwei_type_sound', window._typeSoundEnabled);
  var btn = document.getElementById('btnTypeSound');
  if (btn) { btn.style.color = window._typeSoundEnabled ? 'var(--accent2)' : ''; btn.style.background = window._typeSoundEnabled ? 'var(--nav-active-bg)' : ''; }
  try { Yiwei.sound.play(window._typeSoundEnabled ? 'btn-toggle-on' : 'btn-toggle-off'); } catch(e) {}
  try { toast(window._typeSoundEnabled ? '⌨️ 打字音效 开' : '🔇 打字音效 关', 'info'); } catch(e) {}
};

(function() { var b = document.getElementById('btnTypeSound'); if (b && window._typeSoundEnabled) { b.style.color = 'var(--accent2)'; b.style.background = 'var(--nav-active-bg)'; } })();

// ===== 笔记番茄钟联动 =====
window.startNotePomodoro = function() {
  if (!window.Yiwei || !window.Yiwei.pomodoro) { toast('⚠️ 番茄钟模块未加载', 'warning'); return; }
  var title = document.getElementById('noteTitle')?.value || '未命名笔记';
  localStorage.setItem('yiwei_pomo_note_title', title);
  localStorage.setItem('yiwei_pomo_note_start', Date.now());
  var pomo = window.Yiwei.pomodoro;
  if (pomo.setMode) pomo.setMode('pomodoro');
  setTimeout(function() {
    var state = pomo.getState ? pomo.getState() : null;
    if (state && !state.running) { var sb = document.getElementById('pomodoStartBtn'); if (sb) sb.click(); }
  }, 150);
  Yiwei.sound.play('pomo-start');
  toast('🍅「' + title + '」· 专注 25 分钟', 'info');
};

// ===== 批量修复: 打字音效 + 番茄钟鸡仔 + 画图占位符 + 首页 =====

// --- 1. 打字音效：简化且鲁棒 ---
(function() {
  var tsEnabled = localStorage.getItem('yiwei_type_sound') === 'true';
  var tsBtn = null;
  window.toggleTypeSound = function() {
    tsEnabled = !tsEnabled;
    localStorage.setItem('yiwei_type_sound', tsEnabled);
    tsBtn = tsBtn || document.getElementById('btnTypeSound');
    if (tsBtn) {
      tsBtn.style.color = tsEnabled ? 'var(--accent2)' : '';
      tsBtn.style.background = tsEnabled ? 'var(--nav-active-bg)' : '';
    }
    try { Yiwei.sound.play(tsEnabled ? 'btn-toggle-on' : 'btn-toggle-off'); } catch(e) {}
    try { toast(tsEnabled ? '⌨️ 打字音效 开' : '🔇 打字音效 关', 'info'); } catch(e) {}
  };
  // 直接绑定，不等 DOMContentLoaded
  function bindTypeSound() {
    tsBtn = document.getElementById('btnTypeSound');
    if (tsBtn && tsEnabled) { tsBtn.style.color = 'var(--accent2)'; tsBtn.style.background = 'var(--nav-active-bg)'; }
    var nc = document.getElementById('noteContent');
    if (!nc) return;
    nc.addEventListener('keydown', function(e) {
      if (!tsEnabled) return;
      var sn = e.key === 'Enter' ? 'type-enter' : (e.key === 'Backspace' ? 'click-light' : (e.key.length === 1 ? 'type-click' : ''));
      if (sn) { try { Yiwei.sound.play(sn); } catch(ex) {} }
    });
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', bindTypeSound); }
  else { setTimeout(bindTypeSound, 100); }
})();

// --- 2. 画图工具：形状 + 文本框 + 选中移动 ---
(function() {
  var dActive = false, dCtx, dCanvas, dColor = '#ff6b9d', dSize = 3, dTool = 'pen';
  var dDrawing = false, dStartX, dStartY, dSnapshot;
  var dElements = []; // 追踪所有绘制元素
  var dSelected = -1; // 当前选中的元素索引
  var dMoving = false, dMoveOffX, dMoveOffY;

  window.toggleDrawing = function() { if (dActive) { closeDraw(); return; } openDraw(); };

  function redrawAll() {
    dCtx.fillStyle = '#fff'; dCtx.fillRect(0, 0, dCanvas.width, dCanvas.height);
    dCtx.lineCap = 'round'; dCtx.lineJoin = 'round';
    dElements.forEach(function(el, i) {
      dCtx.strokeStyle = el.color; dCtx.fillStyle = el.color; dCtx.lineWidth = el.size;
      if (el.type === 'pen') {
        if (el.points && el.points.length > 1) {
          dCtx.beginPath(); dCtx.moveTo(el.points[0].x, el.points[0].y);
          for (var p = 1; p < el.points.length; p++) dCtx.lineTo(el.points[p].x, el.points[p].y);
          dCtx.stroke();
        }
      } else if (el.type === 'line') {
        dCtx.beginPath(); dCtx.moveTo(el.x1, el.y1); dCtx.lineTo(el.x2, el.y2); dCtx.stroke();
      } else if (el.type === 'rect') {
        dCtx.strokeRect(el.x, el.y, el.w, el.h);
      } else if (el.type === 'circle') {
        dCtx.beginPath(); dCtx.ellipse(el.x + el.r, el.y + el.r, el.r, el.r, 0, 0, Math.PI*2); dCtx.stroke();
      } else if (el.type === 'text') {
        dCtx.font = (el.size * 3.5) + 'px sans-serif'; dCtx.fillText(el.text, el.x, el.y);
      }
    });
    // 绘制选中元素的外框
    if (dSelected >= 0 && dSelected < dElements.length) {
      var sel = dElements[dSelected];
      dCtx.strokeStyle = '#4488ff'; dCtx.lineWidth = 1.5;
      dCtx.setLineDash([4, 3]);
      if (sel.type === 'text') {
        var tw = dCtx.measureText(sel.text).width;
        dCtx.strokeRect(sel.x - 3, sel.y - sel.size * 3.5 + 2, tw + 6, sel.size * 3.5 + 4);
      } else if (sel.type === 'rect') {
        dCtx.strokeRect(sel.x - 3, sel.y - 3, sel.w + 6, sel.h + 6);
      } else if (sel.type === 'circle') {
        dCtx.strokeRect(sel.x - 3, sel.y - 3, sel.r * 2 + 6, sel.r * 2 + 6);
      } else if (sel.type === 'line') {
        dCtx.strokeRect(Math.min(sel.x1, sel.x2) - 4, Math.min(sel.y1, sel.y2) - 4, Math.abs(sel.x2 - sel.x1) + 8, Math.abs(sel.y2 - sel.y1) + 8);
      } else if (sel.type === 'pen' && sel.points) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        sel.points.forEach(function(p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        dCtx.strokeRect(minX - 4, minY - 4, maxX - minX + 8, maxY - minY + 8);
      }
      dCtx.setLineDash([]);
    }
  }

  function hitTest(x, y) {
    // 倒序遍历（上层优先）
    for (var i = dElements.length - 1; i >= 0; i--) {
      var el = dElements[i];
      var margin = 8;
      if (el.type === 'text') {
        dCtx.font = (el.size * 3.5) + 'px sans-serif';
        var tw = dCtx.measureText(el.text).width;
        if (x >= el.x - margin && x <= el.x + tw + margin && y >= el.y - el.size * 3.5 - margin && y <= el.y + margin) return i;
      } else if (el.type === 'rect') {
        if (x >= el.x - margin && x <= el.x + el.w + margin && y >= el.y - margin && y <= el.y + el.h + margin) return i;
      } else if (el.type === 'circle') {
        var dx = x - (el.x + el.r), dy = y - (el.y + el.r);
        if (Math.sqrt(dx*dx + dy*dy) <= el.r + margin) return i;
      } else if (el.type === 'line') {
        var lx1 = Math.min(el.x1, el.x2) - margin, lx2 = Math.max(el.x1, el.x2) + margin;
        var ly1 = Math.min(el.y1, el.y2) - margin, ly2 = Math.max(el.y1, el.y2) + margin;
        if (x >= lx1 && x <= lx2 && y >= ly1 && y <= ly2) return i;
      } else if (el.type === 'pen' && el.points) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        el.points.forEach(function(p) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
        if (x >= minX - margin && x <= maxX + margin && y >= minY - margin && y <= maxY + margin) return i;
      }
    }
    return -1;
  }

  function openDraw() {
    dActive = true;
    var ov = document.createElement('div');
    ov.id = 'drawOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.75);display:flex;flex-direction:column;align-items:center;justify-content:center;';
    ov.onclick = function(e) { if (e.target === ov) closeDraw(); };

    var tb = document.createElement('div');
    tb.style.cssText = 'display:flex;gap:4px;align-items:center;padding:6px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px 8px 0 0;flex-wrap:wrap;';
    tb.innerHTML =
      '<span style="font-size:.65rem;color:var(--sub);">工具</span>' +
      [{v:'select',l:'🖱️',t:'选择/移动'},{v:'pen',l:'✏️',t:'画笔'},{v:'rect',l:'⬜',t:'矩形'},{v:'circle',l:'⭕',t:'圆形'},{v:'line',l:'📏',t:'直线'},{v:'text',l:'📝',t:'文字'}].map(function(tl) {
        return '<button class="draw-tool-btn" style="padding:2px 5px;font-size:.7rem;border:2px solid '+(dTool===tl.v?'var(--accent)':'var(--border)')+';background:'+(dTool===tl.v?'var(--nav-active-bg)':'var(--bg)')+';color:var(--text);cursor:pointer;border-radius:3px;" data-tool="'+tl.v+'" title="'+tl.t+'">'+tl.l+'</button>';
      }).join('') +
      '<span style="font-size:.65rem;color:var(--sub);margin-left:4px;">色</span>' +
      ['#ff6b9d','#64f0ff','#ffbb44','#44dd88','#ffffff','#ff4444','#4488ff','#000000'].map(function(c){return '<button style="width:18px;height:18px;border-radius:50%;background:'+c+';border:2px solid '+(c===dColor?'var(--text)':'var(--border)')+';cursor:pointer;flex-shrink:0;" onclick="window._drawSetColor(\''+c+'\',this)"></button>';}).join('') +
      '<span style="font-size:.65rem;color:var(--sub);margin-left:4px;">粗</span>' +
      [1,3,5,8].map(function(s){return '<button style="padding:1px 4px;font-size:.6rem;border:2px solid '+(s===dSize?'var(--accent)':'var(--border)')+';background:'+(s===dSize?'var(--nav-active-bg)':'var(--bg)')+';color:var(--text);cursor:pointer;border-radius:3px;" onclick="window._drawSetSize('+s+');var bs=this.parentElement.querySelectorAll(\'button\');" title="'+s+'px">'+s+'</button>';}).join('') +
      '<button class="btn-sm" onclick="window._drawUndo()" style="margin-left:auto;" title="撤销最后一个元素">↩</button>' +
      '<button class="btn-sm" onclick="window._drawClear()">清空</button>' +
      '<button class="btn accent" onclick="window._drawInsert()">插入</button>' +
      '<button class="btn-sm" onclick="window._drawClose()">✕</button>';

    dCanvas = document.createElement('canvas');
    dCanvas.width = Math.min(800, window.innerWidth - 40);
    dCanvas.height = Math.min(500, window.innerHeight - 200);
    dCanvas.style.cssText = 'background:#fff;border:1px solid var(--border);border-top:none;';

    dCtx = dCanvas.getContext('2d');
    redrawAll();

    ov.appendChild(tb); ov.appendChild(dCanvas);
    document.body.appendChild(ov);

    // 工具栏按钮事件委托
    tb.addEventListener('click', function(e) {
      var btn = e.target.closest('.draw-tool-btn');
      if (!btn) return;
      var tool = btn.dataset.tool;
      window._drawSetTool(tool);
      tb.querySelectorAll('.draw-tool-btn').forEach(function(b) {
        b.style.borderColor = 'var(--border)'; b.style.background = 'var(--bg)';
      });
      btn.style.borderColor = 'var(--accent)'; btn.style.background = 'var(--nav-active-bg)';
    });

    dCanvas.addEventListener('mousedown', drawDown);
    dCanvas.addEventListener('mousemove', drawMove);
    dCanvas.addEventListener('mouseup', drawUp);
    dCanvas.addEventListener('touchstart', function(e) { e.preventDefault(); var t = e.touches[0]; drawDown({clientX:t.clientX,clientY:t.clientY}); });
    dCanvas.addEventListener('touchmove', function(e) { e.preventDefault(); var t = e.touches[0]; drawMove({clientX:t.clientX,clientY:t.clientY}); });
    dCanvas.addEventListener('touchend', drawUp);
    try { Yiwei.sound.play('modal-open'); } catch(e) {}
  }

  function drawDown(e) {
    var r = dCanvas.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    dStartX = x; dStartY = y;

    // 选择/移动模式
    if (dTool === 'select') {
      var hit = hitTest(x, y);
      if (hit >= 0) {
        dSelected = hit;
        dMoving = true;
        var el = dElements[hit];
        if (el.type === 'text') { dMoveOffX = x - el.x; dMoveOffY = y - el.y; }
        else if (el.type === 'rect') { dMoveOffX = x - el.x; dMoveOffY = y - el.y; }
        else if (el.type === 'circle') { dMoveOffX = x - el.x; dMoveOffY = y - el.y; }
        else if (el.type === 'line') { dMoveOffX = x - el.x1; dMoveOffY = y - el.y1; }
        else if (el.type === 'pen' && el.points) { dMoveOffX = x - el.points[0].x; dMoveOffY = y - el.points[0].y; }
        redrawAll();
        return;
      }
      dSelected = -1; redrawAll();
      return;
    }

    // 文字模式
    if (dTool === 'text') {
      var ti = document.createElement('input');
      ti.type = 'text'; ti.placeholder = '输入文字后回车...';
      var cr = dCanvas.getBoundingClientRect();
      ti.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + (e.clientY - 18) + 'px;min-width:80px;padding:3px 6px;font-size:' + (dSize*3) + 'px;border:2px dashed ' + dColor + ';background:rgba(0,0,0,.75);color:' + dColor + ';outline:none;z-index:2005;font-family:sans-serif;border-radius:3px;';
      document.body.appendChild(ti);
      ti.focus();
      var done = function() {
        var txt = ti.value; ti.remove();
        if (txt) {
          dElements.push({ type: 'text', text: txt, x: x, y: y, color: dColor, size: dSize });
          redrawAll();
        }
      };
      ti.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter') done();
        if (ev.key === 'Escape') { ti.remove(); }
      });
      ti.addEventListener('blur', function() { setTimeout(function() { if (ti.parentNode) done(); }, 100); });
      return;
    }

    dDrawing = true;
    dCtx.strokeStyle = dColor; dCtx.lineWidth = dSize;
    dSnapshot = dCtx.getImageData(0, 0, dCanvas.width, dCanvas.height);
    dCtx.beginPath();
    dCtx.moveTo(x, y);
  }

  function drawMove(e) {
    var r = dCanvas.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;

    // 移动选中元素
    if (dMoving && dSelected >= 0) {
      var el = dElements[dSelected];
      if (el.type === 'text') { el.x = x - dMoveOffX; el.y = y - dMoveOffY; }
      else if (el.type === 'rect') { el.x = x - dMoveOffX; el.y = y - dMoveOffY; }
      else if (el.type === 'circle') { el.x = x - dMoveOffX; el.y = y - dMoveOffY; }
      else if (el.type === 'line') {
        var dx = x - dMoveOffX - el.x1, dy = y - dMoveOffY - el.y1;
        el.x1 += dx; el.y1 += dy; el.x2 += dx; el.y2 += dy;
        dMoveOffX = x - el.x1; dMoveOffY = y - el.y1;
      } else if (el.type === 'pen' && el.points) {
        var pdx = x - dMoveOffX - el.points[0].x;
        var pdy = y - dMoveOffY - el.points[0].y;
        el.points.forEach(function(p) { p.x += pdx; p.y += pdy; });
        dMoveOffX = x - el.points[0].x; dMoveOffY = y - el.points[0].y;
      }
      redrawAll();
      return;
    }

    dLastX = x; dLastY = y; // 追踪最后位置用于 drawUp 保存形状

    if (!dDrawing) return;

    if (dTool === 'pen') {
      dCtx.lineTo(x, y); dCtx.stroke();
      if (!dElements.length || dElements[dElements.length - 1].type !== 'pen' || !dElements[dElements.length - 1].active) {
        dElements.push({ type: 'pen', color: dColor, size: dSize, points: [{x: dStartX, y: dStartY}], active: true });
      }
      dElements[dElements.length - 1].points.push({x: x, y: y});
    } else {
      // 形状预览：还原快照再画
      dCtx.putImageData(dSnapshot, 0, 0);
      dCtx.strokeStyle = dColor; dCtx.lineWidth = dSize;
      dCtx.beginPath();
      if (dTool === 'rect') dCtx.strokeRect(dStartX, dStartY, x - dStartX, y - dStartY);
      else if (dTool === 'circle') { var rx = (x - dStartX) / 2; var ry = (y - dStartY) / 2; dCtx.ellipse(dStartX + rx, dStartY + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2); dCtx.stroke(); }
      else if (dTool === 'line') { dCtx.moveTo(dStartX, dStartY); dCtx.lineTo(x, y); dCtx.stroke(); }
    }
  }

  var dLastX = 0, dLastY = 0; // 追踪最后鼠标位置

  function drawUp() {
    if (dMoving) { dMoving = false; return; }
    if (!dDrawing) return;
    dDrawing = false;
    // 保存形状元素
    if (dTool === 'pen') {
      var last = dElements[dElements.length - 1];
      if (last && last.type === 'pen') last.active = false;
    } else if (dTool === 'rect') {
      var w = dLastX - dStartX, h = dLastY - dStartY;
      if (Math.abs(w) > 1 || Math.abs(h) > 1) {
        dElements.push({ type: 'rect', x: Math.min(dStartX, dLastX), y: Math.min(dStartY, dLastY), w: Math.abs(w), h: Math.abs(h), color: dColor, size: dSize });
      }
    } else if (dTool === 'circle') {
      var rx = (dLastX - dStartX) / 2, ry = (dLastY - dStartY) / 2;
      var r = Math.max(Math.abs(rx), Math.abs(ry));
      if (r > 2) {
        dElements.push({ type: 'circle', x: dStartX - r, y: dStartY - r, r: r, color: dColor, size: dSize });
      }
    } else if (dTool === 'line') {
      var ldx = dLastX - dStartX, ldy = dLastY - dStartY;
      if (Math.abs(ldx) > 1 || Math.abs(ldy) > 1) {
        dElements.push({ type: 'line', x1: dStartX, y1: dStartY, x2: dLastX, y2: dLastY, color: dColor, size: dSize });
      }
    }
    dSnapshot = null;
    redrawAll();
  }

  window._drawSetTool = function(t) {
    dTool = t;
    dSelected = -1; dMoving = false;
    if (dCanvas) dCanvas.style.cursor = (t === 'text' || t === 'select') ? 'default' : 'crosshair';
    redrawAll();
  };
  window._drawSetColor = function(c, btn) { dColor = c; };
  window._drawSetSize = function(s) { dSize = parseInt(s); };
  window._drawClear = function() { dElements = []; dSelected = -1; redrawAll(); };
  window._drawUndo = function() { dElements.pop(); dSelected = -1; redrawAll(); };
  window._drawInsert = function() {
    var ta = document.getElementById('noteContent');
    if (!ta) { closeDraw(); return; }
    dCanvas.toBlob(function(blob) {
      var form = new FormData(); form.append('file', blob, 'drawing_' + Date.now() + '.png');
      fetch('/api/files', { method: 'POST', body: form }).then(function(r) { return r.json(); }).then(function(d) {
        if (d.uploaded && d.uploaded[0]) {
          var ref = '\n![](/api/view/' + encodeURIComponent(d.uploaded[0].name) + ')\n';
          ta.value = ta.value.slice(0, ta.selectionStart) + ref + ta.value.slice(ta.selectionEnd);
          try { renderLive(); markDirty(); toast('✅ 已插入'); } catch(e) {}
        } else {
          ta.value = ta.value.slice(0, ta.selectionStart) + '\n🎨 [手绘图]\n' + ta.value.slice(ta.selectionEnd);
        }
        ta.focus(); closeDraw();
        try { if (typeof loadFiles === 'function') loadFiles(); } catch(e) {}
      }).catch(function() {
        ta.value = ta.value.slice(0, ta.selectionStart) + '\n🎨 [手绘图]\n' + ta.value.slice(ta.selectionEnd);
        ta.focus(); closeDraw();
      });
    }, 'image/png');
  };
  window._drawClose = function() { closeDraw(); };

  function closeDraw() {
    dActive = false;
    var ov = document.getElementById('drawOverlay');
    if (ov) ov.remove();
    try { Yiwei.sound.play('modal-close'); } catch(e) {}
  }
})();

// --- 3. 番茄钟联动：离开笔记面板自动暂停 ---
(function() {
  var notePanelEl = document.getElementById('panel-notes');
  if (!notePanelEl) return;
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.attributeName === 'class') {
        var wasActive = m.oldValue && m.oldValue.includes('active');
        var isActive = notePanelEl.classList.contains('active');
        if (wasActive && !isActive) {
          // 离开笔记面板，检查番茄钟是否在运行
          try {
            var pomo = window.Yiwei && window.Yiwei.pomodoro;
            if (pomo) {
              var state = pomo.getState();
              if (state && state.running && state.mode === 'pomodoro') {
                // 自动暂停并提示
                var pauseBtn = document.getElementById('pomodoPauseBtn');
                if (pauseBtn) pauseBtn.click();
                try { toast('⏸️ 离开笔记，番茄钟已暂停', 'warning'); } catch(e) {}
              }
            }
          } catch(e) {}
        }
      }
    });
  });
  observer.observe(notePanelEl, { attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
})();

console.log('[fixes] typing sound, drawing, pomodoro guard loaded');
