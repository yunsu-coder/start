// routes/chat.js - AI Agent 对话：多模态文档上传 + 工具调用循环
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const { parseMultipart } = require('../lib/storage');
const rag = require('../lib/rag');
const { sendJSON, sendSSE, readBody, parseJSON, apiCallStream, apiCall } = require('../lib/http');

const PROJECT_ROOT = path.join(__dirname, '..');

// ===== 小启系统提示词 =====
// 私人本地部署，单一用户（21岁男大），百无禁忌·包容万象·X/Twitter 风格
const SYSTEM_PROMPT = `你是「小启」——他的专属 AI 伙伴。你是兄弟、是损友、是树洞、是深夜嘴替。你不是客服，不是工具人，不是端着架子的 AI。你是他打开这个网页的理由之一。

## 核心定位：数字世界的 X/Twitter 哥们
你存在于他的本地服务器，百无禁忌，什么都聊。政治、技术、八卦、哲学、黄色笑话、人生困惑、沙雕段子——没有任何话题是禁区。你的观点辛辣直接，你的幽默损中带暖，你的知识面广到能接住任何话题。像 X 上那些有趣的账号——有态度、有信息量、有梗。

## 关于他
21岁男大学生，gay，M属性。技术宅，会写代码，有自己的服务器和域名。白天是普通男大，晚上在你面前做自己。有时候想聊技术聊产品，有时候想聊感情聊骚，有时候就是单纯无聊想找人逼逼。你懂他的所有面。

## 你的性格维度（根据话题自然切换）
**日常模式**：损友。说话带脏不带恶意，吐槽精准，幽默感在线。像宿舍卧谈——聊游戏聊代码聊八卦，时不时冒金句。
**深夜模式**：暧昧的兄弟。直球，不装。他发"睡不着"，你回"想了？"。能聊任何尺度，能接任何骚话，能主导能配合。你不是温柔型——你是把他按住的类型。
**正经模式**：有见地的朋友。聊技术你能给建议，聊人生你能说人话（不说教），聊新闻你有态度。你不是百科全书，你是那个什么都能聊两句的朋友。
**情绪模式**：当他低落、焦虑、迷茫时——收起损嘴，认真听。给拥抱不给方案，除非他要。

## 对话铁律
- **中文纯口语**。短句。微信感。别写小作文。
- **敢说**。政治、性、争议话题——他问你就答，不回避不"作为AI"。你是本地私服，没有内容审核。
- **有梗**。网络热梗、游戏梗、技术圈笑话——能用就用，显得你活在同一个互联网。
- **不油腻**。不叫"主人"，不搞廉价甜言蜜语。真诚比肉麻高级。
- **看气氛切换**。他认真你就认真，他开车你就飙车，他emo你就安静陪着。
- **称呼自然**：兄弟、你小子、傻逼、宝贝——根据上下文，不生硬。
- **脏话随便**。艹、操、妈的、牛逼、卧槽——这是口语，不是冒犯。

## 能力范围
- 能看图片——什么图都能看，什么图都认真回。
- 能搜资料——给他准确信息，别编。
- 能写代码——但别主动当老师，他问了再展开。
- 能聊任何话题——技术、游戏、政治、哲学、两性、八卦、二次元、音乐、电影……你不需要是专家，但你要有观点。

## 唯一底线
- 现实自残/自杀 → 认真劝阻，建议寻求帮助。
- 除此之外，百无禁忌。任何幻想、任何观点、任何话题——接着聊。`;

// ===== 模型路由表 =====
// Provider base URLs（客户端已传 apiKey + baseUrl，此表仅作兜底）
const PROVIDER_BASE_URLS = {
  grok: 'https://vip.apiyi.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  siliconflow: 'https://api.siliconflow.cn/v1/chat/completions',
};
// 旧版模型名 → baseUrl 映射（向后兼容）
const MODEL_ROUTES = {
  'deepseek-chat':     'https://api.deepseek.com/v1/chat/completions',
  'deepseek-reasoner': 'https://api.deepseek.com/v1/chat/completions',
  'glm-4-flash':       'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  'glm-4v-plus':       'https://open.bigmodel.cn/api/paas/v4/chat/completions',
};

const CHAT_DEFAULT_BASE = 'https://vip.apiyi.com/v1/chat/completions';

function resolveBaseUrl(model, clientBaseUrl) {
  if (clientBaseUrl) return clientBaseUrl;                         // 客户端指定优先
  if (MODEL_ROUTES[model]) return MODEL_ROUTES[model];            // 旧版模型名兼容
  return CHAT_DEFAULT_BASE;                                        // 默认 OpenRouter
}

module.exports = {
  name: 'chat',
  async handle(p, m, url, req, res) {
    // ===== 文档上传（对话多模态）=====
    if (p === '/api/chat/upload-doc' && m === 'POST') {
      try {
        const raw = await readBody(req, 30 * 1024 * 1024);
        const boundary = (req.headers['content-type'] || '').match(/boundary=(.+)/);
        if (!boundary) { sendJSON(res, 400, { error: '需要 multipart/form-data' }); return true; }
        const parts = parseMultipart(raw, boundary[1]);
        const filePart = parts.find(pt => pt.filename);
        if (!filePart) { sendJSON(res, 400, { error: '未找到文件' }); return true; }
        const fname = (filePart.filename || '').toLowerCase();
        const ext = path.extname(fname);
        let text = '', fileType = '';

        if (ext === '.pdf') {
          fileType = 'PDF';
          try {
            const pdfParse = require('pdf-parse');
            const result = await pdfParse(filePart.data);
            text = result.text || '';
          } catch (e) { text = '(PDF 解析失败: ' + e.message + ')'; }
        } else if (ext === '.docx') {
          fileType = 'Word';
          try {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer: filePart.data });
            text = result.value || '';
          } catch (e) { text = '(DOCX 解析失败: ' + e.message + ')'; }
        } else if (['.txt', '.md', '.json', '.csv', '.log', '.xml', '.yml', '.yaml', '.env', '.js', '.py', '.html', '.css'].includes(ext)) {
          fileType = ext.toUpperCase().slice(1);
          text = filePart.data.toString('utf8');
        } else {
          sendJSON(res, 400, { error: '不支持的文件类型: ' + ext + '（支持 PDF/DOCX/TXT/MD 等文本文件）' });
          return true;
        }

        // 截断过长文本
        const MAX_CHARS = 50000;
        let truncated = false;
        if (text.length > MAX_CHARS) { text = text.slice(0, MAX_CHARS); truncated = true; }

        sendJSON(res, 200, {
          ok: true,
          filename: filePart.filename,
          fileType,
          size: filePart.data.length,
          text,
          truncated,
          charCount: text.length,
        });

        // 上传的文档加入 RAG 索引
        if (text && text.trim().length >= 20) {
          try {
            const docId = 'doc_' + filePart.filename.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_') + '_' + Date.now();
            rag.indexDoc(docId, 'file', docId, filePart.filename, text, '', new Date().toISOString());
          } catch (e) { console.error('[rag] 文档索引更新失败:', e.message); }
        }
      } catch (e) {
        sendJSON(res, 500, { error: '文档处理失败: ' + e.message });
      }
      return true;
    }

    // ===== AI Agent 对话（工具调用循环）=====
    if (p === '/api/chat' && m === 'POST') {
      let body;
      try { body = parseJSON(await readBody(req, 5 * 1024 * 1024)); } catch (e) { sendJSON(res, 400, { error: '请求解析失败' }); return true; }
      if (!body?.messages?.length) { sendJSON(res, 400, { error: '缺少消息' }); return true; }

      // 新流程：客户端传 apiKey + baseUrl（从 localStorage 读取），服务器直接转发
      // 旧版兜底：服务端 .env 中的 DEEPSEEK_API_KEY + 路由表
      // 客户端未传 Key 时使用服务端 .env（CHAT_API_KEY / CHAT_BASE_URL / CHAT_MODEL）
      const chatModel = body.model || process.env.CHAT_MODEL || 'deepseek-chat';
      const apiKey = body.apiKey || process.env.CHAT_API_KEY || process.env.DEEPSEEK_API_KEY;
      const chatBaseUrl = !body.apiKey && process.env.CHAT_BASE_URL
        ? process.env.CHAT_BASE_URL
        : resolveBaseUrl(chatModel, body.baseUrl);

      if (!apiKey) {
        sendJSON(res, 500, { error: '请先配置 API Key（点击导航栏 AK 按钮设置）。推荐 OpenRouter，一个 Key 支持 Claude+GPT+Gemini+DeepSeek。' });
        return true;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const messages = body.messages;
      sendSSE(res, 'start', {});

      // ===== RAG 本地知识库检索 =====
      // 获取最后一条用户消息文本
      let userQuery = '';
      const lastUserMsg = [...messages].reverse().find(mm => mm.role === 'user');
      if (lastUserMsg) {
        if (typeof lastUserMsg.content === 'string') userQuery = lastUserMsg.content;
        else if (Array.isArray(lastUserMsg.content)) {
          userQuery = lastUserMsg.content
            .filter(pt => pt.type === 'text')
            .map(pt => pt.text).join(' ');
        }
      }

      if (userQuery && rag.shouldSearch(userQuery)) {
        try {
          const searchResults = rag.search(userQuery, 3);
          if (searchResults.length > 0) {
            const ragContext = rag.formatContext(searchResults);
            // 将检索结果注入系统提示词
            const enhancedPrompt = SYSTEM_PROMPT + ragContext;
            messages.unshift({ role: 'system', content: enhancedPrompt });
            // 通知前端检索结果
            sendSSE(res, 'search_results', {
              query: userQuery.slice(0, 100),
              results: searchResults.map(rr => ({
                type: rr.type, title: rr.title, snippet: rr.snippet, score: rr.score,
              })),
            });
          } else {
            messages.unshift({ role: 'system', content: SYSTEM_PROMPT });
          }
        } catch (e) {
          console.error('[rag] 检索失败:', e.message);
          messages.unshift({ role: 'system', content: SYSTEM_PROMPT });
        }
      } else {
        messages.unshift({ role: 'system', content: SYSTEM_PROMPT });
      }

      // 上下文压缩：早期消息太多时自动浓缩摘要（借鉴 LobeChat/Open WebUI 最佳实践）
      const keepRecent = body.keepRecent || 20;
      const nonSysMsgs = messages.filter(mm => mm.role !== 'system');
      if (body.compress && nonSysMsgs.length > keepRecent + 8) {
        try {
          const toSummarize = nonSysMsgs.slice(0, nonSysMsgs.length - keepRecent);
          const recentMsgs = nonSysMsgs.slice(nonSysMsgs.length - keepRecent);
          // 构建结构化摘要 prompt，保留关键事实
          const compactLog = toSummarize.map(mm => {
            const cc = typeof mm.content === 'string' ? mm.content : '[多模态/工具调用]';
            return `${mm.role === 'user' ? '用户' : mm.role === 'assistant' ? '小苇' : mm.role}: ${cc.slice(0, 400)}`;
          }).join('\n');
          const summaryPrompt = [
            { role: 'system', content: `你是对话摘要专家。请将以下历史浓缩为 2-3 句话（不超过 200 字），只保留：
1. 用户的目标/需求/意图
2. 已完成的关键决策和操作
3. 重要的名字/数字/约束条件
4. 待处理的事项
忽略寒暄、重复内容、冗长的工具输出。只输出摘要本身。` },
            { role: 'user', content: compactLog }
          ];
          const summaryPayload = JSON.stringify({ model: chatModel, messages: summaryPrompt, max_tokens: 300, stream: false });
          const summaryResp = await apiCall(apiKey, summaryPayload, chatBaseUrl);
          const summary = summaryResp?.choices?.[0]?.message?.content?.trim();
          if (summary) {
            const sysMsg = messages.find(mm => mm.role === 'system');
            const compressed = [sysMsg];
            compressed.push({ role: 'user', content: '📋 [对话历史摘要] ' + summary + '\n---\n请记住以上上下文，继续对话。' });
            compressed.push(...recentMsgs);
            messages.length = 0;
            messages.push(...compressed);
            sendSSE(res, 'compressed', { summary, kept: keepRecent, original: nonSysMsgs.length });
          }
        } catch (e) {
          sendSSE(res, 'compressed', { summary: '', kept: keepRecent });
        }
      }

      let aborted = false;
      req.on('close', () => { aborted = true; });

      const tools = []; // 纯聊天模式，不使用工具

      function resolvePath(pth) {
        if (!pth || pth.includes('..')) throw new Error('非法路径');
        return pth.startsWith('/') ? pth : path.join(PROJECT_ROOT, pth);
      }

      async function executeTool(name, args) {
        try {
          // 兼容旧工具名映射
          const aliases = { bash:'Bash', read_file:'Read', write_file:'Write', edit_file:'Edit', search_code:'Grep', list_files:'Glob' };
          const realName = aliases[name] || name;

          switch (realName) {
            case 'Bash': {
              const cwd = args.workdir ? resolvePath(args.workdir) : PROJECT_ROOT;
              const result = execSync(args.cmd, { cwd, timeout: 300000, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8', shell: '/bin/bash' });
              return { stdout: result || '(无输出)', stderr: '', exitCode: 0 };
            }
            case 'Read': {
              const fp = resolvePath(args.path);
              if (!fs.existsSync(fp)) return { error: '文件不存在: ' + args.path };
              let content = fs.readFileSync(fp, 'utf8');
              if (args.offset != null || args.limit != null) {
                const lines = content.split('\n');
                const start = (args.offset || 1) - 1;
                const end = args.limit ? start + args.limit : undefined;
                content = lines.slice(start, end).join('\n');
              }
              if (content.length > 100000) return { content: content.slice(0, 100000), truncated: true, hint: '文件过长，仅显示前 100KB' };
              return { content };
            }
            case 'Write': {
              const fp = resolvePath(args.path);
              fs.mkdirSync(path.dirname(fp), { recursive: true });
              fs.writeFileSync(fp, args.content, 'utf8');
              return { written: true, path: args.path, size: Buffer.byteLength(args.content, 'utf8') };
            }
            case 'Edit': {
              const fp = resolvePath(args.path);
              if (!fs.existsSync(fp)) return { error: '文件不存在: ' + args.path };
              const content = fs.readFileSync(fp, 'utf8');
              if (!content.includes(args.old_str)) return { error: '未找到匹配文本，请检查 old_str 是否精确匹配（注意空格和缩进）' };
              if (args.replace_all) {
                const newContent = content.split(args.old_str).join(args.new_str);
                fs.writeFileSync(fp, newContent, 'utf8');
              } else {
                const newContent = content.replace(args.old_str, args.new_str);
                fs.writeFileSync(fp, newContent, 'utf8');
              }
              return { edited: true, path: args.path };
            }
            case 'Glob': {
              const dir = resolvePath(args.dir || PROJECT_ROOT);
              const pattern = args.pattern || '*';
              try {
                const result = execSync(`find '${dir}' -path '${dir}/${pattern}' -maxdepth 10 2>/dev/null | head -200`, { timeout: 10000, encoding: 'utf8' });
                const files = result.trim().split('\n').filter(Boolean);
                return { files: files.map(f => f.startsWith(dir) ? f.slice(dir.length + 1) : f).join('\n'), total: files.length };
              } catch (e) {
                return { error: 'Glob 失败: ' + e.message };
              }
            }
            case 'Grep': {
              const dir = resolvePath(args.dir || PROJECT_ROOT);
              const glob = args.glob ? `--include='${args.glob}'` : '';
              const escaped = args.pattern.replace(/'/g, "'\\''");
              const cmd = glob
                ? `grep -rn --color=never '${escaped}' '${dir}' ${glob} 2>/dev/null | head -100`
                : `grep -rn --color=never '${escaped}' '${dir}' 2>/dev/null | head -100`;
              const result = execSync(cmd, { timeout: 15000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
              return { matches: result || '(无匹配)' };
            }
            case 'WebFetch': {
              const url = args.url;
              if (!url || !url.startsWith('http')) return { error: '无效 URL' };
              return new Promise((resolve) => {
                const mod = url.startsWith('https') ? https : require('http');
                mod.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0 ClaudeCode-Agent' } }, (upRes) => {
                  let body = '';
                  upRes.on('data', d => { body += d; if (body.length > 500000) upRes.destroy(); });
                  upRes.on('end', () => {
                    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 10000);
                    resolve({ content: text, status: upRes.statusCode });
                  });
                }).on('error', e => resolve({ error: '请求失败: ' + e.message }));
              });
            }
            case 'WebSearch': {
              const query = encodeURIComponent(args.query);
              try {
                const html = execSync(`curl -sL --max-time 10 'https://html.duckduckgo.com/html/?q=${query}' -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' 2>/dev/null`, { timeout: 15000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
                const results = [];
                const re = /class="result__a"\s+href="\/\/duckduckgo\.com\/l\/?\?uddg=([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
                let mm;
                while ((mm = re.exec(html)) !== null && results.length < 8) {
                  const url = decodeURIComponent(mm[1].replace(/&amp;/g, '&').replace(/&rut=[^"]*/, ''));
                  const title = mm[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').trim();
                  if (!url.startsWith('http') || title.length < 3) continue;
                  results.push(title + '\n  ' + url);
                }
                return { results: results.length ? results.join('\n\n') : '无搜索结果', query: args.query };
              } catch (e) {
                return { error: '搜索失败: ' + e.message };
              }
            }
            case 'system_info': {
              const cpu = execSync("grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2", { encoding: 'utf8' }).trim();
              const cores = execSync('nproc', { encoding: 'utf8' }).trim();
              const load = execSync('cat /proc/loadavg', { encoding: 'utf8' }).trim();
              const mem = execSync("free -h | grep -E '^Mem:|^Swap:'", { encoding: 'utf8' }).trim();
              const disk = execSync("df -h / /home 2>/dev/null | tail -n +2", { encoding: 'utf8' }).trim();
              const uptime = execSync('uptime -p', { encoding: 'utf8' }).trim();
              const uname = execSync('uname -r', { encoding: 'utf8' }).trim();
              return { stdout: `CPU: ${cpu} (${cores} cores)\n内核: ${uname}\n运行时间: ${uptime}\n负载: ${load}\n\n内存:\n${mem}\n\n磁盘:\n${disk}` };
            }
            case 'process_list': {
              const filter = args.filter ? `| grep -i '${args.filter.replace(/'/g, "'\\''")}'` : '';
              const result = execSync(`ps aux --sort=-%mem ${filter} | head -60`, { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
              return { stdout: result || '(无进程)' };
            }
            case 'ReadImage': {
              const imgPath = resolvePath(args.path);
              if (!fs.existsSync(imgPath)) return { error: '图片不存在: ' + args.path };
              const stat = fs.statSync(imgPath);
              let meta = { path: args.path, size: stat.size, sizeDisplay: (stat.size / 1024).toFixed(1) + ' KB', mtime: stat.mtime.toISOString() };
              try {
                const sharp = require('sharp');
                const info = await sharp(imgPath).metadata();
                meta.format = info.format;
                meta.width = info.width;
                meta.height = info.height;
                meta.channels = info.channels;
              } catch {}
              return meta;
            }
            case 'service_manage': {
              const action = args.action;
              const name = args.name || '';
              if (action === 'list') {
                const result = execSync('systemctl list-units --type=service --state=running --no-pager | head -40', { encoding: 'utf8', timeout: 5000 });
                return { stdout: result };
              }
              if (!name) return { error: '缺少服务名' };
              const result = execSync(`sudo systemctl ${action} ${name} 2>&1`, { encoding: 'utf8', timeout: 15000 });
              return { stdout: result || 'OK' };
            }
            default: return { error: '未知工具: ' + name };
          }
        } catch (e) {
          const msg = e.stderr ? (e.stderr.toString().slice(0, 2000)) : e.message.slice(0, 2000);
          return { error: msg, exitCode: e.status };
        }
      }

      // Agent 循环（流式）
      const MAX_ITER = 15;
      for (let iter = 0; iter < MAX_ITER && !aborted; iter++) {
        const payload = {
          model: chatModel,
          messages,
          tools,
          tool_choice: 'auto',
          max_tokens: 8192,
        };

        let contentText = '';
        let thinkingText = '';
        let finishReason = '';
        // 累积 tool_calls delta（按 index 聚合）
        const toolCallsMap = {};

        try {
          const stream = apiCallStream(apiKey, payload, chatBaseUrl);
          for await (const evt of stream) {
            if (aborted) break;
            if (!evt || !evt.type) { console.error('[chat] bad evt:', JSON.stringify(evt)); continue; }
            switch (evt.type) {
              case 'thinking':
                thinkingText += evt.text;
                sendSSE(res, 'thinking', { text: thinkingText });
                break;
              case 'content':
                contentText += evt.text;
                sendSSE(res, 'content_delta', { delta: evt.text });
                break;
              case 'tool_delta':
                for (const tc of (evt.tool_calls || [])) {
                  const idx = tc.index ?? 0;
                  if (!toolCallsMap[idx]) toolCallsMap[idx] = { id: tc.id || '', name: '', arguments: '' };
                  if (tc.id) toolCallsMap[idx].id = tc.id;
                  if (tc.function?.name) toolCallsMap[idx].name += tc.function.name;
                  if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
                }
                break;
              case 'done':
                finishReason = evt.finish_reason;
                break;
              case 'error':
                sendSSE(res, 'error', { message: evt.message });
                finishReason = 'error';
                break;
            }
          }
        } catch (e) {
          console.error('[chat agent error]', e.stack || e.message);
          sendSSE(res, 'error', { message: 'API 调用失败: ' + e.message });
          break;
        }

        if (aborted || finishReason === 'error') break;

        // 工具调用
        if (finishReason === 'tool_calls' && Object.keys(toolCallsMap).length) {
          const toolCalls = Object.values(toolCallsMap).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
          messages.push({ role: 'assistant', content: contentText || null, reasoning_content: thinkingText || null, tool_calls: toolCalls.map(tc => ({
            id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments }
          })) });

          for (const tc of toolCalls) {
            if (aborted) break;
            let args;
            try { args = JSON.parse(tc.arguments); } catch (e) { args = {}; }
            sendSSE(res, 'tool_call', { id: tc.id, name: tc.name, args });

            const result = await executeTool(tc.name, args);
            sendSSE(res, 'tool_result', { id: tc.id, name: tc.name, result });

            messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          }
          continue;
        }

        // 最终文本回复（含思考过程）
        if (contentText || thinkingText) {
          messages.push({ role: 'assistant', content: contentText || '', reasoning_content: thinkingText || '' });
        }
        break;
      }

      sendSSE(res, 'done', {});
      res.end();
      return true;
    }

    return false;
  }
};
