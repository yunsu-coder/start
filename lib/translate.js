// lib/translate.js - 翻译引擎（支持自定义 API）

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const DEFAULT_MODEL = 'glm-4-flash';

const TRANS_DIR = path.join(__dirname, '..', 'translate');
if (!fs.existsSync(TRANS_DIR)) fs.mkdirSync(TRANS_DIR, { recursive: true });

// ===== 支持的语言 =====
const LANGS = [
  { code: 'auto', name: '自动检测' },
  { code: 'zh', name: '中文' },
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
  { code: 'th', name: 'ไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Bahasa Indonesia' },
];

const LANG_MAP = Object.fromEntries(LANGS.map(l => [l.code, l.name]));

function getLangs() {
  return LANGS;
}

function getLangName(code) {
  return LANG_MAP[code] || code;
}

// ===== 流式翻译 =====
// 返回 fetch Response（可 pipe 到客户端）
function translateStream(text, from, to, apiKey, baseUrl, model) {
  const systemPrompt = from === 'auto'
    ? `你是一个专业翻译。识别用户输入的语言并将其翻译成${to}。只输出译文，不要解释。`
    : `你是一个专业翻译。将用户输入从${from}翻译成${to}。只输出译文，不要解释。`;

  return fetch(baseUrl || DEFAULT_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text.slice(0, 8000) },
      ],
      max_tokens: 4000,
      temperature: 0.1,
    }),
  });
}

// ===== 语言检测 =====
async function detectLanguage(text, apiKey, baseUrl, model) {
  try {
    const resp = await fetch(baseUrl || DEFAULT_BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        stream: false,
        messages: [
          {
            role: 'system',
            content: '你是一个语言检测专家。只输出语言代码（如zh/en/ja/ko/fr/de/es/pt/ru/ar/th/vi/id），不要输出任何其他内容。如果无法确定，输出"en"。',
          },
          {
            role: 'user',
            content: '检测下面这段文字的语言：\n' + text.slice(0, 2000),
          },
        ],
        max_tokens: 10,
        temperature: 0,
      }),
    });
    const data = await resp.json();
    const detected = (data.choices?.[0]?.message?.content || 'en').trim().toLowerCase();
    // 验证是有效语言代码
    if (LANG_MAP[detected]) return detected;
    return 'en';
  } catch {
    return 'en';
  }
}

// ===== 翻译历史 =====

/**
 * 保存一条翻译记录
 * @param {object} entry - { original, translated, from, to, detectedLang, note? }
 * @returns {object} { id, timestamp }
 */
function saveHistory(entry) {
  const id = 'ts_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  const record = {
    id,
    original: entry.original || '',
    translated: entry.translated || '',
    from: entry.from || 'auto',
    to: entry.to || 'zh',
    detectedLang: entry.detectedLang || '',
    note: entry.note || '',
    fav: entry.fav !== undefined ? !!entry.fav : true,
    timestamp: Date.now(),
  };
  fs.writeFileSync(
    path.join(TRANS_DIR, id + '.json'),
    JSON.stringify(record, null, 2)
  );
  return { id, timestamp: record.timestamp };
}

/**
 * 获取翻译历史列表（按时间倒序）
 * @param {number} limit - 最大返回条数
 * @returns {Array}
 */
function listHistory(limit = 100) {
  const files = fs.readdirSync(TRANS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);

  return files.map(f => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(TRANS_DIR, f), 'utf8'));
      return {
        id: raw.id,
        original: raw.original?.slice(0, 200) || '',
        translated: raw.translated?.slice(0, 200) || '',
        from: raw.from,
        to: raw.to,
        detectedLang: raw.detectedLang,
        note: raw.note || '',
        fav: raw.fav !== undefined ? raw.fav : true,
        timestamp: raw.timestamp,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

/**
 * 删除翻译历史记录
 * @param {string} id
 */
function deleteHistory(id) {
  const fp = path.join(TRANS_DIR, id + '.json');
  if (!fs.existsSync(fp)) return { error: '记录不存在' };
  fs.unlinkSync(fp);
  return { ok: true };
}

module.exports = {
  getLangs,
  getLangName,
  translateStream,
  detectLanguage,
  saveHistory,
  listHistory,
  deleteHistory,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
};
