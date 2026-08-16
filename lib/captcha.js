// lib/captcha.js - 图形验证码（自托管 SVG，无外部依赖）
const crypto = require('crypto');

const COOKIE_NAME = 'yiwei_captcha';
const COOKIE_MAX_AGE = 30 * 24 * 3600;        // 通过后 30 天内免验证
const CODE_TTL = 5 * 60 * 1000;               // 单个验证码 5 分钟有效
const CODE_LEN = 4;

// 剔除易混淆字符 0/O/1/I/L
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// 签名密钥：由 AUTH_PASS 派生（稳定、无需额外配置）
const SECRET = crypto.createHash('sha256').update('yiwei-captcha:' + (process.env.AUTH_PASS || 'default')).digest();

// token -> { code, expires }（内存存储，重启即失效，单用户足够）
const store = new Map();

function rand(n) { return Math.floor(Math.random() * n); }
function pick(arr) { return arr[rand(arr.length)]; }

const NOISE_COLORS = ['#c9d6e3', '#b8c8d9', '#d5dfe9', '#a9bccd'];
const CHAR_COLORS = ['#2d3e50', '#1f6f8b', '#7a3b69', '#b04a2f', '#3d5a80', '#1a535c'];

// 生成 4 位 SVG 验证码
function renderSVG(code) {
  const W = 140, H = 52;
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  // 背景
  parts.push(`<rect width="100%" height="100%" rx="10" fill="#f2f5f9"/>`);
  // 干扰点
  for (let i = 0; i < 28; i++) {
    parts.push(`<circle cx="${rand(W)}" cy="${rand(H)}" r="${(Math.random() * 1.8 + 0.3).toFixed(1)}" fill="${pick(NOISE_COLORS)}"/>`);
  }
  // 干扰线
  for (let i = 0; i < 3; i++) {
    parts.push(`<path d="M${rand(W / 2)} ${rand(H)} q ${rand(W)} ${rand(H) - rand(H)} ${W} ${rand(H)}" stroke="${pick(NOISE_COLORS)}" stroke-width="1.2" fill="none" opacity="0.7"/>`);
  }
  // 字符
  const cw = W / (code.length + 0.6);
  [...code].forEach((ch, i) => {
    const x = Math.round(cw * (i + 0.4) + rand(7));
    const y = Math.round(H / 2 + rand(12));
    const rot = rand(40) - 20;
    const fs = 28 + rand(8);
    parts.push(`<text x="${x}" y="${y}" font-size="${fs}" font-family="Arial,Helvetica,sans-serif" font-weight="700" fill="${pick(CHAR_COLORS)}" transform="rotate(${rot} ${x} ${y})">${ch}</text>`);
  });
  parts.push('</svg>');
  return parts.join('');
}

// 生成验证码：{ token, code, svg }
function generate() {
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) code += pick(CHARS);
  const token = crypto.randomBytes(16).toString('hex');
  store.set(token, { code, expires: Date.now() + CODE_TTL });
  // 顺带清理过期项
  const now = Date.now();
  if (store.size > 200) { for (const [k, v] of store) if (now > v.expires) store.delete(k); }
  return { token, code, svg: renderSVG(code) };
}

// 校验答案（一次性使用，大小写不敏感）
function verify(token, answer) {
  const rec = store.get(token);
  if (!rec) return false;
  store.delete(token); // 一次性
  if (Date.now() > rec.expires) return false;
  return typeof answer === 'string' && answer.trim().toUpperCase() === rec.code;
}

// ===== 通过凭证 Cookie（HMAC 签名）=====
function sign(expires) {
  return expires + '.' + crypto.createHmac('sha256', SECRET).update('ok:' + expires).digest('hex');
}

function setCookie(res) {
  const expires = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE;
  const value = sign(expires);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

// 验证请求是否已通过人机验证
function cookieOK(req) {
  const value = parseCookies(req)[COOKIE_NAME];
  if (!value) return false;
  const dot = value.lastIndexOf('.');
  if (dot === -1) return false;
  const expires = parseInt(value.slice(0, dot), 10);
  const mac = value.slice(dot + 1);
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return false;
  const expect = crypto.createHmac('sha256', SECRET).update('ok:' + expires).digest('hex');
  // 长度一致 + 常量时间比较，防时序攻击
  const a = Buffer.from(mac), b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { generate, verify, setCookie, cookieOK, COOKIE_NAME, COOKIE_MAX_AGE };
