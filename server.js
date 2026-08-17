// server.js - 导航页主服务（认证 / 限流 / 路由分发 / 静态服务）
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

// ===== 加载环境变量（必须最先执行，确保各模块 require 时能读到 .env）=====
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

const { safeJoin, safeDecode } = require('./lib/safePath');
const { sendJSON, authOK, rateLimitOK, readBody, parseJSON } = require('./lib/http');
const captcha = require('./lib/captcha');
const rag = require('./lib/rag');

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
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      zlib.gzip(data, (_, result) => res.end(result));
    } else {
      res.writeHead(200, headers);
      res.end(data);
    }
  });
}


// ===== 人机验证（图形验证码）=====

// 无需验证码的"机器直连"端点：VLC/系统播放器等原生客户端走 401 登录框
function isMediaEndpoint(p) {
  return p.startsWith('/api/m3u/') || p.startsWith('/api/view/') || p.startsWith('/api/dl/') ||
         p.startsWith('/api/stream/') || p.startsWith('/api/wallpaper/') || p.startsWith('/wallpaper/') ||
         p.startsWith('/api/scrape/thumb/') || p.startsWith('/api/scrape/img/');
}

// ===== 登录页与验证码 =====

function serveLogin(res) {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'login.html'), 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('login.html 缺失: ' + e.message);
  }
}

// 无需验证码的"机器直连"端点：VLC/系统播放器等原生客户端走 401 登录框
function isMediaEndpoint(p) {
  return p.startsWith('/api/m3u/') || p.startsWith('/api/view/') || p.startsWith('/api/dl/') ||
         p.startsWith('/api/stream/') || p.startsWith('/api/wallpaper/') || p.startsWith('/wallpaper/') ||
         p.startsWith('/api/scrape/thumb/') || p.startsWith('/api/scrape/img/');
}

// ===== 路由（按注册顺序匹配// ===== 路由（按注册顺序匹配，各模块内部保持原有路由优先级）=====

const routes = [
  require('./routes/misc'),
  require('./routes/files'),
  require('./routes/notes'),
  require('./routes/tasks'),
  require('./routes/translate'),
  require('./routes/scrape'),
  require('./routes/wallpaper'),
  require('./routes/chat'),
  require('./routes/novel'),
];

const server = http.createServer(async (req, res) => {
  // 启用 SharedArrayBuffer（ONNX Runtime Web WASM 多线程需要）
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  // --- 认证门：未登录 → 滑块拼图登录页 / 验证码接口 / 401 弹窗 ---
  if (!authOK(req)) {
    // 验证码背景图
    if (p.startsWith('/captcha/bg/') && m === 'GET') {
      const fname = p.slice('/captcha/bg/'.length);
      const fp = safeJoin(captcha.BG_DIR, fname);
      if (!fp || !fs.existsSync(fp)) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
      return fs.createReadStream(fp).pipe(res);
    }
    // 拼图块
    if (p.startsWith('/captcha/piece/') && m === 'GET') {
      const token = p.slice('/captcha/piece/'.length);
      const rec = captcha.getRecord(token);
      if (!rec) { res.writeHead(404); return res.end('404'); }
      try {
        const buf = await captcha.renderPiece(rec);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        return res.end(buf);
      } catch (e) { console.error('[captcha] piece:', e.message); res.writeHead(500); return res.end('piece error'); }
    }
    // 生成拼图
    if (p === '/captcha/new' && m === 'GET') {
      if (!rateLimitOK(p, req)) return sendJSON(res, 429, { error: '请求过于频繁，请稍后再试' });
      const { token, bg, x, y } = captcha.generate();
      const payload = { token, bg, piece: '/captcha/piece/' + token, y, bgW: captcha.BG_W, bgH: captcha.BG_H, pieceW: captcha.PIECE_W, pieceH: captcha.PIECE_H };
      if (process.env.CAPTCHA_TEST_MODE === '1') payload.target = x; // 仅测试环境
      return sendJSON(res, 200, payload);
    }
    // 校验滑块位置
    if (p === '/captcha/verify' && m === 'POST') {
      if (!rateLimitOK(p, req)) return sendJSON(res, 429, { error: '请求过于频繁，请稍后再试' });
      const body = parseJSON(await readBody(req));
      if (!captcha.verify(body?.token, body?.offset)) {
        return sendJSON(res, 400, { error: '验证失败，请重试' });
      }
      captcha.setCaptchaCookie(res);
      return sendJSON(res, 200, { ok: true });
    }
    // 登录（需已通过滑块验证 + 凭据正确 → 会话 Cookie）
    if (p === '/login' && m === 'POST') {
      if (!rateLimitOK(p, req)) return sendJSON(res, 429, { error: '请求过于频繁，请稍后再试' });
      if (captcha.loginLocked(req)) return sendJSON(res, 429, { error: '尝试次数过多，请 10 分钟后再试' });
      const body = parseJSON(await readBody(req));
      if (!captcha.captchaCookieOK(req)) return sendJSON(res, 403, { error: '请先完成滑块拼图验证' });
      if (!captcha.verifyLogin(body?.user, body?.pass)) {
        captcha.recordLoginFail(req);
        return sendJSON(res, 401, { error: '用户名或密码错误' });
      }
      captcha.clearLoginFails(req);
      captcha.setAuthCookie(res, body.user, body.remember !== false);
      return sendJSON(res, 200, { ok: true });
    }

    // favicon 供登录页使用
    if (p === '/favicon.svg') return serveStatic(p, res, req);

    // 媒体直连端点 → 401 弹出原生登录框（VLC 等）
    if (isMediaEndpoint(p)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Yiwei"', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('401 Unauthorized');
    }

    // 其余：登录页（滑块拼图 + 表单）
    return serveLogin(res);
  }

  // --- 限流：敏感接口每 IP 每分钟次数限制 ---
  if (!rateLimitOK(p, req)) {
    return sendJSON(res, 429, { error: '请求过于频繁，请稍后再试' });
  }

  // --- API 路由分发 ---
  for (const route of routes) {
    if (await route.handle(p, m, url, req, res)) return;
  }

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

  serveStatic(p, res, req);
});

// 启动时重建本地知识库索引
rag.rebuildIndex().catch(e => console.error('[rag] 启动索引失败:', e.message));

server.listen(PORT, '127.0.0.1', () => console.log(`📌 导航页已启动: http://127.0.0.1:${PORT}`));
