// server.js - 导航页主服务（路由分发）
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const { getStatus, listFiles, uploadFiles, deleteFile, getFilePath, getFilePreview,
        listNotes, saveNote, getNote, deleteNote, parseMultipart, invalidateSizeCache, MAX_STORAGE,
        createFolder, deleteFolder, renameFolder, emptyTrash, listTrash, restoreFromTrash,
        scanDir, breadcrumb, FILES_DIR } = require('./lib/storage');
const { doScrape, listSessions, getSession, deleteSession, transferSession, invalidateSessionCache, scrapeTieba } = require('./lib/scraper');

// ===== 加载环境变量 =====
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
}

const PORT = 3001;
const ROOT = __dirname;

// ===== 工具函数 =====

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
  if (p === '/api/status') return sendJSON(res, 200, await getStatus());

  // --- OCR 图片转文字 ---
  if (p === '/api/ocr' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.name) return sendJSON(res, 400, { error: '缺少文件名' });
    const fp = await getFilePath(body.name);
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
    const result = { files: await listFiles(dirRel), breadcrumb: breadcrumb(dirRel), currentDir: dirRel };
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
    const result = await uploadFiles(parts, MAX_STORAGE, subDir);
    if (result.error) return sendJSON(res, result.error === 'no file' ? 400 : 413, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/files/') && m === 'DELETE') {
    const name = decodeURIComponent(p.slice('/api/files/'.length));
    const result = await deleteFile(name);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
  }
  // 重命名文件
  if (p.startsWith('/api/files/rename/') && m === 'PUT') {
    const name = decodeURIComponent(p.slice('/api/files/rename/'.length));
    const body = parseJSON(await readBody(req));
    if (!body?.newName) return sendJSON(res, 400, { error: 'no new name' });
    const oldPath = await getFilePath(name);
    if (!oldPath) return sendJSON(res, 404, { error: 'not found' });
    const newPath = path.join(path.dirname(oldPath), body.newName);
    if (fs.existsSync(newPath)) return sendJSON(res, 409, { error: 'name exists' });
    fs.renameSync(oldPath, newPath);
    return sendJSON(res, 200, { ok: true, name: body.newName });
  }
  if (p.startsWith('/api/dl/')) {
    const name = decodeURIComponent(p.slice('/api/dl/'.length));
    const fp = await getFilePath(name);
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
    const fp = await getFilePath(name);
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
    const fp = await getFilePath(name);
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

  // 翻译（流式）
  if (p === '/api/translate' && m === 'POST') {
    const body = parseJSON(await readBody(req));
    if (!body?.text) return sendJSON(res, 400, { error: 'no text' });
    const from = body.from || 'auto';
    const to = body.to || 'zh';
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) return sendJSON(res, 500, { error: 'API key not configured' });
    
    // 流式转发
    try {
      const aiResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: 'deepseek-chat',
          stream: true,
          messages: [{
            role: 'system',
            content: `你是一个专业翻译。将用户输入${from === 'auto' ? '' : '从' + from}翻译成${to}。只输出译文，不要解释。`
          }, {
            role: 'user',
            content: body.text.slice(0, 8000)
          }],
          max_tokens: 4000, temperature: 0.1,
        }),
      });
      
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      
      // 把 DeepSeek 的 SSE 流直接转发给客户端
      for await (const chunk of aiResp.body) {
        res.write(chunk);
      }
      res.end();
    } catch(e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
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
    const preview = await getFilePreview(name);
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
    const srcPath = await getFilePath(body.name);
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
    const result = await createFolder(body.name);
    if (result.error) return sendJSON(res, 409, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/folders/') && m === 'DELETE') {
    const name = decodeURIComponent(p.slice('/api/folders/'.length));
    const result = await deleteFolder(name);
    if (result.error) return sendJSON(res, 400, result);
    return sendJSON(res, 200, result);
  }
  if (p.startsWith('/api/folders/rename/') && m === 'PUT') {
    const name = decodeURIComponent(p.slice('/api/folders/rename/'.length));
    const body = parseJSON(await readBody(req));
    if (!body?.newName) return sendJSON(res, 400, { error: '缺少新名称' });
    const result = await renameFolder(name, body.newName);
    if (result.error) return sendJSON(res, 400, result);
    return sendJSON(res, 200, result);
  }

  // --- 回收站 ---
  if (p === '/api/trash' && m === 'GET') return sendJSON(res, 200, await listTrash());
  if (p === '/api/trash' && m === 'DELETE') return sendJSON(res, 200, await emptyTrash());
  if (p.startsWith('/api/trash/restore/') && m === 'POST') {
    const name = decodeURIComponent(p.slice('/api/trash/restore/'.length));
    const result = await restoreFromTrash(name);
    if (result.error) return sendJSON(res, 400, result);
    return sendJSON(res, 200, result);
  }

  // --- 笔记 ---
  if (p === '/api/notes' && m === 'GET') {
    const q = url.searchParams.get('q') || '';
    const notes = await listNotes();
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
    return sendJSON(res, 200, await saveNote(body));
  }
  if (p.startsWith('/api/notes/') && m === 'GET') {
    const id = p.slice('/api/notes/'.length).replace(/\.json$/, '');
    const note = await getNote(id);
    if (!note) return sendJSON(res, 404, { error: 'not found' });
    return sendJSON(res, 200, note);
  }
  if (p.startsWith('/api/notes/') && m === 'DELETE') {
    const id = p.slice('/api/notes/'.length).replace(/\.json$/, '');
    const result = await deleteNote(id);
    if (result.error) return sendJSON(res, 404, result);
    return sendJSON(res, 200, result);
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
    const fpath = await getFilePath(fname);
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
    const fp = await getFilePath(name);
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
