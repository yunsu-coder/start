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
let pinPendingConvId = null;
let pinMode = 'unlock'; // 'unlock' | 'delete' | 'set' | 'clear'
let unlockVerified = null; // 刚验证通过的对话 ID，loadConv 使用后清除

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

  // 检查锁定状态：已锁且未验证通过，不渲染消息
  if (conv.pinHash && unlockVerified !== id) {
    chatMessages.innerHTML = `<div class="chat-welcome">
      <div class="chat-welcome-icon mi">lock</div>
      <h3>此对话已加密</h3>
      <p>需要 PIN 才能查看</p>
      <button class="btn accent" style="margin-top:.8rem;" onclick="pinPendingConvId='${id}';showPinModal('请输入 PIN 以查看此对话','unlock')"><span class="mi">lock_open</span> 解锁查看</button></div>`;
    chatHistory = []; // 清空内存中的历史，直到解锁
    chatMessages.scrollTop = 0;
    if (chatHeaderTitle) chatHeaderTitle.innerHTML = '<span class="mi">smart_toy</span> <span class="mi" style="font-size:.7rem;color:var(--accent);">lock</span> ' + escapeHtml(conv.title || '小苇');
    updateChatCount();
    updatePinHeaderButton(activeConvId);
    return;
  }

  // 已验证通过，清除标记
  if (unlockVerified === id) unlockVerified = null;

  // 重建 UI
  chatMessages.innerHTML = '';
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
      <div class="chat-welcome-icon mi">smart_toy</div><h3>小苇 · 你兄弟</h3>
      <p>啥都能聊，别跟我见外</p></div>`;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatHeaderTitle) chatHeaderTitle.innerHTML = '<span class="mi">smart_toy</span> ' + escapeHtml(conv.title || '小苇');
  updateChatCount();
  updatePinHeaderButton(activeConvId);
}

async function newConversation() {
  if (chatStreaming) return;
  if (activeConvId && chatHistory.length) await saveConv();
  activeConvId = convId();
  chatHistory = [];
  chatMessages.innerHTML = `<div class="chat-welcome">
    <div class="chat-welcome-icon mi">smart_toy</div><h3>小苇 · 你的 AI 伴侣</h3>
    <p>你的专属男人——聊天、命令、疼爱，我在这里</p></div>`;
  if (chatHeaderTitle) chatHeaderTitle.innerHTML = '<span class="mi">smart_toy</span> 小苇';
  updateChatCount();
  refreshConvList();
  // 新对话隐藏锁按钮
  const c = document.getElementById('chatLockBtnContainer');
  if (c) c.style.display = 'none';
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
      <div class="chat-welcome-icon mi">smart_toy</div><h3>小苇 · 你兄弟</h3>
      <p>啥都能聊，别跟我见外</p></div>`;
    // 隐藏锁按钮
    const c = document.getElementById('chatLockBtnContainer');
    if (c) c.style.display = 'none';
  }
  refreshConvList();
}

// ---- PIN 锁功能 ----
async function handleConvClick(id) {
  if (chatStreaming) return;
  const conv = await ChatDB.get(id);
  if (conv?.pinHash) { pinPendingConvId = id; showPinModal('请输入 PIN 以查看此对话', 'unlock'); return; }
  switchConversation(id);
}

async function handleDeleteConv(id) {
  const conv = await ChatDB.get(id);
  if (conv?.pinHash) { pinPendingConvId = id; showPinModal('请输入 PIN 以删除此对话', 'delete'); return; }
  deleteConversation(id);
}

async function lockConversation(id, pin) {
  const conv = await ChatDB.get(id);
  if (!conv) return;
  conv.pinHash = await sha256(pin);
  conv.updatedAt = Date.now();
  await ChatDB.put(conv);
  refreshConvList();
  updatePinHeaderButton(id);
}

async function unlockConversation(id) {
  const conv = await ChatDB.get(id);
  if (!conv) return;
  delete conv.pinHash;
  conv.updatedAt = Date.now();
  await ChatDB.put(conv);
  refreshConvList();
  updatePinHeaderButton(id);
}

async function verifyPin(id, pin) {
  const conv = await ChatDB.get(id);
  if (!conv || !conv.pinHash) return true;
  return (await sha256(pin)) === conv.pinHash;
}

function showPinModal(msg, mode) {
  pinMode = mode || 'unlock';
  pinPendingConvId = pinPendingConvId || activeConvId;
  const titleEl = document.getElementById('pinModalTitle');
  if (titleEl) titleEl.textContent = mode === 'set' ? '设置加密' : mode === 'clear' ? '解除加密' : '对话加密';
  const promptEl = document.getElementById('pinPromptText');
  if (promptEl) promptEl.textContent = msg;
  const inputEl = document.getElementById('pinInput');
  if (inputEl) { inputEl.value = ''; }
  const errEl = document.getElementById('pinError');
  if (errEl) errEl.style.display = 'none';
  document.getElementById('pinModal').classList.add('show');
  setTimeout(() => { const inp = document.getElementById('pinInput'); if (inp) inp.focus(); }, 100);
}

function closePinModal() {
  document.getElementById('pinModal').classList.remove('show');
  pinPendingConvId = null;
}

async function submitPin() {
  const input = document.getElementById('pinInput');
  const pin = input.value.trim();
  const errEl = document.getElementById('pinError');
  if (!/^\d{1,6}$/.test(pin)) { errEl.textContent = '请输入 1-6 位数字'; errEl.style.display = 'block'; return; }
  const id = pinPendingConvId || activeConvId;
  if (!id) { closePinModal(); return; }

  if (pinMode === 'set') {
    await lockConversation(id, pin);
    toast?.('对话已加密', 'success');
    closePinModal();
    return;
  }
  if (pinMode === 'clear') {
    if (!await verifyPin(id, pin)) { errEl.textContent = 'PIN 错误，请重试'; errEl.style.display = 'block'; input.value = ''; return; }
    await unlockConversation(id);
    toast?.('对话已解锁', 'success');
    closePinModal();
    return;
  }
  if (!await verifyPin(id, pin)) { errEl.textContent = 'PIN 错误，请重试'; errEl.style.display = 'block'; input.value = ''; return; }
  // 标记已验证，loadConv 凭此放行
  unlockVerified = id;
  closePinModal();
  if (pinMode === 'delete') { unlockVerified = null; deleteConversation(id); }
  else { switchConversation(id); }
}

function updatePinHeaderButton(id) {
  const container = document.getElementById('chatLockBtnContainer');
  if (!container) return;
  ChatDB.get(id).then(conv => {
    if (!conv || !id || id !== activeConvId) { container.style.display = 'none'; return; }
    container.style.display = '';
    container.innerHTML = conv.pinHash
      ? '<button onclick="showPinModal(\'输入当前 PIN 以解锁\',\'clear\')" title="解锁对话" class="chat-lock-btn"><span class="mi">lock</span></button>'
      : '<button onclick="pinPendingConvId=activeConvId;showPinModal(\'设置数字 PIN\',\'set\')" title="锁定对话" class="chat-lock-btn"><span class="mi">lock_open</span></button>';
  });
}

async function refreshConvList() {
  if (!chatConvList) return;
  const convs = await ChatDB.getAll();
  convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  chatConvList.innerHTML = convs.map(c => {
    const active = c.id === activeConvId ? ' active' : '';
    const locked = c.pinHash ? '<span class="mi chat-conv-lock">lock</span>' : '';
    const date = c.updatedAt ? new Date(c.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '';
    return `<div class="chat-conv-item${active}" data-id="${c.id}" onclick="handleConvClick('${c.id}')">
      ${locked}
      <span class="chat-conv-title">${escapeHtml(c.title || '新对话')}</span>
      <span class="chat-conv-date">${date}</span>
      <button class="chat-conv-del" onclick="event.stopPropagation();handleDeleteConv('${c.id}')" title="删除">✕</button>
    </div>`;
  }).join('') || '<div class="chat-conv-empty">还没有对话，点击 + 新建</div>';
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
    <div class="chat-welcome-icon mi">smart_toy</div><h3>小苇 · 你的 AI 伴侣</h3>
    <p>你的专属男人——聊天、命令、疼爱，我在这里</p></div>`;
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

// ---- 视觉模型检测 ----
function isVisionModel(model) {
  if (!model) return false;
  const m = model.toLowerCase();
  return m.includes('vl') || m.includes('vision') || m.includes('glm-4v') || m.includes('gpt-4o') || m.includes('gemini') || m.includes('claude') || m.includes('grok');
}

// ---- 图片压缩 ----
function compressImage(file, maxW = 1024, quality = 0.75) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('非图片文件')); return; }
    // SVG/GIF 不压缩，直接读
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      // 统一用 JPEG（兼容性最好，Grok/Claude/GPT 都支持）
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.8);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
}

// ---- 图片处理 ----
function triggerImageUpload() { chatImageInput?.click(); }
async function handleChatImage(e) {
  const files = e.target.files;
  if (!files?.length) return;
  for (const f of files) {
    if (f.type.startsWith('image/')) {
      try {
        const dataUrl = await compressImage(f);
        addImagePreview(dataUrl, f.name);
      } catch (err) { toast?.('图片处理失败: ' + err.message, 'error'); }
    } else {
      // 非图片文件 → 文档上传
      await uploadDocFile(f);
    }
  }
  chatImageInput.value = '';
}
// handleChatPaste 定义在文件末尾，支持图片+文件粘贴

// ---- 文档上传 ----
async function uploadDocFile(file) {
  const MAX = 30 * 1024 * 1024;
  if (file.size > MAX) { toast?.('文件过大（最大30MB）', 'error'); return; }
  const form = new FormData();
  form.append('file', file);
  try {
    const resp = await fetch('/api/chat/upload-doc', { method: 'POST', body: form });
    const data = await resp.json();
    if (!data.ok) { toast?.(data.error || '上传失败', 'error'); return; }
    // 在输入框插入文档引用，替换发送逻辑时识别
    const docChip = document.createElement('span');
    docChip.className = 'chat-doc-chip';
    docChip.title = data.text.slice(0, 200);
    docChip.innerHTML = '<span class="mi">description</span> ' + escapeHtml(data.filename) + ' (' + data.fileType + ', ' + (data.size / 1024).toFixed(1) + 'K)';
    docChip.onclick = () => docChip.remove();
    const existed = document.querySelectorAll('.chat-doc-chip');
    if (existed.length) { for (const c of existed) c.remove(); } // 一次只允许一个文档
    chatImagePreview.appendChild(docChip);
    // 暂存文档文本
    window._chatDocText = data.text;
    window._chatDocName = data.filename;
    toast?.('已添加 ' + data.filename + '（' + data.charCount + ' 字）', 'success');
  } catch (e) {
    toast?.('文档上传失败: ' + e.message, 'error');
  }
}

// ---- 拖拽上传 ----
(function() {
  const area = document.querySelector('.chat-input-area');
  if (!area) return;
  let dragCounter = 0;
  area.addEventListener('dragover', (e) => {
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  });
  area.addEventListener('dragenter', (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter++;
    if (dragCounter === 1) area.classList.add('drag-over');
  });
  area.addEventListener('dragleave', (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) area.classList.remove('drag-over');
  });
  area.addEventListener('drop', async (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter = 0;
    area.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (!files?.length) return;
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        try {
          const dataUrl = await compressImage(f);
          addImagePreview(dataUrl, f.name);
        } catch (err) { /* skip */ }
      } else {
        await uploadDocFile(f);
      }
    }
  });
  // 也可拖到整个聊天区域
  const msgArea = document.getElementById('chatMessages');
  if (msgArea) {
    msgArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    msgArea.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation();
      area.classList.remove('drag-over');
      const files = e.dataTransfer.files;
      if (!files?.length) return;
      for (const f of files) {
        if (f.type.startsWith('image/')) {
          try {
            const dataUrl = await compressImage(f);
            addImagePreview(dataUrl, f.name);
          } catch (err) { /* skip */ }
        } else {
          await uploadDocFile(f);
        }
      }
    });
  }
})();
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
  if (!text && !pendingImages.length && !window._chatDocText) return;
  chatInput.value = '';
  chatInput.style.height = 'auto';

  const welcome = chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // 组装消息内容
  let content, displayText = text;
  const hasImages = pendingImages.length > 0;
  const hasDoc = !!window._chatDocText;

  if (hasImages || hasDoc) {
    content = [];
    let fullText = text || '';
    if (hasDoc) {
      const docLabel = window._chatDocName || '文档';
      fullText = (fullText ? fullText + '\n\n' : '') + '📄 [' + docLabel + '] 内容:\n```\n' + window._chatDocText + '\n```';
      displayText = (text || '') + (text ? '\n' : '') + '📎 ' + docLabel;
    }
    if (hasImages) {
      if (fullText) content.push({ type: 'text', text: fullText });
      for (const img of pendingImages) content.push({ type: 'image_url', image_url: { url: img } });
      if (!fullText && hasDoc) content.unshift({ type: 'text', text: fullText });
    } else {
      content.push({ type: 'text', text: fullText });
    }
  } else { content = text; }

  chatHistory.push({ role: 'user', content });
  appendUserMsg(displayText, pendingImages);
  pendingImages = [];
  chatImagePreview.innerHTML = '';
  // 清理文档状态
  window._chatDocText = null;
  window._chatDocName = null;
  document.querySelectorAll('.chat-doc-chip').forEach(c => c.remove());

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
        apiKey: chatCfg.apiKey || '', baseUrl: chatCfg.baseUrl || '',
        model: chatCfg.model || 'grok-4.3',
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
          if (event === 'content_delta') contentText += payload.delta;
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
      else if (r.content !== undefined) { out = renderToolFileResult(r); }
      else if (r.stdout !== undefined) { out = renderToolStdout(r); }
      else if (r.matches !== undefined) { out = '<pre>' + escapeHtml(r.matches.slice(0, 3000)) + '</pre>'; }
      else if (r.files !== undefined) { out = renderToolFiles(r); }
      else if (r.written || r.edited) { out = renderToolWritten(r); }
      else if (r.width) { out = renderToolImageInfo(r); }
      else { out = '<pre>' + escapeHtml(JSON.stringify(r, null, 2).slice(0, 2000)) + '</pre>'; }
      resultDiv.innerHTML = out;
      chatMessages.scrollTop = chatMessages.scrollHeight;
      break;
    }
    case 'content_delta': {
      clearTyping();
      const body = currentBody(); if (!body) return;
      let contentDiv = body.querySelector('.chat-content');
      if (!contentDiv) { contentDiv = document.createElement('div'); contentDiv.className = 'chat-content'; body.appendChild(contentDiv); }
      if (!contentDiv._streamBuffer) contentDiv._streamBuffer = '';
      contentDiv._streamBuffer += data.delta;
      if (!contentDiv._renderScheduled) {
        contentDiv._renderScheduled = true;
        requestAnimationFrame(() => {
          contentDiv._renderScheduled = false;
          if (typeof contentDiv._streamBuffer !== 'string') return; // done 已清理
          const fullText = contentDiv._streamBuffer;
          contentDiv.innerHTML = renderMarkdown(fullText);
          enhanceCodeBlocks(contentDiv);
          renderMermaidDiagrams(contentDiv);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        });
      }
      break;
    }
    case 'done': {
      // 最终渲染 + 清理 stream buffer
      const body = currentBody(); if (body) {
        let contentDiv = body.querySelector('.chat-content');
        if (contentDiv && contentDiv._streamBuffer) {
          contentDiv.innerHTML = renderMarkdown(contentDiv._streamBuffer);
          enhanceCodeBlocks(contentDiv);
          renderMermaidDiagrams(contentDiv);
          delete contentDiv._streamBuffer;
          delete contentDiv._renderScheduled;
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
      }
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

// ---- Markdown 增强版 ----
function escapeHtml(s) { if (!s) return ''; return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function unescapeHtml(s) { return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"'); }
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function renderMarkdown(text) {
  if (!text) return '';
  // 分离代码块，保护内容不被转义
  const codeBlocks = [];
  let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || '', code: code.trimEnd() });
    return `%%CODEBLOCK_${idx}%%`;
  });
  // 分离行内代码
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(code);
    return `%%INLINECODE_${idx}%%`;
  });

  html = escapeHtml(html);

  // 恢复行内代码
  html = html.replace(/%%INLINECODE_(\d+)%%/g, (_, i) => `<code>${escapeHtml(inlineCodes[+i])}</code>`);

  // 表格（在转义后处理——需要还原管道符）
  html = html.replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (match, header, rows) => {
    const hcells = header.split('|').map(h => h.trim()).filter(Boolean);
    const thead = '<thead><tr>' + hcells.map(h => `<th>${h}</th>`).join('') + '</tr></thead>';
    const tbody = '<tbody>' + rows.trim().split('\n').map(row => {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    }).join('') + '</tbody>';
    return `<div class="table-wrap"><table>${thead}${tbody}</table></div>`;
  });

  // 任务列表
  html = html.replace(/^- \[([ x])\] (.+)$/gm, (_, checked, label) =>
    `<div class="task-item"><input type="checkbox" ${checked==='x'?'checked':''} disabled><span>${label}</span></div>`);

  // 图片 ![](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="chat-img-inline" loading="lazy" onclick="viewChatImage(this.src)">');

  // 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // 粗斜体
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // 标题
  html = html.replace(/^#### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');

  // 引用
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // 分割线
  html = html.replace(/^---$/gm, '<hr>');

  // 无序列表
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // 组装列表
  const lines = html.split('\n');
  let result = '', inList = false, inTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<div class="table-wrap">')) { if (inList) { result += '</ul>'; inList = false; } inTable = true; result += line; continue; }
    if (line === '</div>' && inTable) { inTable = false; result += line; continue; }
    if (inTable) { result += line; continue; }
    const isLi = line.startsWith('<li>');
    const isTask = line.startsWith('<div class="task-item">');
    if ((isLi || isTask) && !inList) { result += '<ul class="chat-list">'; inList = true; }
    if (!isLi && !isTask && inList) { result += '</ul>'; inList = false; }
    result += line;
    if (i < lines.length - 1) result += '\n';
  }
  if (inList) result += '</ul>';
  html = result;

  // 合并连续引用和段落
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  if (!html.startsWith('<')) html = '<p>' + html + '</p>';

  // 恢复代码块
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, i) => {
    const cb = codeBlocks[+i];
    const langLabel = cb.lang ? `<span class="code-lang">${escapeHtml(cb.lang)}</span>` : '';
    const copyBtn = `<button class="code-copy-btn" onclick="copyCodeBlock(this)" title="复制代码"><span class="mi">content_copy</span></button>`;
    return `<div class="code-block-wrap">${langLabel}${copyBtn}<pre><code class="${cb.lang ? 'lang-'+escapeHtml(cb.lang) : ''}">${escapeHtml(cb.code)}</code></pre></div>`;
  });

  // 包裹顶层裸文本
  if (html.trim() && !html.startsWith('<')) html = '<p>' + html + '</p>';
  return html;
}

// ---- 代码块增强：复制按钮 ----
function copyCodeBlock(btn) {
  const pre = btn.parentElement.querySelector('pre code');
  if (!pre) return;
  const text = unescapeHtml(pre.textContent || '');
  navigator.clipboard.writeText(text).then(() => {
    btn.classList.add('copied');
    btn.querySelector('.mi').textContent = 'check';
    setTimeout(() => { btn.classList.remove('copied'); btn.querySelector('.mi').textContent = 'content_copy'; }, 2000);
  }).catch(() => { /* 降级：选中文本 */ });
}

function enhanceCodeBlocks(container) {
  // 为代码块添加语言标签后的额外处理（当前 renderMarkdown 已处理主要逻辑）
  // 此处为后续扩展保留
}

// ---- Mermaid 图表渲染 ----
function renderMermaidDiagrams(container) {
  const mermaidBlocks = container.querySelectorAll('.lang-mermaid');
  if (!mermaidBlocks.length) return;
  if (typeof mermaid === 'undefined') {
    // Mermaid 未加载，显示原始代码
    mermaidBlocks.forEach(b => { b.classList.add('mermaid-fallback'); });
    return;
  }
  mermaidBlocks.forEach(async (block) => {
    const wrap = block.closest('.code-block-wrap');
    if (!wrap || wrap._mermaidRendered) return;
    wrap._mermaidRendered = true;
    const code = unescapeHtml(block.textContent || '');
    try {
      const { svg } = await mermaid.render('mermaid-' + Math.random().toString(36).slice(2,8), code);
      const svgDiv = document.createElement('div');
      svgDiv.className = 'mermaid-rendered';
      svgDiv.innerHTML = svg;
      wrap.insertAdjacentElement('afterend', svgDiv);
      wrap.style.display = 'none'; // 隐藏原始代码块
    } catch (e) {
      // 渲染失败，保留原始代码
      block.classList.add('mermaid-error');
      block.title = 'Mermaid 渲染失败: ' + e.message;
    }
  });
}

// ---- 点击查看大图 ----
function viewChatImage(src) {
  const overlay = document.createElement('div');
  overlay.className = 'chat-img-overlay';
  overlay.innerHTML = `<img src="${src}">`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

// ---- 工具结果多模态渲染 ----
function isImageExt(name) {
  const n = (name || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(n);
}
function isViewableExt(name) {
  const n = (name || '').toLowerCase();
  return /\.(png|jpe?g|gif|webp|svg|pdf|mp4|webm|mov|mp3|wav|ogg)$/i.test(n);
}
function fileIcon(name) {
  if (isImageExt(name)) return 'image';
  if (/\.pdf$/i.test(name)) return 'picture_as_pdf';
  if (/\.(mp4|webm|mov)$/i.test(name)) return 'movie';
  if (/\.(mp3|wav|ogg|flac)$/i.test(name)) return 'music_note';
  if (/\.(zip|tar|gz|rar)$/i.test(name)) return 'folder_zip';
  if (/\.(js|py|sh|ts|json|html|css|md|txt)$/i.test(name)) return 'code';
  return 'description';
}

function fileCardHtml(name, size, extra) {
  const viewUrl = '/api/view/' + encodeURIComponent(name);
  const dlUrl = '/api/dl/' + encodeURIComponent(name);
  const icon = fileIcon(name);
  const sizeStr = size ? (size > 1024*1024 ? (size/(1024*1024)).toFixed(1)+'MB' : (size>1024?(size/1024).toFixed(1)+'KB':size+'B')) : '';
  let preview = '';
  if (isImageExt(name)) {
    preview = `<img src="${viewUrl}" class="tool-img-preview" loading="lazy" onclick="viewChatImage(this.src)" title="点击查看大图">`;
  }
  return `<div class="tool-file-card">
    <div class="tool-file-icon mi">${icon}</div>
    <div class="tool-file-info">
      <span class="tool-file-name">${escapeHtml(name)}</span>
      <span class="tool-file-meta">${sizeStr}${extra ? ' · ' + extra : ''}</span>
    </div>
    <div class="tool-file-actions">
      <a href="${viewUrl}" target="_blank" class="tool-file-btn" title="预览"><span class="mi">visibility</span></a>
      <a href="${dlUrl}" class="tool-file-btn" title="下载"><span class="mi">download</span></a>
    </div>
    ${preview}
  </div>`;
}

function renderToolFileResult(r) {
  // 如果是图片路径，显示预览
  let out = '<pre>' + escapeHtml(r.content.slice(0, 3000)) + '</pre>';
  if (r.truncated) out += '<em>（文件过长，已截断）</em>';
  return out;
}

function renderToolStdout(r) {
  let out = '<pre>' + escapeHtml(r.stdout.slice(0, 3000)) + '</pre>';
  if (r.stderr) out += '<pre class="tool-err">' + escapeHtml(r.stderr.slice(0, 500)) + '</pre>';
  out += '<span class="tool-exit">退出码: ' + (r.exitCode || 0) + '</span>';
  return out;
}

function renderToolFiles(r) {
  // Glob/Grep 结果：检测是否有图片文件
  const fileList = (r.files || '').split('\n').filter(Boolean);
  if (fileList.length > 0 && fileList.every(f => isImageExt(f))) {
    // 全是图片：显示缩略图网格
    const imgs = fileList.slice(0, 20).map(f => {
      const url = '/api/view/' + encodeURIComponent(f.trim());
      return `<img src="${url}" class="tool-img-grid-item" loading="lazy" onclick="viewChatImage(this.src)">`;
    }).join('');
    return `<div class="tool-img-grid">${imgs}</div><span class="tool-exit">${fileList.length} 个图片文件</span>`;
  }
  return '<pre>' + escapeHtml(r.files) + '</pre>';
}

function renderToolWritten(r) {
  const name = r.path || '';
  const size = r.size || 0;
  // 图片或可预览文件显示卡片
  if (name && (isImageExt(name) || isViewableExt(name))) {
    return fileCardHtml(name, size, r.written ? '已创建' : '已编辑');
  }
  return '<span class="tool-ok">✓ ' + (r.written ? '已写入 ' + name + ' (' + size + ' 字节)' : '已编辑 ' + name) + '</span>';
}

function renderToolImageInfo(r) {
  // ReadImage 结果：显示缩略图 + 元信息
  let out = '<span class="tool-ok">📷 ' + r.width + '×' + r.height + ' ' + (r.format || '') + ' ' + (r.sizeDisplay || '') + '</span>';
  if (r.path && isImageExt(r.path)) {
    const viewUrl = '/api/view/' + encodeURIComponent(r.path);
    out += `<br><img src="${viewUrl}" class="tool-img-preview" loading="lazy" onclick="viewChatImage(this.src)" style="margin-top:.5rem;max-width:300px;max-height:200px;border-radius:8px;cursor:pointer;">`;
  }
  return out;
}

// 侧栏折叠
function toggleChatSidebar() {
  const sidebar = document.getElementById('chatSidebar');
  if (sidebar) sidebar.classList.toggle('collapsed');
}

// 沉浸模式切换
function toggleImmersive() {
  const layout = document.querySelector('.chat-layout');
  if (!layout) return;
  layout.classList.toggle('immersive');
  const isImmersive = layout.classList.contains('immersive');
  localStorage.setItem('yiwei_chat_immersive', isImmersive ? '1' : '');
  const btn = document.getElementById('chatImmersiveBtn');
  if (btn) {
    btn.querySelector('.mi').textContent = isImmersive ? 'fullscreen_exit' : 'fullscreen';
    btn.title = isImmersive ? '退出沉浸模式' : '沉浸模式';
  }
  if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ---- 语音输入 (Web Speech API) ----
let speechRecognition = null;
let isListening = false;
function toggleSpeechInput() {
  const micBtn = document.getElementById('chatMicBtn');
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    toast?.('浏览器不支持语音输入', 'error'); return;
  }
  if (isListening) {
    speechRecognition?.stop();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognition = new SR();
  speechRecognition.lang = 'zh-CN';
  speechRecognition.interimResults = true;
  speechRecognition.continuous = true;
  speechRecognition.maxAlternatives = 1;

  speechRecognition.onstart = () => {
    isListening = true;
    if (micBtn) { micBtn.classList.add('listening'); micBtn.querySelector('.mi').textContent = 'mic_off'; }
    toast?.('🎤 正在聆听...', 'success');
  };
  speechRecognition.onend = () => {
    isListening = false;
    if (micBtn) { micBtn.classList.remove('listening'); micBtn.querySelector('.mi').textContent = 'mic'; }
  };
  speechRecognition.onerror = (e) => {
    isListening = false;
    if (micBtn) { micBtn.classList.remove('listening'); micBtn.querySelector('.mi').textContent = 'mic'; }
    if (e.error !== 'aborted') toast?.('语音识别失败: ' + e.error, 'error');
  };
  speechRecognition.onresult = (e) => {
    let final = '', interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t;
    }
    if (final) { chatInput.value = (chatInput.value + ' ' + final).trim(); }
    // 临时显示未确认文本（可选）
    chatInput.focus();
  };
  speechRecognition.start();
}

// 粘贴事件也支持文档文件
async function handleChatPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      try {
        const dataUrl = await compressImage(blob);
        addImagePreview(dataUrl, '截图');
      } catch (err) { toast?.('截图处理失败', 'error'); }
      return;
    }
  }
  // 检查是否有文件
  for (const item of items) {
    if (item.kind === 'file') {
      e.preventDefault();
      const file = item.getAsFile();
      await uploadDocFile(file);
      return;
    }
  }
}

// 输入框自适应
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

// PIN 输入框回车提交
document.getElementById('pinInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitPin(); }
});

// ESC 关闭 PIN 弹窗
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const pm = document.getElementById('pinModal');
    if (pm && pm.classList.contains('show')) { closePinModal(); e.stopPropagation(); }
  }
});

// ---- 初始化 ----
(async function init() {
  const convs = await ChatDB.getAll();
  convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  // 自动加载最近对话，但跳过已锁的
  const firstUnlocked = convs.find(c => !c.pinHash);
  if (firstUnlocked) {
    await loadConv(firstUnlocked.id);
  } else if (convs.length > 0) {
    // 全部已锁或只有已锁对话，加载第一个（会显示解锁界面）
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

  // 恢复沉浸模式
  if (localStorage.getItem('yiwei_chat_immersive')) {
    const layout = document.querySelector('.chat-layout');
    if (layout) {
      layout.classList.add('immersive');
      const btn = document.getElementById('chatImmersiveBtn');
      if (btn) { btn.querySelector('.mi').textContent = 'fullscreen_exit'; btn.title = '退出沉浸模式'; }
    }
  }
})();
