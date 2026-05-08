// lib/storage.js - 文件 & 笔记存储（Async）
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const FILES_DIR = path.join(__dirname, '..', 'files');
const TRASH_DIR = path.join(__dirname, '..', '.trash');
const NOTES_DIR = path.join(__dirname, '..', 'notes');
const MAX_STORAGE = 20 * 1024 * 1024 * 1024; // 20GB

// 确保目录存在
async function ensureDirs() {
  for (const d of [FILES_DIR, TRASH_DIR, NOTES_DIR]) {
    try { await fsp.mkdir(d, { recursive: true }); } catch {}
  }
}
ensureDirs();

// 递归列出目录（含子文件夹）
async function scanDir(dir, base = dir) {
  const results = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fp = path.join(dir, entry.name);
      const stat = await fsp.stat(fp);
      const rel = path.relative(base, fp);
      results.push({
        name: rel, path: fp, size: stat.size, mtime: stat.mtime.toISOString(),
        isDir: stat.isDirectory(),
      });
      if (stat.isDirectory()) results.push(...await scanDir(fp, base));
    }
  } catch {}
  return results;
}

// ===== 存储用量（带缓存） =====
let _dirSizeCache = { size: 0, time: 0, ttl: 30000 };

async function dirSize(dir) {
  if (dir.includes('.trash')) return 0;
  const now = Date.now();
  if (now - _dirSizeCache.time < _dirSizeCache.ttl) return _dirSizeCache.size;
  let size = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fp = path.join(dir, entry.name);
      try {
        const stat = await fsp.stat(fp);
        size += entry.isDirectory() ? await dirSize(fp) : stat.size;
      } catch {}
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

async function getStatus() {
  const total = os.totalmem(), free = os.freemem(), used = total - free;
  const pct = Math.round((used / total) * 100);
  let uptime = '';
  const u = os.uptime();
  const d = Math.floor(u / 86400), h = Math.floor((u % 86400) / 3600), m = Math.floor((u % 3600) / 60);
  if (d > 0) uptime += d + '天';
  uptime += h + '时' + m + '分';
  const usedStorage = await dirSize(FILES_DIR);
  return {
    mem_used: fmtSize(used), mem_total: fmtSize(total), mem_pct: pct,
    cpu: os.loadavg()[0].toFixed(1), disk_free: '41G', uptime,
    storage_used: usedStorage, storage_max: MAX_STORAGE,
    storage_pct: Math.max(Math.round((usedStorage / MAX_STORAGE) * 1000) / 10, usedStorage > 0 ? 0.1 : 0),
    storage_used_h: fmtSize(usedStorage), storage_max_h: '20G',
  };
}

async function listFiles(dirRel = '') {
  const dir = path.join(FILES_DIR, dirRel || '');
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      const fp = path.join(dir, entry.name);
      const stat = await fsp.stat(fp);
      items.push({
        name: entry.name,
        relPath: dirRel ? dirRel + '/' + entry.name : entry.name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        isDir: entry.isDirectory(),
      });
    }
    return items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return new Date(b.mtime) - new Date(a.mtime);
    });
  } catch { return []; }
}

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

async function createFolder(dirRel) {
  const dir = path.join(FILES_DIR, dirRel || '');
  try {
    await fsp.access(dir);
    return { error: '文件夹已存在' };
  } catch {
    await fsp.mkdir(dir, { recursive: true });
    return { ok: true, name: dirRel || '根目录' };
  }
}

async function deleteFolder(dirRel) {
  if (!dirRel || dirRel === '.' || dirRel === '/') return { error: '不能删除根目录' };
  const dir = path.join(FILES_DIR, dirRel);
  try {
    await fsp.access(dir);
    const trashTarget = path.join(TRASH_DIR, Date.now() + '_' + path.basename(dir));
    await fsp.rename(dir, trashTarget);
    invalidateSizeCache();
    return { ok: true };
  } catch { return { error: '文件夹不存在' }; }
}

async function renameFolder(dirRel, newName) {
  if (!dirRel || !newName) return { error: '缺少参数' };
  const oldPath = path.join(FILES_DIR, dirRel);
  const newPath = path.join(FILES_DIR, path.dirname(dirRel), newName);
  try {
    await fsp.access(oldPath);
  } catch { return { error: '文件夹不存在' }; }
  try {
    await fsp.access(newPath);
    return { error: '目标名称已存在' };
  } catch {}
  await fsp.rename(oldPath, newPath);
  return { ok: true, newName };
}

async function uploadFiles(parts, maxSize, subDir = '') {
  const fileParts = parts.filter(p => p.filename);
  if (!fileParts.length) return { error: 'no file' };
  let totalNew = 0;
  for (const fp of fileParts) totalNew += fp.data.length;
  invalidateSizeCache();
  const current = await dirSize(FILES_DIR);
  if (current + totalNew > maxSize) {
    return { error: `空间不足！剩余 ${((maxSize - current) / 1024 / 1024 / 1024).toFixed(1)}GB` };
  }
  const targetDir = path.join(FILES_DIR, subDir || '');
  await fsp.mkdir(targetDir, { recursive: true });
  const results = [];
  for (const fp of fileParts) {
    let finalName = safeName(fp.filename || 'unnamed');
    const ext = path.extname(finalName), base = path.basename(finalName, ext);
    let counter = 1;
    while (true) {
      try {
        await fsp.access(path.join(targetDir, finalName));
        finalName = base + '_' + (counter++) + ext;
      } catch { break; }
    }
    await fsp.writeFile(path.join(targetDir, finalName), fp.data);
    results.push({ name: finalName, size: fp.data.length });
  }
  return { uploaded: results };
}

async function deleteFile(name) {
  const fp = path.join(FILES_DIR, name);
  try {
    await fsp.access(fp);
    const trashPath = path.join(TRASH_DIR, Date.now() + '_' + path.basename(name).replace(/\//g, '_'));
    await fsp.rename(fp, trashPath);
    invalidateSizeCache();
    return { ok: true };
  } catch { return { error: 'not found' }; }
}

async function emptyTrash() {
  try {
    const entries = await fsp.readdir(TRASH_DIR);
    for (const f of entries) {
      await fsp.rm(path.join(TRASH_DIR, f), { recursive: true, force: true });
    }
    invalidateSizeCache();
  } catch {}
  return { ok: true };
}

async function listTrash() {
  try {
    const entries = await fsp.readdir(TRASH_DIR, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      const fp = path.join(TRASH_DIR, entry.name);
      const stat = await fsp.stat(fp);
      items.push({ name: entry.name, size: stat.size, mtime: stat.mtime.toISOString(), isDir: entry.isDirectory() });
    }
    return items.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
  } catch { return []; }
}

async function restoreFromTrash(name) {
  const trashPath = path.join(TRASH_DIR, name);
  try {
    await fsp.access(trashPath);
  } catch { return { error: '文件不在回收站' }; }
  const originalName = name.replace(/^\d+_/, '');
  let destPath = path.join(FILES_DIR, originalName);
  let counter = 1;
  while (true) {
    try {
      await fsp.access(destPath);
      const ext = path.extname(originalName), base = path.basename(originalName, ext);
      destPath = path.join(FILES_DIR, base + '_' + (counter++) + ext);
    } catch { break; }
  }
  await fsp.rename(trashPath, destPath);
  invalidateSizeCache();
  return { ok: true, name: path.basename(destPath) };
}

async function getFilePath(name) {
  const fp = path.join(FILES_DIR, name);
  try {
    const stat = await fsp.stat(fp);
    if (!stat.isDirectory()) return fp;
  } catch {}
  return null;
}

async function getFilePreview(name) {
  const fp = path.join(FILES_DIR, name);
  try {
    await fsp.access(fp);
  } catch { return null; }
  const ext = path.extname(name).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) {
    return { redirect: '/api/dl/' + encodeURIComponent(name) };
  }
  const textExts = { '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.csv': 'text/csv', '.log': 'text/plain', '.html': 'text/html', '.css': 'text/css',
    '.js': 'text/javascript', '.xml': 'text/xml' };
  const stat = await fsp.stat(fp);
  const isText = ext in textExts || !['.pdf', '.doc', '.docx', '.zip', '.tar', '.gz', '.rar', '.7z',
    '.mp4', '.mp3', '.mov', '.avi', '.exe', '.bin'].includes(ext);
  if (!isText) return { preview: false, size: stat.size, mtime: stat.mtime.toISOString() };
  const data = await fsp.readFile(fp);
  return { type: textExts[ext] || 'text/plain', data, size: stat.size };
}

// ===== 笔记操作 =====

async function listNotes(q) {
  try {
    const files = await fsp.readdir(NOTES_DIR);
    let notes = files.filter(f => f.endsWith('.json')).map(async f => {
      const raw = JSON.parse(await fsp.readFile(path.join(NOTES_DIR, f), 'utf8'));
      return { id: raw.id, title: raw.title, updated: raw.updated, preview: (raw.content || '').slice(0, 80), tags: raw.tags||[], pinned: raw.pinned||false };
    });
    let results = await Promise.all(notes);
    results.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updated) - new Date(a.updated);
    });
    if (q) {
      const lower = q.toLowerCase();
      results = results.filter(n => n.title.toLowerCase().includes(lower) || (n.tags||[]).some(t => t.toLowerCase().includes(lower)));
    }
    return results;
  } catch { return []; }
}

async function saveNote(body) {
  const id = body.id || crypto.randomBytes(8).toString('hex');
  let existing = {};
  if (body.id) {
    try { existing = JSON.parse(await fsp.readFile(path.join(NOTES_DIR, id + '.json'), 'utf8')); } catch {}
  }
  const note = {
    id, title: body.title, content: body.content || '',
    tags: body.tags || existing.tags || [],
    pinned: body.pinned !== undefined ? body.pinned : (existing.pinned || false),
    created: body.created || existing.created || new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(NOTES_DIR, id + '.json'), JSON.stringify(note, null, 2));
  return { id, updated: note.updated };
}

async function getNote(id) {
  const fp = path.join(NOTES_DIR, id + '.json');
  try {
    return JSON.parse(await fsp.readFile(fp, 'utf8'));
  } catch { return null; }
}

async function deleteNote(id) {
  const fp = path.join(NOTES_DIR, id + '.json');
  try {
    await fsp.unlink(fp);
    return { ok: true };
  } catch { return { error: 'not found' }; }
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
