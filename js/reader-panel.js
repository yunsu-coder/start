// ===== 阅读器 =====
const READABLE_EXTS = ['pdf','txt','md','js','ts','jsx','tsx','py','html','css','json','xml','yaml','yml','toml','c','cpp','h','hpp','java','go','rs','rb','php','sh','bash','sql','swift','kt','vue','svelte','r','m','mm','pl','lua','scala','zig','tex','ini','cfg','conf','env','gradle','makefile','dockerfile'];
const CODE_EXTS = ['js','ts','jsx','tsx','py','html','css','json','xml','yaml','yml','toml','c','cpp','h','hpp','java','go','rs','rb','php','sh','bash','sql','swift','kt','vue','svelte','r','m','mm','pl','lua','scala','zig','tex','ini','cfg','conf','env','gradle','makefile','dockerfile'];
let currentBook = null;
let readerType = null; // 'file' | 'note'

const READER_ICONS = { pdf:'<span class="mi">picture_as_pdf</span>', txt:'<span class="mi">text_snippet</span>', md:'<span class="mi">description</span>' };

async function loadReaderBooks() {
  // 并行加载文件、笔记、作品
  const [filesRes, notesArr, worksArr] = await Promise.all([
    fetch('/api/files?recursive=true').then(r => r.json()).catch(() => ({ files: [] })),
    fetch('/api/notes').then(r => r.json()).catch(() => []),
    fetch('/api/works').then(r => r.json()).catch(() => [])
  ]);

  // ── 文件 ──
  const files = (filesRes.files || []).filter(f => !f.isDir && READABLE_EXTS.includes(f.name.split('.').pop().toLowerCase()));
  const filesEl = document.getElementById('readerFiles');
  const filesEmpty = document.getElementById('readerFilesEmpty');
  if (!files.length) {
    filesEl.innerHTML = '';
    filesEmpty.style.display = 'block';
  } else {
    filesEmpty.style.display = 'none';
    filesEl.innerHTML = files.map(b => {
      const filePath = b.relPath || b.name;
      const displayName = filePath.includes('/') ? filePath : filePath;
      const ext = filePath.split('.').pop().toLowerCase();
      const progress = JSON.parse(localStorage.getItem('read-file-' + filePath) || '{}');
      const pct = progress.pct ? ' · ' + progress.pct + '%' : '';
      return '<div class="book-card tilt-card" onclick="openBook(\'' + escAttr(filePath) + '\',\'file\')">' +
        '<span class="cover">' + (READER_ICONS[ext] || (CODE_EXTS.includes(ext) ? '<span class="mi">code</span>' : '📘')) + '</span>' +
        '<span class="btitle" title="' + escAttr(filePath) + '">' + escHtml(displayName) + '</span>' +
        '<span class="bprogress">' + fmtFileSize(b.size) + pct + '</span></div>';
    }).join('');
  }

  // ── 笔记（独立笔记，非小说章节）──
  const notes = notesArr.filter(n => !n.workId);
  const notesEl = document.getElementById('readerNotes');
  const notesEmpty = document.getElementById('readerNotesEmpty');
  if (!notes.length) {
    notesEl.innerHTML = '';
    notesEmpty.style.display = 'block';
  } else {
    notesEmpty.style.display = 'none';
    notesEl.innerHTML = notes.map(n => {
      const progress = JSON.parse(localStorage.getItem('read-note-' + n.id) || '{}');
      const pct = progress.pct ? ' · ' + progress.pct + '%' : '';
      const updated = new Date(n.updated).toLocaleDateString('zh-CN', { month:'short', day:'numeric' });
      return '<div class="book-card tilt-card" onclick="openBook(\'' + escAttr(n.id) + '\',\'note\')">' +
        '<span class="cover"><span class="mi">note</span></span>' +
        '<span class="btitle">' + escHtml(n.title || '无标题') + '</span>' +
        '<span class="bprogress">' + updated + pct + '</span></div>';
    }).join('');
  }

  // ── 小说（作品 + 章节）──
  const works = worksArr;
  const worksEl = document.getElementById('readerWorks');
  const worksEmpty = document.getElementById('readerWorksEmpty');
  if (!works.length) {
    worksEl.innerHTML = '<div class="empty-state reader-empty" id="readerWorksEmpty">暂无作品</div>';
  } else {
    // 获取所有小说章节（带 workId 的笔记）
    const novelNotes = notesArr.filter(n => n.workId);
    worksEl.innerHTML = works.map(w => {
      const chapters = novelNotes.filter(n => n.workId === w.id).sort((a, b) => (a.chapterOrder || 0) - (b.chapterOrder || 0));
      const chCount = chapters.length;
      const firstId = chCount > 0 ? chapters[0].id : '';
      let chHTML = '';
      if (chCount > 0) {
        chHTML = '<div class="work-reader-chapters">' + chapters.map((ch, i) => {
          const progress = JSON.parse(localStorage.getItem('read-note-' + ch.id) || '{}');
          const pct = progress.pct ? '<span style="color:var(--sub);font-size:.65rem;">' + progress.pct + '%</span>' : '';
          return '<div class="work-reader-chapter" onclick="event.stopPropagation();openBook(\'' + escAttr(ch.id) + '\',\'note\')">' +
            '<span class="ch-num">' + (i + 1) + '</span>' +
            '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(ch.title || '无标题') + '</span>' +
            pct + '</div>';
        }).join('') + '</div>';
      }
      // 点击作品标题 → 展开/折叠章节目录
      return '<div class="work-reader-card">' +
        '<div class="work-reader-header">' +
          '<span class="mi" style="color:var(--accent);">book</span>' +
          (firstId
            ? '<span class="work-reader-title" style="cursor:pointer;" onclick="this.closest(\'.work-reader-card\').classList.toggle(\'open\')" title="展开目录">' + escHtml(w.title) + '</span>'
            : '<span class="work-reader-title">' + escHtml(w.title) + '</span>'
          ) +
          '<span class="work-reader-meta">' + chCount + ' 章</span>' +
          (chCount > 0
            ? '<button class="btn-sm work-expand-btn" onclick="event.stopPropagation();this.closest(\'.work-reader-card\').classList.toggle(\'open\')" title="目录"><span class="mi">expand_more</span></button>'
            : ''
          ) +
        '</div>' + chHTML + '</div>';
    }).join('');
  }
}

// 打开书籍
async function openBook(name, type) {
  if (type === 'file') {
    await openFileBook(name);
  } else if (type === 'note') {
    await openNoteBook(name);
  }
}

// ── 打开文件 ──
async function openFileBook(name) {
  const ext = name.split('.').pop().toLowerCase();
  currentBook = name;
  readerType = 'file';
  readerOpenTime = Date.now();
  if (readerStatsTimer) clearInterval(readerStatsTimer);
  readerStatsTimer = setInterval(refreshReadingStats, 30000);
  showReaderView(name);

  const content = document.getElementById('readerContent');
  content.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--sub);">⏳ 加载中...</div>';

  const progress = JSON.parse(localStorage.getItem('read-file-' + name) || '{}');

  if (ext === 'pdf') {
    content.innerHTML = '<div style="padding:.5rem 1rem;"><a href="/api/dl/' + encodeURIComponent(name) + '" class="btn-sm">⬇ 下载 PDF</a></div><iframe src="/api/view/' + encodeURIComponent(name) + '" style="width:100%;height:100%;border:none;"></iframe>';
  } else {
    // TXT/MD/Code
    try {
      const r = await fetch('/api/preview/' + encodeURIComponent(name));
      const text = await r.text();
      let html;
      if (ext === 'md') {
        html = md2html(text);
      } else if (CODE_EXTS.includes(ext)) {
        html = '<pre><code>' + escHtml(text) + '</code></pre>';
      } else {
        html = '<p>' + escHtml(text).replace(/\n/g, '<br>') + '</p>';
      }
      content.innerHTML = '<div class="reader-content-inner">' + html + '</div>';
      if (progress.scroll) content.scrollTop = progress.scroll;
      setupScrollProgress('read-file-' + name);
      updateReadingStats(text);
    } catch(e) {
      content.innerHTML = '<div style="text-align:center;padding:3rem;">❌ 加载失败</div>';
    }
  }
  updateReaderSettings();
}

// ── 打开笔记/小说章节 ──
async function openNoteBook(noteId) {
  currentBook = noteId;
  readerOpenTime = Date.now();
  if (readerStatsTimer) clearInterval(readerStatsTimer);
  readerStatsTimer = setInterval(refreshReadingStats, 30000); // 每30秒刷新疲劳衰减
  readerType = 'note';

  try {
    const resp = await fetch('/api/notes/' + noteId);
    if (!resp.ok) throw new Error('笔记不存在');
    const note = await resp.json();
    showReaderView(note.title || '无标题');

    const content = document.getElementById('readerContent');
    const html = md2html(note.content || '');
    content.innerHTML = '<div class="reader-content-inner">' + html + '</div>';

    const progress = JSON.parse(localStorage.getItem('read-note-' + noteId) || '{}');
    if (progress.scroll) content.scrollTop = progress.scroll;
    setupScrollProgress('read-note-' + noteId);
    updateReadingStats(note.content || '');

    // 构建目录：若属于作品则显示该作品全部章节
    await buildNoteTOC(note);

    updateReaderSettings();
  } catch(e) {
    document.getElementById('readerContent').innerHTML = '<div style="text-align:center;padding:3rem;">❌ 加载失败<br><small>' + e.message + '</small></div>';
  }
}

// ── 构建笔记/小说目录 + 上下章导航 ──
let novelNav = null; // { prevId, nextId, prevTitle, nextTitle }
async function buildNoteTOC(note) {
  const toc = document.getElementById('readerTOC');
  novelNav = null;
  if (!note.workId) { toc.innerHTML = ''; toc.classList.remove('open'); return; }

  try {
    const [workResp, notesArr] = await Promise.all([
      fetch('/api/works/' + note.workId).then(r => r.json()).catch(() => null),
      fetch('/api/notes').then(r => r.json()).catch(() => [])
    ]);
    if (!workResp) { toc.innerHTML = ''; toc.classList.remove('open'); return; }

    const chapters = notesArr
      .filter(n => n.workId === note.workId)
      .sort((a, b) => (a.chapterOrder || 0) - (b.chapterOrder || 0));

    if (chapters.length <= 1) { toc.innerHTML = ''; toc.classList.remove('open'); return; }

    // 找到当前章节位置，构建上下章导航
    const idx = chapters.findIndex(ch => ch.id === note.id);
    if (idx > 0) novelNav = { ...novelNav, prevId: chapters[idx - 1].id, prevTitle: chapters[idx - 1].title };
    if (idx >= 0 && idx < chapters.length - 1) novelNav = { ...novelNav, nextId: chapters[idx + 1].id, nextTitle: chapters[idx + 1].title };

    toc.innerHTML =
      '<div class="reader-toc-title">' + escHtml(workResp.title || '目录') + '</div>' +
      chapters.map((ch, i) => {
        const active = ch.id === note.id ? ' active' : '';
        const progress = JSON.parse(localStorage.getItem('read-note-' + ch.id) || '{}');
        const pct = progress.pct ? '<span class="toc-pct">' + progress.pct + '%</span>' : '';
        return '<div class="reader-toc-item' + active + '" data-note-id="' + ch.id + '">' +
          '<span class="ch-num">' + (i + 1) + '</span>' +
          '<span class="toc-label">' + escHtml(ch.title || '无标题') + '</span>' +
          pct + '</div>';
      }).join('');

    toc.querySelectorAll('.reader-toc-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.noteId;
        if (id !== currentBook) openNoteBook(id);
      });
    });
    // TOC 由用户手动打开

    // 注入上下章导航到内容底部
    injectNovelNav();
  } catch(e) { toc.innerHTML = ''; toc.classList.remove('open'); }
}

function injectNovelNav() {
  const inner = document.querySelector('.reader-content-inner');
  if (!inner || !novelNav) return;
  let navHTML = '<div class="novel-nav">';
  if (novelNav.prevId) navHTML += '<button class="btn-sm novel-nav-btn" onclick="openNoteBook(\'' + novelNav.prevId + '\')">← ' + escHtml(novelNav.prevTitle || '上一章') + '</button>';
  if (novelNav.nextId) navHTML += '<button class="btn accent novel-nav-btn" onclick="openNoteBook(\'' + novelNav.nextId + '\')">' + escHtml(novelNav.nextTitle || '下一章') + ' →</button>';
  navHTML += '</div>';
  inner.insertAdjacentHTML('beforeend', navHTML);
}

// ── 显示阅读视图 ──
function showReaderView(title) {
  document.getElementById('readerShelf').style.display = 'none';
  const view = document.getElementById('readerView');
  view.style.display = 'flex';
  view.classList.add('active');
  document.body.classList.add('reader-mode');
  document.getElementById('readerTitle').textContent = title;

  // 恢复主题/字号/字体/宽度
  const theme = localStorage.getItem('reader-theme') || 'light';
  const fontSize = localStorage.getItem('reader-font') || '18';
  const fontFamily = localStorage.getItem('reader-font-family') || 'serif';
  const width = localStorage.getItem('reader-width') || 'medium';
  document.getElementById('readerTheme').value = theme;
  document.getElementById('readerFont').value = fontSize;
  const ffSel = document.getElementById('readerFontFamily');
  if (ffSel) ffSel.value = fontFamily;
  const widthSel = document.getElementById('readerWidth');
  if (widthSel) widthSel.value = width;

  // 重置进度
  document.getElementById('readerProgressFill').style.width = '0%';
  document.getElementById('readerPosition').textContent = '';
  document.getElementById('readerStats').textContent = '';

}

// ── 滚动进度 ──
function setupScrollProgress(key) {
  const content = document.getElementById('readerContent');
  const handler = () => {
    const h = content.scrollHeight - content.clientHeight;
    const pct = h > 0 ? Math.round(content.scrollTop / h * 100) : 0;
    localStorage.setItem(key, JSON.stringify({ scroll: content.scrollTop, pct }));
    const fill = document.getElementById('readerProgressFill');
    if (fill) fill.style.width = pct + '%';
    const pos = document.getElementById('readerPosition');
    if (pos) pos.textContent = pct + '%';
  };
  content._scrollHandler = handler;
  content.addEventListener('scroll', handler);
}

// ── 关闭阅读器 ──
function closeReader() {
  const content = document.getElementById('readerContent');
  if (content._scrollHandler) {
    content.removeEventListener('scroll', content._scrollHandler);
    content._scrollHandler = null;
  }
  document.getElementById('readerShelf').style.display = 'block';
  const view = document.getElementById('readerView');
  view.style.display = 'none';
  view.classList.remove('active');
  content.innerHTML = '';
  currentBook = null;
  readerType = null;
  document.body.classList.remove('reader-mode');
  if (readerStatsTimer) { clearInterval(readerStatsTimer); readerStatsTimer = null; }
  if (document.fullscreenElement) document.exitFullscreen();
  loadReaderBooks();
}

var readerOpenTime = Date.now();
var readerStatsTimer = null;
function updateReadingStats(text) {
  var chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  var englishWords = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').split(/\s+/).filter(function(w) { return /[a-zA-Z]/.test(w); }).length;
  var totalUnits = chineseChars + englishWords;
  var t = (Date.now() - readerOpenTime) / 60000;
  var warmup = 0.9 + 0.1 * (1 - Math.exp(-t / 8));
  var fatigue = t > 30 ? Math.exp(-(t - 30) / 90) : 1;
  var speed = Math.max(400, Math.round(800 * warmup * fatigue));
  var totalSec = Math.round(totalUnits / speed * 60);
  var readMin = Math.floor(totalSec / 60);
  var readSec = totalSec % 60;
  var label = totalSec < 60 ? (totalSec + '秒') : (readMin < 5 ? (readMin + '分' + readSec + '秒') : (readMin + '分钟'));
  document.getElementById('readerStats').textContent = '📊 ' + totalUnits.toLocaleString() + ' 字 · ⏱ ~' + label;
}

function refreshReadingStats() {
  var el = document.getElementById('readerContent');
  if (el) updateReadingStats(el.textContent || '');
}

function updateReaderSettings() {
  const theme = document.getElementById('readerTheme').value;
  const fontSize = document.getElementById('readerFont').value;
  const fontFamily = document.getElementById('readerFontFamily')?.value || 'serif';
  const width = document.getElementById('readerWidth')?.value || 'medium';
  localStorage.setItem('reader-theme', theme);
  localStorage.setItem('reader-font', fontSize);
  localStorage.setItem('reader-font-family', fontFamily);
  localStorage.setItem('reader-width', width);

  const content = document.getElementById('readerContent');
  content.className = 'reader-content reader-' + theme + ' width-' + width + ' font-' + fontFamily;
  content.style.fontSize = fontSize + 'px';

  const inner = content.querySelector('.reader-content-inner');
  if (inner) inner.style.fontSize = fontSize + 'px';
}

function updateReaderWidth() {
  updateReaderSettings();
}

function toggleTOC() {
  document.getElementById('readerTOC').classList.toggle('open');
}

// ===== 划词→笔记 =====
document.addEventListener('mouseup', function(e) {
  if (!currentBook) return;
  const sel = window.getSelection();
  const text = sel.toString().trim();
  if (!text || text.length < 3) return;

  const existing = document.getElementById('selectionPopup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'selectionPopup';
  popup.style.cssText = 'position:fixed;z-index:999;background:var(--accent);color:#fff;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);animation: chatMsgIn var(--dur-fast) var(--ease-out-back);';
  popup.textContent = '💾 保存到笔记';
  popup.style.left = Math.min(e.clientX + 10, window.innerWidth - 140) + 'px';
  popup.style.top = (e.clientY - 35) + 'px';
  popup.addEventListener('click', async function() {
    const title = text.slice(0, 30) + (text.length > 30 ? '...' : '');
    const note = {
      title: '📖 ' + title,
      content: '> ' + text.replace(/\n/g, '\n> ') + '\n\n---\n*来源：' + currentBook + '*',
    };
    try {
      await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(note),
      });
      toast('✅ 已保存到笔记');
    } catch(err) { toast('❌ 保存失败', 'error'); }
    popup.remove();
  });
  document.body.appendChild(popup);

  setTimeout(() => popup.remove(), 3000);
});

