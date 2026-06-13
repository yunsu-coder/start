// ===== 小苇 AI 对话 v2 — IndexedDB + 多会话 =====

// ---- IndexedDB 封装 ----
const ChatDB = (() => {
  const DB_NAME = 'yiwei_chat', DB_VER = 1;
  let db = null;
  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('conversations')) {
          const store = d.createObjectStore('conversations', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }
  async function getAll() {
    const d = await open();
    return new Promise((resolve) => {
      const tx = d.transaction('conversations', 'readonly');
      const req = tx.objectStore('conversations').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  }
  async function get(id) {
    const d = await open();
    return new Promise((resolve) => {
      const tx = d.transaction('conversations', 'readonly');
      const req = tx.objectStore('conversations').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }
  async function put(conv) {
    const d = await open();
    return new Promise((resolve) => {
      const tx = d.transaction('conversations', 'readwrite');
      tx.objectStore('conversations').put(conv);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  async function remove(id) {
    const d = await open();
    return new Promise((resolve) => {
      const tx = d.transaction('conversations', 'readwrite');
      tx.objectStore('conversations').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
  return { getAll, get, put, remove };
})();

// ---- 会话管理 ----
let activeConvId = null;
let chatHistory = [];
let chatStreaming = false;
let currentMsgEl = null;
let currentToolEls = {};
let pendingImages = [];

const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const chatImageInput = document.getElementById('chatImageInput');
const chatImagePreview = document.getElementById('chatImagePreview');
const chatCountEl = document.getElementById('chatCount');
const chatConvList = document.getElementById('chatConvList');
const chatHeaderTitle = document.getElementById('chatHeaderTitle');

function convId() { return 'conv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

async function saveConv() {
  if (!activeConvId || !chatHistory.length) return;
  const existing = await ChatDB.get(activeConvId);
  const title = existing?.title || (() => {
    const firstUser = chatHistory.find(m => m.role === 'user');
    if (!firstUser) return '空对话';
    const t = typeof firstUser.content === 'string' ? firstUser.content : '[图片]';
    return t.slice(0, 30) + (t.length > 30 ? '...' : '');
  })();
  await ChatDB.put({ id: activeConvId, title, messages: chatHistory, updatedAt: Date.now() });
  updateChatCount();
  refreshConvList();
}

async function loadConv(id) {
  const conv = await ChatDB.get(id);
  if (!conv) return;
  activeConvId = id;
  chatHistory = conv.messages || [];
  // 重建 UI
  chatMessages.innerHTML = '';
  const welcome = chatMessages.querySelector('.chat-welcome');
  for (const m of chatHistory) {
    if (m.role === 'user') {
      const div = document.createElement('div');
      div.className = 'chat-msg user';
      const txt = typeof m.content === 'string' ? m.content : (
        Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join('\n') : '[多模态]'
      );
      div.innerHTML = '<div class="chat-msg-avatar mi">person</div><div class="chat-msg-body">' + escapeHtml(txt) + '</div>';
      chatMessages.appendChild(div);
    } else if (m.role === 'assistant' && m.content) {
      const div = document.createElement('div');
      div.className = 'chat-msg assistant';
      div.innerHTML = '<div class="chat-msg-avatar mi">smart_toy</div><div class="chat-msg-body"><div class="chat-content">' + renderMarkdown(m.content) + '</div></div>';
      chatMessages.appendChild(div);
    }
  }
  if (!chatHistory.length) {
    chatMessages.innerHTML = `<div class="chat-welcome">
      <div class="chat-welcome-icon mi">smart_toy</div><h3>小苇 · 你的 AI 伙伴</h3>
      <p>聊天、创作、看图、搜索、帮你做事——我在这里陪你</p></div>`;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatHeaderTitle) chatHeaderTitle.innerHTML = '<span class="mi">smart_toy</span> ' + escapeHtml(conv.title || '小苇');
  updateChatCount();
}

async function newConversation() {
  if (chatStreaming) return;
  if (activeConvId && chatHistory.length) await saveConv();
  activeConvId = convId();
  chatHistory = [];
  chatMessages.innerHTML = `<div class="chat-welcome">
    <div class="chat-welcome-icon mi">smart_toy</div><h3>小苇 · 你的 AI 伙伴</h3>
    <p>聊天、创作、看图、搜索、帮你做事——我在这里陪你</p></div>`;
  if (chatHeaderTitle) chatHeaderTitle.innerHTML = '<span class="mi">smart_toy</span> 新对话';
  updateChatCount();
  refreshConvList();
}

async function switchConversation(id) {
  if (chatStreaming) return;
  if (activeConvId && chatHistory.length) await saveConv();
  await loadConv(id);
  refreshConvList();
}

async function deleteConversation(id) {
  await ChatDB.remove(id);
  if (activeConvId === id) {
    activeConvId = null;
    chatHistory = [];
    chatMessages.innerHTML = `<div class="chat-welcome">
      <div class="chat-welcome-icon mi">smart_toy</div><h3>小苇 · 你的 AI 伙伴</h3>
      <p>聊天、创作、看图、搜索、帮你做事——我在这里陪你</p></div>`;
  }
  refreshConvList();
}

async function refreshConvList() {
  if (!chatConvList) return;
  const convs = await ChatDB.getAll();
  convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  chatConvList.innerHTML = convs.map(c => {
    const active = c.id === activeConvId ? ' active' : '';
    const date = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '';
    return `<div class="chat-conv-item${active}" data-id="${c.id}" onclick="switchConversation('${c.id}')">
      <span class="chat-conv-title">${escapeHtml(c.title || '新对话')}</span>
      <span class="chat-conv-date">${date}</span>
      <button class="chat-conv-del" onclick="event.stopPropagation();deleteConversation('${c.id}')" title="删除">✕</button>
    </div>`;
  }).join('') || '<div class="chat-conv-empty">还没有对话，点击 + 新建</div>';
  // 高亮当前
  if (activeConvId) {
    const active = chatConvList.querySelector(`[data-id="${activeConvId}"]`);
    if (active) active.classList.add('active');
  }
}

async function clearHistory() {
  if (!chatHistory.length) return;
  chatHistory = [];
  if (activeConvId) await ChatDB.remove(activeConvId);
  activeConvId = null;
  chatMessages.innerHTML = `<div class="chat-welcome">
    <div class="chat-welcome-icon mi">smart_toy</div><h3>小苇 · 你的 AI 伙伴</h3>
    <p>聊天、创作、看图、搜索、帮你做事——我在这里陪你</p></div>`;
  if (chatHeaderTitle) chatHeaderTitle.innerHTML = '<span class="mi">smart_toy</span> 小苇';
  updateChatCount();
  refreshConvList();
}

function updateChatCount() {
  if (chatCountEl) {
    const n = chatHistory.length;
    chatCountEl.textContent = n ? `${n} 条消息` : '';
  }
}

// ---- 图片处理 ----
function triggerImageUpload() { chatImageInput?.click(); }
function handleChatImage(e) {
  const files = e.target.files;
  if (!files?.length) return;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = () => { addImagePreview(reader.result, f.name); };
    reader.readAsDataURL(f);
  }
  chatImageInput.value = '';
}
function handleChatPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (!item.type.startsWith('image/')) continue;
    e.preventDefault();
    const blob = item.getAsFile();
    const reader = new FileReader();
    reader.onload = () => { addImagePreview(reader.result, '截图'); };
    reader.readAsDataURL(blob);
  }
}
function addImagePreview(dataUrl, name) {
  pendingImages.push(dataUrl);
  const chip = document.createElement('span');
  chip.className = 'chat-img-chip';
  chip.title = name;
  chip.innerHTML = `<img src="${dataUrl}"><span class="chat-img-remove mi">close</span>`;
  chip.querySelector('.chat-img-remove').onclick = function() {
    pendingImages = pendingImages.filter(d => d !== dataUrl);
    chip.remove();
  };
  chatImagePreview.appendChild(chip);
}

// ---- 发送消息 ----
function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}
function sendChat() {
  if (chatStreaming) return;
  const text = chatInput.value.trim();
  if (!text && !pendingImages.length) return;
  chatInput.value = '';
  chatInput.style.height = 'auto';

  const welcome = chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  let content;
  if (pendingImages.length) {
    content = [];
    if (text) content.push({ type: 'text', text });
    for (const img of pendingImages) content.push({ type: 'image_url', image_url: { url: img } });
  } else { content = text; }

  chatHistory.push({ role: 'user', content });
  appendUserMsg(text, pendingImages);
  pendingImages = [];
  chatImagePreview.innerHTML = '';

  currentMsgEl = createAssistantMsg();
  currentToolEls = {};
  chatStreaming = true;
  chatSendBtn.disabled = true;
  chatInput.disabled = true;
  streamAgent();
}

function appendUserMsg(text, images) {
  const div = document.createElement('div');
  div.className = 'chat-msg user';
  let imgsHtml = '';
  if (images?.length) imgsHtml = '<div class="chat-imgs">' + images.map(i => `<img src="${i}">`).join('') + '</div>';
  div.innerHTML = '<div class="chat-msg-avatar mi">person</div><div class="chat-msg-body">' + (text ? escapeHtml(text) : '') + imgsHtml + '</div>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createAssistantMsg() {
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.id = 'currentMsg';
  div.innerHTML = '<div class="chat-msg-avatar mi">smart_toy</div><div class="chat-msg-body"><div class="chat-typing"><span></span><span></span><span></span></div></div>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}
function currentBody() { return currentMsgEl?.querySelector('.chat-msg-body'); }
function clearTyping() { const b = currentBody(); if (b) { const t = b.querySelector('.chat-typing'); if (t) t.remove(); } }

// ---- 流式请求 ----
async function streamAgent() {
  const MAX_MSGS = 40, KEEP_RECENT = 20;
  try {
    const chatCfg = typeof getChatApiConfig === 'function' ? getChatApiConfig() : {};
    const nonSys = chatHistory.filter(m => m.role !== 'system');
    const needCompress = nonSys.length > MAX_MSGS;
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: chatHistory,
        apiKey: chatCfg.apiKey, baseUrl: chatCfg.baseUrl, model: chatCfg.model,
        compress: needCompress, keepRecent: KEEP_RECENT
      }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setContent('**' + (err.error || 'HTTP ' + resp.status) + '**');
      finishStream();
      return;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', contentText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (buffer.includes('\n\n')) {
        const idx = buffer.indexOf('\n\n');
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = '', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (!event || !data) continue;
        try {
          const payload = JSON.parse(data);
          handleEvent(event, payload);
          if (event === 'content') contentText = payload.text;
          if (event === 'done') { chatHistory.push({ role: 'assistant', content: contentText }); }
        } catch {}
      }
    }
  } catch (e) { setContent('**网络错误**: ' + e.message); }
  finishStream();
}

function handleEvent(event, data) {
  switch (event) {
    case 'compressed':
      if (data.summary) {
        const note = document.createElement('div');
        note.className = 'chat-compress-note';
        note.innerHTML = '<span class="mi">compress</span> 对话已压缩 · 早期内容浓缩为摘要 (' + data.kept + ' 条保留)';
        chatMessages.appendChild(note);
      }
      break;
    case 'thinking': {
      clearTyping();
      const body = currentBody(); if (!body) return;
      let el = body.querySelector('.chat-thinking');
      if (!el) {
        el = document.createElement('details'); el.className = 'chat-thinking';
        el.innerHTML = '<summary>思考中...</summary><div class="chat-thinking-text"></div>';
        body.appendChild(el);
      }
      el.querySelector('.chat-thinking-text').textContent = data.text;
      el.querySelector('summary').textContent = '思考 (' + data.text.length + ' 字)';
      break;
    }
    case 'tool_call': {
      clearTyping();
      const body = currentBody(); if (!body) return;
      const tc = document.createElement('details');
      tc.className = 'chat-tool-call'; tc.open = true; tc.id = 'tool-' + data.id;
      const argsPreview = typeof data.args === 'object' ? JSON.stringify(data.args, null, 2).slice(0, 300) : String(data.args).slice(0, 300);
      tc.innerHTML = '<summary><span class="mi" style="font-size:.85rem;">terminal</span> <strong>' + data.name + '</strong><span class="tool-args-summary">' + escapeHtml(argsPreview.slice(0, 60)) + '</span></summary>'
        + '<div class="tool-body"><div class="tool-args"><code>' + escapeHtml(argsPreview) + '</code></div><div class="tool-result loading">执行中...</div></div>';
      body.appendChild(tc);
      currentToolEls[data.id] = tc;
      chatMessages.scrollTop = chatMessages.scrollHeight;
      break;
    }
    case 'tool_result': {
      const tc = currentToolEls[data.id]; if (!tc) return;
      tc.open = false;
      const resultDiv = tc.querySelector('.tool-result'); if (!resultDiv) return;
      resultDiv.classList.remove('loading');
      const r = data.result; let out = '';
      if (r.error) { out = '<span class="tool-err">' + escapeHtml(r.error) + '</span>'; tc.classList.add('tool-error'); }
      else if (r.content !== undefined) { out = '<pre>' + escapeHtml(r.content.slice(0, 3000)) + '</pre>'; if (r.truncated) out += '<em>（文件过长，已截断）</em>'; }
      else if (r.stdout !== undefined) { out = '<pre>' + escapeHtml(r.stdout.slice(0, 3000)) + '</pre>'; if (r.stderr) out += '<pre class="tool-err">' + escapeHtml(r.stderr.slice(0, 500)) + '</pre>'; out += '<span class="tool-exit">退出码: ' + (r.exitCode || 0) + '</span>'; }
      else if (r.matches !== undefined) { out = '<pre>' + escapeHtml(r.matches.slice(0, 3000)) + '</pre>'; }
      else if (r.files !== undefined) { out = '<pre>' + escapeHtml(r.files) + '</pre>'; }
      else if (r.written || r.edited) { out = '<span class="tool-ok">✓ ' + (r.written ? '已写入 ' + r.path + ' (' + (r.size || 0) + ' 字节)' : '已编辑 ' + r.path) + '</span>'; }
      else if (r.width) { out = '<span class="tool-ok">📷 ' + r.width + '×' + r.height + ' ' + (r.format || '') + ' ' + (r.sizeDisplay || '') + '</span>'; }
      else { out = '<pre>' + escapeHtml(JSON.stringify(r, null, 2).slice(0, 2000)) + '</pre>'; }
      resultDiv.innerHTML = out;
      chatMessages.scrollTop = chatMessages.scrollHeight;
      break;
    }
    case 'content': {
      clearTyping();
      const body = currentBody(); if (!body) return;
      let contentDiv = body.querySelector('.chat-content');
      if (!contentDiv) { contentDiv = document.createElement('div'); contentDiv.className = 'chat-content'; body.appendChild(contentDiv); }
      contentDiv.innerHTML = renderMarkdown(data.text);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      break;
    }
    case 'error': {
      clearTyping();
      const body = currentBody(); if (!body) return;
      let contentDiv = body.querySelector('.chat-content');
      if (!contentDiv) { contentDiv = document.createElement('div'); contentDiv.className = 'chat-content'; body.appendChild(contentDiv); }
      contentDiv.innerHTML = '<strong>错误</strong>: ' + escapeHtml(data.message || '未知错误');
      break;
    }
  }
}

function setContent(html) {
  const body = currentBody(); if (!body) return;
  clearTyping();
  let contentDiv = body.querySelector('.chat-content');
  if (!contentDiv) { contentDiv = document.createElement('div'); contentDiv.className = 'chat-content'; body.appendChild(contentDiv); }
  contentDiv.innerHTML = html;
}

async function finishStream() {
  chatStreaming = false;
  chatSendBtn.disabled = false;
  chatInput.disabled = false;
  chatInput.focus();
  const el = document.getElementById('currentMsg');
  if (el) el.removeAttribute('id');
  currentMsgEl = null;
  currentToolEls = {};
  await saveConv();
}

// ---- Markdown ----
function escapeHtml(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  const lines = html.split('\n');
  let result = '', inList = false;
  for (let i = 0; i < lines.length; i++) {
    const isLi = lines[i].startsWith('<li>');
    if (isLi && !inList) { result += '<ul>'; inList = true; }
    if (!isLi && inList) { result += '</ul>'; inList = false; }
    result += lines[i]; if (i < lines.length - 1) result += '\n';
  }
  if (inList) result += '</ul>';
  html = result;
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  if (!html.startsWith('<')) html = '<p>' + html + '</p>';
  return html;
}

// 侧栏折叠
function toggleChatSidebar() {
  const sidebar = document.getElementById('chatSidebar');
  if (sidebar) sidebar.classList.toggle('collapsed');
}

// 输入框自适应
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

// ---- 初始化 ----
(async function init() {
  const convs = await ChatDB.getAll();
  convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (convs.length > 0) {
    await loadConv(convs[0].id);
  } else {
    activeConvId = convId();
    chatHistory = [];
  }
  await refreshConvList();
  // 迁移旧 localStorage 数据
  try {
    const old = localStorage.getItem('yiwei_chat_history');
    if (old) {
      const msgs = JSON.parse(old);
      if (Array.isArray(msgs) && msgs.length) {
        chatHistory = msgs;
        await saveConv();
        await refreshConvList();
      }
      localStorage.removeItem('yiwei_chat_history');
    }
  } catch {}
})();
