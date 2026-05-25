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

// 列出所有壁纸
function listWallpapers() {
  return loadDB();
}

// 获取当前壁纸
function getCurrentWallpaper() {
  const db = loadDB();
  return db.find(w => w.current) || db[0] || null;
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
  // 如果删除的是当前壁纸，自动切换下一个
  if (wp.current && db.length > 0) {
    db[0].current = true;
    saveDB(db);
  }
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
  const db = loadDB().filter(w => !w.current);
  if (!db.length) return null;
  const wp = db[Math.floor(Math.random() * db.length)];
  setCurrentWallpaper(wp.id);
  return wp;
}

module.exports = { listWallpapers, getCurrentWallpaper, setCurrentWallpaper, deleteWallpaper, saveWallpaperFromUrl, setRandomWallpaper, WALLPAPER_DIR };
