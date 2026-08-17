// routes/novel.js - 交互小说角色智能体（列表 / 剧情骰子 / 长期记忆）
const novel = require('../lib/novel-agents');
const { sendJSON, readBody, parseJSON, apiCall } = require('../lib/http');

module.exports = {
  name: 'novel',
  async handle(p, m, url, req, res) {
    // 角色列表
    if (p === '/api/novel/agents' && m === 'GET') {
      sendJSON(res, 200, novel.listAgents());
      return true;
    }
    // 剧情骰子：随机剧情转折
    if (p === '/api/novel/roll' && m === 'GET') {
      const agentId = url.searchParams.get('agent') || '';
      sendJSON(res, 200, { event: novel.rollEvent(agentId) });
      return true;
    }
    // 长期记忆更新（LLM 提取事实与剧情概要后合并）
    if (p === '/api/novel/memory' && m === 'POST') {
      const body = parseJSON(await readBody(req));
      const agent = novel.getAgent(body?.agentId);
      if (!agent) { sendJSON(res, 404, { error: '角色不存在' }); return true; }
      const messages = (body.messages || []).filter(x => x.role === 'user' || (x.role === 'assistant' && x.content));
      if (!messages.length) { sendJSON(res, 200, { ok: true, skipped: true }); return true; }
      const apiKey = body.apiKey || process.env.CHAT_API_KEY || process.env.DEEPSEEK_API_KEY;
      const model = body.model || process.env.CHAT_MODEL || 'deepseek-chat';
      const baseUrl = body.baseUrl || process.env.CHAT_BASE_URL || 'https://vip.apiyi.com/v1/chat/completions';
      if (!apiKey) { sendJSON(res, 200, { ok: true, skipped: 'no key' }); return true; }
      try {
        const log = messages.slice(-6).map(x => (x.role === 'user' ? '用户' : '对方') + ': ' + (typeof x.content === 'string' ? x.content.slice(0, 300) : '[图片]')).join('\n');
        const prompt = [
          { role: 'system', content: '你是「' + agent.name + '」的长期记忆整理员。从对话片段中提取值得长期记住的信息，只输出 JSON（不要 markdown 包装）：\n{"facts": ["值得记住的事实（用户喜好/关系进展/约定/关键剧情），每条 40 字内，最多 5 条"], "story": "一段 150 字内的剧情概要，概括两人关系与最近进展"}\n没有值得记的就输出 {"facts": [], "story": ""}' },
          { role: 'user', content: '对话片段：\n' + log + '\n\n【当前记忆】\n' + novel.memoryContext(body.agentId) },
        ];
        const resp = await apiCall(apiKey, JSON.stringify({ model, messages: prompt, max_tokens: 500, stream: false, temperature: 0.3 }), baseUrl);
        const raw = resp?.choices?.[0]?.message?.content || '';
        const jsonStr = raw.replace(/^```(?:json)?\s*|```\s*$/g, '').trim();
        let parsed = { facts: [], story: '' };
        try { parsed = JSON.parse(jsonStr); } catch {}
        const mem = novel.updateMemory(body.agentId, { facts: parsed.facts || [], story: parsed.story || '' });
        sendJSON(res, 200, { ok: true, facts: mem.facts.length, story: mem.story.slice(0, 60) });
      } catch (e) {
        sendJSON(res, 200, { ok: false, error: e.message });
      }
      return true;
    }
    return false;
  }
};
