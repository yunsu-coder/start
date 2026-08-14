// routes/misc.js - 状态 / 天气 / 配置状态 / 数据分析 / OCR
const fs = require('fs');
const path = require('path');
const https = require('https');
const { getStatus, getFilePath } = require('../lib/storage');
const analytics = require('../lib/analytics');
const { sendJSON, readBody, parseJSON, AUTH_ENABLED } = require('../lib/http');

module.exports = {
  name: 'misc',
  async handle(p, m, url, req, res) {
    // --- 状态 ---
    if (p === '/api/status') { sendJSON(res, 200, getStatus()); return true; }

    // --- 配置状态（只返回有无，不泄露密钥）---
    if (p === '/api/config/status') {
      sendJSON(res, 200, {
        auth: AUTH_ENABLED,
        chat: { hasServerKey: !!(process.env.CHAT_API_KEY || process.env.DEEPSEEK_API_KEY), model: process.env.CHAT_MODEL || '' },
        trans: { hasServerKey: !!process.env.TRANS_API_KEY, model: process.env.TRANS_MODEL || '' },
      });
      return true;
    }

    // --- 天气代理 ---
    if (p === '/api/weather') {
      const city = url.searchParams.get('city') || '';
      const wUrl = 'https://wttr.in/' + encodeURIComponent(city) + '?format=%c+%t';
      https.get(wUrl, { timeout: 5000, headers: { 'User-Agent': 'curl/8.0' } }, wRes => {
        let data = '';
        wRes.on('data', c => data += c);
        wRes.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
          res.end(data.trim() || '--');
        });
      }).on('error', () => { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('--'); })
      .on('timeout', function() { this.destroy(); res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('--'); });
      return true;
    }

    // --- 数据分析 ---
    if (p === '/api/analytics/heartbeat' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      analytics.recordHeartbeat(body?.panel || 'home');
      sendJSON(res, 200, { ok: true });
      return true;
    }
    if (p === '/api/analytics/stats') {
      const range = url.searchParams.get('range') || 'week';
      sendJSON(res, 200, analytics.getStats(range));
      return true;
    }

    // --- OCR 图片转文字 ---
    if (p === '/api/ocr' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.name) { sendJSON(res, 400, { error: '缺少文件名' }); return true; }
      const fp = getFilePath(body.name);
      if (!fp) { sendJSON(res, 404, { error: '文件不存在' }); return true; }
      const ext = path.extname(body.name).toLowerCase();
      if (!['.jpg','.jpeg','.png','.webp','.bmp','.gif'].includes(ext)) {
        sendJSON(res, 400, { error: '不支持的图片格式' });
        return true;
      }
      try {
        const Tesseract = require('tesseract.js');
        const { data } = await Tesseract.recognize(fp, 'chi_sim+eng', {
          logger: () => {}, // 静默
        });
        sendJSON(res, 200, { text: data.text?.trim() || '' });
      } catch (e) {
        sendJSON(res, 500, { error: 'OCR 失败: ' + e.message });
      }
      return true;
    }

    return false;
  }
};
