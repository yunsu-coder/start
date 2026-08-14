// lib/http.js - HTTP 公共助手（路由模块共享）
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

function sendJSON(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' });
  res.end(JSON.stringify(data));
}

function sendSSE(res, event, data) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

function readBody(req, maxMemory = Infinity) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tmpFile = null, tmpStream = null;
    req.on('data', c => {
      total += c.length;
      if (!tmpFile && total > maxMemory) {
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

// 同步版 apiCall（保留用于非对话场景如翻译摘要）
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

// ===== 认证与限流 =====

// Basic Auth：.env 配置 AUTH_USER/AUTH_PASS 后全站启用（未配置则保持免认证，便于本地开发）
// 注意：每次调用时读取 process.env，避免模块加载顺序影响 .env 解析
function isAuthEnabled() {
  return !!(process.env.AUTH_USER && process.env.AUTH_PASS);
}

function authOK(req) {
  const user = process.env.AUTH_USER || '';
  const pass = process.env.AUTH_PASS || '';
  if (!user || !pass) return true;
  const h = req.headers['authorization'] || '';
  const m = /^Basic\s+(.+)$/i.exec(h);
  if (!m) return false;
  let decoded = '';
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch { return false; }
  const idx = decoded.indexOf(':');
  if (idx === -1) return false;
  const a = Buffer.from(decoded.slice(0, idx));
  const b = Buffer.from(user);
  const c = Buffer.from(decoded.slice(idx + 1));
  const d = Buffer.from(pass);
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

module.exports = { sendJSON, sendSSE, readBody, parseJSON, apiCallStream, apiCall, authOK, isAuthEnabled, rateLimitOK };
