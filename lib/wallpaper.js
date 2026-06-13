// lib/wallpaper.js - 壁纸存储与API
const fs = require('fs');
const { execSync } = require('child_process');
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

// Bigjpg AI 超分（在线 API，免费 20 张/月，支持 2x/4x）
async function upscaleViaBigjpg(imageUrl, enlargeFactor = 2, style = 'art') {
  const apiKey = process.env.BIGJPG_API_KEY;
  if (!apiKey) return { error: '未配置 Bigjpg API Key' };

  try {
    // 1. 提交任务
    const x2Map = { 2: '1', 4: '2', 8: '3', 16: '4' };
    const submitResp = await fetch('https://bigjpg.com/api/task/', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        style: style,          // 'art' 插画 / 'photo' 照片
        noise: '0',           // 降噪级别
        x2: x2Map[enlargeFactor] || '1',
        input: imageUrl,
      }),
    });
    const submitData = await submitResp.json();
    if (!submitData.tid) return { error: 'Bigjpg 提交失败: ' + JSON.stringify(submitData) };

    // 2. 轮询等待完成（最长等 120 秒）
    const tid = submitData.tid;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000)); // 每 2 秒查一次
      const statusResp = await fetch('https://bigjpg.com/api/task/' + tid);
      const statusData = await statusResp.json();
      if (statusData.status === 'success' && statusData.url) {
        // 3. 下载结果
        const imgResp = await fetch(statusData.url);
        const buffer = Buffer.from(await imgResp.arrayBuffer());
        return { ok: true, buffer };
      }
      if (statusData.status === 'error') {
        return { error: 'Bigjpg 处理失败' };
      }
      // status: 'new' 或 'processing'，继续等
    }
    return { error: 'Bigjpg 处理超时' };
  } catch (e) {
    return { error: 'Bigjpg API 异常: ' + e.message };
  }
}

// AI 超清：Bigjpg API 优先 → 增强型 sharp 兜底
// sharp 配置拉满：lanczos3 + 自适应锐化 + 去噪 + progressive JPEG
async function upscaleWallpaper(id, serverUrl) {
  const db = loadDB();
  const wp = db.find(w => w.id === id);
  if (!wp) return { error: '壁纸不存在' };
  const fp = path.join(WALLPAPER_DIR, wp.filename);
  if (!fs.existsSync(fp)) return { error: '文件不存在' };
  const ext = path.extname(wp.filename).toLowerCase();
  if (ext === '.svg' || ext === '.gif') return { error: 'SVG/GIF 不支持' };

  const sharp = require('sharp');
  const srcMeta = await sharp(fp).metadata();
  const srcW = srcMeta.width, srcH = srcMeta.height;
  if (!srcW || !srcH) return { error: '无法读取图像尺寸' };

  // 尝试 Bigjpg AI 超分（需 BIGJPG_API_KEY 且 VIP 账户）
  if (process.env.BIGJPG_API_KEY && serverUrl) {
    const imageUrl = serverUrl + '/api/wallpaper/' + encodeURIComponent(wp.filename);
    const apiResult = await upscaleViaBigjpg(imageUrl, 2, 'art');
    if (apiResult.ok) {
      const bakPath = fp + '.bak';
      if (!fs.existsSync(bakPath)) fs.copyFileSync(fp, bakPath);
      const newName = wp.filename.replace(ext, '.jpg');
      const newFp = path.join(WALLPAPER_DIR, newName);
      fs.writeFileSync(newFp, apiResult.buffer);
      const stat = fs.statSync(newFp);
      if (newFp !== fp && fs.existsSync(fp)) fs.unlinkSync(fp);
      wp.filename = newName; wp.size = stat.size;
      saveDB(db);
      const apiMeta = await sharp(newFp).metadata();
      return { ok: true, wallpaper: wp, sizeBefore: fs.statSync(bakPath).size, sizeAfter: stat.size, resolution: `${srcW}x${srcH} → ${apiMeta.width}x${apiMeta.height} (Bigjpg AI)` };
    }
    console.warn('[Wallpaper] Bigjpg failed, falling back to sharp:', apiResult.error);
  }

  // === 增强型 sharp 超分 ===
  const maxDim = 2560;
  const longSide = Math.max(srcW, srcH);
  const scale = Math.min(2, maxDim / longSide);
  const bakPath = fp + '.bak';
  if (!fs.existsSync(bakPath)) fs.copyFileSync(fp, bakPath);

  const tmpPath = fp + '.upscale.jpg';
  try {
    if (scale < 1.01) {
      // 原图已够大：去噪 + 强锐化
      await sharp(fp)
        .median(1)                                      // 去除压缩噪点
        .sharpen({ sigma: 0.8, m1: 0.3, m2: 0.6 })    // 强锐化
        .jpeg({ quality: 92, progressive: true, mozjpeg: true })
        .toFile(tmpPath);
    } else {
      const newW = Math.round(srcW * scale);
      const newH = Math.round(srcH * scale);
      await sharp(fp)
        .median(1)                                      // 先去噪
        .resize(newW, newH, { kernel: 'lanczos3', fit: 'inside', fastShrinkOnLoad: false })
        .sharpen({ sigma: 0.7, m1: 0.25, m2: 0.55 })   // 自适应锐化
        .jpeg({ quality: 92, progressive: true, mozjpeg: true })
        .toFile(tmpPath);
    }

    const stat = fs.statSync(tmpPath);
    if (stat.size < 1024 * 100) { fs.unlinkSync(tmpPath); return { error: '输出过小' }; }

    const newName = wp.filename.replace(ext, '.jpg');
    const newFp = path.join(WALLPAPER_DIR, newName);
    if (newFp !== fp && fs.existsSync(fp)) fs.unlinkSync(fp);
    fs.renameSync(tmpPath, newFp);
    wp.filename = newName; wp.size = stat.size;
    saveDB(db);
    return {
      ok: true, wallpaper: wp,
      sizeBefore: fs.statSync(bakPath).size, sizeAfter: stat.size,
      resolution: scale < 1.01 ? `${srcW}x${srcH} → 降噪锐化` : `${srcW}x${srcH} → ${newW}x${newH} (${scale.toFixed(1)}x)`,
    };
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    return { error: '处理失败: ' + (e.message || '').slice(0, 200) };
  }
}

// 替换壁纸文件（用于浏览器端 AI 超清后回传）
function replaceWallpaperFile(id, buffer) {
  const db = loadDB();
  const wp = db.find(w => w.id === id);
  if (!wp) return { error: '壁纸不存在' };
  const oldExt = path.extname(wp.filename);
  const baseName = wp.filename.replace(oldExt, '');
  const newName = baseName + '.jpg';
  const newFp = path.join(WALLPAPER_DIR, newName);
  const oldFp = path.join(WALLPAPER_DIR, wp.filename);
  // 始终备份旧文件
  const bakPath = path.join(WALLPAPER_DIR, baseName + oldExt + '.bak');
  if (fs.existsSync(oldFp) && !fs.existsSync(bakPath)) {
    fs.copyFileSync(oldFp, bakPath);
  }
  fs.writeFileSync(newFp, buffer);
  if (oldFp !== newFp && fs.existsSync(oldFp)) fs.unlinkSync(oldFp);
  wp.filename = newName;
  wp.size = buffer.length;
  saveDB(db);
  return { ok: true, wallpaper: wp };
}

module.exports = { listWallpapers, getCurrentWallpaper, setCurrentWallpaper, deleteWallpaper, saveWallpaperFromUrl, setRandomWallpaper, getNextWallpaper, upscaleWallpaper, replaceWallpaperFile, WALLPAPER_DIR };
