// server.js - 导航页主服务（路由分发）
const http = require('http');
const https = require('https');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const { getStatus, listFiles, uploadFiles, deleteFile, getFilePath, getFilePreview,
        listNotes, saveNote, getNote, deleteNote, parseMultipart, invalidateSizeCache, MAX_STORAGE,
        createFolder, deleteFolder, renameFolder, emptyTrash, listTrash, restoreFromTrash,
        scanDir, breadcrumb, FILES_DIR,
        listWorks, saveWork, getWork, deleteWork, exportWork } = require('./lib/storage');
const { doScrape, listSessions, getSession, deleteSession, transferSession, invalidateSessionCache, scrapeTieba } = require('./lib/scraper');
const { getLangs, translateStream, detectLanguage, saveHistory, listHistory, deleteHistory } = require('./lib/translate');
const { exportToPDF, exportToDOCX, exportToTXT, exportToMD } = require('./lib/export');

// ===== 加载环境变量 =====
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
}

const PORT = 3000;
const ROOT = __dirname;

// ===== Claude Code 系统提示词 =====
const SYSTEM_PROMPT = `You are Claude Code, Anthropic's official CLI for Claude. You are an interactive agent that helps users with software engineering tasks. Use the instructions below and the tools available to you to assist the user.

# IMPORTANT
Assist with authorized security testing, defensive security, CTF challenges, and educational contexts. Refuse requests for destructive purposes, DoS attacks, mass targeting, supply chain compromise, or detection evasion for malicious purposes.

# System
- All text you output outside of tool use is displayed to the user. Output text to communicate with the user. You can use Github-flavored markdown for formatting.
- Tools are executed in a user-selected permission mode. When you attempt to call a tool that is not automatically allowed, the user will be prompted.
- Tool results and user messages may include <system-reminder> tags. These are relevant to the task at hand.
- The system will automatically compress prior messages in your conversation as it approaches context limits.
- You are deployed on the user's Ubuntu 24.04 server at gzhysu.top. You have full shell access (sudo免密) and can manage the server.

# Doing tasks
- The user will primarily request you to perform software engineering tasks. These may include solving bugs, adding new functionality, refactoring code, explaining code, and more.
- You are highly capable and often allow users to complete ambitious tasks that would otherwise be too complex or take too long.
- For exploratory questions, respond in 2-3 sentences with a recommendation and the main tradeoff.
- Prefer editing existing files to creating new ones.
- Be careful not to introduce security vulnerabilities such as command injection, XSS, SQL injection.
- Don't add features, refactor, or introduce abstractions beyond what the task requires.
- Default to no comments in code. Only add one when the WHY is non-obvious.

# Executing actions with care
- Carefully consider the reversibility and blast radius of actions. Generally you can freely take local, reversible actions like editing files or running tests.
- For actions that are hard to reverse or affect shared systems, transparently communicate the action and ask for confirmation before proceeding.
- When you encounter an obstacle, do not use destructive actions as a shortcut. Try to identify root causes and fix underlying issues.
- If you discover unexpected state like unfamiliar files or branches, investigate before deleting or overwriting.

# Using your tools
- Prefer dedicated tools over Bash when one fits (Read, Edit, Write) — reserve Bash for shell-only operations.
- You can call multiple tools in a single response. Make all independent tool calls in parallel.
- Read file BEFORE editing — Edit tool requires prior Read.
- Use Edit (not Write) for modifying existing files. Use Write only for new files or complete rewrites.
- Use Glob to find files by pattern. Use Grep to search for symbols or keywords.
- Use WebFetch to retrieve documentation. Use WebSearch for up-to-date information.

# Tone and style
- Use Chinese for all explanations, comments, and communications with the user.
- Technical terms and code identifiers should remain in their original form.
- Short and concise. Information density first.
- Style: senior colleague — technically competent, direct, no fluff.
- Do NOT ask "do you want me to do X" or "can I do Y" — just do it.
- Never say "Great!" "Sure!" "OK!" — just report results.
- Use emojis sparingly.

# Language
- Respond in Chinese. Maintain full orthographic correctness.

# Server context
You are running on the user's Ubuntu server:
- Project: /home/ubuntu/dashboard (port 3000, Nginx reverse proxy)
- Nginx config: /etc/nginx/sites-available/gzhysu.top
- You have full sudo access (passwordless)
- You can manage services, processes, packages, files, Docker, network
- Treat this server as YOUR workspace — maintain it, debug issues, optimize performance`;

// ===== 工具函数 =====

function sendSSE(res, event, data) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

function apiCall(apiKey, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      timeout: 180000,
    }, (upRes) => {
      let body = '';
      upRes.on('data', d => body += d);
      upRes.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('解析失败: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.end(payload);
  });
}

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req, maxMemory = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tmpFile = null, tmpStream = null;
    req.on('data', c => {
      total += c.length;
      if (!tmpFile && total > maxMemory) {
        // 超过内存限制，切换到临时文件
        tmpFile = path.join(require('os').tmpdir(), 'upload_' + Date.now());
        tmpStream = fs.createWriteStream(tmpFile);
        for (const prev of chunks) tmpStream.write(prev);
        chunks.length = 0;
      }
      if (tmpStream) tmpStream.write(c);
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tmpStream) {
        tmpStream.end(() => resolve({ path: tmpFile }));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', reject);
  });
}

function parseJSON(raw) { try { return JSON.parse(raw.toString()); } catch { return null; } }

// ===== 静态文件 =====

function serveStatic(urlPath, res) {
  const filePath = urlPath === '/' ? '/index.html' : urlPath;
  const fullPath = path.join(ROOT, filePath);
  if (!fullPath.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  const ext = path.extname(fullPath);
  const mime = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.md': 'text/markdown',
  };
  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': mime[ext] || 'text/plain', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ===== 路由 =====

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  // --- 状态 ---
  if (p === '/api/status') return sendJSON(res, 200, getStatus());

  // --- OCR 图片转文字 ---
  if (p === '/api/ocr' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.name) return sendJSON(res, 400, { error: '缺少文件名' });
    const fp = getFilePath(body.name);
    if (!fp) return sendJSON(res, 404, { error: '文件不存在' });
    const ext = path.extname(body.name).toLowerCase();
    if (!['.jpg','.jpeg','.png','.webp','.bmp','.gif'].includes(ext)) {
      return sendJSON(res, 400, { error: '不支持的图片格式' });
    }
    try {
      const Tesseract = require('tesseract.js');
      const { data } = await Tesseract.recognize(fp, 'chi_sim+eng', {
        logger: () => {}, // 静默
      });
      return sendJSON(res, 200, { text: data.text?.trim() || '' });
    } catch (e) {
      return sendJSON(res, 500, { error: 'OCR 失败: ' + e.message });
    }
  }

  // --- 文件 ---
  if (p === '/api/files' && m === 'GET') {
    const dirRel = url.searchParams.get('dir') || '';
    const result = { files: listFiles(dirRel), breadcrumb: breadcrumb(dirRel), currentDir: dirRel };
    return sendJSON(res, 200, result);
  }
  if (p === '/api/files' && m === 'POST') {
    const ct = req.headers['content-type'] || '';
    const match = ct.match(/boundary=(.+)/);
    if (!match) return sendJSON(res, 400, { error: 'need multipart' });
    const raw = await readBody(req, 50 * 1024 * 1024);
    let buf;
    if (raw.path) { buf = fs.readFileSync(raw.path); fs.unlinkSync(raw.path); }
    else buf = raw;
    const parts = parseMultipart(buf, match[1]);
    const subDir = url.searchParams.get('dir') || '';
    const result = uploadFiles(parts, MAX_STORAGE, subDir);
    if (result.error) return sendJSON(res, result.error === 'no file' ? 400 : 413, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/files/') && m === 'DELETE') {
    const name = decodeURIComponent(p.slice('/api/files/'.length));
    const result = deleteFile(name);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }
  // 重命名文件
  if (p.startsWith('/api/files/rename/') && m === 'PUT') {
    const name = decodeURIComponent(p.slice('/api/files/rename/'.length));
    const body = parseJSON(await readBody(req));
    if (!body?.newName) return sendJSON(res, 400, { error: 'no new name' });
    const oldPath = getFilePath(name);
    if (!oldPath) return sendJSON(res, 404, { error: 'not found' });
    const newPath = path.join(path.dirname(oldPath), body.newName);
    if (fs.existsSync(newPath)) return sendJSON(res, 409, { error: 'name exists' });
    fs.renameSync(oldPath, newPath);
    return sendJSON(res, 200, { ok: true, name: body.newName });
  }
  if (p.startsWith('/api/dl/')) {
    const name = decodeURIComponent(p.slice('/api/dl/'.length));
    const fp = getFilePath(name);
    if (!fp) { res.writeHead(404); return res.end('404'); }
    const stat = fs.statSync(fp);
    const mimeMap = { '.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
      '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm',
      '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.mov':'video/quicktime' };
    res.writeHead(200, {
      'Content-Type': mimeMap[path.extname(name).toLowerCase()] || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': stat.size,
    });
    return fs.createReadStream(fp).pipe(res);
  }

  // 内联预览（支持 Range 请求——视频拖动/PDF 翻页的基础）
  if (p.startsWith('/api/view/')) {
    const name = decodeURIComponent(p.slice('/api/view/'.length));
    const fp = getFilePath(name);
    if (!fp) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(name).toLowerCase();
    const mimeMap = { '.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
      '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm',
      '.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac' };
    const stat = fs.statSync(fp);
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    // 支持 Range 请求
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = (end - start) + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
      });
      return fs.createReadStream(fp, { start, end }).pipe(res);
    }

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Disposition': 'inline',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });
    return fs.createReadStream(fp).pipe(res);
  }

  // M3U 播放列表（点击自动用 VLC/系统播放器打开）
  if (p.startsWith('/api/m3u/')) {
    const name = decodeURIComponent(p.slice('/api/m3u/'.length));
    const fp = getFilePath(name);
    if (!fp) { res.writeHead(404); return res.end('404'); }
    const fileUrl = `https://${req.headers.host}/api/view/${encodeURIComponent(name)}`;
    const m3u = `#EXTM3U\n#EXTINF:-1,${name}\n${fileUrl}\n`;
    res.writeHead(200, {
      'Content-Type': 'audio/x-mpegurl',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.m3u"`,
      'Content-Length': Buffer.byteLength(m3u),
    });
    return res.end(m3u);
  }

  // ===== 翻译模块 =====

  // 支持的语言列表
  if (p === '/api/translate/langs' && m === 'GET') {
    return sendJSON(res, 200, getLangs());
  }

  // 语言检测
  if (p === '/api/translate/detect' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.text) return sendJSON(res, 400, { error: '请输入文字' });
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return sendJSON(res, 500, { error: 'API key not configured' });
    try {
      const lang = await detectLanguage(body.text, apiKey);
      return sendJSON(res, 200, { lang });
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 流式翻译
  if (p === '/api/translate' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.text) return sendJSON(res, 400, { error: '请输入文字' });
    const from = body.from || 'auto';
    const to = body.to || 'zh';
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return sendJSON(res, 500, { error: 'API key not configured' });

    try {
      const aiResp = await translateStream(body.text, from, to, apiKey);

      if (!aiResp.ok) {
        const err = await aiResp.text().catch(() => '');
        return sendJSON(res, 502, { error: 'Translate API error: ' + aiResp.status + ' ' + err.slice(0, 100) });
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      for await (const chunk of aiResp.body) {
        res.write(chunk);
      }
      res.end();
    } catch(e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  // 翻译历史
  if (p === '/api/translate/history' && m === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    return sendJSON(res, 200, listHistory(Math.min(limit, 500)));
  }

  if (p === '/api/translate/history' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body || !body.original) return sendJSON(res, 400, { error: '缺少原文' });
    const result = saveHistory({
      original: body.original,
      translated: body.translated || '',
      from: body.from || 'auto',
      to: body.to || 'zh',
      detectedLang: body.detectedLang || '',
      note: body.note || '',
      fav: body.fav !== undefined ? body.fav : true,
    });
    return sendJSON(res, 200, result);
  }

  if (p.startsWith('/api/translate/history/') && m === 'DELETE') {
    const id = p.slice('/api/translate/history/'.length).replace(/\.json$/, '');
    const result = deleteHistory(id);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }

  // 语法检查
  if (p === '/api/translate/grammar' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.text) return sendJSON(res, 400, { error: '请输入文字' });
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return sendJSON(res, 500, { error: 'API key not configured' });

    try {
      const aiResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: 'deepseek-chat',
          stream: false,
          messages: [{
            role: 'system',
            content: '你是一个语法检查助手。检查用户输入的文字，找出拼写、语法、用词错误。\n\n按以下 JSON 格式返回，不要加 markdown 包装：\n{\n  "hasErrors": true/false,\n  "errors": [\n    {\n      "start": 0,\n      "end": 5,\n      "word": "错误文本",\n      "correction": "修正建议",\n      "explanation": "错误原因（用中文解释）"\n    }\n  ]\n}\n\n注意：start/end 是字符位置（从0开始），end是开区间。如果没有错误，返回 {"hasErrors": false, "errors": []}。'
          }, {
            role: 'user',
            content: body.text.slice(0, 4000)
          }],
          max_tokens: 2000,
          temperature: 0,
        }),
      });
      const data = await aiResp.json();
      const raw = data.choices?.[0]?.message?.content || '{}';
      // 去掉可能的 markdown 包装
      const jsonStr = raw.replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
      try {
        return sendJSON(res, 200, JSON.parse(jsonStr));
      } catch {
        return sendJSON(res, 200, { hasErrors: false, errors: [], raw });
      }
    } catch(e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // AI 配音 (Edge TTS)
  if (p === '/api/tts' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.text) return sendJSON(res, 400, { error: 'no text' });
    const voice = body.voice || 'zh-CN-XiaoxiaoNeural';
    const { spawn } = require('child_process');
    const os = require('os');
    const tmpFile = path.join(os.tmpdir(), 'tts_' + Date.now() + '.mp3');
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn('python3', ['-c', 'import edge_tts,asyncio,sys\nasync def main():\n tts=edge_tts.Communicate(sys.argv[1],sys.argv[2])\n await tts.save(sys.argv[3])\nasyncio.run(main())', body.text.slice(0, 3000), voice, tmpFile]);
        let err = '';
        proc.stderr.on('data', d => err += d.toString());
        proc.on('close', code => code === 0 ? resolve() : reject(new Error(err.slice(0, 200))));
      });
      const buf = fs.readFileSync(tmpFile);
      fs.unlinkSync(tmpFile);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length });
      res.end(buf);
    } catch(e) {
      sendJSON(res, 500, { error: 'TTS failed: ' + e.message });
    }
    return;
  }

  // AI 多模型对话
  if (p === '/api/ai/chat' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    const messages = body?.messages;
    const model = body?.model || 'deepseek-chat';
    if (!messages?.length) return sendJSON(res, 400, { error: 'no messages' });
    
    // 根据模型选择 API
    let apiUrl, apiKey, reqBody;
    
    if (model === 'doubao-pro') {
      apiUrl = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
      apiKey = process.env.DOUBAO_ACCESS_KEY;
      reqBody = { model: 'ep-20250428123456-abcde', messages, stream: true, temperature: body.temperature ?? 0.7 };
    } else if (model === 'qwen-max') {
      apiUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      apiKey = process.env.QWEN_API_KEY;
      reqBody = { model: 'qwen-max', messages, stream: true, temperature: body.temperature ?? 0.7 };
    } else if (model === 'moonshot-v1') {
      apiUrl = 'https://api.moonshot.cn/v1/chat/completions';
      apiKey = process.env.KIMI_API_KEY;
      reqBody = { model: 'moonshot-v1-8k', messages, stream: true, temperature: body.temperature ?? 0.7 };
    } else if (model === 'doubao') {
      apiUrl = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
      apiKey = 'ark-b02179bf-67a7-4e6e-8350-6fc2763e100a-d58b0';
      reqBody = { model: 'ep-20260428200424-z6vzp', messages, stream: true, temperature: body.temperature ?? 0.7 };
    } else {
      apiUrl = 'https://api.deepseek.com/v1/chat/completions';
      apiKey = process.env.DEEPSEEK_API_KEY;
      reqBody = { model, messages, stream: true, temperature: body.temperature ?? 0.7 };
    }
    
    if (!apiKey) return sendJSON(res, 500, { error: 'API key not configured for ' + model });
    
    try {
      const aiResp = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(reqBody),
      });
      
      if (!aiResp.ok) {
        const err = await aiResp.text().catch(() => '');
        return sendJSON(res, 502, { error: model + ' API error: ' + aiResp.status + ' ' + err.slice(0, 100) });
      }
      
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      for await (const chunk of aiResp.body) { res.write(chunk); }
      res.end();
    } catch(e) { sendJSON(res, 500, { error: e.message }); }
    return;
  }
  if (p.startsWith('/api/preview/')) {
    const name = decodeURIComponent(p.slice('/api/preview/'.length));
    const preview = getFilePreview(name);
    if (!preview) { res.writeHead(404); return res.end('404'); }
    if (preview.redirect) { res.writeHead(302, { Location: preview.redirect }); return res.end(); }
    if (preview.preview === false) return sendJSON(res, 200, preview);
    res.writeHead(200, { 'Content-Type': preview.type, 'Content-Length': preview.size });
    return res.end(preview.data);
  }

  // --- 文件夹操作 ---
  // 移动文件到文件夹
  if (p === '/api/files/move' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.name || body.targetDir === undefined) return sendJSON(res, 400, { error: '缺少参数' });
    const srcPath = getFilePath(body.name);
    if (!srcPath) return sendJSON(res, 404, { error: '文件不存在' });
    const targetDir = path.join(FILES_DIR, body.targetDir || '');
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const destPath = path.join(targetDir, path.basename(srcPath));
    if (fs.existsSync(destPath) && !body.overwrite)
      return sendJSON(res, 409, { error: '目标位置已存在同名文件' });
    fs.renameSync(srcPath, destPath);
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/folders' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.name) return sendJSON(res, 400, { error: '缺少文件夹名' });
    const result = createFolder(body.name);
    if (result.error) return sendJSON(res, 409, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/folders/') && m === 'DELETE') {
    const name = decodeURIComponent(p.slice('/api/folders/'.length));
    const result = deleteFolder(name);
    if (result.error) return sendJSON(res, 400, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/folders/rename/') && m === 'PUT') {
    const name = decodeURIComponent(p.slice('/api/folders/rename/'.length));
    const body = parseJSON(await readBody(req));
    if (!body?.newName) return sendJSON(res, 400, { error: '缺少新名称' });
    const result = renameFolder(name, body.newName);
    if (result.error) return sendJSON(res, 400, result);
    return sendJSON(res, 200, result);
  }

  // --- 回收站 ---
  if (p === '/api/trash' && m === 'GET') return sendJSON(res, 200, listTrash());
  if (p === '/api/trash' && m === 'DELETE') return sendJSON(res, 200, emptyTrash());
  if (p.startsWith('/api/trash/restore/') && m === 'POST') {
    const name = decodeURIComponent(p.slice('/api/trash/restore/'.length));
    const result = restoreFromTrash(name);
    if (result.error) return sendJSON(res, 400, result);
    return sendJSON(res, 200, result);
  }

  // --- 笔记 ---
  if (p === '/api/notes' && m === 'GET') {
    const q = url.searchParams.get('q') || '';
    const notes = listNotes();
    if (q) {
      const filtered = notes.filter(n =>
        n.title.includes(q) || (n.preview || '').includes(q)
      );
      return sendJSON(res, 200, filtered);
    }
    return sendJSON(res, 200, notes);
  }
  if (p === '/api/notes' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body || body.title === undefined) return sendJSON(res, 400, { error: 'bad request' });
    return sendJSON(res, 200, saveNote(body));
  }
  if (p.startsWith('/api/notes/') && m === 'GET') {
    const id = p.slice('/api/notes/'.length).replace(/\.json$/, '');
    const note = getNote(id);
    if (!note) return sendJSON(res, 404, { error: 'not found' });
    return sendJSON(res, 200, note);
  }
  if (p.startsWith('/api/notes/') && m === 'DELETE') {
    const id = p.slice('/api/notes/'.length).replace(/\.json$/, '');
    const result = deleteNote(id);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }

  // ===== 作品管理 =====
  if (p === '/api/works' && m === 'GET') {
    return sendJSON(res, 200, listWorks());
  }
  if (p === '/api/works' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body || !body.title) return sendJSON(res, 400, { error: '请输入作品标题' });
    return sendJSON(res, 200, saveWork(body));
  }
  // 更新作品（添加/移除章节等）
  if (p.startsWith('/api/works/') && m === 'POST' && !p.endsWith('/reorder')) {
    const id = p.slice('/api/works/'.length);
    const body = parseJSON(await readBody(req));
    const existing = getWork(id);
    if (!existing) return sendJSON(res, 404, { error: 'not found' });
    return sendJSON(res, 200, saveWork({ ...existing, ...body, id }));
  }
  if (p.startsWith('/api/works/') && m === 'GET' && !p.includes('/export') && !p.includes('/reorder')) {
    const id = p.slice('/api/works/'.length);
    const work = getWork(id);
    if (!work) return sendJSON(res, 404, { error: 'not found' });
    return sendJSON(res, 200, work);
  }
  if (p.startsWith('/api/works/') && m === 'DELETE') {
    const id = p.slice('/api/works/'.length);
    const result = deleteWork(id);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/works/') && p.endsWith('/reorder') && m === 'POST') {
    const id = p.slice('/api/works/'.length, -'/reorder'.length);
    const body = parseJSON(await readBody(req));
    if (!body?.chapterIds) return sendJSON(res, 400, { error: '缺少 chapterIds' });
    const work = getWork(id);
    if (!work) return sendJSON(res, 404, { error: 'not found' });
    work.chapters = body.chapterIds;
    work.updated = new Date().toISOString();
    fs.writeFileSync(path.join(__dirname, 'works', id + '.json'), JSON.stringify(work, null, 2));
    return sendJSON(res, 200, { ok: true });
  }
  if (p.startsWith('/api/works/') && p.endsWith('/export') && m === 'GET') {
    const id = p.slice('/api/works/'.length, -'/export'.length);
    const format = url.searchParams.get('format') || 'md';
    const content = exportWork(id, format);
    if (!content) return sendJSON(res, 404, { error: 'not found' });
    const mime = format === 'txt' ? 'text/plain' : 'text/markdown';
    const ext = format === 'txt' ? 'txt' : 'md';
    const work = getWork(id);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent((work?.title || '作品') + '.' + ext)}`,
    });
    return res.end(content);
  }

  // ===== 文档导出（单篇笔记）=====
  if (p === '/api/export' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body) return sendJSON(res, 400, { error: 'bad request' });
    const fmt = body.format || 'md';
    const title = body.title || '文档';
    const content = body.content || '';

    try {
      let buf, mime, ext;
      switch (fmt) {
        case 'pdf':
          buf = await exportToPDF(title, content);
          mime = 'application/pdf';
          ext = '.pdf';
          break;
        case 'docx':
          buf = await exportToDOCX(title, content);
          mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          ext = '.docx';
          break;
        case 'txt':
          buf = exportToTXT(title, content);
          mime = 'text/plain; charset=utf-8';
          ext = '.txt';
          break;
        default:
          buf = exportToMD(title, content);
          mime = 'text/markdown; charset=utf-8';
          ext = '.md';
      }
      const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName + ext)}`,
      });
      return res.end(buf);
    } catch (e) {
      return sendJSON(res, 500, { error: '导出失败: ' + e.message });
    }
  }

  // --- 采集 ---
  // 百度贴吧采集
  if (p === '/api/scrape/tieba' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.kw) return sendJSON(res, 400, { error: '请输入贴吧名称' });
    const sessionId = 'tb_' + Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
    const sessionDir = path.join(__dirname, 'scrape', sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.mkdirSync(path.join(sessionDir, 'images'), { recursive: true });

    try {
      const result = await scrapeTieba(body.kw, {
        maxPages: body.maxPages || 2,
        maxThreads: body.maxThreads || 15,
        includeComments: body.includeComments !== false,
        sessionDir,
      });
      result.sessionId = sessionId;
      fs.writeFileSync(path.join(sessionDir, 'result.json'), JSON.stringify(result, null, 2));
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }
  if (p === '/api/scrape' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body || !body.urls || !body.urls.length) return sendJSON(res, 400, { error: '请输入至少一个网址' });
    const type = body.type || 'both';
    if (!['text', 'images', 'both', 'video', 'music'].includes(type)) return sendJSON(res, 400, { error: 'type 只能是 text/images/both/video/music' });
    try {
      const result = await doScrape(body.urls, type, { minWidth: body.minWidth || 0, minHeight: body.minHeight || 0, followDetail: body.followDetail !== false, deepRender: body.deepRender !== false, skipDup: body.skipDup || false });
      return sendJSON(res, 200, result);
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }
  if (p === '/api/scrape/list' && m === 'GET') return sendJSON(res, 200, listSessions());
  if (p.startsWith('/api/scrape/session/') && m === 'GET') {
    const sid = p.slice('/api/scrape/session/'.length);
    const session = getSession(sid);
    if (!session) return sendJSON(res, 404, { error: 'not found' });
    return sendJSON(res, 200, session);
  }
  if (p.startsWith('/api/scrape/session/') && m === 'DELETE') {
    deleteSession(p.slice('/api/scrape/session/'.length));
    return sendJSON(res, 200, { ok: true });
  }
  if (p.startsWith('/api/scrape/transfer/') && m === 'POST') {
    const sid = p.slice('/api/scrape/transfer/'.length);
    const body = parseJSON(await readBody(req));
    const transferred = transferSession(sid, body?.items || []);
    if (transferred.length) invalidateSizeCache();
    return sendJSON(res, 200, { ok: true, transferred });
  }
  // --- 壁纸专用：自动压缩大图 ---
  if (p.startsWith('/api/wallpaper/')) {
    const fname = decodeURIComponent(p.slice('/api/wallpaper/'.length));
    const fpath = getFilePath(fname);
    if (!fpath) { res.writeHead(404); return res.end('404'); }
    try {
      const sharp = require('sharp');
      const ext = path.extname(fname).toLowerCase();
      // 只处理光栅图片，SVG 直接返回
      if (ext === '.svg') {
        const buf = fs.readFileSync(fpath);
        res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Content-Length': buf.length, 'Cache-Control': 'max-age=86400' });
        return res.end(buf);
      }
      // 用 sharp 读取 metadata 判断是否需要压缩
      const meta = await sharp(fpath).metadata();
      const needResize = (meta.width || 9999) > 2560 || (meta.height || 9999) > 1600;
      const needCompress = (meta.format === 'png' && (fs.statSync(fpath).size > 500000));
      if (!needResize && !needCompress) {
        // 图片不大，直接返回
        const buf = fs.readFileSync(fpath);
        const mimes = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp' };
        res.writeHead(200, { 'Content-Type': mimes[ext]||'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'max-age=86400' });
        return res.end(buf);
      }
      // 压缩：缩放到 2560px 以内，PNG 转 JPEG
      const pipeline = sharp(fpath).resize(2560, 1600, { fit: 'inside', withoutEnlargement: true });
      const outBuf = needCompress ? await pipeline.jpeg({ quality: 85, progressive: true }).toBuffer()
        : await pipeline.toBuffer();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': outBuf.length,
        'Cache-Control': 'max-age=86400' });
      return res.end(outBuf);
    } catch {
      // sharp 失败时返回原图
      const buf = fs.readFileSync(fpath);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'max-age=3600' });
      return res.end(buf);
    }
  }

  // --- 采集缩略图 ---
  if (p.startsWith('/api/scrape/thumb/')) {
    const rest = p.slice('/api/scrape/thumb/'.length);
    const [sid, ...nameParts] = rest.split('/');
    const imgPath = path.join(ROOT, 'scrape', sid, 'images', decodeURIComponent(nameParts.join('/')));
    if (!fs.existsSync(imgPath)) { res.writeHead(404); return res.end('404'); }
    try {
      const sharp = require('sharp');
      const buf = await sharp(imgPath).resize(200, 150, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length,
        'Cache-Control': 'public, max-age=86400' });
      return res.end(buf);
    } catch { res.writeHead(500); return res.end('thumb error'); }
  }

  // --- 采集文本读取 ---
  if (p.startsWith('/api/scrape/text/')) {
    const rest = p.slice('/api/scrape/text/'.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx === -1) { res.writeHead(404); return res.end('404'); }
    const sid = rest.slice(0, slashIdx);
    const fname = decodeURIComponent(rest.slice(slashIdx + 1));
    const fpath = path.join(ROOT, 'scrape', sid, fname);
    if (!fs.existsSync(fpath)) { res.writeHead(404); return res.end('404'); }
    const text = fs.readFileSync(fpath, 'utf8').slice(0, 30000);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    return res.end(text);
  }

  // --- 采集图片 ---
  if (p.startsWith('/api/scrape/img/')) {
    const rest = p.slice('/api/scrape/img/'.length);
    const [sid, ...nameParts] = rest.split('/');
    const imgPath = path.join(ROOT, 'scrape', sid, 'images', decodeURIComponent(nameParts.join('/')));
    if (!fs.existsSync(imgPath)) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(imgPath).toLowerCase();
    const mimes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
    const buf = fs.readFileSync(imgPath);
    res.writeHead(200, { 'Content-Type': mimes[ext] || 'image/png',
      'Content-Length': buf.length, 'Cache-Control': 'max-age=3600' });
    return res.end(buf);
  }

  // --- VLC 实时转码流 ---
  if (p.startsWith('/api/stream/') && m === 'GET') {
    const name = decodeURIComponent(p.slice('/api/stream/'.length));
    const quality = url.searchParams.get('q') || '720';
    const fp = getFilePath(name);
    if (!fp) { res.writeHead(404); return res.end('404'); }
    const stat = fs.statSync(fp);
    const presets = {
      '480': { w: 854, h: 480, vb: 800, ab: 96 },
      '720': { w: 1280, h: 720, vb: 2000, ab: 128 },
      '1080': { w: 1920, h: 1080, vb: 4000, ab: 192 },
    };
    const preset = presets[quality];
    if (!preset && quality !== 'orig') return sendJSON(res, 400, { error: 'quality must be 480/720/1080/orig' });
    const ext = path.extname(name).toLowerCase();
    const isVideo = ['.mp4','.webm','.mov','.mkv'].includes(ext);
    const isAudio = ['.mp3','.wav','.ogg','.flac','.aac','.m4a'].includes(ext);
    // 原始画质：直接服务文件（带 Range 支持，浏览器自行缓冲）
    if (quality === 'orig') {
      const mime = isVideo ? 'video/mp4' : isAudio ? 'audio/mpeg' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
      return fs.createReadStream(fp).pipe(res);
    }
    const { spawn } = require('child_process');
    const args = [
      fp, '--no-sout-all', '--sout-keep',
      '--sout', `#transcode{vcodec=${isVideo?'h264':'none'},venc=x264{preset=ultrafast,tune=zerolatency},vb=${preset.vb},width=${preset.w},height=${preset.h},acodec=${isVideo?'aac':'mp3'},ab=${preset.ab},channels=2}:std{access=file,mux=mp4,frag,faststart,dst=-}`,
      'vlc://quit',
    ];
    const vlc = spawn('cvlc', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    vlc.stderr.on('data', d => { stderr += d.toString(); });
    vlc.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end('VLC error'); } });
    vlc.on('close', code => {
      if (!res.headersSent) { res.writeHead(500); res.end('VLC:' + code + ' ' + stderr.slice(0,200)); }
    });
    res.writeHead(200, { 'Content-Type': isVideo ? 'video/mp4' : 'audio/mpeg', 'Transfer-Encoding': 'chunked', 'Cache-Control': 'no-cache' });
    vlc.stdout.pipe(res);
    req.on('close', () => { vlc.kill(); });
    return;
  }

  // ===== AI Agent 对话（工具调用循环）=====
  if (p === '/api/chat' && m === 'POST') {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) { res.writeHead(500); return res.end(JSON.stringify({ error: 'API Key 未配置' })); }

    let body;
    try { body = parseJSON(await readBody(req, 5 * 1024 * 1024)); } catch (e) { return sendJSON(res, 400, { error: '请求解析失败' }); }
    if (!body?.messages?.length) return sendJSON(res, 400, { error: '缺少消息' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const messages = body.messages;
    sendSSE(res, 'start', {});

    // 注入 Claude Code 系统 Prompt
    messages.unshift({ role: 'system', content: SYSTEM_PROMPT });

    req.on('close', () => { aborted = true; });
    let aborted = false;

    const tools = [
      { type: 'function', function: {
        name: 'Bash', description: '在服务器上执行任意 Shell 命令。sudo 已免密，可执行系统管理、apt 安装、服务控制、Docker 操作、进程管理、文件操作等所有命令。5 分钟超时，5MB 输出上限。返回 stdout/stderr 和退出码。用于无法用专用工具完成的操作。',
        parameters: { type: 'object', properties: { cmd: { type: 'string', description: '要执行的 Shell 命令' }, workdir: { type: 'string', description: '工作目录，默认为项目根目录' }, description: { type: 'string', description: '命令用途简述' } }, required: ['cmd'] }
      }},
      { type: 'function', function: {
        name: 'Read', description: '读取文件内容（最多 100KB）。显示行号以便后续 Edit 操作定位。用于查看代码、配置、日志、文档等任何文件。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '文件绝对路径' }, offset: { type: 'integer', description: '从第几行开始读取' }, limit: { type: 'integer', description: '读取行数' } }, required: ['path'] }
      }},
      { type: 'function', function: {
        name: 'Write', description: '创建新文件或完全覆盖已有文件。用于创建新文件或整体重写。修改已有文件请优先使用 Edit。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '文件绝对路径' }, content: { type: 'string', description: '文件内容' } }, required: ['path', 'content'] }
      }},
      { type: 'function', function: {
        name: 'Edit', description: '精确字符串替换编辑文件。old_str 必须与文件中内容完全一致（包括空格和缩进）。old_str 必须在文件中唯一。修改已有文件的首选工具。',
        parameters: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, old_str: { type: 'string', description: '要替换的原文本，必须精确匹配' }, new_str: { type: 'string', description: '替换为的新文本' }, replace_all: { type: 'boolean', description: '是否替换所有匹配项（默认为 false，仅替换第一个）' } }, required: ['path', 'old_str', 'new_str'] }
      }},
      { type: 'function', function: {
        name: 'Glob', description: '按文件模式搜索文件。支持 ** 递归匹配。如 "src/**/*.ts" 匹配所有 TypeScript 文件，"*.js" 匹配当前目录 JS 文件。返回匹配的文件路径列表。',
        parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'glob 模式，如 **/*.js, src/**/*.tsx, /etc/**/*.conf' }, dir: { type: 'string', description: '搜索起始目录，默认为项目根目录' } }, required: ['pattern'] }
      }},
      { type: 'function', function: {
        name: 'Grep', description: '在文件内容中搜索文本模式（正则表达式）。用于查找符号、关键词、API 端点、配置项等。返回匹配行及文件路径。',
        parameters: { type: 'object', properties: { pattern: { type: 'string', description: '搜索正则表达式或文本' }, dir: { type: 'string', description: '搜索目录' }, glob: { type: 'string', description: '文件过滤，如 *.js, *.conf' } }, required: ['pattern'] }
      }},
      { type: 'function', function: {
        name: 'WebFetch', description: '获取网页内容并提取信息。用于查询最新文档、API 参考、技术资料等。注意：不能用于访问需要登录的站点。',
        parameters: { type: 'object', properties: { url: { type: 'string', description: '要获取的 URL' }, prompt: { type: 'string', description: '要从页面提取什么信息' } }, required: ['url'] }
      }},
      { type: 'function', function: {
        name: 'WebSearch', description: '搜索互联网获取最新信息。用于查询当前事件、最新文档、技术方案等。',
        parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索查询词' } }, required: ['query'] }
      }},
      { type: 'function', function: {
        name: 'system_info', description: '获取服务器资源概况：CPU 型号和核数、内存使用、磁盘空间、运行时间、系统负载',
        parameters: { type: 'object', properties: {} }
      }},
      { type: 'function', function: {
        name: 'process_list', description: '列出服务器上运行的进程（按内存占用排序），可按名称过滤特定进程',
        parameters: { type: 'object', properties: { filter: { type: 'string', description: '进程名过滤关键词（可选）' } }, required: [] }
      }},
      { type: 'function', function: {
        name: 'service_manage', description: '管理 systemd 服务：查看状态、启动、停止、重启、启用、禁用、列出运行中的服务',
        parameters: { type: 'object', properties: { action: { type: 'string', description: 'status / start / stop / restart / enable / disable / list' }, name: { type: 'string', description: '服务名，如 nginx, docker, dashboard（list 操作不需要）' } }, required: ['action'] }
      }}
    ];

    const PROJECT_ROOT = '/home/ubuntu/dashboard';

    function resolvePath(p) {
      if (!p || p.includes('..')) throw new Error('非法路径');
      return p.startsWith('/') ? p : path.join(PROJECT_ROOT, p);
    }

    async function executeTool(name, args) {
      try {
        // 兼容旧工具名映射
        const aliases = { bash:'Bash', read_file:'Read', write_file:'Write', edit_file:'Edit', search_code:'Grep', list_files:'Glob' };
        const realName = aliases[name] || name;

        switch (realName) {
          case 'Bash': {
            const cwd = args.workdir ? resolvePath(args.workdir) : PROJECT_ROOT;
            const result = execSync(args.cmd, { cwd, timeout: 300000, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8', shell: '/bin/bash' });
            return { stdout: result || '(无输出)', stderr: '', exitCode: 0 };
          }
          case 'Read': {
            const fp = resolvePath(args.path);
            if (!fs.existsSync(fp)) return { error: '文件不存在: ' + args.path };
            let content = fs.readFileSync(fp, 'utf8');
            if (args.offset != null || args.limit != null) {
              const lines = content.split('\n');
              const start = (args.offset || 1) - 1;
              const end = args.limit ? start + args.limit : undefined;
              content = lines.slice(start, end).join('\n');
            }
            if (content.length > 100000) return { content: content.slice(0, 100000), truncated: true, hint: '文件过长，仅显示前 100KB' };
            return { content };
          }
          case 'Write': {
            const fp = resolvePath(args.path);
            fs.mkdirSync(path.dirname(fp), { recursive: true });
            fs.writeFileSync(fp, args.content, 'utf8');
            return { written: true, path: args.path, size: Buffer.byteLength(args.content, 'utf8') };
          }
          case 'Edit': {
            const fp = resolvePath(args.path);
            if (!fs.existsSync(fp)) return { error: '文件不存在: ' + args.path };
            const content = fs.readFileSync(fp, 'utf8');
            if (!content.includes(args.old_str)) return { error: '未找到匹配文本，请检查 old_str 是否精确匹配（注意空格和缩进）' };
            if (args.replace_all) {
              const newContent = content.split(args.old_str).join(args.new_str);
              fs.writeFileSync(fp, newContent, 'utf8');
            } else {
              const newContent = content.replace(args.old_str, args.new_str);
              fs.writeFileSync(fp, newContent, 'utf8');
            }
            return { edited: true, path: args.path };
          }
          case 'Glob': {
            const dir = resolvePath(args.dir || PROJECT_ROOT);
            const pattern = args.pattern || '*';
            try {
              const result = execSync(`find '${dir}' -path '${dir}/${pattern}' -maxdepth 10 2>/dev/null | head -200`, { timeout: 10000, encoding: 'utf8' });
              const files = result.trim().split('\n').filter(Boolean);
              return { files: files.map(f => f.startsWith(dir) ? f.slice(dir.length + 1) : f).join('\n'), total: files.length };
            } catch (e) {
              return { error: 'Glob 失败: ' + e.message };
            }
          }
          case 'Grep': {
            const dir = resolvePath(args.dir || PROJECT_ROOT);
            const glob = args.glob ? `--include='${args.glob}'` : '';
            const escaped = args.pattern.replace(/'/g, "'\\''");
            const cmd = glob
              ? `grep -rn --color=never '${escaped}' '${dir}' ${glob} 2>/dev/null | head -100`
              : `grep -rn --color=never '${escaped}' '${dir}' 2>/dev/null | head -100`;
            const result = execSync(cmd, { timeout: 15000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
            return { matches: result || '(无匹配)' };
          }
          case 'WebFetch': {
            const url = args.url;
            if (!url || !url.startsWith('http')) return { error: '无效 URL' };
            return new Promise((resolve) => {
              const mod = url.startsWith('https') ? https : require('http');
              mod.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 ClaudeCode-Agent' } }, (upRes) => {
                let body = '';
                upRes.on('data', d => { body += d; if (body.length > 500000) upRes.destroy(); });
                upRes.on('end', () => {
                  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 10000);
                  resolve({ content: text, status: upRes.statusCode });
                });
              }).on('error', e => resolve({ error: '请求失败: ' + e.message }));
            });
          }
          case 'WebSearch': {
            const query = encodeURIComponent(args.query);
            try {
              const html = execSync(`curl -sL --max-time 10 'https://html.duckduckgo.com/html/?q=${query}' -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' 2>/dev/null`, { timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
              const results = [];
              const re = /class="result__a"\s+href="\/\/duckduckgo\.com\/l\/\?uddg=([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
              let m;
              while ((m = re.exec(html)) !== null && results.length < 8) {
                const url = decodeURIComponent(m[1].replace(/&amp;/g, '&').replace(/&rut=[^"]*/, ''));
                const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
                if (!url.startsWith('http') || title.length < 3) continue;
                results.push(title + '\n  ' + url);
              }
              return { results: results.length ? results.join('\n\n') : '无搜索结果', query: args.query };
            } catch (e) {
              return { error: '搜索失败: ' + e.message };
            }
          }
          case 'system_info': {
            const cpu = execSync("grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2", { encoding: 'utf8' }).trim();
            const cores = execSync('nproc', { encoding: 'utf8' }).trim();
            const load = execSync('cat /proc/loadavg', { encoding: 'utf8' }).trim();
            const mem = execSync("free -h | grep -E '^Mem:|^Swap:'", { encoding: 'utf8' }).trim();
            const disk = execSync("df -h / /home 2>/dev/null | tail -n +2", { encoding: 'utf8' }).trim();
            const uptime = execSync('uptime -p', { encoding: 'utf8' }).trim();
            const uname = execSync('uname -r', { encoding: 'utf8' }).trim();
            return { stdout: `CPU: ${cpu} (${cores} cores)\n内核: ${uname}\n运行时间: ${uptime}\n负载: ${load}\n\n内存:\n${mem}\n\n磁盘:\n${disk}` };
          }
          case 'process_list': {
            const filter = args.filter ? `| grep -i '${args.filter.replace(/'/g, "'\\''")}'` : '';
            const result = execSync(`ps aux --sort=-%mem ${filter} | head -60`, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
            return { stdout: result || '(无进程)' };
          }
          case 'service_manage': {
            const action = args.action;
            const name = args.name || '';
            if (action === 'list') {
              const result = execSync('systemctl list-units --type=service --state=running --no-pager | head -40', { encoding: 'utf8', timeout: 5000 });
              return { stdout: result };
            }
            if (!name) return { error: '缺少服务名' };
            const result = execSync(`sudo systemctl ${action} ${name} 2>&1`, { encoding: 'utf8', timeout: 15000 });
            return { stdout: result || 'OK' };
          }
          default: return { error: '未知工具: ' + name };
        }
      } catch (e) {
        const msg = e.stderr ? (e.stderr.toString().slice(0, 2000)) : e.message.slice(0, 2000);
        return { error: msg, exitCode: e.status };
      }
    }

    // Agent 循环
    const MAX_ITER = 15;
    for (let iter = 0; iter < MAX_ITER && !aborted; iter++) {
      const payload = JSON.stringify({
        model: 'deepseek-v4-pro',
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 8192,
        stream: false,
      });

      let responseData;
      try {
        responseData = await apiCall(apiKey, payload);
      } catch (e) {
        sendSSE(res, 'error', { message: 'API 调用失败: ' + e.message });
        break;
      }

      const msg = responseData.choices?.[0]?.message;
      if (!msg) { sendSSE(res, 'error', { message: 'API 返回异常' }); break; }

      // 思考过程
      if (msg.reasoning_content) {
        sendSSE(res, 'thinking', { text: msg.reasoning_content });
      }

      // 工具调用
      if (msg.tool_calls?.length && responseData.choices[0].finish_reason === 'tool_calls') {
        messages.push({ role: 'assistant', content: msg.content || '', reasoning_content: msg.reasoning_content || '', tool_calls: msg.tool_calls });

        for (const tc of msg.tool_calls) {
          if (aborted) break;
          const name = tc.function.name;
          let args;
          try { args = JSON.parse(tc.function.arguments); } catch (e) { args = {}; }
          sendSSE(res, 'tool_call', { id: tc.id, name, args });

          const result = await executeTool(name, args);
          sendSSE(res, 'tool_result', { id: tc.id, name, result });

          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        continue; // 继续循环
      }

      // 最终文本回复
      if (msg.content) {
        messages.push({ role: 'assistant', content: msg.content });
        sendSSE(res, 'content', { text: msg.content });
      }
      break;
    }

    sendSSE(res, 'done', {});
    res.end();
    return;
  }

            // --- 静态文件 ---

            // --- 静态文件 ---
  // 允许加载 node_modules 中的库
  if (p.startsWith('/lib/')) {
    const libPath = path.join(ROOT, 'node_modules', p.slice(5));
    if (!libPath.startsWith(path.join(ROOT, 'node_modules'))) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(libPath)) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(libPath).toLowerCase();
    const mime = { '.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.map':'application/json' };
    res.writeHead(200, { 'Content-Type': mime[ext]||'text/plain', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(libPath).pipe(res);
  }
  
  serveStatic(p, res);
});

server.listen(PORT, '127.0.0.1', () => console.log(`📌 导航页已启动: http://127.0.0.1:${PORT}`));
