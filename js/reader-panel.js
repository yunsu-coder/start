// ===== 阅读器 =====
const READABLE_EXTS = ['epub','pdf','txt','md','js','ts','jsx','tsx','py','html','css','json','xml','yaml','yml','toml','c','cpp','h','hpp','java','go','rs','rb','php','sh','bash','sql','swift','kt','vue','svelte','r','m','mm','pl','lua','scala','zig','tex','ini','cfg','conf','env','gradle','makefile','dockerfile'];
const CODE_EXTS = ['js','ts','jsx','tsx','py','html','css','json','xml','yaml','yml','toml','c','cpp','h','hpp','java','go','rs','rb','php','sh','bash','sql','swift','kt','vue','svelte','r','m','mm','pl','lua','scala','zig','tex','ini','cfg','conf','env','gradle','makefile','dockerfile'];
let currentBook = null;
let readerEpubRendition = null;
let readerEpubBook = null;
let readerType = null;

const READER_ICONS = { epub:'<span class="mi">menu_book</span>', pdf:'<span class="mi">picture_as_pdf</span>', txt:'<span class="mi">text_snippet</span>', md:'<span class="mi">description</span>' };

async function loadReaderBooks() {
  try {
    const resp = await (await fetch('/api/files')).json();
    const files = resp.files || [];
    const books = files.filter(f => !f.isDir && READABLE_EXTS.includes(f.name.split('.').pop().toLowerCase()));
    const el = document.getElementById('readerBooks');
    const empty = document.getElementById('readerEmpty');
    if (!books.length) { el.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    el.innerHTML = books.map(b => {
      const ext = b.name.split('.').pop().toLowerCase();
      const progress = JSON.parse(localStorage.getItem('read-' + b.name) || '{}');
      const pct = progress.pct ? ' · ' + progress.pct + '%' : '';
      return '<div class="book-card tilt-card" onclick="openBook(\'' + escAttr(b.name) + '\')">' +
        '<span class="cover">' + (READER_ICONS[ext] || (CODE_EXTS.includes(ext) ? '<span class="mi">code</span>' : '📘')) + '</span>' +
        '<span class="btitle">' + escHtml(b.name) + '</span>' +
        '<span class="bprogress">' + fmtFileSize(b.size) + pct + '</span></div>';
    }).join('');
  } catch(e) { console.error(e); }
}

async function openBook(name) {
  const ext = name.split('.').pop().toLowerCase();
  currentBook = name;
  readerType = ext;
  readerEpubRendition = null;
  readerEpubBook = null;
  document.getElementById('readerShelf').style.display = 'none';
  document.getElementById('readerView').style.display = 'block';
  document.getElementById('readerTitle').textContent = name;

  const progress = JSON.parse(localStorage.getItem('read-' + name) || '{}');
  const theme = localStorage.getItem('reader-theme') || 'light';
  const fontSize = localStorage.getItem('reader-font') || '18';
  document.getElementById('readerTheme').value = theme;
  document.getElementById('readerFont').value = fontSize;

  const content = document.getElementById('readerContent');
  content.innerHTML = '<div style="text-align:center;padding:3rem;">⏳ 加载中...</div>';

  if (ext === 'pdf') {
    content.innerHTML = '<div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.5rem;"><a href="/api/dl/' + encodeURIComponent(name) + '" class="btn-sm" style="text-decoration:none;">⬇ 下载</a></div><iframe src="/api/view/' + encodeURIComponent(name) + '" style="width:100%;height:100%;border:none;"></iframe>';
  } else if (ext === 'epub') {
    if (typeof ePub === 'undefined') {
      content.innerHTML = '<div style="text-align:center;padding:3rem;">❌ epub.js 未加载，刷新页面重试</div>';
      return;
    }
    try {
      const url = location.origin + '/api/view/' + encodeURIComponent(name);
      const book = ePub(url);
      readerEpubBook = book;
      const rendition = book.renderTo(content, {
        width: '100%', height: '100%',
        flow: 'paginated',
        spread: 'none',
        manager: 'default'
      });
      readerEpubRendition = rendition;

      const pos = document.getElementById('readerPosition');
      pos.textContent = '第 1 页';

      rendition.on('relocated', function(loc) {
        if (loc.location && loc.location.start) {
          const cfi = loc.location.start.cfi;
          if (book.locations) {
            const pct = Math.round(book.locations.percentageFromCfi(cfi) * 100);
            const fill = document.getElementById('readerProgressFill');
            if (fill) fill.style.width = pct + '%';
            localStorage.setItem('read-' + name, JSON.stringify({ location: cfi, pct }));
          }
          if (loc.location.start.displayed) {
            pos.textContent = '第 ' + (loc.location.start.displayed.page + 1) + ' 页 / 共 ' + (loc.location.start.displayed.total || '?') + ' 页';
          }
        }
      });

      book.loaded.navigation.then(nav => {
        const toc = document.getElementById('readerTOC');
        toc.innerHTML = nav.toc.map(item =>
          '<div style="padding:.3rem .5rem;cursor:pointer;font-size:.8rem;border-radius:4px;" onclick="document.getElementById(\'readerTOC\').style.display=\'none\'" data-href="' + item.href + '">' + item.label + '</div>'
        ).join('');
        toc.querySelectorAll('div').forEach(el => {
          el.addEventListener('click', () => rendition.display(el.dataset.href));
        });
      });

      book.ready.then(() => book.locations.generate(1000).then(() => {
        if (progress.location) rendition.display(progress.location);
        else rendition.display();
      }));
    } catch(e) {
      content.innerHTML = '<div style="text-align:center;padding:3rem;">❌ EPUB 加载失败<br><small>' + e.message + '</small></div>';
    }
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
      content.addEventListener('scroll', () => {
        const pct = Math.round(content.scrollTop / (content.scrollHeight - content.clientHeight) * 100);
        localStorage.setItem('read-' + name, JSON.stringify({ scroll: content.scrollTop, pct }));
        const fill = document.getElementById('readerProgressFill');
        if (fill) fill.style.width = pct + '%';
        const pos = document.getElementById('readerPosition');
        if (pos) pos.textContent = pct + '%';
      });
    } catch(e) {
      content.innerHTML = '<div style="text-align:center;padding:3rem;">❌ 加载失败</div>';
    }
  }

  updateReaderSettings();
}

function closeReader() {
  document.getElementById('readerShelf').style.display = 'block';
  document.getElementById('readerView').style.display = 'none';
  document.getElementById('readerContent').innerHTML = '';
  readerEpubRendition = null;
  readerEpubBook = null;
  currentBook = null;
  readerType = null;
  if (document.fullscreenElement) document.exitFullscreen();
  loadReaderBooks();
}

// ===== 阅读器键盘控制 =====
document.addEventListener('keydown', function(e) {
  if (!currentBook) return;
  const content = document.getElementById('readerContent');

  if (e.key === 'Escape') { closeReader(); return; }

  if (e.key === 'f' && !e.ctrlKey && !e.metaKey) {
    const view = document.getElementById('readerView');
    document.fullscreenElement ? document.exitFullscreen() : view.requestFullscreen();
    return;
  }

  if (e.key === 'ArrowLeft' && readerEpubRendition) {
    e.preventDefault(); readerEpubRendition.prev(); return;
  }
  if (e.key === 'ArrowRight' && readerEpubRendition) {
    e.preventDefault(); readerEpubRendition.next(); return;
  }

  if (e.key === ' ') { e.preventDefault(); content.scrollBy({ top: content.clientHeight * 0.8, behavior: 'smooth' }); }
  if (e.key === 'ArrowDown') { e.preventDefault(); content.scrollBy({ top: 60, behavior: 'smooth' }); }
  if (e.key === 'ArrowUp') { e.preventDefault(); content.scrollBy({ top: -60, behavior: 'smooth' }); }
});

function updateReaderSettings() {
  const theme = document.getElementById('readerTheme').value;
  const fontSize = document.getElementById('readerFont').value;
  localStorage.setItem('reader-theme', theme);
  localStorage.setItem('reader-font', fontSize);

  const content = document.getElementById('readerContent');
  content.className = 'reader-' + theme;
  content.style.fontSize = fontSize + 'px';

  const inner = content.querySelector('.reader-content-inner');
  if (inner) inner.style.fontSize = fontSize + 'px';
}

function toggleTOC() {
  const toc = document.getElementById('readerTOC');
  toc.style.display = toc.style.display === 'none' ? 'block' : 'none';
}

// ===== 自动滚屏 =====
let autoScrollTimer = null;
let autoScrollSpeed = 3;

function toggleAutoScroll() {
  const btn = document.getElementById('autoScrollBtn');
  if (autoScrollTimer) {
    clearInterval(autoScrollTimer); autoScrollTimer = null;
    btn.textContent = '⏯ 自动滚屏';
    btn.style.background = ''; btn.style.color = '';
    return;
  }
  autoScrollTimer = setInterval(() => {
    const content = document.getElementById('readerContent');
    if (!content || !currentBook) { clearInterval(autoScrollTimer); return; }
    content.scrollTop += autoScrollSpeed * 0.3;
    if (content.scrollTop >= content.scrollHeight - content.clientHeight - 10) {
      clearInterval(autoScrollTimer); autoScrollTimer = null;
      btn.textContent = '⏯ 自动滚屏'; btn.style.background = ''; btn.style.color = '';
      toast('📖 已到末尾');
    }
  }, 30);
  updateScrollBtn();
}

function updateScrollBtn() {
  const btn = document.getElementById('autoScrollBtn');
  if (!autoScrollTimer) return;
  const label = autoScrollSpeed <= 1 ? '🐢' : autoScrollSpeed <= 2 ? '🐌' : autoScrollSpeed <= 4 ? '🚶' : autoScrollSpeed <= 7 ? '🏃' : '🚀';
  btn.textContent = '⏸ ' + label + ' ×' + autoScrollSpeed;
  btn.style.background = 'var(--accent)'; btn.style.color = '#fff';
}

// 滚轮调速
const readerWheelHandler = function(e) {
  if (!autoScrollTimer) return;
  e.preventDefault();
  autoScrollSpeed = Math.max(1, Math.min(20, autoScrollSpeed + (e.deltaY > 0 ? 0.5 : -0.5)));
  updateScrollBtn();
};
document.getElementById('readerContent')?.addEventListener('wheel', readerWheelHandler, { passive: false });

// 键盘调速（+/- 键）
document.addEventListener('keydown', function(e) {
  if (!autoScrollTimer) return;
  if (e.key === '=' || e.key === '+') {
    e.preventDefault();
    autoScrollSpeed = Math.min(20, autoScrollSpeed + 1);
    updateScrollBtn();
  }
  if (e.key === '-') {
    e.preventDefault();
    autoScrollSpeed = Math.max(1, autoScrollSpeed - 1);
    updateScrollBtn();
  }
});

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
  popup.style.cssText = 'position:fixed;z-index:999;background:var(--accent);color:#fff;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);';
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
    } catch(e) { toast('❌ 保存失败'); }
    popup.remove();
  });
  document.body.appendChild(popup);

  setTimeout(() => popup.remove(), 3000);
});
