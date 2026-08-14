// routes/translate.js - 翻译：语言/检测/流式翻译/历史/语法检查/AI 配音
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getLangs, translateStream, detectLanguage, saveHistory, listHistory, deleteHistory, DEFAULT_BASE_URL, DEFAULT_MODEL } = require('../lib/translate');
const { sendJSON, readBody, parseJSON } = require('../lib/http');

module.exports = {
  name: 'translate',
  async handle(p, m, url, req, res) {
    // 支持的语言列表
    if (p === '/api/translate/langs' && m === 'GET') {
      sendJSON(res, 200, getLangs());
      return true;
    }

    // 语言检测
    if (p === '/api/translate/detect' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.text) { sendJSON(res, 400, { error: '请输入文字' }); return true; }
      // 未传 Key 时使用服务端 .env（TRANS_API_KEY / TRANS_BASE_URL / TRANS_MODEL）
      const apiKey = body.apiKey || process.env.TRANS_API_KEY;
      if (!apiKey) { sendJSON(res, 500, { error: '请先配置翻译 API Key（服务端 .env 的 TRANS_API_KEY 或 AK 弹窗自定义 Key）' }); return true; }
      try {
        const lang = await detectLanguage(body.text, apiKey, body.baseUrl || process.env.TRANS_BASE_URL || DEFAULT_BASE_URL, body.model || process.env.TRANS_MODEL || DEFAULT_MODEL);
        sendJSON(res, 200, { lang });
      } catch(e) {
        sendJSON(res, 500, { error: e.message });
      }
      return true;
    }

    // 流式翻译
    if (p === '/api/translate' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.text) { sendJSON(res, 400, { error: '请输入文字' }); return true; }
      const from = body.from || 'auto';
      const to = body.to || 'zh';
      // 未传 Key 时使用服务端 .env（TRANS_API_KEY / TRANS_BASE_URL / TRANS_MODEL）
      const apiKey = body.apiKey || process.env.TRANS_API_KEY;
      if (!apiKey) { sendJSON(res, 500, { error: '请先配置翻译 API Key（服务端 .env 的 TRANS_API_KEY 或 AK 弹窗自定义 Key）' }); return true; }

      try {
        const aiResp = await translateStream(body.text, from, to, apiKey, body.baseUrl || process.env.TRANS_BASE_URL || DEFAULT_BASE_URL, body.model || process.env.TRANS_MODEL || DEFAULT_MODEL);

        if (!aiResp.ok) {
          const err = await aiResp.text().catch(() => '');
          sendJSON(res, 502, { error: 'Translate API error: ' + aiResp.status + ' ' + err.slice(0, 100) });
          return true;
        }

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        for await (const chunk of aiResp.body) {
          res.write(chunk);
        }
        res.end();
      } catch(e) {
        sendJSON(res, 500, { error: e.message });
      }
      return true;
    }

    // 翻译历史
    if (p === '/api/translate/history' && m === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      sendJSON(res, 200, listHistory(Math.min(limit, 500)));
      return true;
    }

    if (p === '/api/translate/history' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body || !body.original) { sendJSON(res, 400, { error: '缺少原文' }); return true; }
      const result = saveHistory({
        original: body.original,
        translated: body.translated || '',
        from: body.from || 'auto',
        to: body.to || 'zh',
        detectedLang: body.detectedLang || '',
        note: body.note || '',
        fav: body.fav !== undefined ? body.fav : true,
      });
      sendJSON(res, 200, result);
      return true;
    }

    if (p.startsWith('/api/translate/history/') && m === 'DELETE') {
      const id = p.slice('/api/translate/history/'.length).replace(/\.json$/, '');
      const result = deleteHistory(id);
      if (result.error) { sendJSON(res, 404, result); return true; }
      sendJSON(res, 200, result);
      return true;
    }

    // 语法检查
    if (p === '/api/translate/grammar' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.text) { sendJSON(res, 400, { error: '请输入文字' }); return true; }
      // 未传 Key 时使用服务端 .env（TRANS_API_KEY / TRANS_BASE_URL / TRANS_MODEL）
      const apiKey = body.apiKey || process.env.TRANS_API_KEY;
      if (!apiKey) { sendJSON(res, 500, { error: '请先配置翻译 API Key（服务端 .env 的 TRANS_API_KEY 或 AK 弹窗自定义 Key）' }); return true; }

      try {
        const aiResp = await fetch(body.baseUrl || process.env.TRANS_BASE_URL || DEFAULT_BASE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
          body: JSON.stringify({
            model: body.model || process.env.TRANS_MODEL || DEFAULT_MODEL,
            stream: false,
            messages: [{
              role: 'system',
              content: '你是一个语法检查助手。检查用户输入的文字，找出拼写、语法、用词错误。\n\n按以下 JSON 格式返回，不要加 markdown 包装：\n{\n  "hasErrors": true/false,\n  "errors": [\n    {\n      "start": 0,\n      "end": 5,\n      "word": "错误文本",\n      "correction": "修正建议",\n      "explanation": "错误原因（用中文解释）"\n    }\n  ]\n}\n\n注意：start/end 是字符位置（从0开始），end是开区间。如果没有错误，返回 {"hasErrors": false, "errors": []}。'
            }, {
              role: 'user',
              content: body.text.slice(0, 4000)
            }],
            max_tokens: 2000,
            temperature: 0,
          }),
        });
        const data = await aiResp.json();
        const raw = data.choices?.[0]?.message?.content || '{}';
        // 去掉可能的 markdown 包装
        const jsonStr = raw.replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
        try {
          sendJSON(res, 200, JSON.parse(jsonStr));
        } catch {
          sendJSON(res, 200, { hasErrors: false, errors: [], raw });
        }
      } catch(e) {
        sendJSON(res, 500, { error: e.message });
      }
      return true;
    }

    // AI 配音 (Edge TTS)
    if (p === '/api/tts' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      if (!body?.text) { sendJSON(res, 400, { error: 'no text' }); return true; }
      const voice = body.voice || 'zh-CN-XiaoxiaoNeural';
      const { spawn } = require('child_process');
      const tmpFile = path.join(os.tmpdir(), 'tts_' + Date.now() + '.mp3');
      try {
        await new Promise((resolve, reject) => {
          const proc = spawn('python3', ['-c', 'import edge_tts,asyncio,sys\nasync def main():\n tts=edge_tts.Communicate(sys.argv[1],sys.argv[2])\n await tts.save(sys.argv[3])\nasyncio.run(main())', body.text.slice(0, 3000), voice, tmpFile]);
          let err = '';
          proc.stderr.on('data', d => err += d.toString());
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(err.slice(0, 200))));
        });
        const buf = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length });
        res.end(buf);
      } catch(e) {
        sendJSON(res, 500, { error: 'TTS failed: ' + e.message });
      }
      return true;
    }

    return false;
  }
};
