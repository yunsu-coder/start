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
      try { notes = await (await fetch('/api/notes')).json(); } catch {}
      const noteMap = {};
      notes.forEach(n => { noteMap[n.id] = n; });

      const chapterHtml = chapters.map((cid, i) => {
        const note = noteMap[cid];
        return `<div class="work-chapter-item" draggable="true">
          <span class="ch-order">${i + 1}</span>
          <span class="ch-title">${escHtml(note?.title || '(已删除)')}</span>
          <span class="ch-del" onclick="removeChapterFromWork('${escAttr(w.id)}','${escAttr(cid)}')">✕</span>
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
  } catch {}
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
  if (!title) { toast('⚠️ 请输入作品标题'); return; }
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
  } catch { toast('❌ 移除失败'); }
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
  if (!title && !content) { toast('⚠️ 标题和内容不能都为空'); return; }
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
      } catch {}
    }
  } catch(e) { toast('❌ 保存失败'); }
};

// ===== 重写 openNote 以加载作品关联 =====
openNote = async function(id) {
  if (noteDirty && id !== currentNoteId && !confirm('当前笔记未保存，是否放弃？')) return;
  try {
    const note = await (await fetch('/api/notes/' + id)).json();
    currentNoteId = id;
    document.getElementById('noteEditor').style.display = 'flex';
    if (document.getElementById('noteEditor').style.flexDirection !== 'column')
      document.getElementById('noteEditor').style.flexDirection = 'column';
    document.getElementById('noteTitle').value = note.title;
    document.getElementById('noteContent').value = note.content;
    const workSel = document.getElementById('noteWorkId');
    if (workSel) {
      workSel.value = note.workId || '';
    }
    const orderSel = document.getElementById('noteChapterOrder');
    if (orderSel) {
      orderSel.value = note.chapterOrder || 0;
    }
    renderLive();
    updateWordCount();
    markClean();
    document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.note-list-item').forEach(el => { if (el.getAttribute('onclick')?.includes(id)) el.classList.add('active'); });
    startAutoSave();
  } catch(e) { console.error(e); }
};

// ===== 重写 newNote 清空作品关联 =====
newNote = async function() {
  if (noteDirty && !confirm('当前笔记未保存，是否放弃？')) return;
  currentNoteId = null; noteDirty = false;
  document.getElementById('noteEditor').style.display = 'flex';
  if (document.getElementById('noteEditor').style.flexDirection !== 'column')
    document.getElementById('noteEditor').style.flexDirection = 'column';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteContent').value = '';
  document.getElementById('notePreview').innerHTML = '';
  const workSel = document.getElementById('noteWorkId');
  if (workSel) workSel.value = currentWorkFilter || '';
  const orderSel = document.getElementById('noteChapterOrder');
  if (orderSel) orderSel.value = 0;
  updateWordCount();
  document.getElementById('noteTitle').focus();
  document.querySelectorAll('.note-list-item').forEach(el => el.classList.remove('active'));
  markClean(); startAutoSave();
};

// ===== 笔记侧栏标签切换 =====
let currentNoteTab = 'notes';

function switchNoteTab(tab) {
  currentNoteTab = tab;
  const tabNotes = document.getElementById('tabNotes');
  const tabNovel = document.getElementById('tabNovel');
  const workFilter = document.getElementById('workFilter');
  const titleEl = document.getElementById('writingModeTitle');

  if (!tabNotes || !tabNovel) return;

  const btnQuick = document.getElementById('btnQuickNew');
  const btnChapter = document.getElementById('btnNewChapter');

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
    if (workFilter) workFilter.style.display = 'none';
    if (titleEl) titleEl.innerHTML = '<span class="mi">note</span> 笔记';
    // 显示小按钮，隐藏醒目按钮
    if (btnQuick) btnQuick.style.display = 'inline-block';
    if (btnChapter) btnChapter.style.display = 'none';
  }
  loadNotesList();
}

// ===== 重写 loadNotesList 最终版（作品过滤 + 标签过滤）=====
loadNotesList = async function() {
  try {
    let url = '/api/notes';
    const q = document.getElementById('noteSearch')?.value || '';
    if (q) url += '?q=' + encodeURIComponent(q);
    let notes = await (await fetch(url)).json();

    // 标签过滤
    if (currentNoteTab === 'novel') {
      notes = notes.filter(n => n.workId && n.workId !== '');
      const wf = document.getElementById('workFilter');
      if (wf && wf.value) {
        notes = notes.filter(n => n.workId === wf.value);
      }
    } else {
      notes = notes.filter(n => !n.workId || n.workId === '');
    }

    const list = document.getElementById('noteList');
    if (!notes.length) {
      list.innerHTML = '<div class="empty-state">' +
        (q ? '无匹配' : (currentNoteTab === 'novel' ? '还没有章节，选择作品后新建' : '还没有笔记')) +
        '</div>';
      return;
    }
    list.innerHTML = notes.map(n => {
      const orderStr = n.chapterOrder > 0 ? ` #${n.chapterOrder}` : '';
      return `<div class="note-list-item${currentNoteId === n.id ? ' active' : ''}" onclick="openNote('${n.id}')">
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
  if (!title && !content) { toast('⚠️ 没有可导出的内容'); return; }

  try {
    const resp = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || '文档', content: content || '', format }),
    });
    if (!resp.ok) { toast('❌ 导出失败'); return; }
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
