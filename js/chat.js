// ===== Claude Code Agent 对话 =====
let chatHistory = [];
let chatStreaming = false;
let currentMsgEl = null;
let currentToolEls = {};
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
}

function sendChat() {
  if (chatStreaming) return;
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  chatInput.style.height = 'auto';

  const welcome = chatMessages.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // 用户消息
  chatHistory.push({ role: 'user', content: text });
  appendUserMsg(text);

  // 助手消息容器
  currentMsgEl = createAssistantMsg();
  currentToolEls = {};

  chatStreaming = true;
  chatSendBtn.disabled = true;
  chatInput.disabled = true;

  streamAgent();
}

function appendUserMsg(text) {
  const div = document.createElement('div');
  div.className = 'chat-msg user';
  div.innerHTML = '<div class="chat-msg-avatar mi">person</div><div class="chat-msg-body">' + escapeHtml(text) + '</div>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function createAssistantMsg() {
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.id = 'currentMsg';
  div.innerHTML = '<div class="chat-msg-avatar mi">smart_toy</div>'
    + '<div class="chat-msg-body"><div class="chat-typing"><span></span><span></span><span></span></div></div>';
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return div;
}

function currentBody() {
  if (!currentMsgEl) return null;
  return currentMsgEl.querySelector('.chat-msg-body');
}

function clearTyping() {
  const body = currentBody();
  if (!body) return;
  const typing = body.querySelector('.chat-typing');
  if (typing) typing.remove();
}

async function streamAgent() {
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatHistory }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      setContent('**' + (err.error || 'HTTP ' + resp.status) + '**');
      finishStream();
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let thinkingText = '';
    let contentText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 解析 SSE 事件
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
          if (event === 'done') {
            chatHistory.push({ role: 'assistant', content: contentText });
            break;
          }
        } catch (e) { /* skip */ }
      }
    }
  } catch (e) {
    setContent('**网络错误**: ' + e.message);
  }
  finishStream();
}

function handleEvent(event, data) {
  switch (event) {
    case 'start':
      break;

    case 'thinking': {
      clearTyping();
      const body = currentBody();
      if (!body) return;
      let el = body.querySelector('.chat-thinking');
      if (!el) {
        el = document.createElement('details');
        el.className = 'chat-thinking';
        el.innerHTML = '<summary>思考中...</summary><div class="chat-thinking-text"></div>';
        body.appendChild(el);
      }
      el.querySelector('.chat-thinking-text').textContent = data.text;
      el.querySelector('summary').textContent = '思考 (' + data.text.length + ' 字)';
      break;
    }

    case 'tool_call': {
      clearTyping();
      const body = currentBody();
      if (!body) return;
      const tc = document.createElement('details');
      tc.className = 'chat-tool-call';
      tc.open = true;
      tc.id = 'tool-' + data.id;
      const argsPreview = typeof data.args === 'object' ? JSON.stringify(data.args, null, 2).slice(0, 300) : String(data.args).slice(0, 300);
      tc.innerHTML = '<summary><span class="mi" style="font-size:.85rem;">terminal</span> <strong>' + data.name + '</strong><span class="tool-args-summary">' + escapeHtml(argsPreview.slice(0, 60)) + '</span></summary>'
        + '<div class="tool-body"><div class="tool-args"><code>' + escapeHtml(argsPreview) + '</code></div>'
        + '<div class="tool-result loading">执行中...</div></div>';
      body.appendChild(tc);
      currentToolEls[data.id] = tc;
      chatMessages.scrollTop = chatMessages.scrollHeight;
      break;
    }

    case 'tool_result': {
      const tc = currentToolEls[data.id];
      if (!tc) return;
      tc.open = false;
      const resultDiv = tc.querySelector('.tool-result');
      if (!resultDiv) return;
      resultDiv.classList.remove('loading');
      const r = data.result;
      let out = '';
      if (r.error) {
        out = '<span class="tool-err">' + escapeHtml(r.error) + '</span>';
        tc.classList.add('tool-error');
      } else if (r.content !== undefined) {
        out = '<pre>' + escapeHtml(r.content.slice(0, 3000)) + '</pre>';
        if (r.truncated) out += '<em>（文件过长，已截断）</em>';
      } else if (r.stdout !== undefined) {
        out = '<pre>' + escapeHtml(r.stdout.slice(0, 3000)) + '</pre>';
        if (r.stderr) out += '<pre class="tool-err">' + escapeHtml(r.stderr.slice(0, 500)) + '</pre>';
        out += '<span class="tool-exit">退出码: ' + (r.exitCode || 0) + '</span>';
      } else if (r.matches !== undefined) {
        out = '<pre>' + escapeHtml(r.matches.slice(0, 3000)) + '</pre>';
      } else if (r.files !== undefined) {
        out = '<pre>' + escapeHtml(r.files) + '</pre>';
      } else if (r.written || r.edited) {
        out = '<span class="tool-ok">✓ ' + (r.written ? '已写入 ' + r.path + ' (' + (r.size || 0) + ' 字节)' : '已编辑 ' + r.path) + '</span>';
      } else {
        out = '<pre>' + escapeHtml(JSON.stringify(r, null, 2).slice(0, 2000)) + '</pre>';
      }
      resultDiv.innerHTML = out;
      chatMessages.scrollTop = chatMessages.scrollHeight;
      break;
    }

    case 'content': {
      clearTyping();
      const body = currentBody();
      if (!body) return;
      let contentDiv = body.querySelector('.chat-content');
      if (!contentDiv) {
        contentDiv = document.createElement('div');
        contentDiv.className = 'chat-content';
        body.appendChild(contentDiv);
      }
      contentDiv.innerHTML = renderMarkdown(data.text);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      break;
    }

    case 'error': {
      clearTyping();
      const body = currentBody();
      if (!body) return;
      let contentDiv = body.querySelector('.chat-content');
      if (!contentDiv) {
        contentDiv = document.createElement('div');
        contentDiv.className = 'chat-content';
        body.appendChild(contentDiv);
      }
      contentDiv.innerHTML = '<strong>错误</strong>: ' + escapeHtml(data.message || '未知错误');
      break;
    }
  }
}

function setContent(html) {
  const body = currentBody();
  if (!body) return;
  clearTyping();
  let contentDiv = body.querySelector('.chat-content');
  if (!contentDiv) {
    contentDiv = document.createElement('div');
    contentDiv.className = 'chat-content';
    body.appendChild(contentDiv);
  }
  contentDiv.innerHTML = html;
}

function finishStream() {
  chatStreaming = false;
  chatSendBtn.disabled = false;
  chatInput.disabled = false;
  chatInput.focus();
  const el = document.getElementById('currentMsg');
  if (el) el.removeAttribute('id');
  currentMsgEl = null;
  currentToolEls = {};
}

// ===== 基础 Markdown =====
function escapeHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

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

  // 列表：连续 li 行包进 ul，去掉前缀标记
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  const lines = html.split('\n');
  let result = '';
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const isLi = lines[i].startsWith('<li>');
    if (isLi && !inList) { result += '<ul>'; inList = true; }
    if (!isLi && inList) { result += '</ul>'; inList = false; }
    result += lines[i];
    if (i < lines.length - 1) result += '\n';
  }
  if (inList) result += '</ul>';
  html = result;

  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  if (!html.startsWith('<')) html = '<p>' + html + '</p>';
  return html;
}

// 输入框自适应
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});
