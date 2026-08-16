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

function serveCaptchaPage(res) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>人机验证 · 一苇</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;
background:radial-gradient(1200px 600px at 20% -10%,rgba(120,140,255,.18),transparent),radial-gradient(900px 500px at 110% 110%,rgba(255,120,180,.12),transparent),#10131c;color:#e8ebf2}
.card{width:min(360px,92vw);padding:2rem 1.6rem;border-radius:1.2rem;background:rgba(30,35,50,.72);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.09);box-shadow:0 20px 60px rgba(0,0,0,.4)}
h1{font-size:1.15rem;font-weight:700;display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem}
h1 .mi{font-size:1.3rem}
p.sub{font-size:.8rem;color:#9aa3b5;margin-bottom:1.4rem;line-height:1.5}
.capbox{display:flex;gap:.6rem;align-items:center;margin-bottom:.8rem}
.capbox svg{width:140px;height:52px;border-radius:.6rem;border:1px solid rgba(255,255,255,.12);background:#f2f5f9;flex-shrink:0}
.capbox button{border:1px solid rgba(255,255,255,.14);background:transparent;color:#9aa3b5;border-radius:.6rem;padding:.5rem .6rem;cursor:pointer;font-size:.78rem;transition:.15s}
.capbox button:hover{color:#fff;border-color:rgba(255,255,255,.4)}
input{width:100%;padding:.65rem .8rem;border-radius:.6rem;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.25);color:#fff;font-size:1rem;letter-spacing:.35em;text-transform:uppercase;text-align:center;outline:none}
input:focus{border-color:#6d8bff}
.btn{width:100%;margin-top:.8rem;padding:.7rem;border:none;border-radius:.6rem;background:linear-gradient(135deg,#5a7bff,#7a5cff);color:#fff;font-size:.95rem;font-weight:600;cursor:pointer;transition:.15s}
.btn:hover{filter:brightness(1.1)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.msg{font-size:.76rem;margin-top:.6rem;min-height:1.1em;text-align:center}
.msg.err{color:#ff7d7d}.msg.ok{color:#6fd08c}
.foot{margin-top:1.2rem;font-size:.7rem;color:#667085;text-align:center}
</style>
</head>
<body>
<div class="card">
  <h1>🔐 人机验证</h1>
  <p class="sub">输入图中字符以证明你不是机器人。<br>通过后浏览器会弹出登录框。</p>
  <div class="capbox"><span id="capimg"></span><button id="refresh" type="button">换一张</button></div>
  <input id="answer" placeholder="输入 4 位字符" maxlength="6" autocomplete="off" spellcheck="false">
  <button class="btn" id="submit" type="button">验证并继续</button>
  <div class="msg" id="msg"></div>
  <div class="foot">一苇 · 个人启动页 · gzhysu.top</div>
</div>
<script>
(function () {
  var token = '';
  var img = document.getElementById('capimg');
  var inp = document.getElementById('answer');
  var msg = document.getElementById('msg');
  var btn = document.getElementById('submit');
  function load() {
    img.textContent = '加载中…';
    fetch('/captcha/new').then(function (r) { return r.json(); }).then(function (d) {
      token = d.token;
      img.innerHTML = d.svg;
      inp.value = '';
      inp.focus();
      msg.textContent = '';
      msg.className = 'msg';
    }).catch(function () { img.textContent = '加载失败，点击换一张'; });
  }
  function submit() {
    var val = inp.value.trim();
    if (val.length < 4) { msg.textContent = '请输入完整字符'; msg.className = 'msg err'; return; }
    btn.disabled = true;
    fetch('/captcha/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, answer: val })
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); }).then(function (r) {
      if (r.ok) {
        msg.textContent = '✓ 验证通过，即将弹出登录框…';
        msg.className = 'msg ok';
        setTimeout(function () { location.reload(); }, 600);
      } else {
        msg.textContent = (r.d && r.d.error) || '验证码错误或已过期';
        msg.className = 'msg err';
        btn.disabled = false;
        load();
      }
    }).catch(function () { msg.textContent = '网络错误，请重试'; msg.className = 'msg err'; btn.disabled = false; });
  }
  document.getElementById('refresh').addEventListener('click', load);
  document.getElementById('submit').addEventListener('click', submit);
  inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  load();
})();
</script>
</body>
</html>`;
  res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'SAMEORIGIN' });
  res.end(html);
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

  // --- 认证门：未登录先过人机验证，再弹登录框 ---
  if (!authOK(req)) {
    // 验证码接口（未认证可访问，单独限流）
    if (p === '/captcha/new' && m === 'GET') {
      if (!rateLimitOK(p, req)) return sendJSON(res, 429, { error: '请求过于频繁，请稍后再试' });
      const { token, code, svg } = captcha.generate();
      const payload = { token, svg };
      if (process.env.CAPTCHA_TEST_MODE === '1') payload.code = code; // 仅测试环境
      return sendJSON(res, 200, payload);
    }
    if (p === '/captcha/verify' && m === 'POST') {
      if (!rateLimitOK(p, req)) return sendJSON(res, 429, { error: '请求过于频繁，请稍后再试' });
      const body = parseJSON(await readBody(req));
      if (!captcha.verify(body?.token, body?.answer)) {
        return sendJSON(res, 400, { error: '验证码错误或已过期' });
      }
      captcha.setCookie(res);
      return sendJSON(res, 200, { ok: true });
    }

    // 已通过人机验证（或原生播放器直连端点）→ 401 弹出登录框
    if (captcha.cookieOK(req) || isMediaEndpoint(p)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Yiwei"', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('401 Unauthorized');
    }

    // 未通过人机验证 → 验证码页面
    return serveCaptchaPage(res);
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
