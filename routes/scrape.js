// routes/scrape.js - 网页采集：会话/缩略图/文本/图片/保存壁纸
const fs = require('fs');
const path = require('path');
const { doScrape, listSessions, getSession, deleteSession, transferSession } = require('../lib/scraper');
const { saveWallpaperFromUrl } = require('../lib/wallpaper');
const { invalidateSizeCache } = require('../lib/storage');
const { sendJSON, readBody, parseJSON } = require('../lib/http');
const { safeJoin, safeDecode } = require('../lib/safePath');

const ROOT = path.join(__dirname, '..');

module.exports = {
  name: 'scrape',
  async handle(p, m, url, req, res) {
    if (p === '/api/scrape' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body || !body.urls || !body.urls.length) { sendJSON(res, 400, { error: '请输入至少一个网址' }); return true; }
      const type = body.type || 'both';
      if (!['text', 'images', 'both', 'video', 'music'].includes(type)) { sendJSON(res, 400, { error: 'type 只能是 text/images/both/video/music' }); return true; }

      // SSE 流式模式
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        const send = (event, data) => { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); };
        try {
          const result = await doScrape(body.urls, type, { minWidth: body.minWidth || 0, minHeight: body.minHeight || 0, followDetail: body.followDetail !== false, deepRender: body.deepRender !== false, skipDup: body.skipDup || false, onProgress: (p) => { send('progress', p); } });
          send('result', result);
        } catch (e) {
          send('error', { error: e.message });
        }
        res.end();
        return true;
      }

      try {
        const result = await doScrape(body.urls, type, { minWidth: body.minWidth || 0, minHeight: body.minHeight || 0, followDetail: body.followDetail !== false, deepRender: body.deepRender !== false, skipDup: body.skipDup || false });
        sendJSON(res, 200, result);
      } catch (e) {
        sendJSON(res, 500, { error: e.message });
      }
      return true;
    }
    if (p === '/api/scrape/list' && m === 'GET') { sendJSON(res, 200, listSessions()); return true; }
    if (p.startsWith('/api/scrape/session/') && m === 'GET') {
      const sid = p.slice('/api/scrape/session/'.length);
      const session = getSession(sid);
      if (!session) { sendJSON(res, 404, { error: 'not found' }); return true; }
      sendJSON(res, 200, session);
      return true;
    }
    if (p.startsWith('/api/scrape/session/') && m === 'DELETE') {
      deleteSession(p.slice('/api/scrape/session/'.length));
      sendJSON(res, 200, { ok: true });
      return true;
    }
    if (p.startsWith('/api/scrape/transfer/') && m === 'POST') {
      const sid = p.slice('/api/scrape/transfer/'.length);
      const body = parseJSON(await readBody(req));
      const transferred = transferSession(sid, body?.items || []);
      if (transferred.length) invalidateSizeCache();
      sendJSON(res, 200, { ok: true, transferred });
      return true;
    }

    // --- 采集缩略图 ---
    if (p.startsWith('/api/scrape/thumb/')) {
      const rest = p.slice('/api/scrape/thumb/'.length);
      const [sid, ...nameParts] = rest.split('/');
      const imgPath = safeJoin(path.join(ROOT, 'scrape'), sid + '/images/' + safeDecode(nameParts.join('/')));
      if (!imgPath || !fs.existsSync(imgPath)) { res.writeHead(404); return res.end('404'); }
      try {
        const sharp = require('sharp');
        const buf = await sharp(imgPath).resize(200, 150, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length,
          'Cache-Control': 'public, max-age=86400' });
        res.end(buf);
      } catch { res.writeHead(500); res.end('thumb error'); }
      return true;
    }

    // --- 采集文本读取 ---
    if (p.startsWith('/api/scrape/text/')) {
      const rest = p.slice('/api/scrape/text/'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx === -1) { res.writeHead(404); return res.end('404'); }
      const sid = rest.slice(0, slashIdx);
      const fname = safeDecode(rest.slice(slashIdx + 1));
      const fpath = safeJoin(path.join(ROOT, 'scrape'), sid + '/' + fname);
      if (!fpath || !fs.existsSync(fpath)) { res.writeHead(404); return res.end('404'); }
      const text = fs.readFileSync(fpath, 'utf8').slice(0, 30000);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
      res.end(text);
      return true;
    }

    // --- 采集图片 ---
    if (p.startsWith('/api/scrape/img/')) {
      const rest = p.slice('/api/scrape/img/'.length);
      const [sid, ...nameParts] = rest.split('/');
      const imgPath = safeJoin(path.join(ROOT, 'scrape'), sid + '/images/' + safeDecode(nameParts.join('/')));
      if (!imgPath || !fs.existsSync(imgPath)) { res.writeHead(404); return res.end('404'); }
      const ext = path.extname(imgPath).toLowerCase();
      const mimes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
      const buf = fs.readFileSync(imgPath);
      res.writeHead(200, { 'Content-Type': mimes[ext] || 'image/png',
        'Content-Length': buf.length, 'Cache-Control': 'max-age=3600' });
      res.end(buf);
      return true;
    }

    // 从采集会话中保存图片为壁纸
    if (p.startsWith('/api/scrape/save-wallpaper/') && m === 'POST') {
      const sid = p.slice('/api/scrape/save-wallpaper/'.length);
      const body = parseJSON(await readBody(req));
      const wp = saveWallpaperFromUrl(body.url, body.filename, sid);
      sendJSON(res, 200, wp.id ? { ok: true, wallpaper: wp } : { error: wp.error });
      return true;
    }

    return false;
  }
};
