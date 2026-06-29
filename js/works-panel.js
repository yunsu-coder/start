// ===== 作品管理 =====
let currentWorkFilter = '';

async function loadWorks() {
  try {
    const works = await (await fetch('/api/works')).json();
    const filter = document.getElementById('workFilter');
    if (!filter) return;
    const currentVal = filter.value;
    filter.innerHTML = '<option value="">📚 全部笔记</option>' +
      works.map(w => `<option value="${escAttr(w.id)}">${escHtml(w.title)} (${w.chapterCount}章)</option>`).join('');
    if (currentVal) filter.value = currentVal;

    const sel = document.getElementById('noteWorkId');
    if (sel) {
      const cur = sel.value;
      sel.innerHTML = '<option value="">无作品</option>' +
        works.map(w => `<option value="${escAttr(w.id)}">${escHtml(w.title)}</option>`).join('');
      if (cur) sel.value = cur;
    }

    const list = document.getElementById('workList');
    if (!list) return;
    if (!works.length) { list.innerHTML = '<div class="empty-state">还没有作品，在上面创建一个吧</div>'; return; }

    list.innerHTML = await Promise.all(works.map(async w => {
      const full = await (await fetch('/api/works/' + w.id)).json();
      const chapters = full.chapters || [];
      let notes = [];
      try { notes = await (await fetch('/api/notes')).json(); } catch(e) { console.warn('[Works] fetch notes failed', e.message); }
      const noteMap = {};
      notes.forEach(n => { noteMap[n.id] = n; });

      const chapterHtml = chapters.map((cid, i) => {
        const note = noteMap[cid];
        return `<div class="work-chapter-item" draggable="true"
          ondragstart="chapterDragStart(event,'${escAttr(cid)}','${escAttr(w.id)}')"
          ondragover="chapterDragOver(event)"
          ondrop="chapterDrop(event,'${escAttr(cid)}','${escAttr(w.id)}')"
          ondragend="chapterDragEnd(event)"
          data-cid="${escAttr(cid)}">
          <span class="ch-grip mi" style="cursor:grab;color:var(--sub);margin-right:4px;font-size:14px;">drag_indicator</span>
          <span class="ch-order">${i + 1}</span>
          <span class="ch-title">${escHtml(note?.title || '(已删除)')}</span>
          <span class="ch-del" onclick="event.stopPropagation();removeChapterFromWork('${escAttr(w.id)}','${escAttr(cid)}')">✕</span>
        </div>`;
      }).join('') || '<div class="empty-state" style="font-size:.7rem;padding:.2rem;">暂无章节</div>';

      return `<div class="work-card tilt-card">
        <div class="work-card-header">
          <div>
            <div class="work-card-title">${escHtml(w.title)}</div>
            <div class="work-card-meta">${w.fandom ? escHtml(w.fandom) + ' · ' : ''}${w.chapterCount} 章 · ${new Date(w.updated).toLocaleDateString('zh-CN')}</div>
          </div>
          <div class="work-card-actions">
            <button onclick="exportWork('${escAttr(w.id)}','md')" title="导出 Markdown">📥</button>
            <button onclick="exportWork('${escAttr(w.id)}','txt')" title="导出 TXT">📄</button>
            <button onclick="deleteWorkConfirm('${escAttr(w.id)}')" title="删除">🗑</button>
          </div>
        </div>
        <div class="work-chapter-list">${chapterHtml}</div>
      </div>`;
    })).then(arr => arr.join(''));
  } catch(e) { console.warn('[Works] loadWorks failed', e.message); }
}

function filterByWork(workId) {
  currentWorkFilter = workId;
  loadNotesList();
}

function showWorkDialog() {
  document.getElementById('workDialog').classList.add('show');
  document.getElementById('workTitleInput').value = '';
  document.getElementById('workFandomInput').value = '';
  document.getElementById('workDescInput').value = '';
  loadWorks();
}

function hideWorkDialog() {
  document.getElementById('workDialog').classList.remove('show');
}

async function saveWorkFromDialog() {
  const title = document.getElementById('workTitleInput').value.trim();
  if (!title) { toast('⚠️ 请输入作品标题', 'warning'); return; }
  await fetch('/api/works', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      fandom: document.getElementById('workFandomInput').value.trim(),
      description: document.getElementById('workDescInput').value.trim(),
    }),
  });
  toast('✅ 作品已创建');
  loadWorks();
  loadWorkDropdowns();
}

async function loadWorkDropdowns() {
  await loadWorks();
}

async function deleteWorkConfirm(id) {
  if (!confirm('确定删除这个作品？（笔记不会被删除）')) return;
  await fetch('/api/works/' + id, { method: 'DELETE' });
  toast('🗑️ 已删除');
  loadWorks();
  loadWorkDropdowns();
}

// ---- 章节拖拽排序 ----
let chapterDragData = null;

function chapterDragStart(e, cid, workId) {
  chapterDragData = { cid, workId };
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', cid);
  e.currentTarget.classList.add('dragging');
  setTimeout(() => { if (e.currentTarget) e.currentTarget.style.opacity = '0.4'; }, 0);
}

function chapterDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function chapterDrop(e, targetCid, workId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!chapterDragData || chapterDragData.cid === targetCid) return;

  const list = e.currentTarget.parentElement;
  const items = [...list.querySelectorAll('.work-chapter-item[data-cid]')];
  const fromIdx = items.findIndex(el => el.dataset.cid === chapterDragData.cid);
  const toIdx = items.findIndex(el => el.dataset.cid === targetCid);
  if (fromIdx === -1 || toIdx === -1) return;

  // 移动 DOM
  if (fromIdx < toIdx) {
    list.insertBefore(items[fromIdx], items[toIdx].nextSibling);
  } else {
    list.insertBefore(items[fromIdx], items[toIdx]);
  }

  // 更新序号
  const newOrder = [...list.querySelectorAll('.work-chapter-item[data-cid]')].map(el => el.dataset.cid);
  [...list.querySelectorAll('.ch-order')].forEach((el, i) => { el.textContent = i + 1; });

  // 保存到服务端
  fetch('/api/works/' + encodeURIComponent(workId) + '/reorder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chapterIds: newOrder })
  }).catch(e => console.warn('[Works] reorder failed', e));

  chapterDragData = null;
}

function chapterDragEnd(e) {
  e.currentTarget.style.opacity = '';
  e.currentTarget.classList.remove('dragging');
  chapterDragData = null;
}

async function removeChapterFromWork(workId, noteId) {
  if (!confirm('从作品中移除该章节？')) return;
  try {
    const work = await (await fetch('/api/works/' + workId)).json();
    work.chapters = (work.chapters || []).filter(c => c !== noteId);
    await fetch('/api/works/' + workId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(work),
    });
    toast('✅ 已移除');
    loadWorks();
  } catch { toast('❌ 移除失败', 'error'); }
}

async function exportWork(workId, format) {
  const a = document.createElement('a');
  a.href = '/api/works/' + workId + '/export?format=' + format;
  a.download = '';
  a.click();
  toast('📥 正在下载…');
}

// ===== 重写 saveNote 以支持作品关联 =====
saveNote = async function() {
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value;
  if (!title && !content) { toast('⚠️ 标题和内容不能都为空', 'warning'); return; }
  const body = { title: title || '无标题', content };
  if (currentNoteId) body.id = currentNoteId;

  const workId = document.getElementById('noteWorkId')?.value || '';
  const chapterOrder = parseInt(document.getElementById('noteChapterOrder')?.value || '0', 10);
  body.workId = workId;
  body.chapterOrder = chapterOrder;

  try {
    const r = await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json();
    currentNoteId = data.id;
    markClean();
    toast('✅ 已保存');
    loadNotesList();

    if (workId) {
      try {
        const work = await (await fetch('/api/works/' + workId)).json();
        if (work && !work.chapters.includes(data.id)) {
          work.chapters.push(data.id);
          const allNotes = await (await fetch('/api/notes')).json();
          const workNotes = allNotes.filter(n => n.workId === workId);
          workNotes.sort((a, b) => (a.chapterOrder || 0) - (b.chapterOrder || 0));
          work.chapters = workNotes.map(n => n.id);
          if (!work.chapters.includes(data.id)) work.chapters.push(data.id);
          await fetch('/api/works/' + workId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(work),
          });
          loadWorks();
        }
      } catch(e) { console.warn('[Works] chapter sync failed', e.message); }
    }
  } catch(e) { toast('❌ 保存失败', 'error'); }
};

// ===== 重写 openNote 以加载作品关联 =====
openNote = async function(id) {
  if (noteDirty && id !== currentNoteId && !confirm('当前笔记未保存，是否放弃？')) return;
  try {
    const note = await (await fetch('/api/notes/' + id)).json();
    currentNoteId = id;
    document.getElementById('noteEditor').style.display = 'flex';
    localStorage.setItem('last_note_id', id);
    if (document.getElementById('noteEditor').style.flexDirection !== 'column')
      document.getElementById('noteEditor').style.flexDirection = 'column';
    document.getElementById('noteTitle').value = note.title;
    document.getElementById('noteContent').value = note.content;
    const workSel = document.getElementById('noteWorkId');
    if (workSel) { workSel.value = note.workId || ''; }
    const orderSel = document.getElementById('noteChapterOrder');
    if (orderSel) { orderSel.value = note.chapterOrder || 0; }
    renderLive();
    updateWordCount();
    markClean();
    document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.note-list-item').forEach(el => { if (el.getAttribute('onclick')?.includes(id)) el.classList.add('active'); });
    startAutoSave();
    // Dock 自动隐藏侧栏
    setTimeout(() => { if (typeof dockEnabled !== 'undefined' && dockEnabled) { const l = document.querySelector('.notes-layout'); if (l) l.classList.add('dock-hidden'); } }, 700);
  } catch(e) { console.error(e); }
};

// ===== 重写 newNote 清空作品关联 =====
newNote = async function() {
  if (noteDirty && !confirm('当前笔记未保存，是否放弃？')) return;
  currentNoteId = null; noteDirty = false;
  localStorage.removeItem('last_note_id');
  document.getElementById('noteEditor').style.display = 'flex';
  if (document.getElementById('noteEditor').style.flexDirection !== 'column')
    document.getElementById('noteEditor').style.flexDirection = 'column';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteContent').value = '';
  document.getElementById('notePreview').innerHTML = '';
  const workSel = document.getElementById('noteWorkId');
  if (workSel) {
    // 小说模式：优先用作品筛选器选中的，否则自动选第一个作品
    if (currentNoteTab === 'novel') {
      const filterVal = (document.getElementById('workFilter')?.value || '');
      workSel.value = filterVal || workSel.options[1]?.value || '';
    } else {
      workSel.value = '';
    }
  }
  const orderSel = document.getElementById('noteChapterOrder');
  if (orderSel) orderSel.value = 0;
  updateWordCount();
  document.getElementById('noteTitle').focus();
  document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
  markClean(); startAutoSave();
  // Dock 自动隐藏侧栏
  setTimeout(() => { if (typeof dockEnabled !== 'undefined' && dockEnabled) { const l = document.querySelector('.notes-layout'); if (l) l.classList.add('dock-hidden'); } }, 700);
};

// ===== 笔记侧栏标签切换 =====
let currentNoteTab = 'notes';

function switchNoteTab(tab) {
  currentNoteTab = tab;
  const tabNotes = document.getElementById('tabNotes');
  const tabNovel = document.getElementById('tabNovel');
  const workFilter = document.getElementById('workFilter');
  const titleEl = document.getElementById('writingModeTitle');
  const editor = document.getElementById('noteEditor');
  const noteTitle = document.getElementById('noteTitle');
  const noteContent = document.getElementById('noteContent');
  const sidebar = document.querySelector('.notes-sidebar');
  const searchInput = document.getElementById('noteSearch');

  if (!tabNotes || !tabNovel) return;

  const btnQuick = document.getElementById('btnQuickNew');
  const btnChapter = document.getElementById('btnNewChapter');
  const assocRow = document.getElementById('workAssocRow');

  if (tab === 'novel') {
    tabNotes.style.background = 'var(--hover)';
    tabNotes.style.color = 'var(--text)';
    tabNotes.style.border = '1px solid var(--border)';
    tabNotes.style.fontWeight = 'normal';
    tabNovel.style.background = 'var(--accent)';
    tabNovel.style.color = '#fff';
    tabNovel.style.border = 'none';
    tabNovel.style.fontWeight = '500';
    if (workFilter) workFilter.style.display = 'block';
    if (titleEl) titleEl.innerHTML = '<span class="mi">book</span> 小说';
    // 侧栏视觉隔离
    if (sidebar) { sidebar.classList.add('novel-sidebar'); sidebar.classList.remove('note-sidebar'); }
    // 编辑器模式标记
    if (editor) { editor.classList.add('novel-mode'); editor.classList.remove('note-mode'); }
    if (noteTitle) noteTitle.placeholder = '章节标题…';
    if (noteContent) noteContent.placeholder = '章节内容…';
    if (searchInput) searchInput.placeholder = '搜索章节标题…';
    // 显示作品关联行
    if (assocRow) assocRow.style.display = 'flex';
    // 显示醒目的「新章节」按钮，隐藏小按钮
    if (btnQuick) btnQuick.style.display = 'none';
    if (btnChapter) btnChapter.style.display = 'inline-flex';
  } else {
    tabNovel.style.background = 'var(--hover)';
    tabNovel.style.color = 'var(--text)';
    tabNovel.style.border = '1px solid var(--border)';
    tabNovel.style.fontWeight = 'normal';
    tabNotes.style.background = 'var(--accent)';
    tabNotes.style.color = '#fff';
    tabNotes.style.border = 'none';
    tabNotes.style.fontWeight = '500';
    if (workFilter) { workFilter.style.display = 'none'; workFilter.value = ''; currentWorkFilter = ''; }
    if (titleEl) titleEl.innerHTML = '<span class="mi">note</span> 笔记';
    // 侧栏视觉隔离
    if (sidebar) { sidebar.classList.add('note-sidebar'); sidebar.classList.remove('novel-sidebar'); }
    // 编辑器模式标记
    if (editor) { editor.classList.add('note-mode'); editor.classList.remove('novel-mode'); }
    if (noteTitle) noteTitle.placeholder = '标题...';
    if (noteContent) noteContent.placeholder = '开始写作…';
    if (searchInput) searchInput.placeholder = '搜索标题...';
    // 隐藏作品关联行
    if (assocRow) assocRow.style.display = 'none';
    // 显示小按钮，隐藏醒目按钮
    if (btnQuick) btnQuick.style.display = 'inline-block';
    if (btnChapter) btnChapter.style.display = 'none';
  }
  loadNotesList();
}

// ===== 重写 loadNotesList 最终版（服务端类型隔离）=====
loadNotesList = async function() {
  try {
    const params = new URLSearchParams();
    const q = document.getElementById('noteSearch')?.value || '';
    if (q) params.set('q', q);
    // 按标签类型隔离：笔记(standalone) vs 小说(novel)
    if (currentNoteTab === 'novel') {
      params.set('type', 'novel');
      const wf = document.getElementById('workFilter');
      if (wf && wf.value) params.set('work_id', wf.value);
    } else {
      params.set('type', 'standalone');
    }
    const qs = params.toString();
    const url = '/api/notes' + (qs ? '?' + qs : '');
    const notes = await (await fetch(url)).json();

    const list = document.getElementById('noteList');
    if (!notes.length) {
      list.innerHTML = '<div class="empty-state">' +
        (q ? '无匹配' : (currentNoteTab === 'novel' ? '还没有章节，选择作品后新建' : '还没有笔记')) +
        '</div>';
      return;
    }
    list.innerHTML = notes.map(n => {
      const orderStr = n.chapterOrder > 0 ? ` #${n.chapterOrder}` : '';
      const cls = 'note-list-item' + (currentNoteId === n.id ? ' active' : '');
      return `<div class="${cls}" data-note-id="${n.id}" draggable="true"
        ondragstart="noteDragStart(event,'${n.id}')"
        ondragover="noteDragOver(event,'${n.id}')"
        ondragleave="noteDragLeave(event)"
        ondrop="noteDrop(event,'${n.id}')"
        ondragend="noteDragEnd(event)"
        onclick="openNote('${n.id}')">
        <span class="ntitle">${escHtml(n.title || '无标题')}${orderStr}</span>
        <span class="ndate">${new Date(n.updated).toLocaleDateString('zh-CN')}</span>
      </div>`;
    }).join('');
  } catch(e) { console.error(e); }
};

// ===== 导出函数 =====
async function exportNote(format) {
  const title = document.getElementById('noteTitle')?.value.trim();
  const content = document.getElementById('noteContent')?.value;
  if (!title && !content) { toast('⚠️ 没有可导出的内容', 'warning'); return; }

  try {
    const body = { title: title || '文档', content: content || '', format };
    // PDF 导出时附带已渲染的 HTML，让 Puppeteer 直接使用客户端预览结果
    if (format === 'pdf') {
      const preview = document.getElementById('notePreview');
      if (preview) body.html = '<h1>' + (title || '文档') + '</h1>\n' + preview.innerHTML;
    }
    const resp = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) { toast('❌ 导出失败', 'error'); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const extMap = { md: '.md', txt: '.txt', pdf: '.pdf', docx: '.docx' };
    a.download = (title || '文档') + (extMap[format] || '.md');
    a.click();
    URL.revokeObjectURL(url);
    toast('📥 正在下载 ' + format.toUpperCase());
  } catch(e) {
    toast('❌ 导出失败: ' + e.message);
  }
}
