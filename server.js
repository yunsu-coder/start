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
const { sendJSON, authOK, rateLimitOK } = require('./lib/http');
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

// ===== 路由（按注册顺序匹配，各模块内部保持原有路由优先级）=====

const routes = [
  require('./routes/misc'),
  require('./routes/files'),
  require('./routes/notes'),
  require('./routes/tasks'),
  require('./routes/translate'),
  require('./routes/scrape'),
  require('./routes/wallpaper'),
  require('./routes/chat'),
];

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
