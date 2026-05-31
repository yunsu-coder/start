// js/translate-panel.js — 翻译面板（纯原生 JS）

let tlAbort = null; // 用于中断上一次翻译请求
let tlLastInput = ''; // 防止重复翻译相同内容
let tlFinalTranslated = ''; // 存最新完整译文

// ===== 元素引用 =====
const $ = id => document.getElementById(id);
const tlInput = $('tlInput');
const tlOutput = $('tlOutput');
const tlFrom = $('tlFrom');
const tlTo = $('tlTo');
const tlSwap = $('tlSwap');
const tlDetect = $('tlDetect');
const tlSpeakSrc = $('tlSpeakSrc');
const tlSpeakTgt = $('tlSpeakTgt');
const tlSaveNote = $('tlSaveNote');
const tlHistoryList = $('tlHistoryList');
const tlClearHistory = $('tlClearHistory');
const tlGrammar = $('tlGrammar');
const tlGrammarBadge = $('tlGrammarBadge');

// ===== 加载语言列表 =====
async function loadLangs() {
  try {
    const langs = await (await fetch('/api/translate/langs')).json();
    // 只填充前几个常用语言，手动留其他选项
  } catch(e) { console.warn('[Translate] loadLangs failed', e.message); }
}

// ===== 流式翻译 =====
async function doTranslate(text) {
  if (!text.trim()) {
    tlOutput.innerHTML = '<span class="placeholder">等待输入…</span>';
    tlDetect.textContent = '';
    tlFinalTranslated = '';
    return;
  }

  // 中止上一次请求
  if (tlAbort) {
    tlAbort.abort();
    tlAbort = null;
  }

  tlOutput.innerHTML = '<span style="color:var(--sub);">翻译中…<span class="cursor">▌</span></span>';

  const from = tlFrom.value;
  const to = tlTo.value;

  const ac = new AbortController();
  tlAbort = ac;

  try {
    const resp = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 5000), from, to }),
      signal: ac.signal,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: '请求失败' }));
      tlOutput.innerHTML = '<span style="color:var(--danger);">⚠️ ' + (err.error || '翻译失败') + '</span>';
      return;
    }

    // 流式读取
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let result = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      // 解析 SSE 事件
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 不完整的行留在 buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              result += content;
              tlOutput.innerHTML = escHtml(result) + '<span class="cursor">▌</span>';
              tlOutput.scrollTop = tlOutput.scrollHeight;
            }
          } catch(e) { console.warn('[Translate] SSE parse failed', e.message); }
        }
      }
    }

    // 翻译完成
    tlFinalTranslated = result;
    tlOutput.innerHTML = escHtml(result) || '<span style="color:var(--sub);">（无译文输出）</span>';
    tlAbort = null;

    // 自动检测语言
    if (from === 'auto' && text) {
      detectLang(text);
    }

    // 语法检查（原文语言非中文时）
    const detectedFrom = tlDetect.textContent || from;
    if (text && !detectedFrom.includes('中文') && !detectedFrom.includes('zh')) {
      checkGrammar(text);
    } else if (text && from !== 'zh' && from !== 'auto') {
      checkGrammar(text);
    } else {
      $('tlGrammar').innerHTML = '';
      $('tlGrammarBadge').textContent = '';
    }

  } catch (e) {
    if (e.name === 'AbortError') return;
    tlOutput.innerHTML = '<span style="color:var(--danger);">⚠️ ' + escHtml(e.message) + '</span>';
    tlAbort = null;
  }
}

// ===== 语法检查 =====
async function checkGrammar(text) {
  const grammarEl = $('tlGrammar');
  const badge = $('tlGrammarBadge');
  if (!text.trim() || text.length < 3) {
    grammarEl.innerHTML = '';
    badge.textContent = '';
    return;
  }

  badge.textContent = '🔍 检查中…';
  badge.style.color = 'var(--sub)';

  try {
    const resp = await fetch('/api/translate/grammar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 3000) }),
    });
    const data = await resp.json();

    if (!data.hasErrors || !data.errors?.length) {
      grammarEl.innerHTML = '<div class="tl-grammar-header"><span class="ok">✅</span> 语法正确</div><div class="tl-grammar-empty">没有发现错误</div>';
      badge.textContent = '✅';
      badge.style.color = 'var(--ok)';
      return;
    }

    badge.textContent = '⚠️ ' + data.errors.length;
    badge.style.color = 'var(--warn)';

    // 构建带波浪线错误标记的原文
    let marked = escHtml(text);
    // 按 start 从大到小排序，避免位置偏移
    const sorted = [...data.errors].sort((a, b) => b.start - a.start);
    for (const err of sorted) {
      const before = marked.slice(0, err.start);
      const word = marked.slice(err.start, err.end);
      const after = marked.slice(err.end);
      marked = before + '<span class="err">' + word + '</span>' + after;
    }

    grammarEl.innerHTML = `
      <div class="tl-grammar-header"><span class="warn">⚠️</span> 发现 ${data.errors.length} 处错误</div>
      <div class="tl-grammar-orig">${marked}</div>
      <div class="tl-grammar-list">
        ${data.errors.map(e => `
          <div class="tl-grammar-item">
            <span class="gi-arrow">→</span>
            <div>
              <span class="gi-word">${escHtml(e.word)}</span>
              <span class="gi-corr">${escHtml(e.correction || '')}</span>
              <span class="gi-explain">${escHtml(e.explanation || '')}</span>
            </div>
          </div>
        `).join('')}
      </div>`;
  } catch(e) {
    console.warn('[Translate] grammar check failed', e.message);
    grammarEl.innerHTML = '';
    badge.textContent = '';
  }
}

// ===== 语言检测 =====
let detectTimer = null;

async function detectLang(text) {
  try {
    const resp = await fetch('/api/translate/detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 2000) }),
    });
    const data = await resp.json();
    if (data.lang) {
      const langName = {zh:'中文',en:'English',ja:'日本語',ko:'한국어',fr:'Français',de:'Deutsch',es:'Español',pt:'Português',ru:'Русский',ar:'العربية',th:'ไทย',vi:'Tiếng Việt',id:'Bahasa Indonesia'};
      tlDetect.textContent = '🌐 ' + (langName[data.lang] || data.lang);
    }
  } catch(e) { console.warn('[Translate] detectLang failed', e.message); }
}

// ===== 语言选择变更 → 自动重翻 =====
tlFrom.addEventListener('change', () => {
  if (tlInput.value.trim()) doTranslate(tlInput.value);
});
tlTo.addEventListener('change', () => {
  if (tlInput.value.trim()) doTranslate(tlInput.value);
});

// ===== 输入事件（实时翻译） =====
let inputTimer = null;

tlInput.addEventListener('input', () => {
  clearTimeout(inputTimer);
  const text = tlInput.value;
  if (text === tlLastInput) return;
  tlLastInput = text;

  inputTimer = setTimeout(() => {
    doTranslate(text);
  }, 400); // 400ms 防抖
});

// ===== 按 1 保存到历史 =====
tlInput.addEventListener('keydown', async (e) => {
  if (e.key === '1' && tlInput.value.trim()) {
    e.preventDefault(); // 阻止输入数字 1
    await saveTranslation();
  }
});

async function saveTranslation() {
  const original = tlInput.value.trim();
  const translated = tlFinalTranslated;
  if (!original) { toast('⚠️ 没有输入内容', 'warning'); return; }

  try {
    const resp = await fetch('/api/translate/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        original,
        translated: translated || '',
        from: tlFrom.value,
        to: tlTo.value,
        detectedLang: tlDetect.textContent.replace('🌐 ', '') || '',
        fav: true,
      }),
    });
    const data = await resp.json();
    if (data.id) {
      toast('✅ 已保存到历史');
      loadHistory();
    }
  } catch (e) {
    toast('❌ 保存失败: ' + e.message);
  }
}

// ===== 朗读 =====
async function speak(text) {
  if (!text.trim()) { toast('⚠️ 没有可朗读的内容', 'warning'); return; }
  try {
    const resp = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 3000), voice: 'zh-CN-XiaoxiaoNeural' }),
    });
    if (!resp.ok) { toast('❌ TTS 失败', 'error'); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.play().catch(() => toast('❌ 播放失败', 'error'));
  } catch (e) {
    toast('❌ TTS 出错: ' + e.message);
  }
}

tlSpeakSrc.addEventListener('click', () => speak(tlInput.value));
tlSpeakTgt.addEventListener('click', () => speak(tlFinalTranslated));

// ===== 存笔记 =====
tlSaveNote.addEventListener('click', async () => {
  const original = tlInput.value.trim();
  const translated = tlFinalTranslated;
  if (!original) { toast('⚠️ 没有内容', 'warning'); return; }

  const title = '📝 翻译: ' + original.slice(0, 30);
  const content = `## 原文\n${original}\n\n## 译文\n${translated || '（无）'}`;

  try {
    const resp = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    const data = await resp.json();
    if (data.id) toast('✅ 已保存到笔记');
  } catch (e) {
    toast('❌ 存笔记失败: ' + e.message);
  }
});

// ===== 语言互换 =====
tlSwap.addEventListener('click', () => {
  const fromVal = tlFrom.value;
  const toVal = tlTo.value;
  if (fromVal === 'auto') { toast('⚠️ 自动检测不能设为目标语言', 'warning'); return; }
  tlFrom.value = toVal;
  tlTo.value = fromVal;
  // 互换原文译文
  const srcText = tlInput.value;
  const transText = tlFinalTranslated;
  if (transText) {
    tlInput.value = transText;
    tlLastInput = '';
    doTranslate(transText);
  }
});

// ===== 历史记录 =====
async function loadHistory() {
  try {
    const list = await (await fetch('/api/translate/history?limit=50')).json();
    if (!list.length) {
      tlHistoryList.innerHTML = '<div class="empty-state">暂无翻译记录</div>';
      return;
    }
    tlHistoryList.innerHTML = list.map(item => {
      const time = new Date(item.timestamp).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      return `
        <div class="tl-hist-item">
          <div class="tl-hist-text">
            <div class="tl-hist-orig">${escHtml(item.original)}</div>
            <div class="tl-hist-trans">${escHtml(item.translated)}</div>
            <div class="tl-hist-meta">${time} · ${item.to}</div>
          </div>
          <div class="tl-hist-actions">
            <button onclick="clickHistItem('${escAttr(item.id)}')" title="加载到编辑器">↩</button>
            <button onclick="deleteHistItem('${escAttr(item.id)}')" title="删除">✕</button>
          </div>
        </div>`;
    }).join('');
  } catch(e) {
    console.warn('[Translate] loadHistory failed', e.message);
    tlHistoryList.innerHTML = '<div class="empty-state">⚠️ 加载失败</div>';
  }
}

// 点击历史条目 → 加载到编辑器
function clickHistItem(id) {
  // 从 DOM 获取数据不太可靠，改为直接请求 API
  // 我们用更简单的方式：触发 delete + 重新加载
  // 但实际上应该获取完整内容，但 list 已有原始数据，从列表 DOM 取就行
  const items = tlHistoryList.querySelectorAll('.tl-hist-item');
  for (const item of items) {
    const btn = item.querySelector('button');
    if (btn && btn.getAttribute('onclick')?.includes(id)) {
      const orig = item.querySelector('.tl-hist-orig')?.textContent || '';
      const trans = item.querySelector('.tl-hist-trans')?.textContent || '';
      tlInput.value = orig;
      tlLastInput = '';
      tlFinalTranslated = trans;
      tlOutput.innerHTML = escHtml(trans);
      toast('↩ 已加载到编辑器');
      switchPanel('translate');
      return;
    }
  }
}

// 删除历史条目
async function deleteHistItem(id) {
  try {
    await fetch('/api/translate/history/' + encodeURIComponent(id), { method: 'DELETE' });
    loadHistory();
  } catch(e) {
    console.warn('[Translate] deleteHist failed', e.message);
    toast('❌ 删除失败', 'error');
  }
}

// 清空全部
tlClearHistory.addEventListener('click', async () => {
  if (!confirm('确定清空全部翻译历史？')) return;
  try {
    const list = await (await fetch('/api/translate/history?limit=500')).json();
    for (const item of list) {
      await fetch('/api/translate/history/' + encodeURIComponent(item.id), { method: 'DELETE' });
    }
    loadHistory();
    toast('✅ 已清空');
  } catch(e) {
    console.warn('[Translate] clearHistory failed', e.message);
    toast('❌ 清空失败', 'error');
  }
});

// ===== 导航集成 =====
// 使用 MutationObserver 检测面板激活
(function watchTranslatePanel() {
  const panel = $('panel-translate');
  if (!panel) return;
  const observer = new MutationObserver(() => {
    if (panel.classList.contains('active')) {
      loadHistory();
    }
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
})();

// ===== 初始化 =====
loadHistory();
