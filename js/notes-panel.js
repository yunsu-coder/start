// ===== 笔记 =====
let currentNoteId = null, noteDirty = false, autoSaveTimer = null;
function isNoteDirty() { return noteDirty; }
function markDirty() { noteDirty = true; document.getElementById('saveIndicator').textContent = '● 未保存'; }
function markClean() { noteDirty = false; document.getElementById('saveIndicator').textContent = ''; }

function md2html(md) {
  let s = (md || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // 代码块（先处理，保护内部内容）
  const blocks = [];
  s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push({ lang, code: code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') });
    return '\x00' + (blocks.length - 1) + '\x00';
  });

  // 表格
  s = s.replace(/^\|(.+)\|\n\|[-: |]+\|\n((?:\|.+\|\n?)*)/gm, (_, head, rows) => {
    const hc = head.split('|').map(c => '<th>' + c.trim() + '</th>').join('');
    const rc = rows.trim().split('\n').map(r => '<tr>' + r.split('|').filter(c => c).map(c => '<td>' + c.trim() + '</td>').join('') + '</tr>').join('');
    return '<table><thead><tr>' + hc + '</tr></thead><tbody>' + rc + '</tbody></table>';
  });

  // 水平线
  s = s.replace(/^(---|\*\*\*|___)\s*$/gm, '<hr>');

  // 标题 h1-h6
  s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 引用块
  s = s.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');

  // 任务列表
  s = s.replace(/^[*-] \[x\] (.+)$/gim, '<li class="task done"><input type="checkbox" checked disabled> $1</li>');
  s = s.replace(/^[*-] \[ \] (.+)$/gim, '<li class="task"><input type="checkbox" disabled> $1</li>');

  // 有序列表 — 标记后用ol包裹
  s = s.replace(/^(\d+)\. (.+)$/gm, '<li data-n="$1">$2</li>');

  // 任务列表 — ul包裹
  s = s.replace(/(<li class="task.*?<\/li>\n?)+/g, '<ul class="task-list">$&</ul>');

  // 有序列表 — ol包裹
  s = s.replace(/(<li data-n=.*?<\/li>\n?)+/g, '<ol>$&</ol>');

  // 无序列表
  s = s.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>(?!<\/li>).*<\/li>\n?)+/g, '<ul>$&</ul>');

  // 保护列表块不被段落处理破坏（支持 <ul>、<ol>、<ul class="task-list">）
  const listBlocks = [];
  s = s.replace(/<[uo]l[^>]*>[\s\S]*?<\/[uo]l>/g, m => {
    listBlocks.push(m);
    return '\x01L' + (listBlocks.length - 1) + 'L\x01';
  });

  // 段落
  s = s.replace(/\n\n+/g, '</p><p>');
  s = s.replace(/\n/g, '<br>');

  // 恢复列表块
  s = s.replace(/\x01L(\d+)L\x01/g, (_, i) => listBlocks[+i]);

  // 清理 <p> 包裹块级元素 (列表, 表格, 引用等)
  s = s.replace(/<p>\s*(<(?:\/[uo]l|[uo]l|table|blockquote|h\d|hr|pre)[^>]*>)/gi, '$1');
  s = s.replace(/(<\/(?:[uo]l|table|blockquote|h\d|hr|pre)[^>]*>)\s*<\/p>/gi, '$1');
  s = s.replace(/<\/p>\s*(<[uo]l[^>]*>)/g, '$1');
  // 清理列表块之间的 <br>（段落处理残留）
  s = s.replace(/<\/([uo]l)>\s*<br>/g, '</$1>');

  // 行内格式
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 链接和图片
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  // 恢复代码块
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => {
    const b = blocks[+i];
    return '<pre><code class="' + (b.lang || '') + '">' + b.code + '</code></pre>';
  });

  // 如果开头已经是块级元素，不加 <p> 包裹
  const startsWithBlock = /^<(\/?[uo]l|table|blockquote|h\d|hr|pre)/.test(s);
  return startsWithBlock ? s : '<p>' + s + '</p>';
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
  if (!title && !content) { toast('⚠️ 标题和内容不能都为空'); return; }
  const body = { title: title || '无标题', content };
  if (currentNoteId) body.id = currentNoteId;
  try {
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    currentNoteId = data.id; markClean();
    toast('✅ 已保存'); loadNotesList();
  } catch(e) { toast('❌ 保存失败'); }
}

async function deleteNote() {
  if (!currentNoteId) { toast('⚠️ 还没有保存的笔记'); return; }
  if (!confirm('确定删除这篇笔记？')) return;
  try {
    await fetch('/api/notes/' + currentNoteId, { method: 'DELETE' });
    currentNoteId = null; noteDirty = false;
    document.getElementById('noteEditor').style.display = 'none';
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
    markClean(); stopAutoSave();
    toast('🗑️ 已删除'); loadNotesList();
  } catch(e) { toast('❌ 删除失败'); }
}

function startAutoSave() { stopAutoSave(); autoSaveTimer = setInterval(() => { if (noteDirty) saveNoteSilent(); }, 30000); }
function stopAutoSave() { if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = null; } }

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
      toast('❌ 图片上传失败');
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
