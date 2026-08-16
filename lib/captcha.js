// lib/captcha.js - 滑块拼图验证码 + 会话登录凭证
// 无外部服务依赖：sharp 切图（本地生成拼图块与缺口），HMAC 签名 Cookie
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const BG_DIR = path.join(__dirname, 'captcha-bg');
const BG_W = 320, BG_H = 180;
const PIECE_W = 50, PIECE_H = 50;
const TOLERANCE = 5;          // 误差容限（px）
const TOKEN_TTL = 3 * 60 * 1000; // 单个拼图 3 分钟有效

const CAPTCHA_COOKIE = 'yiwei_captcha';
const AUTH_COOKIE = 'yiwei_auth';
const AUTH_MAX_AGE = 30 * 24 * 3600; // 记住我 30 天

// 签名密钥：由 AUTH_PASS 派生（稳定，无需额外配置）
const SECRET = crypto.createHash('sha256').update('yiwei-captcha:' + (process.env.AUTH_PASS || 'default')).digest();

// token -> { bg, x, y, expires, hole, piece }
const store = new Map();

// 登录失败锁定（防暴力破解）：同一 IP 10 分钟内 5 次失败 → 锁 10 分钟
const MAX_FAILS = 5, FAIL_WINDOW = 10 * 60 * 1000;
const failedLogins = new Map(); // ip -> { count, firstFailAt, lockedUntil }

function rand(n) { return Math.floor(Math.random() * n); }
function hmac(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest('hex'); }
function safeEqual(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); }

// 拼图块轮廓（右侧圆弧凸起）
const PIECE_PATH = 'M0,0 L35,0 L35,13 A12,12 0 1 0 35,37 L35,50 L0,50 Z';

// ===== 生成拼图 =====

function generate() {
  const bgs = fs.readdirSync(BG_DIR).filter(f => f.endsWith('.jpg'));
  if (!bgs.length) throw new Error('缺少验证码背景图');
  const bg = bgs[rand(bgs.length)];
  const x = 60 + rand(181);            // 60..240
  const y = 20 + rand(111);            // 20..130
  const token = crypto.randomBytes(16).toString('hex');
  store.set(token, { bg, x, y, expires: Date.now() + TOKEN_TTL, hole: null, piece: null });
  // 清理过期
  const now = Date.now();
  if (store.size > 200) { for (const [k, v] of store) if (now > v.expires) store.delete(k); }
  return { token, bg: '/captcha/bg/' + bg, x, y };
}

function getRecord(token) {
  const rec = store.get(token);
  if (!rec) return null;
  if (Date.now() > rec.expires) { store.delete(token); return null; }
  return rec;
}

// 生成缺口背景（深色缺口标识目标位置）
async function renderHole(rec) {
  if (rec.hole) return rec.hole;
  const bgBuf = fs.readFileSync(path.join(BG_DIR, rec.bg));
  const holeSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${BG_W}" height="${BG_H}"><path d="${PIECE_PATH}" fill="rgba(15,15,15,0.55)" transform="translate(${rec.x} ${rec.y})"/></svg>`);
  rec.hole = await sharp(bgBuf).composite([{ input: holeSvg, blend: 'over' }]).jpeg({ quality: 85 }).toBuffer();
  return rec.hole;
}

// 生成拼图块（透明底、带圆弧凸起的图片碎片）
async function renderPiece(rec) {
  if (rec.piece) return rec.piece;
  const bgBuf = fs.readFileSync(path.join(BG_DIR, rec.bg));
  const raw = await sharp(bgBuf).extract({ left: rec.x, top: rec.y, width: PIECE_W, height: PIECE_H }).png().toBuffer();
  const maskSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PIECE_W}" height="${PIECE_H}"><path d="${PIECE_PATH}" fill="#fff"/></svg>`);
  rec.piece = await sharp(raw).composite([{ input: maskSvg, blend: 'dest-in' }]).png().toBuffer();
  return rec.piece;
}

// 校验滑块位置（一次性使用）
function verify(token, offset) {
  const rec = getRecord(token);
  if (!rec) return false;
  store.delete(token); // 一次性
  const off = parseFloat(offset);
  if (!Number.isFinite(off)) return false;
  return Math.abs(off - rec.x) <= TOLERANCE;
}

// ===== 通过凭证 Cookie（HMAC 签名）=====

function setCaptchaCookie(res) {
  const expires = Math.floor(Date.now() / 1000) + AUTH_MAX_AGE;
  // 三段格式（与 auth cookie 一致，供 checkSignedCookie 统一校验）
  res.setHeader('Set-Cookie', `${CAPTCHA_COOKIE}=${expires}.ok.${hmac('captcha:ok:' + expires)}; Max-Age=${AUTH_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`);
}

function setAuthCookie(res, user, remember) {
  const expires = Math.floor(Date.now() / 1000) + AUTH_MAX_AGE;
  const value = expires + '.' + user + '.' + hmac('auth:' + user + ':' + expires);
  const maxAge = remember ? '; Max-Age=' + AUTH_MAX_AGE : ''; // 不勾选记住我 → 会话 Cookie
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${value}${maxAge}; Path=/; HttpOnly; SameSite=Lax`);
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

function checkSignedCookie(req, name, prefix) {
  const value = parseCookies(req)[name];
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null; // 统一三段格式：expires.payload.mac
  const expires = parseInt(parts[0], 10);
  if (!Number.isFinite(expires) || expires < Date.now() / 1000) return null;
  const payload = prefix + parts.slice(1, -1).join('.') + ':' + expires;
  if (!safeEqual(parts[parts.length - 1], hmac(payload))) return null;
  return prefix === 'auth:' ? parts[1] : 'ok';
}

// 是否已通过人机验证
function captchaCookieOK(req) { return checkSignedCookie(req, CAPTCHA_COOKIE, 'captcha:') !== null; }

// 是否持有有效会话（返回用户名或 null）
function authCookieOK(req) { return checkSignedCookie(req, AUTH_COOKIE, 'auth:'); }

// ===== 登录校验 =====

function verifyLogin(user, pass) {
  const u = process.env.AUTH_USER || '';
  const p = process.env.AUTH_PASS || '';
  if (!u || !p) return false;
  return safeEqual(String(user || ''), u) && safeEqual(String(pass || ''), p);
}

function clientIP(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

function loginLocked(req) {
  const rec = failedLogins.get(clientIP(req));
  if (!rec) return false;
  const now = Date.now();
  if (rec.lockedUntil && now < rec.lockedUntil) return true;
  if (now - rec.firstFailAt > FAIL_WINDOW) { failedLogins.delete(clientIP(req)); return false; }
  return false;
}

function recordLoginFail(req) {
  const ip = clientIP(req);
  const now = Date.now();
  let rec = failedLogins.get(ip);
  if (!rec || now - rec.firstFailAt > FAIL_WINDOW) rec = { count: 0, firstFailAt: now, lockedUntil: 0 };
  rec.count++;
  if (rec.count >= MAX_FAILS) rec.lockedUntil = now + FAIL_WINDOW;
  failedLogins.set(ip, rec);
}

function clearLoginFails(req) { failedLogins.delete(clientIP(req)); }

module.exports = {
  generate, getRecord, renderHole, renderPiece, verify,
  setCaptchaCookie, setAuthCookie, captchaCookieOK, authCookieOK,
  verifyLogin, loginLocked, recordLoginFail, clearLoginFails,
  CAPTCHA_COOKIE, AUTH_COOKIE, BG_DIR, BG_W, BG_H, PIECE_W, PIECE_H, TOLERANCE,
};
