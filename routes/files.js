// routes/files.js - 文件站：列表/上传/下载/预览/文件夹/回收站/流媒体/音频提取
const fs = require('fs');
const path = require('path');
const { listFiles, uploadFiles, deleteFile, getFilePath, getFilePreview, invalidateSizeCache, MAX_STORAGE,
        createFolder, deleteFolder, renameFolder, emptyTrash, listTrash, restoreFromTrash, deleteTrashItem,
        breadcrumb, FILES_DIR, parseMultipart } = require('../lib/storage');
const rag = require('../lib/rag');
const { sendJSON, readBody, parseJSON } = require('../lib/http');
const { safeJoin, safeDecode } = require('../lib/safePath');

module.exports = {
  name: 'files',
  async handle(p, m, url, req, res) {
    // --- 文件列表 ---
    if (p === '/api/files' && m === 'GET') {
      const dirRel = url.searchParams.get('dir') || '';
      const result = { files: listFiles(dirRel), breadcrumb: breadcrumb(dirRel), currentDir: dirRel };
      sendJSON(res, 200, result);
      return true;
    }

    // --- 文件上传 ---
    if (p === '/api/files' && m === 'POST') {
      const ct = req.headers['content-type'] || '';
      const match = ct.match(/boundary=(.+)/);
      if (!match) { sendJSON(res, 400, { error: 'need multipart' }); return true; }
      const raw = await readBody(req, 50 * 1024 * 1024);
      let buf;
      if (raw.path) { buf = fs.readFileSync(raw.path); fs.unlinkSync(raw.path); }
      else buf = raw;
      const parts = parseMultipart(buf, match[1]);
      const subDir = url.searchParams.get('dir') || '';
      const result = uploadFiles(parts, MAX_STORAGE, subDir);
      if (result.error) { sendJSON(res, result.error === 'no file' ? 400 : 413, result); return true; }
      // 文本文件加入 RAG 索引
      if (result.uploaded) {
        try {
          const textExts = ['.txt', '.md', '.json', '.csv', '.log', '.html', '.css',
                            '.js', '.xml', '.yml', '.yaml', '.env', '.py', '.sh', '.conf'];
          for (const f of result.uploaded) {
            const ext = path.extname(f.name).toLowerCase();
            if (textExts.includes(ext)) {
              const relPath = subDir ? subDir + '/' + f.name : f.name;
              const fp = safeJoin(FILES_DIR, relPath);
              if (fp && fs.existsSync(fp)) {
                const content = fs.readFileSync(fp, 'utf8').slice(0, 20000);
                const docId = 'file_' + relPath.replace(/[^a-zA-Z0-9_-]/g, '_');
                rag.indexDoc(docId, 'file', relPath, f.name, content, relPath, new Date().toISOString());
              }
            }
          }
        } catch (e) { console.error('[rag] 文件索引更新失败:', e.message); }
      }
      sendJSON(res, 200, result);
      return true;
    }

    // --- 删除文件 ---
    if (p.startsWith('/api/files/') && m === 'DELETE') {
      const name = safeDecode(p.slice('/api/files/'.length));
      const result = deleteFile(name);
      if (result.error) { sendJSON(res, 404, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }

    // --- 下载 ---
    if (p.startsWith('/api/dl/')) {
      const name = safeDecode(p.slice('/api/dl/'.length));
      const fp = getFilePath(name);
      if (!fp) { res.writeHead(404); return res.end('404'); }
      const stat = fs.statSync(fp);
      const mimeMap = { '.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
        '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm',
        '.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.mov':'video/quicktime' };
      res.writeHead(200, {
        'Content-Type': mimeMap[path.extname(name).toLowerCase()] || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Content-Length': stat.size,
      });
      fs.createReadStream(fp).pipe(res);
      return true;
    }

    // 内联预览（支持 Range 请求——视频拖动/PDF 翻页的基础）
    if (p.startsWith('/api/view/')) {
      const name = safeDecode(p.slice('/api/view/'.length));
      const fp = getFilePath(name);
      if (!fp) { res.writeHead(404); return res.end('404'); }
      const ext = path.extname(name).toLowerCase();
      const mimeMap = { '.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
        '.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.mp4':'video/mp4','.webm':'video/webm',
        '.mov':'video/quicktime','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.flac':'audio/flac',
        '.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '.epub':'application/epub+zip','.zip':'application/zip','.tar':'application/x-tar','.gz':'application/gzip',
        '.md':'text/markdown','.txt':'text/plain','.csv':'text/csv','.json':'application/json','.xml':'application/xml' };
      const stat = fs.statSync(fp);
      const mimeType = mimeMap[ext] || 'application/octet-stream';

      // 支持 Range 请求
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = (end - start) + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
        });
        fs.createReadStream(fp, { start, end }).pipe(res);
        return true;
      }

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Disposition': 'inline',
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(fp).pipe(res);
      return true;
    }

    // M3U 播放列表（点击自动用 VLC/系统播放器打开）
    if (p.startsWith('/api/m3u/')) {
      const name = safeDecode(p.slice('/api/m3u/'.length));
      const fp = getFilePath(name);
      if (!fp) { res.writeHead(404); return res.end('404'); }
      const fileUrl = `https://${req.headers.host}/api/view/${encodeURIComponent(name)}`;
      const m3u = `#EXTM3U\n#EXTINF:-1,${name}\n${fileUrl}\n`;
      res.writeHead(200, {
        'Content-Type': 'audio/x-mpegurl',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}.m3u"`,
        'Content-Length': Buffer.byteLength(m3u),
      });
      res.end(m3u);
      return true;
    }

    // --- 文件预览 ---
    if (p.startsWith('/api/preview/')) {
      const name = safeDecode(p.slice('/api/preview/'.length));
      const preview = getFilePreview(name);
      if (!preview) { res.writeHead(404); return res.end('404'); }
      if (preview.redirect) { res.writeHead(302, { Location: preview.redirect }); return res.end(); }
      if (preview.preview === false) { sendJSON(res, 200, preview); return true; }
      res.writeHead(200, { 'Content-Type': preview.type, 'Content-Length': preview.size });
      res.end(preview.data);
      return true;
    }

    // --- 提取视频音频 ---
    if (p === '/api/extract-audio' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.name) { sendJSON(res, 400, { error: '缺少文件名' }); return true; }
      const fp = getFilePath(body.name);
      if (!fp) { sendJSON(res, 404, { error: '文件不存在' }); return true; }
      const ext = path.extname(fp).toLowerCase();
      if (!['.mp4','.webm','.mov','.mkv','.avi','.flv','.wmv','.m4v'].includes(ext)) {
        sendJSON(res, 400, { error: '仅支持视频文件' });
        return true;
      }
      const outName = body.name.replace(ext, '.m4a');
      const outPath = safeJoin(FILES_DIR, outName);
      if (!outPath) { sendJSON(res, 403, { error: '非法路径' }); return true; }
      // 已有则直接返回
      if (fs.existsSync(outPath)) {
        sendJSON(res, 200, { name: outName, cached: true });
        return true;
      }
      // ffmpeg 提取最高质量音频流
      const { spawn } = require('child_process');
      let stderr = '';
      const ff = spawn('ffmpeg', ['-y','-i',fp,'-vn','-acodec','aac','-b:a','256k','-movflags','+faststart',outPath]);
      ff.stderr.on('data', d => { stderr += d.toString().slice(0, 500); });
      ff.on('close', (code) => {
        if (code === 0) sendJSON(res, 200, { name: outName });
        else { console.error('[ffmpeg] exit', code, stderr.slice(-300)); sendJSON(res, 500, { error: '提取失败: ' + (stderr.split('\n').pop() || 'exit=' + code) }); }
      });
      return true; // 异步等待 ffmpeg 完成
    }

    // --- 创建空文件（touch 命令和笔记导入用）---
    if (p === '/api/files/create' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      const name = (body.name || '').trim();
      if (!name) { sendJSON(res, 400, { error: 'name required' }); return true; }
      const subDir = body.dir || '';
      const relPath = subDir ? subDir + '/' + name : name;
      const fp = safeJoin(FILES_DIR, relPath);
      if (!fp) { sendJSON(res, 403, { error: '非法路径' }); return true; }
      if (fs.existsSync(fp)) { sendJSON(res, 409, { error: 'file exists' }); return true; }
      const dirPath = path.dirname(fp);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(fp, body.content || '');
      invalidateSizeCache();
      sendJSON(res, 200, { ok: true, name: relPath });
      return true;
    }

    // --- 写入文件内容（echo 命令用：创建或覆盖/追加）---
    if (p === '/api/files/write' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      const name = (body.name || '').trim();
      if (!name) { sendJSON(res, 400, { error: 'name required' }); return true; }
      const fp = safeJoin(FILES_DIR, name);
      // 安全检查：确保路径在 FILES_DIR 内
      if (!fp) { sendJSON(res, 403, { error: 'forbidden' }); return true; }
      const fileDir = path.dirname(fp);
      if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true });
      if (body.append && fs.existsSync(fp)) {
        fs.appendFileSync(fp, body.content || '', 'utf8');
      } else {
        fs.writeFileSync(fp, body.content || '', 'utf8');
      }
      invalidateSizeCache();
      sendJSON(res, 200, { ok: true, name, size: fs.statSync(fp).size });
      return true;
    }

    // --- 重命名文件 ---
    if (p === '/api/files/rename' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.name || !body?.newName) { sendJSON(res, 400, { error: '缺少参数' }); return true; }
      const srcPath = safeJoin(FILES_DIR, body.name);
      if (!srcPath) { sendJSON(res, 403, { error: 'forbidden' }); return true; }
      if (!fs.existsSync(srcPath)) { sendJSON(res, 404, { error: '文件不存在' }); return true; }
      const destPath = safeJoin(path.dirname(srcPath), body.newName);
      if (!destPath) { sendJSON(res, 403, { error: 'forbidden' }); return true; }
      if (fs.existsSync(destPath)) { sendJSON(res, 409, { error: '目标文件已存在' }); return true; }
      fs.renameSync(srcPath, destPath);
      invalidateSizeCache();
      sendJSON(res, 200, { ok: true, newName: body.newName });
      return true;
    }

    // --- 移动文件到文件夹 ---
    if (p === '/api/files/move' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.name || body.targetDir === undefined) { sendJSON(res, 400, { error: '缺少参数' }); return true; }
      const srcPath = getFilePath(body.name);
      if (!srcPath) { sendJSON(res, 404, { error: '文件不存在' }); return true; }
      // 空 targetDir = 根目录
      const targetDir = body.targetDir ? safeJoin(FILES_DIR, body.targetDir) : FILES_DIR;
      if (!targetDir) { sendJSON(res, 403, { error: '非法路径' }); return true; }
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const destPath = safeJoin(targetDir, path.basename(srcPath));
      if (fs.existsSync(destPath) && !body.overwrite) {
        sendJSON(res, 409, { error: '目标位置已存在同名文件' });
        return true;
      }
      fs.renameSync(srcPath, destPath);
      sendJSON(res, 200, { ok: true });
      return true;
    }
    // --- 复制文件 ---
    if (p === '/api/files/copy' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.name || body.targetDir === undefined) { sendJSON(res, 400, { error: '缺少参数' }); return true; }
      const srcPath = getFilePath(body.name);
      if (!srcPath) { sendJSON(res, 404, { error: '文件不存在' }); return true; }
      // 空 targetDir = 根目录
      const targetDir = body.targetDir ? safeJoin(FILES_DIR, body.targetDir) : FILES_DIR;
      if (!targetDir) { sendJSON(res, 403, { error: '非法路径' }); return true; }
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const destPath = safeJoin(targetDir, path.basename(srcPath));
      if (fs.existsSync(destPath) && !body.overwrite) {
        sendJSON(res, 409, { error: '目标位置已存在同名文件' });
        return true;
      }
      fs.copyFileSync(srcPath, destPath);
      invalidateSizeCache();
      sendJSON(res, 200, { ok: true });
      return true;
    }

    // --- 文件夹操作 ---
    if (p === '/api/folders' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.name) { sendJSON(res, 400, { error: '缺少文件夹名' }); return true; }
      const result = createFolder(body.name);
      if (result.error) { sendJSON(res, 409, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }
    if (p.startsWith('/api/folders/') && m === 'DELETE') {
      const name = safeDecode(p.slice('/api/folders/'.length));
      const result = deleteFolder(name);
      if (result.error) { sendJSON(res, 400, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }
    if (p.startsWith('/api/folders/rename/') && m === 'PUT') {
      const name = safeDecode(p.slice('/api/folders/rename/'.length));
      const body = parseJSON(await readBody(req));
      if (!body?.newName) { sendJSON(res, 400, { error: '缺少新名称' }); return true; }
      const result = renameFolder(name, body.newName);
      if (result.error) { sendJSON(res, 400, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }

    // --- 回收站 ---
    if (p === '/api/trash' && m === 'GET') { sendJSON(res, 200, listTrash()); return true; }
    if (p === '/api/trash' && m === 'DELETE') { sendJSON(res, 200, emptyTrash()); return true; }
    if (p.startsWith('/api/trash/item/') && m === 'DELETE') {
      const name = safeDecode(p.slice('/api/trash/item/'.length));
      const result = deleteTrashItem(name);
      if (result.error) { sendJSON(res, 404, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }
    if (p.startsWith('/api/trash/restore/') && m === 'POST') {
      const name = safeDecode(p.slice('/api/trash/restore/'.length));
      const result = restoreFromTrash(name);
      if (result.error) { sendJSON(res, 400, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }

    // --- VLC 实时转码流 ---
    if (p.startsWith('/api/stream/') && m === 'GET') {
      const name = safeDecode(p.slice('/api/stream/'.length));
      const quality = url.searchParams.get('q') || '720';
      const fp = getFilePath(name);
      if (!fp) { res.writeHead(404); return res.end('404'); }
      const stat = fs.statSync(fp);
      const presets = {
        '480': { w: 854, h: 480, vb: 800, ab: 96 },
        '720': { w: 1280, h: 720, vb: 2000, ab: 128 },
        '1080': { w: 1920, h: 1080, vb: 4000, ab: 192 },
      };
      const preset = presets[quality];
      if (!preset && quality !== 'orig') { sendJSON(res, 400, { error: 'quality must be 480/720/1080/orig' }); return true; }
      const ext = path.extname(name).toLowerCase();
      const isVideo = ['.mp4','.webm','.mov','.mkv'].includes(ext);
      const isAudio = ['.mp3','.wav','.ogg','.flac','.aac','.m4a'].includes(ext);
      // 原始画质：直接服务文件（带 Range 支持，浏览器自行缓冲）
      if (quality === 'orig') {
        const mime = isVideo ? 'video/mp4' : isAudio ? 'audio/mpeg' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' });
        fs.createReadStream(fp).pipe(res);
        return true;
      }
      const { spawn } = require('child_process');
      const args = [
        fp, '--no-sout-all', '--sout-keep',
        '--sout', `#transcode{vcodec=${isVideo?'h264':'none'},venc=x264{preset=ultrafast,tune=zerolatency},vb=${preset.vb},width=${preset.w},height=${preset.h},acodec=${isVideo?'aac':'mp3'},ab=${preset.ab},channels=2}:std{access=file,mux=mp4,frag,faststart,dst=-}`,
        'vlc://quit',
      ];
      const vlc = spawn('cvlc', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      vlc.stderr.on('data', d => { stderr += d.toString(); });
      vlc.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end('VLC error'); } });
      vlc.on('close', code => {
        if (!res.headersSent) { res.writeHead(500); res.end('VLC:' + code + ' ' + stderr.slice(0,200)); }
      });
      res.writeHead(200, { 'Content-Type': isVideo ? 'video/mp4' : 'audio/mpeg', 'Transfer-Encoding': 'chunked', 'Cache-Control': 'no-cache' });
      vlc.stdout.pipe(res);
      req.on('close', () => { vlc.kill(); });
      return true;
    }

    return false;
  }
};
