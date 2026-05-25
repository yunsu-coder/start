// lib/ai-agent.js — AI 智能代理
// 一句话任务 → AI 解析 → 自动执行 → 结果推送
const fs = require('fs');
const path = require('path');

const PIPELINE_DIR = path.join(__dirname, '..', 'pipelines');

function ensureDir() {
  if (!fs.existsSync(PIPELINE_DIR)) fs.mkdirSync(PIPELINE_DIR, { recursive: true });
}

// ===== AI 调用（DeepSeek）=====
const API_KEY = () => process.env.DEEPSEEK_API_KEY || '';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

async function askAI(systemPrompt, userMsg, opts = {}) {
  const key = API_KEY();
  if (!key) throw new Error('DEEPSEEK_API_KEY 未配置');

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model: opts.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens || 4096,
    }),
    signal: AbortSignal.timeout((opts.timeout || 60) * 1000),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`AI API error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ===== 文本摘要 =====
async function summarize(text, maxLen = 300) {
  const content = text.slice(0, 8000);
  return await askAI(
    `你是一个摘要助手。用中文将以下内容精炼成不超过${maxLen}字的摘要，保留关键信息。只输出摘要内容。`,
    content,
    { maxTokens: maxLen + 200 }
  );
}

// ===== 智能分类 =====
async function classify(content, categories) {
  const cats = categories.join('、');
  return await askAI(
    `从以下类别中选择最匹配的一项：${cats}\n只输出类别名称，不要其他内容。`,
    content.slice(0, 3000),
    { maxTokens: 50, temperature: 0.1 }
  );
}

// ===== 关键信息提取 =====
async function extractKeyInfo(text) {
  return await askAI(
    `从以下文本中提取关键信息，以 JSON 格式返回：
{
  "title": "标题",
  "summary": "一句话摘要",
  "tags": ["标签1", "标签2"],
  "type": "article|news|story|tech|other",
  "keyPoints": ["要点1", "要点2"]
}
只输出 JSON，不要其他内容。`,
    text.slice(0, 6000),
    { maxTokens: 1000, temperature: 0.1 }
  );
}

// ===== 自然语言任务解析 =====
async function parseTask(naturalLang) {
  const prompt = `你是一个任务解析器。将用户的自然语言指令解析为可执行的任务列表。

可执行的动作类型：
- monitor: 网页监控。参数: url（目标网址）, interval（检查间隔秒数）
- scrape: 网页采集。参数: url, type（images/text/both/video）
- summarize: AI 摘要。参数: text（或引用之前操作的结果）
- notify: 推送通知。参数: message
- search: 搜索。参数: query

返回 JSON 数组，每个元素：
{ "action": "动作类型", "params": { 参数字典 }, "description": "这个步骤的描述" }

示例输入："监控知乎热榜，每天检查一次，有变化通知我"
示例输出：
[
  {"action":"monitor","params":{"url":"https://www.zhihu.com/hot","interval":86400},"description":"监控知乎热榜"},
  {"action":"notify","params":{"message":"知乎热榜有更新！"},"description":"有变化时推送通知"}
]

如果无法解析，返回 {"error": "无法理解"}。只输出 JSON。`;

  const result = await askAI(prompt, naturalLang, { maxTokens: 2000, temperature: 0.1 });
  try {
    return JSON.parse(result);
  } catch {
    return { error: '解析失败', raw: result };
  }
}

// ===== 管道记录 =====
function savePipeline(entry) {
  ensureDir();
  const file = path.join(PIPELINE_DIR, 'history.json');
  let history = [];
  try { history = JSON.parse(fs.readFileSync(file, 'utf8') || '[]'); } catch {}
  history.unshift(entry);
  if (history.length > 200) history = history.slice(0, 200);
  fs.writeFileSync(file, JSON.stringify(history, null, 2));
}

function listPipelines(limit = 50) {
  ensureDir();
  const file = path.join(PIPELINE_DIR, 'history.json');
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
    return list.slice(0, limit);
  } catch { return []; }
}

// ===== 执行智能任务 =====
async function executeSmartTask(userInput) {
  const entry = {
    id: 'pipe_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    input: userInput,
    created: Date.now(),
    steps: [],
    status: 'running',
    result: null,
  };
  savePipeline(entry);

  try {
    // 1. AI 解析任务
    const plan = await parseTask(userInput);
    if (plan.error) {
      entry.status = 'error';
      entry.result = plan.error;
      savePipeline(entry);
      return entry;
    }

    entry.plan = plan;
    entry.steps = plan.map(p => ({ ...p, status: 'pending' }));
    savePipeline(entry);

    // 2. 逐个执行
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i];
      entry.steps[i].status = 'running';
      savePipeline(entry);

      try {
        let result = null;
        switch (step.action) {
          case 'monitor': {
            const { addMonitor } = require('./monitor');
            result = addMonitor({
              url: step.params.url,
              interval: step.params.interval || 3600,
            });
            break;
          }
          case 'scrape': {
            const { doScrape } = require('./scraper');
            result = await doScrape(
              [step.params.url],
              step.params.type || 'text',
              step.params.opts || {}
            );
            break;
          }
          case 'summarize': {
            const text = step.params.text || step.params.content || '';
            result = await summarize(text);
            break;
          }
          case 'search': {
            // 搜索笔记和文件名
            const query = step.params.query || step.params.q || '';
            const { listNotes } = require('./storage');
            const notes = listNotes();
            const matches = notes.filter(n =>
              n.title?.includes(query) || n.content?.includes(query)
            ).slice(0, 10);
            result = { hits: matches.length, items: matches };
            break;
          }
          case 'notify': {
            // 写入通知队列
            const notifyDir = path.join(__dirname, '..', 'notifications');
            if (!fs.existsSync(notifyDir)) fs.mkdirSync(notifyDir, { recursive: true });
            const notif = {
              id: 'n_' + Date.now(),
              message: step.params.message,
              time: Date.now(),
              source: 'pipeline',
              pipelineId: entry.id,
            };
            fs.writeFileSync(
              path.join(notifyDir, notif.id + '.json'),
              JSON.stringify(notif)
            );
            result = { ok: true, notification: notif };
            break;
          }
          default:
            result = { error: '未知动作: ' + step.action };
        }
        entry.steps[i].result = result;
        entry.steps[i].status = result?.error ? 'error' : 'success';
      } catch (e) {
        entry.steps[i].status = 'error';
        entry.steps[i].error = e.message;
      }
      savePipeline(entry);
    }

    // 3. AI 总结
    const summary = await askAI(
      '用一句话总结以下任务执行结果，中文。',
      JSON.stringify({ input: userInput, steps: entry.steps.map(s => s.action + ': ' + s.status) }),
      { maxTokens: 200 }
    );
    entry.result = summary;
    entry.status = entry.steps.some(s => s.status === 'error') ? 'partial' : 'success';
  } catch (e) {
    entry.status = 'error';
    entry.result = e.message;
  }

  savePipeline(entry);
  return entry;
}

module.exports = { executeSmartTask, listPipelines, summarize, classify, extractKeyInfo, parseTask, askAI };
