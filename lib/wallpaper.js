// lib/wallpaper.js - 壁纸存储与API
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WALLPAPER_DIR = path.join(__dirname, '..', 'wallpapers');
const WALLPAPER_DB = path.join(WALLPAPER_DIR, '.wallpapers.json');

// 确保目录存在
if (!fs.existsSync(WALLPAPER_DIR)) fs.mkdirSync(WALLPAPER_DIR, { recursive: true });

function loadDB() {
  if (!fs.existsSync(WALLPAPER_DB)) return [];
  try { return JSON.parse(fs.readFileSync(WALLPAPER_DIR + '/.wallpapers.json', 'utf8')); }
  catch { return []; }
}

function saveDB(db) {
  fs.writeFileSync(WALLPAPER_DB, JSON.stringify(db, null, 2));
}

// 列出所有壁纸（自动修复：为孤立文件创建数据库条目）
function listWallpapers() {
  const db = loadDB();
  // 扫描 WALLPAPER_DIR 中未被 DB 记录的图片文件
  const known = new Set(db.map(w => w.filename));
  const orphans = [];
  try {
    const files = fs.readdirSync(WALLPAPER_DIR);
    for (const f of files) {
      if (f === '.wallpapers.json' || known.has(f)) continue;
      const fp = path.join(WALLPAPER_DIR, f);
      const stat = fs.statSync(fp);
      if (!stat.isFile()) continue;
      const ext = path.extname(f).toLowerCase();
      if (!['.jpg','.jpeg','.png','.gif','.webp','.bmp','.svg'].includes(ext)) continue;
      orphans.push({
        id: crypto.randomBytes(8).toString('hex'),
        filename: f,
        path: '/wallpaper/' + f,
        url: '',
        sessionId: '',
        size: stat.size,
        addedAt: new Date().toISOString(),
        current: false,
      });
    }
  } catch {}
  if (orphans.length) {
    db.push(...orphans);
    saveDB(db);
  }
  return db;
}

// 获取当前壁纸（不再回退到第一张）
function getCurrentWallpaper() {
  const db = loadDB();
  return db.find(w => w.current) || null;
}

// 设置当前壁纸
function setCurrentWallpaper(id) {
  const db = loadDB();
  db.forEach(w => w.current = w.id === id);
  saveDB(db);
  return db.find(w => w.id === id);
}

// 删除壁纸
function deleteWallpaper(id) {
  const db = loadDB();
  const idx = db.findIndex(w => w.id === id);
  if (idx === -1) return { error: 'not found' };
  const wp = db[idx];
  // 删除文件
  const fp = path.join(WALLPAPER_DIR, wp.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  // 从数据库删除
  db.splice(idx, 1);
  saveDB(db);
  return { ok: true };
}

// 保存采集的图片为壁纸
function saveWallpaperFromUrl(url, filename, sessionId) {
  const id = crypto.randomBytes(8).toString('hex');
  const destPath = path.join(WALLPAPER_DIR, filename);
  
  // 如果是 session 中的图片，从 scrape 目录复制
  if (sessionId) {
    const srcPath = path.join(__dirname, '..', 'scrape', sessionId, filename);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
    } else {
      return { error: '源文件不存在' };
    }
  }
  
  if (!fs.existsSync(destPath)) return { error: '文件保存失败' };
  
  const stat = fs.statSync(destPath);
  const wp = {
    id, filename,
    path: '/wallpaper/' + filename,
    url: url || '',
    sessionId: sessionId || '',
    size: stat.size,
    addedAt: new Date().toISOString(),
    current: false,
  };
  
  const db = loadDB();
  db.unshift(wp);
  saveDB(db);
  return wp;
}

// 设置随机壁纸
function setRandomWallpaper() {
  const db = loadDB();
  const candidates = db.filter(w => !w.current);
  if (!candidates.length && db.length) {
    // 只有一张时也允许
    setCurrentWallpaper(db[0].id);
    return db[0];
  }
  if (!candidates.length) return null;
  const wp = candidates[Math.floor(Math.random() * candidates.length)];
  setCurrentWallpaper(wp.id);
  return wp;
}

// 获取下一张壁纸（轮播用，循环）
function getNextWallpaper() {
  const db = loadDB();
  if (!db.length) return null;
  const cur = db.find(w => w.current);
  if (!cur) {
    setCurrentWallpaper(db[0].id);
    return db[0];
  }
  const curIdx = db.indexOf(cur);
  const next = db[(curIdx + 1) % db.length];
  setCurrentWallpaper(next.id);
  return next;
}

module.exports = { listWallpapers, getCurrentWallpaper, setCurrentWallpaper, deleteWallpaper, saveWallpaperFromUrl, setRandomWallpaper, getNextWallpaper, WALLPAPER_DIR };
