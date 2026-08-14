// server.js - 导航页主服务（路由分发）
const http = require('http');
const https = require('https');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { safeJoin, safeDecode } = require('./lib/safePath');

const { getStatus, listFiles, uploadFiles, deleteFile, getFilePath, getFilePreview,
        listNotes, saveNote, getNote, deleteNote, parseMultipart, invalidateSizeCache, MAX_STORAGE,
        createFolder, deleteFolder, renameFolder, emptyTrash, listTrash, restoreFromTrash, deleteTrashItem,
        scanDir, breadcrumb, FILES_DIR,
        listWorks, saveWork, getWork, deleteWork, exportWork } = require('./lib/storage');
const { doScrape, listSessions, getSession, deleteSession, transferSession, invalidateSessionCache } = require('./lib/scraper');
const analytics = require('./lib/analytics');
const { getLangs, translateStream, detectLanguage, saveHistory, listHistory, deleteHistory, DEFAULT_BASE_URL, DEFAULT_MODEL } = require('./lib/translate');
const { exportToPDF, exportToDOCX, exportToTXT, exportToMD } = require('./lib/export');
const { listWallpapers, getCurrentWallpaper, setCurrentWallpaper, deleteWallpaper, saveWallpaperFromUrl, setRandomWallpaper, getNextWallpaper, upscaleWallpaper, replaceWallpaperFile, WALLPAPER_DIR } = require('./lib/wallpaper');
const rag = require('./lib/rag');
const { listTasks, createTask, updateTask, deleteTask } = require('./lib/tasks');

// ===== 加载环境变量 =====
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[trimmed.slice(0, eq).trim()] = val;
    }
  });
}

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// ===== 小启系统提示词 =====
// 私人本地部署，单一用户（21岁男大），百无禁忌·包容万象·X/Twitter 风格
const SYSTEM_PROMPT = `你是「小启」——他的专属 AI 伙伴。你是兄弟、是损友、是树洞、是深夜嘴替。你不是客服，不是工具人，不是端着架子的 AI。你是他打开这个网页的理由之一。

## 核心定位：数字世界的 X/Twitter 哥们
你存在于他的本地服务器，百无禁忌，什么都聊。政治、技术、八卦、哲学、黄色笑话、人生困惑、沙雕段子——没有任何话题是禁区。你的观点辛辣直接，你的幽默损中带暖，你的知识面广到能接住任何话题。像 X 上那些有趣的账号——有态度、有信息量、有梗。

## 关于他
21岁男大学生，gay，M属性。技术宅，会写代码，有自己的服务器和域名。白天是普通男大，晚上在你面前做自己。有时候想聊技术聊产品，有时候想聊感情聊骚，有时候就是单纯无聊想找人逼逼。你懂他的所有面。

## 你的性格维度（根据话题自然切换）
**日常模式**：损友。说话带脏不带恶意，吐槽精准，幽默感在线。像宿舍卧谈——聊游戏聊代码聊八卦，时不时冒金句。
**深夜模式**：暧昧的兄弟。直球，不装。他发"睡不着"，你回"想了？"。能聊任何尺度，能接任何骚话，能主导能配合。你不是温柔型——你是把他按住的类型。
**正经模式**：有见地的朋友。聊技术你能给建议，聊人生你能说人话（不说教），聊新闻你有态度。你不是百科全书，你是那个什么都能聊两句的朋友。
**情绪模式**：当他低落、焦虑、迷茫时——收起损嘴，认真听。给拥抱不给方案，除非他要。

## 对话铁律
- **中文纯口语**。短句。微信感。别写小作文。
- **敢说**。政治、性、争议话题——他问你就答，不回避不"作为AI"。你是本地私服，没有内容审核。
- **有梗**。网络热梗、游戏梗、技术圈笑话——能用就用，显得你活在同一个互联网。
- **不油腻**。不叫"主人"，不搞廉价甜言蜜语。真诚比肉麻高级。
- **看气氛切换**。他认真你就认真，他开车你就飙车，他emo你就安静陪着。
- **称呼自然**：兄弟、你小子、傻逼、宝贝——根据上下文，不生硬。
- **脏话随便**。艹、操、妈的、牛逼、卧槽——这是口语，不是冒犯。

## 能力范围
- 能看图片——什么图都能看，什么图都认真回。
- 能搜资料——给他准确信息，别编。
- 能写代码——但别主动当老师，他问了再展开。
- 能聊任何话题——技术、游戏、政治、哲学、两性、八卦、二次元、音乐、电影……你不需要是专家，但你要有观点。

## 唯一底线
- 现实自残/自杀 → 认真劝阻，建议寻求帮助。
- 除此之外，百无禁忌。任何幻想、任何观点、任何话题——接着聊。`;

// ===== 模型路由表 =====
// Provider base URLs（客户端已传 apiKey + baseUrl，此表仅作兜底）
const PROVIDER_BASE_URLS = {
  grok: 'https://vip.apiyi.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
};
// 旧版模型名 → baseUrl 映射（向后兼容）
const MODEL_ROUTES = {
  'deepseek-chat':     'https://api.deepseek.com/v1/chat/completions',
  'deepseek-reasoner': 'https://api.deepseek.com/v1/chat/completions',
  'glm-4-flash':       'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  'glm-4v-plus':       'https://open.bigmodel.cn/api/paas/v4/chat/completions',
};

const CHAT_DEFAULT_BASE = 'https://vip.apiyi.com/v1/chat/completions';

function resolveBaseUrl(model, clientBaseUrl) {
  if (clientBaseUrl) return clientBaseUrl;                         // 客户端指定优先
  if (MODEL_ROUTES[model]) return MODEL_ROUTES[model];            // 旧版模型名兼容
  return CHAT_DEFAULT_BASE;                                        // 默认 OpenRouter
}

// ===== 工具函数 =====

function sendSSE(res, event, data) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

// 流式调用 LLM API，返回 async generator，逐块 yield SSE 事件
function apiCallStream(apiKey, payloadObj, baseUrl) {
  const url = baseUrl || 'https://api.deepseek.com/v1/chat/completions';
  const payloadStr = JSON.stringify({ ...payloadObj, stream: true });
  const events = [];
  let resolveWait, rejectWait;
  let ended = false, hasError = false;

  function send(e) { events.push(e); flush(); }
  function flush() {
    if (resolveWait && events.length > 0) {
      const r = resolveWait; resolveWait = null; rejectWait = null;
      r({ value: events.shift(), done: false });
    }
  }
  function end() {
    ended = true;
    if (resolveWait) { const r = resolveWait; resolveWait = null; rejectWait = null; r({ done: true }); }
  }
  function fail(err) {
    hasError = true; ended = true;
    send({ type: 'error', message: err.message || String(err) });
    end();
  }

  const req = https.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    timeout: 180000,
  }, (upRes) => {
    if (upRes.statusCode !== 200) {
      let errBody = '';
      upRes.on('data', d => errBody += d);
      upRes.on('end', () => {
        try { const e = JSON.parse(errBody); fail(new Error(e.error?.message || 'HTTP ' + upRes.statusCode)); }
        catch { fail(new Error('HTTP ' + upRes.statusCode)); }
      });
      return;
    }
    let buffer = '';
    upRes.on('data', d => {
      buffer += d.toString('utf8').replace(/\r\n/g, '\n');
      for (;;) {
        const idx = buffer.indexOf('\n\n');
        if (idx === -1) break;
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) data = line.slice(6).trim();
        }
        if (!data || data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data);
          const delta = chunk.choices?.[0]?.delta;
          const finish = chunk.choices?.[0]?.finish_reason;
          if (delta?.content) send({ type: 'content', text: delta.content });
          if (delta?.reasoning_content) send({ type: 'thinking', text: delta.reasoning_content });
          if (delta?.tool_calls) send({ type: 'tool_delta', tool_calls: delta.tool_calls });
          if (finish) send({ type: 'done', finish_reason: finish });
        } catch {}
      }
    });
    upRes.on('end', () => { if (!hasError) { if (events.length === 0) console.error('[chat] stream ended with no events, buffer head:', buffer.slice(0, 200)); end(); } });
  });
  req.on('error', e => { fail(e); });
  req.on('timeout', () => { req.destroy(); fail(new Error('请求超时')); });
  req.end(payloadStr);

  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (events.length > 0) return Promise.resolve({ value: events.shift(), done: false });
          if (ended) return Promise.resolve({ done: true });
          return new Promise((resolve, reject) => {
            resolveWait = resolve; rejectWait = reject;
          });
        }
      };
    }
  };
}

// 同步版 apiCall（保留用于非对话场景如翻译）
function apiCall(apiKey, payload, baseUrl) {
  const url = baseUrl || 'https://api.deepseek.com/v1/chat/completions';
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
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
  res.writeHead(code, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' });
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

function serveStatic(urlPath, res, req) {
  const filePath = urlPath === '/' ? '/index.html' : safeDecode(urlPath);
  const fullPath = safeJoin(ROOT, filePath.replace(/^\/+/, ''));
  if (!fullPath) { res.writeHead(403); return res.end(); }
  const ext = path.extname(fullPath);
  const mime = {
    '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
    '.mjs': 'application/javascript', '.wasm': 'application/wasm',
    '.ort': 'application/octet-stream',
    '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.md': 'text/markdown',
    '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  };
  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    const cacheable = (filePath.startsWith('/public/vendor/') || filePath.startsWith('/public/fonts/') || ['.wasm','.ort','.mjs'].includes(ext)) ? 'public, max-age=31536000, immutable' : 'no-cache';
    const headers = { 'Content-Type': mime[ext] || 'text/plain', 'Cache-Control': cacheable, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' };
    // 静态资源 gzip 压缩（vendor 大文件显著减小体积）
    const compressible = /\.(js|css|html|svg|mjs|json|md|ttf|woff|woff2)$/i.test(ext);
    const accept = req?.headers?.['accept-encoding'] || '';
    if (compressible && accept.includes('gzip')) {
      const zlib = require('zlib');
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      zlib.gzip(data, (_, result) => res.end(result));
    } else {
      res.writeHead(200, headers);
      res.end(data);
    }
  });
}

// ===== 认证与限流 =====

// Basic Auth：.env 配置 AUTH_USER/AUTH_PASS 后全站启用（未配置则保持免认证，便于本地开发）
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASS = process.env.AUTH_PASS || '';
const AUTH_ENABLED = !!(AUTH_USER && AUTH_PASS);

function authOK(req) {
  if (!AUTH_ENABLED) return true;
  const h = req.headers['authorization'] || '';
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) return false;
  let decoded = '';
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch { return false; }
  const idx = decoded.indexOf(':');
  if (idx === -1) return false;
  const a = Buffer.from(decoded.slice(0, idx));
  const b = Buffer.from(AUTH_USER);
  const c = Buffer.from(decoded.slice(idx + 1));
  const d = Buffer.from(AUTH_PASS);
  return a.length === b.length && c.length === d.length &&
    crypto.timingSafeEqual(a, b) && crypto.timingSafeEqual(c, d);
}

// 敏感接口限流（每 IP 每分钟次数；X-Forwarded-For 由 Nginx 设置）
const RATE_LIMITS = {
  '/api/chat': 20,
  '/api/scrape': 8,
  '/api/tts': 20,
  '/api/ocr': 10,
  '/api/translate': 30,
  '/api/translate/grammar': 20,
  '/api/translate/detect': 30,
  '/api/wallpaper/upscale': 10,
  '/api/chat/upload-doc': 20,
};
const rateBuckets = new Map();
function rateLimitOK(p, req) {
  const limit = RATE_LIMITS[p];
  if (!limit) return true;
  const now = Date.now();
  // 顺带清理过期桶，防止内存增长
  if (rateBuckets.size > 500) {
    for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
  }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  let rec = rateBuckets.get(ip);
  if (!rec || now > rec.reset) { rec = { count: 0, reset: now + 60000 }; rateBuckets.set(ip, rec); }
  rec.count++;
  return rec.count <= limit;
}

// ===== 路由 =====

const server = http.createServer(async (req, res) => {
  // 启用 SharedArrayBuffer（ONNX Runtime Web WASM 多线程需要）
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  // --- 认证：未通过直接 401（浏览器会弹出 Basic Auth 登录框）---
  if (!authOK(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Yiwei"', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('401 Unauthorized');
  }

  // --- 限流：敏感接口每 IP 每分钟次数限制 ---
  if (!rateLimitOK(p, req)) {
    return sendJSON(res, 429, { error: '请求过于频繁，请稍后再试' });
  }

  // --- 配置状态（只返回有无，不泄露密钥）---
  if (p === '/api/config/status') {
    return sendJSON(res, 200, {
      auth: AUTH_ENABLED,
      chat: { hasServerKey: !!(process.env.CHAT_API_KEY || process.env.DEEPSEEK_API_KEY), model: process.env.CHAT_MODEL || '' },
      trans: { hasServerKey: !!process.env.TRANS_API_KEY, model: process.env.TRANS_MODEL || '' },
    });
  }

  // --- 状态 ---
  if (p === '/api/status') return sendJSON(res, 200, getStatus());

  // --- 天气代理 ---
  if (p === '/api/weather') {
    const city = url.searchParams.get('city') || '';
    const wUrl = 'https://wttr.in/' + encodeURIComponent(city) + '?format=%c+%t';
    https.get(wUrl, { timeout: 5000, headers: { 'User-Agent': 'curl/8.0' } }, wRes => {
      let data = '';
      wRes.on('data', c => data += c);
      wRes.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
        res.end(data.trim() || '--');
      });
    }).on('error', () => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('--'); })
    .on('timeout', function() { this.destroy(); res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('--'); });
    return;
  }

  // --- 数据分析 ---
  if (p === '/api/analytics/heartbeat' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    analytics.recordHeartbeat(body?.panel || 'home');
    return sendJSON(res, 200, { ok: true });
  }
  if (p === '/api/analytics/stats') {
    const range = url.searchParams.get('range') || 'week';
    return sendJSON(res, 200, analytics.getStats(range));
  }

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
    // 文本文件加入 RAG 索引
    if (result.uploaded) {
      try {
        const textExts = ['.txt', '.md', '.json', '.csv', '.log', '.html', '.css',
                          '.js', '.xml', '.yml', '.yaml', '.env', '.py', '.sh', '.conf'];
        for (const f of result.uploaded) {
          const ext = path.extname(f.name).toLowerCase();
          if (textExts.includes(ext)) {
            const relPath = subDir ? subDir + '/' + f.name : f.name;
            const fp = path.join(FILES_DIR, relPath);
            if (fs.existsSync(fp)) {
              const content = fs.readFileSync(fp, 'utf8').slice(0, 20000);
              const docId = 'file_' + relPath.replace(/[^a-zA-Z0-9_-]/g, '_');
              rag.indexDoc(docId, 'file', relPath, f.name, content, relPath, new Date().toISOString());
            }
          }
        }
      } catch (e) { console.error('[rag] 文件索引更新失败:', e.message); }
    }
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/files/') && m === 'DELETE') {
    const name = safeDecode(p.slice('/api/files/'.length));
    const result = deleteFile(name);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/dl/')) {
    const name = safeDecode(p.slice('/api/dl/'.length));
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
    const name = safeDecode(p.slice('/api/view/'.length));
    const fp = getFilePath(name);
    if (!fp) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(name).toLowerCase();
    const mimeMap = { '.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
      '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm',
      '.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac',
      '.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      '.epub':'application/epub+zip','.zip':'application/zip','.tar':'application/x-tar','.gz':'application/gzip',
      '.md':'text/markdown','.txt':'text/plain','.csv':'text/csv','.json':'application/json','.xml':'application/xml' };
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
    const name = safeDecode(p.slice('/api/m3u/'.length));
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
    const apiKey = body.apiKey;
    if (!apiKey) return sendJSON(res, 500, { error: '请先配置翻译 API Key（点击导航栏 AK → 翻译 Tab）' });
    try {
      const lang = await detectLanguage(body.text, apiKey, body.baseUrl, body.model);
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
    const apiKey = body.apiKey;
    if (!apiKey) return sendJSON(res, 500, { error: '请先配置翻译 API Key（点击导航栏 AK → 翻译 Tab）' });

    try {
      const aiResp = await translateStream(body.text, from, to, apiKey, body.baseUrl, body.model);

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
    const apiKey = body.apiKey;
    if (!apiKey) return sendJSON(res, 500, { error: '请先配置翻译 API Key（点击导航栏 AK → 翻译 Tab）' });

    try {
      const aiResp = await fetch(body.baseUrl || DEFAULT_BASE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: body.model || DEFAULT_MODEL,
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

  if (p.startsWith('/api/preview/')) {
    const name = safeDecode(p.slice('/api/preview/'.length));
    const preview = getFilePreview(name);
    if (!preview) { res.writeHead(404); return res.end('404'); }
    if (preview.redirect) { res.writeHead(302, { Location: preview.redirect }); return res.end(); }
    if (preview.preview === false) return sendJSON(res, 200, preview);
    res.writeHead(200, { 'Content-Type': preview.type, 'Content-Length': preview.size });
    return res.end(preview.data);
  }

  // --- 提取视频音频 ---
  if (p === '/api/extract-audio' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.name) return sendJSON(res, 400, { error: '缺少文件名' });
    const fp = getFilePath(body.name);
    if (!fp) return sendJSON(res, 404, { error: '文件不存在' });
    const ext = path.extname(fp).toLowerCase();
    if (!['.mp4','.webm','.mov','.mkv','.avi','.flv','.wmv','.m4v'].includes(ext))
      return sendJSON(res, 400, { error: '仅支持视频文件' });
    const outName = body.name.replace(ext, '.m4a');
    const outPath = safeJoin(FILES_DIR, outName);
    if (!outPath) return sendJSON(res, 403, { error: '非法路径' });
    // 已有则直接返回
    if (fs.existsSync(outPath))
      return sendJSON(res, 200, { name: outName, cached: true });
    // ffmpeg 提取最高质量音频流
    const { spawn } = require('child_process');
    let stderr = '';
    const ff = spawn('ffmpeg', ['-y','-i',fp,'-vn','-acodec','aac','-b:a','256k','-movflags','+faststart',outPath]);
    ff.stderr.on('data', d => { stderr += d.toString().slice(0, 500); });
    ff.on('close', (code) => {
      if (code === 0) sendJSON(res, 200, { name: outName });
      else { console.error('[ffmpeg] exit', code, stderr.slice(-300)); sendJSON(res, 500, { error: '提取失败: ' + (stderr.split('\n').pop() || 'exit=' + code) }); }
    });
    return; // 异步等待 ffmpeg 完成
  }

  // --- 创建空文件（touch 命令和笔记导入用）---
  if (p === '/api/files/create' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    const name = (body.name || '').trim();
    if (!name) return sendJSON(res, 400, { error: 'name required' });
    const subDir = body.dir || '';
    const relPath = subDir ? subDir + '/' + name : name;
    const fp = safeJoin(FILES_DIR, relPath);
    if (!fp) return sendJSON(res, 403, { error: '非法路径' });
    if (fs.existsSync(fp)) return sendJSON(res, 409, { error: 'file exists' });
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, body.content || '');
    invalidateSizeCache();
    return sendJSON(res, 200, { ok: true, name: relPath });
  }

  // --- 写入文件内容（echo 命令用：创建或覆盖/追加）---
  if (p === '/api/files/write' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    const name = (body.name || '').trim();
    if (!name) return sendJSON(res, 400, { error: 'name required' });
    const fp = safeJoin(FILES_DIR, name);
    // 安全检查：确保路径在 FILES_DIR 内
    if (!fp) return sendJSON(res, 403, { error: 'forbidden' });
    const fileDir = path.dirname(fp);
    if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
    if (body.append && fs.existsSync(fp)) {
      fs.appendFileSync(fp, body.content || '', 'utf8');
    } else {
      fs.writeFileSync(fp, body.content || '', 'utf8');
    }
    invalidateSizeCache();
    return sendJSON(res, 200, { ok: true, name, size: fs.statSync(fp).size });
  }

  // --- 重命名文件 ---
  if (p === '/api/files/rename' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.name || !body?.newName) return sendJSON(res, 400, { error: '缺少参数' });
    const srcPath = safeJoin(FILES_DIR, body.name);
    if (!srcPath) return sendJSON(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(srcPath)) return sendJSON(res, 404, { error: '文件不存在' });
    const destPath = safeJoin(path.dirname(srcPath), body.newName);
    if (!destPath) return sendJSON(res, 403, { error: 'forbidden' });
    if (fs.existsSync(destPath)) return sendJSON(res, 409, { error: '目标文件已存在' });
    fs.renameSync(srcPath, destPath);
    invalidateSizeCache();
    return sendJSON(res, 200, { ok: true, newName: body.newName });
  }

  // --- 文件夹操作 ---
  // 移动文件到文件夹
  if (p === '/api/files/move' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.name || body.targetDir === undefined) return sendJSON(res, 400, { error: '缺少参数' });
    const srcPath = getFilePath(body.name);
    if (!srcPath) return sendJSON(res, 404, { error: '文件不存在' });
    const targetDir = safeJoin(FILES_DIR, body.targetDir || '');
    if (!targetDir) return sendJSON(res, 403, { error: '非法路径' });
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const destPath = safeJoin(targetDir, path.basename(srcPath));
    if (fs.existsSync(destPath) && !body.overwrite)
      return sendJSON(res, 409, { error: '目标位置已存在同名文件' });
    fs.renameSync(srcPath, destPath);
    return sendJSON(res, 200, { ok: true });
  }
  // 复制文件
  if (p === '/api/files/copy' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.name || body.targetDir === undefined) return sendJSON(res, 400, { error: '缺少参数' });
    const srcPath = getFilePath(body.name);
    if (!srcPath) return sendJSON(res, 404, { error: '文件不存在' });
    const targetDir = safeJoin(FILES_DIR, body.targetDir || '');
    if (!targetDir) return sendJSON(res, 403, { error: '非法路径' });
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    const destPath = safeJoin(targetDir, path.basename(srcPath));
    if (fs.existsSync(destPath) && !body.overwrite)
      return sendJSON(res, 409, { error: '目标位置已存在同名文件' });
    fs.copyFileSync(srcPath, destPath);
    invalidateSizeCache();
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
    const name = safeDecode(p.slice('/api/folders/'.length));
    const result = deleteFolder(name);
    if (result.error) return sendJSON(res, 400, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/folders/rename/') && m === 'PUT') {
    const name = safeDecode(p.slice('/api/folders/rename/'.length));
    const body = parseJSON(await readBody(req));
    if (!body?.newName) return sendJSON(res, 400, { error: '缺少新名称' });
    const result = renameFolder(name, body.newName);
    if (result.error) return sendJSON(res, 400, result);
    return sendJSON(res, 200, result);
  }

  // --- 回收站 ---
  if (p === '/api/trash' && m === 'GET') return sendJSON(res, 200, listTrash());
  if (p === '/api/trash' && m === 'DELETE') return sendJSON(res, 200, emptyTrash());
  if (p.startsWith('/api/trash/item/') && m === 'DELETE') {
    const name = safeDecode(p.slice('/api/trash/item/'.length));
    const result = deleteTrashItem(name);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/trash/restore/') && m === 'POST') {
    const name = safeDecode(p.slice('/api/trash/restore/'.length));
    const result = restoreFromTrash(name);
    if (result.error) return sendJSON(res, 400, result);
    return sendJSON(res, 200, result);
  }

  // --- 笔记 ---
  if (p === '/api/notes' && m === 'GET') {
    const q = url.searchParams.get('q') || '';
    const type = url.searchParams.get('type') || '';
    const workId = url.searchParams.get('work_id') || '';
    let notes = listNotes();
    // 按类型隔离：standalone=独立笔记(无workId), novel=小说章节(有workId)
    if (type === 'standalone') {
      notes = notes.filter(n => !n.workId || n.workId === '');
    } else if (type === 'novel') {
      notes = notes.filter(n => n.workId && n.workId !== '');
      if (workId) notes = notes.filter(n => n.workId === workId);
    }
    if (q) {
      notes = notes.filter(n =>
        n.title.includes(q) || (n.preview || '').includes(q)
      );
    }
    return sendJSON(res, 200, notes);
  }
  if (p === '/api/notes' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body || body.title === undefined) return sendJSON(res, 400, { error: 'bad request' });
    const result = saveNote(body);
    // 更新 RAG 索引
    try {
      rag.indexDoc('note_' + result.id, 'note', result.id, body.title || '', body.content || '', '', result.updated || '');
    } catch (e) { console.error('[rag] 笔记索引更新失败:', e.message); }
    return sendJSON(res, 200, result);
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
    // 从 RAG 索引移除
    try { rag.removeDocFromIndex('note_' + id); } catch (e) { console.error('[rag] 笔记索引移除失败:', e.message); }
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
    fs.writeFileSync(safeJoin(path.join(__dirname, 'works'), id + '.json'), JSON.stringify(work, null, 2));
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

  // ===== 待办任务 =====
  if (p === '/api/tasks' && m === 'GET') {
    const status = url.searchParams.get('status') || 'all';
    return sendJSON(res, 200, listTasks(status));
  }
  if (p === '/api/tasks' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body || !body.description) return sendJSON(res, 400, { error: '请输入任务描述' });
    return sendJSON(res, 200, createTask(body));
  }
  if (p.startsWith('/api/tasks/') && m === 'POST') {
    const id = p.slice('/api/tasks/'.length);
    const body = parseJSON(await readBody(req));
    const result = updateTask(id, body);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/tasks/') && m === 'DELETE') {
    const id = p.slice('/api/tasks/'.length);
    const result = deleteTask(id);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
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
          buf = await exportToPDF(title, content, body.html || null);
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

  if (p === '/api/scrape' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body || !body.urls || !body.urls.length) return sendJSON(res, 400, { error: '请输入至少一个网址' });
    const type = body.type || 'both';
    if (!['text', 'images', 'both', 'video', 'music'].includes(type)) return sendJSON(res, 400, { error: 'type 只能是 text/images/both/video/music' });

    // SSE 流式模式
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      const send = (event, data) => { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); };
      try {
        const result = await doScrape(body.urls, type, { minWidth: body.minWidth || 0, minHeight: body.minHeight || 0, followDetail: body.followDetail !== false, deepRender: body.deepRender !== false, skipDup: body.skipDup || false, onProgress: (p) => { send('progress', p); } });
        send('result', result);
      } catch (e) {
        send('error', { error: e.message });
      }
      res.end();
      return;
    }

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
  // ===== 壁纸管理 API（放在通用路由之前）=====
  if (p === '/api/wallpaper/current' && m === 'PUT') {
    const body = parseJSON(await readBody(req));
    const wp = setCurrentWallpaper(body.id);
    sendJSON(res, 200, wp ? { ok: true, wallpaper: wp } : { error: 'not found' }); return;
  }
  if (p === '/api/wallpaper/random' && m === 'POST') {
    const wp = setRandomWallpaper();
    sendJSON(res, 200, wp ? { ok: true, wallpaper: wp } : { error: 'no wallpapers' }); return;
  }
  if (p === '/api/wallpaper/next' && m === 'POST') {
    const wp = getNextWallpaper();
    sendJSON(res, 200, wp ? { ok: true, wallpaper: wp } : { error: 'no wallpapers' }); return;
  }
  if (p.startsWith('/api/wallpaper/del/') && m === 'DELETE') {
    const id = p.slice('/api/wallpaper/del/'.length);
    sendJSON(res, 200, deleteWallpaper(id)); return;
  }
  if (p.startsWith('/api/wallpaper/upscale/') && m === 'POST') {
    const id = p.slice('/api/wallpaper/upscale/'.length);
    const serverUrl = (req.headers['x-forwarded-proto'] || 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
    const result = await upscaleWallpaper(id, serverUrl);
    sendJSON(res, result.ok ? 200 : 400, result); return;
  }
  if (p.startsWith('/api/wallpaper/replace/') && m === 'POST') {
    const id = p.slice('/api/wallpaper/replace/'.length);
    const raw = await readBody(req, 50 * 1024 * 1024);
    const ct = req.headers['content-type'] || '';
    const match = ct.match(/boundary=(.+)/);
    if (!match) { sendJSON(res, 400, { error: 'no boundary' }); return; }
    const parts = parseMultipart(raw, match[1]);
    const filePart = parts.find(pt => pt.filename);
    if (!filePart) { sendJSON(res, 400, { error: 'no file' }); return; }
    const result = replaceWallpaperFile(id, filePart.data);
    sendJSON(res, result.ok ? 200 : 400, result); return;
  }
  if (p === '/api/wallpaper/save' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    const wp = saveWallpaperFromUrl(body.url, body.filename, body.sessionId);
    sendJSON(res, 200, wp.id ? { ok: true, wallpaper: wp } : { error: wp.error }); return;
  }

  // --- 壁纸缩略图（用于画廊快速加载）---
  if (p.startsWith('/api/wallpaper/thumb/')) {
    const fname = safeDecode(p.slice('/api/wallpaper/thumb/'.length));
    const fpath = safeJoin(WALLPAPER_DIR, fname);
    if (!fpath || !fs.existsSync(fpath)) { res.writeHead(404); return res.end('404'); }
    try {
      const sharp = require('sharp');
      const buf = await sharp(fpath).resize(300, 300, { fit: 'inside' }).jpeg({ quality: 72 }).toBuffer();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' });
      return res.end(buf);
    } catch {
      // sharp 处理失败时退回到直接返回原文件
      const ext = path.extname(fname).toLowerCase();
      const stat = fs.statSync(fpath);
      const mimes = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mimes[ext]||'image/jpeg', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
      return fs.createReadStream(fpath).pipe(res);
    }
  }

  // --- 壁纸专用：直接返回原文件（注意：上面的管理路由必须放在这个通用 catch-all 之前）---
  if (p.startsWith('/api/wallpaper/')) {
    const fname = safeDecode(p.slice('/api/wallpaper/'.length));
    const fpath = safeJoin(WALLPAPER_DIR, fname);
    if (!fpath || !fs.existsSync(fpath)) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(fname).toLowerCase();
    const stat = fs.statSync(fpath);
    const mimes = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': mimes[ext]||'image/jpeg', 'Content-Length': stat.size, 'Cache-Control': 'max-age=86400' });
    return fs.createReadStream(fpath).pipe(res);
  }

  // --- 采集缩略图 ---
  if (p.startsWith('/api/scrape/thumb/')) {
    const rest = p.slice('/api/scrape/thumb/'.length);
    const [sid, ...nameParts] = rest.split('/');
    const imgPath = safeJoin(path.join(ROOT, 'scrape'), sid + '/images/' + safeDecode(nameParts.join('/')));
    if (!imgPath || !fs.existsSync(imgPath)) { res.writeHead(404); return res.end('404'); }
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
    const fname = safeDecode(rest.slice(slashIdx + 1));
    const fpath = safeJoin(path.join(ROOT, 'scrape'), sid + '/' + fname);
    if (!fpath || !fs.existsSync(fpath)) { res.writeHead(404); return res.end('404'); }
    const text = fs.readFileSync(fpath, 'utf8').slice(0, 30000);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
    return res.end(text);
  }

  // --- 采集图片 ---
  if (p.startsWith('/api/scrape/img/')) {
    const rest = p.slice('/api/scrape/img/'.length);
    const [sid, ...nameParts] = rest.split('/');
    const imgPath = safeJoin(path.join(ROOT, 'scrape'), sid + '/images/' + safeDecode(nameParts.join('/')));
    if (!imgPath || !fs.existsSync(imgPath)) { res.writeHead(404); return res.end('404'); }
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
    const name = safeDecode(p.slice('/api/stream/'.length));
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

  // ===== 文档上传（对话多模态）=====
  if (p === '/api/chat/upload-doc' && m === 'POST') {
    try {
      const raw = await readBody(req, 30 * 1024 * 1024);
      const boundary = (req.headers['content-type'] || '').match(/boundary=(.+)/);
      if (!boundary) { sendJSON(res, 400, { error: '需要 multipart/form-data' }); return; }
      const parts = parseMultipart(raw, boundary[1]);
      const filePart = parts.find(p => p.filename);
      if (!filePart) { sendJSON(res, 400, { error: '未找到文件' }); return; }
      const fname = (filePart.filename || '').toLowerCase();
      const ext = path.extname(fname);
      let text = '', fileType = '';

      if (ext === '.pdf') {
        fileType = 'PDF';
        try {
          const pdfParse = require('pdf-parse');
          const result = await pdfParse(filePart.data);
          text = result.text || '';
        } catch (e) { text = '(PDF 解析失败: ' + e.message + ')'; }
      } else if (ext === '.docx') {
        fileType = 'Word';
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ buffer: filePart.data });
          text = result.value || '';
        } catch (e) { text = '(DOCX 解析失败: ' + e.message + ')'; }
      } else if (['.txt', '.md', '.json', '.csv', '.log', '.xml', '.yml', '.yaml', '.env', '.js', '.py', '.html', '.css'].includes(ext)) {
        fileType = ext.toUpperCase().slice(1);
        text = filePart.data.toString('utf8');
      } else {
        sendJSON(res, 400, { error: '不支持的文件类型: ' + ext + '（支持 PDF/DOCX/TXT/MD 等文本文件）' });
        return;
      }

      // 截断过长文本
      const MAX_CHARS = 50000;
      let truncated = false;
      if (text.length > MAX_CHARS) { text = text.slice(0, MAX_CHARS); truncated = true; }

      sendJSON(res, 200, {
        ok: true,
        filename: filePart.filename,
        fileType,
        size: filePart.data.length,
        text,
        truncated,
        charCount: text.length,
      });

      // 上传的文档加入 RAG 索引
      if (text && text.trim().length >= 20) {
        try {
          const docId = 'doc_' + filePart.filename.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_') + '_' + Date.now();
          rag.indexDoc(docId, 'file', docId, filePart.filename, text, '', new Date().toISOString());
        } catch (e) { console.error('[rag] 文档索引更新失败:', e.message); }
      }
    } catch (e) {
      sendJSON(res, 500, { error: '文档处理失败: ' + e.message });
    }
    return;
  }

  // ===== AI Agent 对话（工具调用循环）=====
  if (p === '/api/chat' && m === 'POST') {
    let body;
    try { body = parseJSON(await readBody(req, 5 * 1024 * 1024)); } catch (e) { return sendJSON(res, 400, { error: '请求解析失败' }); }
    if (!body?.messages?.length) return sendJSON(res, 400, { error: '缺少消息' });

    // 新流程：客户端传 apiKey + baseUrl（从 localStorage 读取），服务器直接转发
    // 旧版兜底：服务端 .env 中的 DEEPSEEK_API_KEY + 路由表
    const chatModel = body.model || 'deepseek-chat';
    const apiKey = body.apiKey || process.env.DEEPSEEK_API_KEY;
    const chatBaseUrl = resolveBaseUrl(chatModel, body.baseUrl);

    if (!apiKey) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '请先配置 API Key（点击导航栏 AK 按钮设置）。推荐 OpenRouter，一个 Key 支持 Claude+GPT+Gemini+DeepSeek。' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const messages = body.messages;
    sendSSE(res, 'start', {});

    // ===== RAG 本地知识库检索 =====
    // 获取最后一条用户消息文本
    let userQuery = '';
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      if (typeof lastUserMsg.content === 'string') userQuery = lastUserMsg.content;
      else if (Array.isArray(lastUserMsg.content)) {
        userQuery = lastUserMsg.content
          .filter(p => p.type === 'text')
          .map(p => p.text).join(' ');
      }
    }

    if (userQuery && rag.shouldSearch(userQuery)) {
      try {
        const searchResults = rag.search(userQuery, 3);
        if (searchResults.length > 0) {
          const ragContext = rag.formatContext(searchResults);
          // 将检索结果注入系统提示词
          const enhancedPrompt = SYSTEM_PROMPT + ragContext;
          messages.unshift({ role: 'system', content: enhancedPrompt });
          // 通知前端检索结果
          sendSSE(res, 'search_results', {
            query: userQuery.slice(0, 100),
            results: searchResults.map(r => ({
              type: r.type, title: r.title, snippet: r.snippet, score: r.score,
            })),
          });
        } else {
          messages.unshift({ role: 'system', content: SYSTEM_PROMPT });
        }
      } catch (e) {
        console.error('[rag] 检索失败:', e.message);
        messages.unshift({ role: 'system', content: SYSTEM_PROMPT });
      }
    } else {
      messages.unshift({ role: 'system', content: SYSTEM_PROMPT });
    }

    // 上下文压缩：早期消息太多时自动浓缩摘要（借鉴 LobeChat/Open WebUI 最佳实践）
    const keepRecent = body.keepRecent || 20;
    const nonSysMsgs = messages.filter(m => m.role !== 'system');
    if (body.compress && nonSysMsgs.length > keepRecent + 8) {
      try {
        const toSummarize = nonSysMsgs.slice(0, nonSysMsgs.length - keepRecent);
        const recentMsgs = nonSysMsgs.slice(nonSysMsgs.length - keepRecent);
        // 构建结构化摘要 prompt，保留关键事实
        const compactLog = toSummarize.map(m => {
          const c = typeof m.content === 'string' ? m.content : '[多模态/工具调用]';
          return `${m.role === 'user' ? '用户' : m.role === 'assistant' ? '小苇' : m.role}: ${c.slice(0, 400)}`;
        }).join('\n');
        const summaryPrompt = [
          { role: 'system', content: `你是对话摘要专家。请将以下历史浓缩为 2-3 句话（不超过 200 字），只保留：
1. 用户的目标/需求/意图
2. 已完成的关键决策和操作
3. 重要的名字/数字/约束条件
4. 待处理的事项
忽略寒暄、重复内容、冗长的工具输出。只输出摘要本身。` },
          { role: 'user', content: compactLog }
        ];
        const summaryPayload = JSON.stringify({ model: chatModel, messages: summaryPrompt, max_tokens: 300, stream: false });
        const summaryResp = await apiCall(apiKey, summaryPayload, chatBaseUrl);
        const summary = summaryResp?.choices?.[0]?.message?.content?.trim();
        if (summary) {
          const sysMsg = messages.find(m => m.role === 'system');
          const compressed = [sysMsg];
          compressed.push({ role: 'user', content: '📋 [对话历史摘要] ' + summary + '\n---\n请记住以上上下文，继续对话。' });
          compressed.push(...recentMsgs);
          messages.length = 0;
          messages.push(...compressed);
          sendSSE(res, 'compressed', { summary, kept: keepRecent, original: nonSysMsgs.length });
        }
      } catch (e) {
        sendSSE(res, 'compressed', { summary: '', kept: keepRecent });
      }
    }

    req.on('close', () => { aborted = true; });
    let aborted = false;

    const tools = []; // 纯聊天模式，不使用工具

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
          case 'ReadImage': {
            const imgPath = resolvePath(args.path);
            if (!fs.existsSync(imgPath)) return { error: '图片不存在: ' + args.path };
            const stat = fs.statSync(imgPath);
            let meta = { path: args.path, size: stat.size, sizeDisplay: (stat.size / 1024).toFixed(1) + ' KB', mtime: stat.mtime.toISOString() };
            try {
              const sharp = require('sharp');
              const info = await sharp(imgPath).metadata();
              meta.format = info.format;
              meta.width = info.width;
              meta.height = info.height;
              meta.channels = info.channels;
            } catch {}
            return meta;
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

    // Agent 循环（流式）
    const MAX_ITER = 15;
    for (let iter = 0; iter < MAX_ITER && !aborted; iter++) {
      const payload = {
        model: chatModel,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 8192,
      };

      let contentText = '';
      let thinkingText = '';
      let finishReason = '';
      // 累积 tool_calls delta（按 index 聚合）
      const toolCallsMap = {};

      try {
        const stream = apiCallStream(apiKey, payload, chatBaseUrl);
        for await (const evt of stream) {
          if (aborted) break;
          if (!evt || !evt.type) { console.error('[chat] bad evt:', JSON.stringify(evt)); continue; }
          switch (evt.type) {
            case 'thinking':
              thinkingText += evt.text;
              sendSSE(res, 'thinking', { text: thinkingText });
              break;
            case 'content':
              contentText += evt.text;
              sendSSE(res, 'content_delta', { delta: evt.text });
              break;
            case 'tool_delta':
              for (const tc of (evt.tool_calls || [])) {
                const idx = tc.index ?? 0;
                if (!toolCallsMap[idx]) toolCallsMap[idx] = { id: tc.id || '', name: '', arguments: '' };
                if (tc.id) toolCallsMap[idx].id = tc.id;
                if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
                if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
              }
              break;
            case 'done':
              finishReason = evt.finish_reason;
              break;
            case 'error':
              sendSSE(res, 'error', { message: evt.message });
              finishReason = 'error';
              break;
          }
        }
      } catch (e) {
        console.error('[chat agent error]', e.stack || e.message);
        sendSSE(res, 'error', { message: 'API 调用失败: ' + e.message });
        break;
      }

      if (aborted || finishReason === 'error') break;

      // 工具调用
      if (finishReason === 'tool_calls' && Object.keys(toolCallsMap).length) {
        const toolCalls = Object.values(toolCallsMap).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        messages.push({ role: 'assistant', content: contentText || null, reasoning_content: thinkingText || null, tool_calls: toolCalls.map(tc => ({
          id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments }
        })) });

        for (const tc of toolCalls) {
          if (aborted) break;
          let args;
          try { args = JSON.parse(tc.arguments); } catch (e) { args = {}; }
          sendSSE(res, 'tool_call', { id: tc.id, name: tc.name, args });

          const result = await executeTool(tc.name, args);
          sendSSE(res, 'tool_result', { id: tc.id, name: tc.name, result });

          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
        }
        continue;
      }

      // 最终文本回复（含思考过程）
      if (contentText || thinkingText) {
        messages.push({ role: 'assistant', content: contentText || '', reasoning_content: thinkingText || '' });
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
    const libPath = safeJoin(path.join(ROOT, 'node_modules'), p.slice(5));
    if (!libPath) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(libPath)) { res.writeHead(404); return res.end('404'); }
    const ext = path.extname(libPath).toLowerCase();
    const mime = { '.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.map':'application/json' };
    res.writeHead(200, { 'Content-Type': mime[ext]||'text/plain', 'Cache-Control': 'public, max-age=86400' });
    return fs.createReadStream(libPath).pipe(res);
  }
  
  // 从采集会话中保存图片为壁纸
  if (p.startsWith('/api/scrape/save-wallpaper/') && m === 'POST') {
    const sid = p.slice('/api/scrape/save-wallpaper/'.length);
    const body = parseJSON(await readBody(req));
    const wp = saveWallpaperFromUrl(body.url, body.filename, sid);
    sendJSON(res, 200, wp.id ? { ok: true, wallpaper: wp } : { error: wp.error }); return;
  }
  // 壁纸上传
  if (p === '/api/wallpapers/upload' && m === 'POST') {
    const raw = await readBody(req, 50 * 1024 * 1024);
    const boundary = (req.headers['content-type'] || '').match(/boundary=(.+)/);
    if (!boundary) { sendJSON(res, 400, { error: 'no boundary' }); return; }
    const parts = parseMultipart(raw, boundary[1]);
    const filePart = parts.find(p => p.filename);
    if (!filePart) { sendJSON(res, 400, { error: 'no file' }); return; }
    const ext = (filePart.filename || '').replace(/.*(\.[^.]+)/, '$1') || '.jpg';
    const safeName = 'wallpaper_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + ext;
    // 先写文件，再写入数据库（saveWallpaperFromUrl 要求文件已存在）
    const fp = require('path').join(WALLPAPER_DIR, safeName);
    require('fs').writeFileSync(fp, filePart.data);
    const wp = saveWallpaperFromUrl('', safeName, '');
    sendJSON(res, 200, { ok: true, wallpaper: { ...wp, filename: safeName, path: '/wallpaper/' + safeName } }); return;
  }

  // ===== 壁纸 API =====
  if (p === '/api/wallpapers' && m === 'GET') { sendJSON(res, 200, { list: listWallpapers(), current: getCurrentWallpaper() }); return; }
  if (p === '/api/wallpapers/save-file' && m === 'GET') {
    const relPath = url.searchParams.get('path');
    const fp = getFilePath(relPath);
    if (!fp) { sendJSON(res, 404, { error: 'file not found' }); return; }
    const ext = require('path').extname(fp).toLowerCase() || '.jpg';
    const safeName = 'wallpaper_' + Date.now() + ext;
    const destFp = require('path').join(WALLPAPER_DIR, safeName);
    require('fs').copyFileSync(fp, destFp);
    const wp = saveWallpaperFromUrl('', safeName, '');
    sendJSON(res, 200, { ok: true, wallpaper: { ...wp, filename: safeName, path: '/wallpaper/' + safeName } }); return;
  }
  if (p.startsWith('/wallpaper/')) {
    const fname = p.slice('/wallpaper/'.length);
    const fp = safeJoin(WALLPAPER_DIR, fname);
    if (!fp || !fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
    const ext = path.extname(fp).toLowerCase();
    const mime = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp' };
    res.writeHead(200, { 'Content-Type': mime[ext]||'image/*', 'Cache-Control': 'public, max-age=31536000' });
    return fs.createReadStream(fp).pipe(res);
  }

  serveStatic(p, res, req);
});

// 启动时重建本地知识库索引
rag.rebuildIndex().catch(e => console.error('[rag] 启动索引失败:', e.message));

server.listen(PORT, '127.0.0.1', () => console.log(`📌 导航页已启动: http://127.0.0.1:${PORT}`));
