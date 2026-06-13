// ===== 笔记 =====
let currentNoteId = null, noteDirty = false, autoSaveTimer = null;
function isNoteDirty() { return noteDirty; }
function markDirty() { noteDirty = true; document.getElementById('saveIndicator').textContent = '● 未保存'; }
function markClean() { noteDirty = false; document.getElementById('saveIndicator').textContent = ''; }

function md2html(md) {
  let s = (md || '');

  // ① 保护代码块和行内代码（防转义破坏内部内容）
  const codeBlocks = [];
  const inlineCodes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { inlineCodes.push(c); return '\x01' + (inlineCodes.length - 1) + '\x01'; });
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push({ lang, code });
    return '\x00' + (codeBlocks.length - 1) + '\x00';
  });

  // ② HTML 转义
  s = s.replace(/&(?!\w+;)/g, '&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ③ 表格
  s = s.replace(/^\|(.+)\|\s*$\n\|[-: |]+\|\s*$(?:\n\|.+\|\s*$)*/gm, (match) => {
    const lines = match.trim().split('\n');
    if (lines.length < 2) return match;
    const hc = lines[0].split('|').filter(c => c.trim()).map(c => '<th>' + c.trim() + '</th>').join('');
    const rc = lines.slice(2).map(r => '<tr>' + r.split('|').filter(c => c.trim()).map(c => '<td>' + c.trim() + '</td>').join('') + '</tr>').join('');
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

  // ⑥ 引用块（支持多行）
  s = s.replace(/^(?:&gt;\s?.+\n?)+/gm, (match) => {
    const inner = match.replace(/^&gt;\s?/gm, '').trim();
    return '<blockquote>' + inner.replace(/\n{2,}/g, '<br><br>') + '</blockquote>';
  });

  // ⑦ 任务列表
  s = s.replace(/^[*-] \[x\] (.+)$/gim, '<li class="task done"><input type="checkbox" checked onclick="return false"> $1</li>');
  s = s.replace(/^[*-] \[ \] (.+)$/gim, '<li class="task"><input type="checkbox" onclick="return false"> $1</li>');

  // ⑧ 有序/无序列表项标记
  s = s.replace(/^(\d+)\.\s+(.+)$/gm, '<li class="olitem">$2</li>');
  s = s.replace(/^[*-]\s+(.+)$/gm, '<li class="ulitem">$1</li>');

  // 用 ul/ol 包裹连续列表项
  s = s.replace(/((?:<li class="olitem">.*<\/li>\n?)+)/g, '<ol>$1</ol>');
  s = s.replace(/((?:<li class="ulitem">.*<\/li>\n?)+)/g, '<ul>$1</ul>');
  s = s.replace(/ class="(?:ol|ul)item"/g, '');

  // ⑨ 段落处理（智能识别块级元素）
  const lines = s.split('\n');
  let result = [], inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlock = /^<(h[1-6]|hr|table|blockquote|ul|ol|pre|div|p)\b/.test(line) || /^<\/(ul|ol|table|blockquote)>/.test(line);
    if (isBlock) {
      if (inBlock) result[result.length-1] += '\n' + line;
      else { result.push(line); inBlock = true; }
    } else if (line.trim() === '') { inBlock = false; }
    else {
      if (inBlock) result[result.length-1] += '\n' + line;
      else { result.push(line); inBlock = true; }
    }
  }
  s = result.map(block => {
    if (/^<\/?/.test(block.trim())) return block;
    return '<p>' + block.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  }).join('\n');

  // ⑩ 行内格式
  s = s.replace(/==(.+?)==/g, '<mark>$1</mark>');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/~(.+?)~/g, '<sub>$1</sub>');
  s = s.replace(/\^(.+?)\^/g, '<sup>$1</sup>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 链接和图片
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // 恢复代码块和行内代码（还原保护的内容）
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => {
    const b = codeBlocks[+i];
    return '<pre><code class="' + (b.lang || '') + '">' + b.code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code></pre>';
  });
  s = s.replace(/\x01(\d+)\x01/g, (_, i) => '<code>' + inlineCodes[+i].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code>');

  return s || '<p></p>';
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
let dockTimer = null, dockEnabled = true;
function initSidebarDock() {
  const layout = document.querySelector('.notes-layout');
  const sidebar = document.querySelector('.notes-sidebar');
  const editor = document.getElementById('noteEditor');
  if (!layout || !sidebar || !editor) return;

  function hideSidebar() {
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
  if (editor.style.display !== 'none') hideSidebar();
}
// 页面加载后初始化
document.addEventListener('DOMContentLoaded', initSidebarDock);
// 打开/新建笔记时自动触发隐藏
const _origOpenNote = openNote;
openNote = async function(id) {
  await _origOpenNote(id);
  setTimeout(() => { if (dockEnabled) { const l = document.querySelector('.notes-layout'); if (l) l.classList.add('dock-hidden'); } }, 700);
};
const _origNewNote = newNote;
newNote = async function() {
  await _origNewNote();
  setTimeout(() => { if (dockEnabled) { const l = document.querySelector('.notes-layout'); if (l) l.classList.add('dock-hidden'); } }, 700);
};

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
function updateWordCount() {
  const text = document.getElementById('noteContent')?.value || '';
  const el = document.getElementById('wordCount');
  const rt = document.getElementById('readTime');
  if (!el) return;

  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const englishWords = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .split(/\s+/).filter(w => w.length > 0).length;
  const totalChars = text.length;
  const totalWords = chineseChars + englishWords;
  const readMin = Math.max(1, Math.round(totalWords / 300));

  el.textContent = `📊 ${totalWords} 字${chineseChars > 0 && englishWords > 0 ? `（中${chineseChars} / 英${englishWords}）` : ''}`;
  rt.textContent = readMin <= 1 ? '〜1分钟' : `〜${readMin}分钟`;
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
  if ((e.ctrlKey || e.metaKey) && e.key === '.') {
    if (S.currentPanel === 'notes' || document.activeElement?.closest('#panel-notes')) {
      e.preventDefault();
      e.stopPropagation();
      togglePreviewOnly();
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
