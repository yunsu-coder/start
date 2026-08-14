// routes/wallpaper.js - 壁纸：管理/缩略图/原图/上传/中转站保存
const fs = require('fs');
const path = require('path');
const { listWallpapers, getCurrentWallpaper, setCurrentWallpaper, deleteWallpaper, saveWallpaperFromUrl, setRandomWallpaper, getNextWallpaper, upscaleWallpaper, replaceWallpaperFile, WALLPAPER_DIR } = require('../lib/wallpaper');
const { getFilePath, parseMultipart } = require('../lib/storage');
const { sendJSON, readBody, parseJSON } = require('../lib/http');
const { safeJoin, safeDecode } = require('../lib/safePath');

module.exports = {
  name: 'wallpaper',
  async handle(p, m, url, req, res) {
    // ===== 壁纸管理 API（放在通用路由之前）=====
    if (p === '/api/wallpaper/current' && m === 'PUT') {
      const body = parseJSON(await readBody(req));
      const wp = setCurrentWallpaper(body.id);
      sendJSON(res, 200, wp ? { ok: true, wallpaper: wp } : { error: 'not found' }); return true;
    }
    if (p === '/api/wallpaper/random' && m === 'POST') {
      const wp = setRandomWallpaper();
      sendJSON(res, 200, wp ? { ok: true, wallpaper: wp } : { error: 'no wallpapers' }); return true;
    }
    if (p === '/api/wallpaper/next' && m === 'POST') {
      const wp = getNextWallpaper();
      sendJSON(res, 200, wp ? { ok: true, wallpaper: wp } : { error: 'no wallpapers' }); return true;
    }
    if (p.startsWith('/api/wallpaper/del/') && m === 'DELETE') {
      const id = p.slice('/api/wallpaper/del/'.length);
      sendJSON(res, 200, deleteWallpaper(id)); return true;
    }
    if (p.startsWith('/api/wallpaper/upscale/') && m === 'POST') {
      const id = p.slice('/api/wallpaper/upscale/'.length);
      const serverUrl = (req.headers['x-forwarded-proto'] || 'http') + '://' + (req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
      const result = await upscaleWallpaper(id, serverUrl);
      sendJSON(res, result.ok ? 200 : 400, result); return true;
    }
    if (p.startsWith('/api/wallpaper/replace/') && m === 'POST') {
      const id = p.slice('/api/wallpaper/replace/'.length);
      const raw = await readBody(req, 50 * 1024 * 1024);
      const ct = req.headers['content-type'] || '';
      const match = ct.match(/boundary=(.+)/);
      if (!match) { sendJSON(res, 400, { error: 'no boundary' }); return true; }
      const parts = parseMultipart(raw, match[1]);
      const filePart = parts.find(pt => pt.filename);
      if (!filePart) { sendJSON(res, 400, { error: 'no file' }); return true; }
      const result = replaceWallpaperFile(id, filePart.data);
      sendJSON(res, result.ok ? 200 : 400, result); return true;
    }
    if (p === '/api/wallpaper/save' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      const wp = saveWallpaperFromUrl(body.url, body.filename, body.sessionId);
      sendJSON(res, 200, wp.id ? { ok: true, wallpaper: wp } : { error: wp.error }); return true;
    }

    // --- 壁纸缩略图（用于画廊快速加载）---
    if (p.startsWith('/api/wallpaper/thumb/')) {
      const fname = safeDecode(p.slice('/api/wallpaper/thumb/'.length));
      const fpath = safeJoin(WALLPAPER_DIR, fname);
      if (!fpath || !fs.existsSync(fpath)) { res.writeHead(404); return res.end('404'); }
      try {
        const sharp = require('sharp');
        const buf = await sharp(fpath).resize(300, 300, { fit: 'inside' }).jpeg({ quality: 72 }).toBuffer();
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' });
        res.end(buf);
      } catch {
        // sharp 处理失败时退回到直接返回原文件
        const ext = path.extname(fname).toLowerCase();
        const stat = fs.statSync(fpath);
        const mimes = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml' };
        res.writeHead(200, { 'Content-Type': mimes[ext]||'image/jpeg', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
        fs.createReadStream(fpath).pipe(res);
      }
      return true;
    }

    // --- 壁纸专用：直接返回原文件（注意：上面的管理路由必须放在这个通用 catch-all 之前）---
    if (p.startsWith('/api/wallpaper/')) {
      const fname = safeDecode(p.slice('/api/wallpaper/'.length));
      const fpath = safeJoin(WALLPAPER_DIR, fname);
      if (!fpath || !fs.existsSync(fpath)) { res.writeHead(404); return res.end('404'); }
      const ext = path.extname(fname).toLowerCase();
      const stat = fs.statSync(fpath);
      const mimes = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': mimes[ext]||'image/jpeg', 'Content-Length': stat.size, 'Cache-Control': 'max-age=86400' });
      fs.createReadStream(fpath).pipe(res);
      return true;
    }

    // 壁纸上传
    if (p === '/api/wallpapers/upload' && m === 'POST') {
      const raw = await readBody(req, 50 * 1024 * 1024);
      const boundary = (req.headers['content-type'] || '').match(/boundary=(.+)/);
      if (!boundary) { sendJSON(res, 400, { error: 'no boundary' }); return true; }
      const parts = parseMultipart(raw, boundary[1]);
      const filePart = parts.find(pt => pt.filename);
      if (!filePart) { sendJSON(res, 400, { error: 'no file' }); return true; }
      const ext = (filePart.filename || '').replace(/.*(\.[^.]+)/, '$1') || '.jpg';
      const safeName = 'wallpaper_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + ext;
      // 先写文件，再写入数据库（saveWallpaperFromUrl 要求文件已存在）
      const fp = path.join(WALLPAPER_DIR, safeName);
      fs.writeFileSync(fp, filePart.data);
      const wp = saveWallpaperFromUrl('', safeName, '');
      sendJSON(res, 200, { ok: true, wallpaper: { ...wp, filename: safeName, path: '/wallpaper/' + safeName } }); return true;
    }

    // ===== 壁纸 API =====
    if (p === '/api/wallpapers' && m === 'GET') { sendJSON(res, 200, { list: listWallpapers(), current: getCurrentWallpaper() }); return true; }
    if (p === '/api/wallpapers/save-file' && m === 'GET') {
      const relPath = url.searchParams.get('path');
      const fp = getFilePath(relPath);
      if (!fp) { sendJSON(res, 404, { error: 'file not found' }); return true; }
      const ext = path.extname(fp).toLowerCase() || '.jpg';
      const safeName = 'wallpaper_' + Date.now() + ext;
      const destFp = path.join(WALLPAPER_DIR, safeName);
      fs.copyFileSync(fp, destFp);
      const wp = saveWallpaperFromUrl('', safeName, '');
      sendJSON(res, 200, { ok: true, wallpaper: { ...wp, filename: safeName, path: '/wallpaper/' + safeName } }); return true;
    }
    if (p.startsWith('/wallpaper/')) {
      const fname = p.slice('/wallpaper/'.length);
      const fp = safeJoin(WALLPAPER_DIR, fname);
      if (!fp || !fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
      const ext = path.extname(fp).toLowerCase();
      const mime = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp' };
      res.writeHead(200, { 'Content-Type': mime[ext]||'image/*', 'Cache-Control': 'public, max-age=31536000' });
      fs.createReadStream(fp).pipe(res);
      return true;
    }

    return false;
  }
};
