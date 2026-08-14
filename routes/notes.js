// routes/notes.js - 笔记 / 作品管理 / 文档导出
const fs = require('fs');
const path = require('path');
const { listNotes, saveNote, getNote, deleteNote,
        listWorks, saveWork, getWork, deleteWork, exportWork, WORKS_DIR } = require('../lib/storage');
const rag = require('../lib/rag');
const { sendJSON, readBody, parseJSON } = require('../lib/http');
const { safeJoin } = require('../lib/safePath');
const { exportToPDF, exportToDOCX, exportToTXT, exportToMD } = require('../lib/export');

module.exports = {
  name: 'notes',
  async handle(p, m, url, req, res) {
    // --- 笔记列表 ---
    if (p === '/api/notes' && m === 'GET') {
      const q = url.searchParams.get('q') || '';
      const type = url.searchParams.get('type') || '';
      const workId = url.searchParams.get('work_id') || '';
      let notes = listNotes();
      // 按类型隔离：standalone=独立笔记(无workId), novel=小说章节(有workId)
      if (type === 'standalone') {
        notes = notes.filter(n => !n.workId || n.workId === '');
      } else if (type === 'novel') {
        notes = notes.filter(n => n.workId && n.workId !== '');
        if (workId) notes = notes.filter(n => n.workId === workId);
      }
      if (q) {
        notes = notes.filter(n =>
          n.title.includes(q) || (n.preview || '').includes(q)
        );
      }
      sendJSON(res, 200, notes);
      return true;
    }

    // --- 保存笔记 ---
    if (p === '/api/notes' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body || body.title === undefined) { sendJSON(res, 400, { error: 'bad request' }); return true; }
      const result = saveNote(body);
      if (result.error) { sendJSON(res, 403, result); return true; }
      // 更新 RAG 索引
      try {
        rag.indexDoc('note_' + result.id, 'note', result.id, body.title || '', body.content || '', '', result.updated || '');
      } catch (e) { console.error('[rag] 笔记索引更新失败:', e.message); }
      sendJSON(res, 200, result);
      return true;
    }

    // --- 获取笔记 ---
    if (p.startsWith('/api/notes/') && m === 'GET') {
      const id = p.slice('/api/notes/'.length).replace(/\.json$/, '');
      const note = getNote(id);
      if (!note) { sendJSON(res, 404, { error: 'not found' }); return true; }
      sendJSON(res, 200, note);
      return true;
    }

    // --- 删除笔记 ---
    if (p.startsWith('/api/notes/') && m === 'DELETE') {
      const id = p.slice('/api/notes/'.length).replace(/\.json$/, '');
      const result = deleteNote(id);
      if (result.error) { sendJSON(res, 404, result); return true; }
      // 从 RAG 索引移除
      try { rag.removeDocFromIndex('note_' + id); } catch (e) { console.error('[rag] 笔记索引移除失败:', e.message); }
      sendJSON(res, 200, result);
      return true;
    }

    // ===== 作品管理 =====
    if (p === '/api/works' && m === 'GET') {
      sendJSON(res, 200, listWorks());
      return true;
    }
    if (p === '/api/works' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body || !body.title) { sendJSON(res, 400, { error: '请输入作品标题' }); return true; }
      sendJSON(res, 200, saveWork(body));
      return true;
    }
    // 更新作品（添加/移除章节等）
    if (p.startsWith('/api/works/') && m === 'POST' && !p.endsWith('/reorder')) {
      const id = p.slice('/api/works/'.length);
      const body = parseJSON(await readBody(req));
      const existing = getWork(id);
      if (!existing) { sendJSON(res, 404, { error: 'not found' }); return true; }
      sendJSON(res, 200, saveWork({ ...existing, ...body, id }));
      return true;
    }
    if (p.startsWith('/api/works/') && m === 'GET' && !p.includes('/export') && !p.includes('/reorder')) {
      const id = p.slice('/api/works/'.length);
      const work = getWork(id);
      if (!work) { sendJSON(res, 404, { error: 'not found' }); return true; }
      sendJSON(res, 200, work);
      return true;
    }
    if (p.startsWith('/api/works/') && m === 'DELETE') {
      const id = p.slice('/api/works/'.length);
      const result = deleteWork(id);
      if (result.error) { sendJSON(res, 404, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }
    if (p.startsWith('/api/works/') && p.endsWith('/reorder') && m === 'POST') {
      const id = p.slice('/api/works/'.length, -'/reorder'.length);
      const body = parseJSON(await readBody(req));
      if (!body?.chapterIds) { sendJSON(res, 400, { error: '缺少 chapterIds' }); return true; }
      const work = getWork(id);
      if (!work) { sendJSON(res, 404, { error: 'not found' }); return true; }
      work.chapters = body.chapterIds;
      work.updated = new Date().toISOString();
      const fp = safeJoin(WORKS_DIR, id + '.json');
      if (!fp) { sendJSON(res, 403, { error: '非法路径' }); return true; }
      fs.writeFileSync(fp, JSON.stringify(work, null, 2));
      sendJSON(res, 200, { ok: true });
      return true;
    }
    if (p.startsWith('/api/works/') && p.endsWith('/export') && m === 'GET') {
      const id = p.slice('/api/works/'.length, -'/export'.length);
      const format = url.searchParams.get('format') || 'md';
      const content = exportWork(id, format);
      if (!content) { sendJSON(res, 404, { error: 'not found' }); return true; }
      const mime = format === 'txt' ? 'text/plain' : 'text/markdown';
      const ext = format === 'txt' ? 'txt' : 'md';
      const work = getWork(id);
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent((work?.title || '作品') + '.' + ext)}`,
      });
      res.end(content);
      return true;
    }

    // ===== 文档导出（单篇笔记）=====
    if (p === '/api/export' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body) { sendJSON(res, 400, { error: 'bad request' }); return true; }
      const fmt = body.format || 'md';
      const title = body.title || '文档';
      const content = body.content || '';

      try {
        let buf, mime, ext;
        switch (fmt) {
          case 'pdf':
            buf = await exportToPDF(title, content, body.html || null);
            mime = 'application/pdf';
            ext = '.pdf';
            break;
          case 'docx':
            buf = await exportToDOCX(title, content);
            mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            ext = '.docx';
            break;
          case 'txt':
            buf = exportToTXT(title, content);
            mime = 'text/plain; charset=utf-8';
            ext = '.txt';
            break;
          default:
            buf = exportToMD(title, content);
            mime = 'text/markdown; charset=utf-8';
            ext = '.md';
        }
        const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName + ext)}`,
        });
        res.end(buf);
      } catch (e) {
        sendJSON(res, 500, { error: '导出失败: ' + e.message });
      }
      return true;
    }

    return false;
  }
};
