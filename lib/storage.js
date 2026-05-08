// lib/storage.js - 文件 & 笔记存储
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const FILES_DIR = path.join(__dirname, '..', 'files');
const TRASH_DIR = path.join(__dirname, '..', '.trash');
const NOTES_DIR = path.join(__dirname, '..', 'notes');
const MAX_STORAGE = 20 * 1024 * 1024 * 1024; // 20GB

[FILES_DIR, TRASH_DIR, NOTES_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// 递归列出目录（含子文件夹）
function scanDir(dir, base = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const stat = fs.statSync(fp);
    const rel = path.relative(base, fp);
    results.push({
      name: rel, path: fp, size: stat.size, mtime: stat.mtime.toISOString(),
      isDir: stat.isDirectory(),
    });
    if (stat.isDirectory()) results.push(...scanDir(fp, base));
  }
  return results;
}

// ===== 存储用量（带缓存） =====

let _dirSizeCache = { size: 0, time: 0, ttl: 30000 }; // 30秒缓存

function dirSize(dir) {
  // 排除回收站
  if (dir.includes('.trash')) return 0;
  const now = Date.now();
  if (now - _dirSizeCache.time < _dirSizeCache.ttl) return _dirSizeCache.size;
  let size = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      const s = fs.statSync(path.join(dir, f));
      size += s.isDirectory() ? dirSize(path.join(dir, f)) : s.size;
    }
  } catch {}
  _dirSizeCache = { size, time: now, ttl: 30000 };
  return size;
}

function invalidateSizeCache() { _dirSizeCache.time = 0; }

function fmtSize(sz) {
  if (sz < 1024) return sz + 'B';
  if (sz < 1024 * 1024) return (sz / 1024).toFixed(1) + 'K';
  if (sz < 1024 * 1024 * 1024) return (sz / 1024 / 1024).toFixed(1) + 'M';
  return (sz / 1024 / 1024 / 1024).toFixed(2) + 'G';
}

function getStatus() {
  const total = os.totalmem(), free = os.freemem(), used = total - free;
  const pct = Math.round((used / total) * 100);
  let uptime = '';
  const u = os.uptime();
  const d = Math.floor(u / 86400), h = Math.floor((u % 86400) / 3600), m = Math.floor((u % 3600) / 60);
  if (d > 0) uptime += d + '天';
  uptime += h + '时' + m + '分';
  const usedStorage = dirSize(FILES_DIR);
  return {
    mem_used: fmtSize(used), mem_total: fmtSize(total), mem_pct: pct,
    cpu: os.loadavg()[0].toFixed(1), disk_free: '41G', uptime,
    storage_used: usedStorage, storage_max: MAX_STORAGE,
    storage_pct: Math.max(Math.round((usedStorage / MAX_STORAGE) * 1000) / 10, usedStorage > 0 ? 0.1 : 0),
    storage_used_h: fmtSize(usedStorage), storage_max_h: '20G',
  };
}

/**
 * 列出指定目录下的直接子文件和子文件夹（不递归）
 * @param {string} dirRel - 相对于 FILES_DIR 的路径
 */
function listFiles(dirRel = '') {
  const dir = path.join(FILES_DIR, dirRel || '');
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const name of fs.readdirSync(dir)) {
    const fp = path.join(dir, name);
    const stat = fs.statSync(fp);
    items.push({
      name,
      relPath: dirRel ? dirRel + '/' + name : name,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      isDir: stat.isDirectory(),
    });
  }
  // 文件夹在前，按时间排序
  return items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return new Date(b.mtime) - new Date(a.mtime);
  });
}

/** 生成面包屑路径 */
function breadcrumb(dirRel) {
  if (!dirRel) return [{ name: '📁 根目录', path: '' }];
  const parts = dirRel.split('/');
  const crumbs = [{ name: '📁 根目录', path: '' }];
  let acc = '';
  for (const p of parts) {
    acc = acc ? acc + '/' + p : p;
    crumbs.push({ name: '📁 ' + p, path: acc });
  }
  return crumbs;
}

function createFolder(dirRel) {
  const dir = path.join(FILES_DIR, dirRel || '');
  if (fs.existsSync(dir)) return { error: '文件夹已存在' };
  fs.mkdirSync(dir, { recursive: true });
  return { ok: true, name: dirRel || '根目录' };
}

function deleteFolder(dirRel) {
  if (!dirRel || dirRel === '.' || dirRel === '/') return { error: '不能删除根目录' };
  const dir = path.join(FILES_DIR, dirRel);
  if (!fs.existsSync(dir)) return { error: '文件夹不存在' };
  // 移到回收站
  const trashTarget = path.join(TRASH_DIR, Date.now() + '_' + path.basename(dir));
  fs.renameSync(dir, trashTarget);
  invalidateSizeCache();
  return { ok: true };
}

function renameFolder(dirRel, newName) {
  if (!dirRel || !newName) return { error: '缺少参数' };
  const oldPath = path.join(FILES_DIR, dirRel);
  if (!fs.existsSync(oldPath)) return { error: '文件夹不存在' };
  const newPath = path.join(FILES_DIR, path.dirname(dirRel), newName);
  if (fs.existsSync(newPath)) return { error: '目标名称已存在' };
  fs.renameSync(oldPath, newPath);
  return { ok: true, newName };
}

function uploadFiles(parts, maxSize, subDir = '') {
  const fileParts = parts.filter(p => p.filename);
  if (!fileParts.length) return { error: 'no file' };
  let totalNew = 0;
  for (const fp of fileParts) totalNew += fp.data.length;
  invalidateSizeCache();
  const current = dirSize(FILES_DIR);
  if (current + totalNew > maxSize) {
    return { error: `空间不足！剩余 ${((maxSize - current) / 1024 / 1024 / 1024).toFixed(1)}GB` };
  }
  const targetDir = path.join(FILES_DIR, subDir || '');
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const results = [];
  for (const fp of fileParts) {
    let finalName = safeName(fp.filename || 'unnamed');
    const ext = path.extname(finalName), base = path.basename(finalName, ext);
    let counter = 1;
    while (fs.existsSync(path.join(targetDir, finalName)))
      finalName = base + '_' + (counter++) + ext;
    fs.writeFileSync(path.join(targetDir, finalName), fp.data);
    results.push({ name: finalName, size: fp.data.length });
  }
  return { uploaded: results };
}

function deleteFile(name) {
  const fp = path.join(FILES_DIR, name);
  if (!fs.existsSync(fp)) return { error: 'not found' };
  // 移到回收站而不是直接删除
  const trashPath = path.join(TRASH_DIR, Date.now() + '_' + path.basename(name).replace(/\//g, '_'));
  fs.renameSync(fp, trashPath);
  invalidateSizeCache();
  return { ok: true };
}

function emptyTrash() {
  if (!fs.existsSync(TRASH_DIR)) return { ok: true };
  for (const f of fs.readdirSync(TRASH_DIR)) {
    const fp = path.join(TRASH_DIR, f);
    fs.rmSync(fp, { recursive: true, force: true });
  }
  invalidateSizeCache();
  return { ok: true };
}

function listTrash() {
  if (!fs.existsSync(TRASH_DIR)) return [];
  return fs.readdirSync(TRASH_DIR).map(name => {
    const fp = path.join(TRASH_DIR, name);
    const stat = fs.statSync(fp);
    return { name, size: stat.size, mtime: stat.mtime.toISOString(), isDir: stat.isDirectory() };
  }).sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
}

function restoreFromTrash(name) {
  const trashPath = path.join(TRASH_DIR, name);
  if (!fs.existsSync(trashPath)) return { error: '文件不在回收站' };
  // 去掉时间戳前缀
  const originalName = name.replace(/^\d+_/, '');
  let destPath = path.join(FILES_DIR, originalName);
  let counter = 1;
  while (fs.existsSync(destPath)) {
    const ext = path.extname(originalName), base = path.basename(originalName, ext);
    destPath = path.join(FILES_DIR, base + '_' + (counter++) + ext);
  }
  fs.renameSync(trashPath, destPath);
  invalidateSizeCache();
  return { ok: true, name: path.basename(destPath) };
}

function getFilePath(name) {
  // 直接拼接路径（支持子目录）
  const fp = path.join(FILES_DIR, name);
  if (fs.existsSync(fp) && !fs.statSync(fp).isDirectory()) return fp;
  return null;
}

function getFilePreview(name) {
  const fp = path.join(FILES_DIR, name);
  if (!fs.existsSync(fp)) return null;
  const ext = path.extname(name).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) {
    return { redirect: '/api/dl/' + encodeURIComponent(name) };
  }
  const textExts = { '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.csv': 'text/csv', '.log': 'text/plain', '.html': 'text/html', '.css': 'text/css',
    '.js': 'text/javascript', '.xml': 'text/xml' };
  const stat = fs.statSync(fp);
  const isText = ext in textExts || !['.pdf', '.doc', '.docx', '.zip', '.tar', '.gz', '.rar', '.7z',
    '.mp4', '.mp3', '.mov', '.avi', '.exe', '.bin'].includes(ext);
  if (!isText) return { preview: false, size: stat.size, mtime: stat.mtime.toISOString() };
  return { type: textExts[ext] || 'text/plain', data: fs.readFileSync(fp), size: stat.size };
}

// ===== 笔记操作 =====

function listNotes(q) {
  let notes = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.json')).map(f => {
    const raw = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, f), 'utf8'));
    return { id: raw.id, title: raw.title, updated: raw.updated, preview: (raw.content || '').slice(0, 80), tags: raw.tags||[], pinned: raw.pinned||false };
  }).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.updated) - new Date(a.updated);
  });
  if (q) {
    const lower = q.toLowerCase();
    notes = notes.filter(n => n.title.toLowerCase().includes(lower) || (n.tags||[]).some(t => t.toLowerCase().includes(lower)));
  }
  return notes;
}

function saveNote(body) {
  const id = body.id || crypto.randomBytes(8).toString('hex');
  let existing = {};
  if (body.id) {
    try { existing = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, id + '.json'), 'utf8')); } catch {}
  }
  const note = {
    id, title: body.title, content: body.content || '',
    tags: body.tags || existing.tags || [],
    pinned: body.pinned !== undefined ? body.pinned : (existing.pinned || false),
    created: body.created || existing.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(NOTES_DIR, id + '.json'), JSON.stringify(note, null, 2));
  return { id, updated: note.updated };
}

function getNote(id) {
  const fp = path.join(NOTES_DIR, id + '.json');
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function deleteNote(id) {
  const fp = path.join(NOTES_DIR, id + '.json');
  if (!fs.existsSync(fp)) return { error: 'not found' };
  fs.unlinkSync(fp);
  return { ok: true };
}

// ===== 辅助 =====

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
}

function parseMultipart(buf, boundary) {
  const b = '--' + boundary;
  const parts = [];
  let idx = buf.indexOf(b);
  while (idx !== -1) {
    const end = buf.indexOf(b, idx + b.length);
    if (end === -1) break;
    const part = buf.slice(idx + b.length, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString();
      const nameMatch = headers.match(/name="([^"]+)"/);
      const fileMatch = headers.match(/filename="([^"]+)"/);
      if (nameMatch) {
        parts.push({
          name: nameMatch[1],
          filename: fileMatch ? fileMatch[1] : null,
          data: fileMatch ? part.slice(headerEnd + 4, part.length - 2) : part.slice(headerEnd + 4, part.length - 2).toString(),
        });
      }
    }
    idx = buf.indexOf(b, end > idx ? end : idx + 1);
  }
  return parts;
}

module.exports = {
  getStatus, listFiles, uploadFiles, deleteFile, getFilePath, getFilePreview,
  listNotes, saveNote, getNote, deleteNote,
  parseMultipart, safeName, dirSize, invalidateSizeCache, MAX_STORAGE,
  FILES_DIR, NOTES_DIR, TRASH_DIR,
  createFolder, deleteFolder, renameFolder, emptyTrash, listTrash, restoreFromTrash,
  scanDir, breadcrumb,
};
