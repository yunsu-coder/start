// lib/rag.js — 本地知识检索引擎
// 关键词匹配 + 中文 n-gram + TF-IDF 评分
// 检索源：笔记(notes/)、文件(files/)、采集(scrape/)

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NOTES_DIR = path.join(ROOT, 'notes');
const FILES_DIR = path.join(ROOT, 'files');
const SCRAPE_DIR = path.join(ROOT, 'scrape');
const INDEX_PATH = path.join(ROOT, '.rag_index.json');

// ===== 中文/英文分词 =====

// 中文字符范围
function isCJK(ch) {
  const cp = ch.codePointAt(0);
  return (cp >= 0x4E00 && cp <= 0x9FFF) ||   // CJK Unified
         (cp >= 0x3400 && cp <= 0x4DBF) ||   // CJK Ext-A
         (cp >= 0x20000 && cp <= 0x2A6DF) || // CJK Ext-B
         (cp >= 0xF900 && cp <= 0xFAFF) ||   // CJK Compat
         (cp >= 0x2F800 && cp <= 0x2FA1F);   // CJK Compat Supp
}

function tokenize(text) {
  if (!text) return [];
  const tokens = [];
  const lower = text.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    // 跳过空白
    if (/\s/.test(lower[i])) { i++; continue; }
    // 英文/数字词
    if (/[a-z0-9]/.test(lower[i])) {
      let word = '';
      while (i < lower.length && /[a-z0-9]/.test(lower[i])) {
        word += lower[i]; i++;
      }
      if (word.length >= 2) tokens.push(word);
      else if (word.length === 1) tokens.push(word); // 单字母也保留（如 "c", "r" 在技术语境）
      continue;
    }
    // 中文字符 → unigram + bigram
    if (isCJK(lower[i])) {
      // unigram
      tokens.push(lower[i]);
      // bigram (与前一个字符组合)
      if (i + 1 < lower.length && isCJK(lower[i + 1])) {
        tokens.push(lower[i] + lower[i + 1]);
      }
      i++;
      continue;
    }
    // 其他字符（标点、符号）跳过
    i++;
  }
  // 去重但保留频率信息（在索引构建时计数）
  return tokens;
}

// ===== 索引结构 =====

let index = null; // 内存索引

function emptyIndex() {
  return {
    version: 1,
    built: Date.now(),
    docs: {},      // docId -> { type, id, title, content, filePath, updated }
    inverted: {},  // token -> { docId: frequency }
    docCount: 0,
  };
}

// 加载索引（磁盘 → 内存）
function loadIndex() {
  if (index) return index;
  try {
    if (fs.existsSync(INDEX_PATH)) {
      const raw = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
      if (raw.version === 1 && raw.docs && raw.inverted) {
        index = raw;
        return index;
      }
    }
  } catch (e) {
    console.error('[rag] 索引加载失败:', e.message);
  }
  index = emptyIndex();
  return index;
}

// 保存索引到磁盘
function saveIndex() {
  try {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  } catch (e) {
    console.error('[rag] 索引保存失败:', e.message);
  }
}

// ===== 文档内容读取 =====

// 读取文本文件（限制大小）
function readTextFile(filePath, maxChars = 20000) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const textExts = ['.txt', '.md', '.json', '.csv', '.log', '.html', '.css',
                      '.js', '.xml', '.yml', '.yaml', '.env', '.py', '.sh', '.conf'];
    if (!textExts.includes(ext)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return content.length > maxChars ? content.slice(0, maxChars) : content;
  } catch { return null; }
}

// 读取笔记
function readNote(noteId) {
  try {
    const fp = path.join(NOTES_DIR, noteId + '.json');
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch { return null; }
}

// 读取采集文本
function readScrapeText(sessionDir) {
  try {
    const fp = path.join(SCRAPE_DIR, sessionDir, 'text.md');
    if (!fs.existsSync(fp)) {
      // 尝试 text_ 前缀的文件
      const dir = path.join(SCRAPE_DIR, sessionDir);
      if (!fs.existsSync(dir)) return null;
      const files = fs.readdirSync(dir).filter(f => f.startsWith('text') && f.endsWith('.md'));
      if (!files.length) return null;
      const content = fs.readFileSync(path.join(dir, files[0]), 'utf8');
      return content.slice(0, 15000);
    }
    const content = fs.readFileSync(fp, 'utf8');
    return content.slice(0, 15000);
  } catch { return null; }
}

// ===== 索引操作 =====

// 给文档添加/更新到索引
function indexDoc(docId, type, id, title, content, filePath, updated) {
  const idx = loadIndex();
  
  // 如果已有旧索引，先移除
  if (idx.docs[docId]) {
    removeDocFromIndex(docId, true); // silent = 不保存
  }

  idx.docs[docId] = {
    type, id, title: title || '', content: content || '',
    filePath: filePath || '', updated: updated || new Date().toISOString(),
  };

  const tokens = tokenize((title || '') + ' ' + (content || ''));
  const freq = {};
  for (const t of tokens) {
    freq[t] = (freq[t] || 0) + 1;
  }

  for (const [token, count] of Object.entries(freq)) {
    if (!idx.inverted[token]) idx.inverted[token] = {};
    idx.inverted[token][docId] = count;
  }

  idx.docCount = Object.keys(idx.docs).length;
  saveIndex();
}

// 从索引移除文档（silent=true 时不保存，用于批量操作）
function removeDocFromIndex(docId, silent = false) {
  const idx = loadIndex();
  if (!idx.docs[docId]) return;

  // 从倒排索引中移除
  for (const token of Object.keys(idx.inverted)) {
    delete idx.inverted[token][docId];
    if (Object.keys(idx.inverted[token]).length === 0) {
      delete idx.inverted[token];
    }
  }

  delete idx.docs[docId];
  idx.docCount = Object.keys(idx.docs).length;

  if (!silent) saveIndex();
}

// 计算 IDF
function computeIDF(token) {
  const idx = loadIndex();
  const posting = idx.inverted[token];
  if (!posting) return 0;
  return Math.log(1 + idx.docCount / Object.keys(posting).length);
}

// ===== 搜索 =====

/**
 * 搜索相关文档
 * @param {string} query - 用户查询
 * @param {number} k - 返回 top K 个结果
 * @returns {Array<{docId, type, id, title, snippet, score, filePath}>}
 */
function search(query, k = 3) {
  const idx = loadIndex();
  if (!idx.docCount) return [];

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];

  // 计算每个 token 的权重（TF-IDF 在查询侧用 IDF 加权）
  const tokenWeights = {};
  for (const t of queryTokens) {
    tokenWeights[t] = (tokenWeights[t] || 0) + 1;
  }

  // 对每个文档打分
  const scores = {}; // docId -> score
  for (const [token, qWeight] of Object.entries(tokenWeights)) {
    const posting = idx.inverted[token];
    if (!posting) continue;
    const idf = computeIDF(token);
    for (const [docId, docFreq] of Object.entries(posting)) {
      // TF-IDF: qWeight * docFreq * idf
      scores[docId] = (scores[docId] || 0) + qWeight * Math.log(1 + docFreq) * idf;
    }
  }

  // 排序取 top K
  const ranked = Object.entries(scores)
    .filter(([_, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);

  return ranked.map(([docId, score]) => {
    const doc = idx.docs[docId];
    if (!doc) return null;

    // 生成片段：找到 query 关键词命中的位置，取前后上下文
    const snippet = generateSnippet(doc.content, queryTokens, 200);

    return {
      docId,
      type: doc.type,
      id: doc.id,
      title: doc.title,
      snippet,
      score: Math.round(score * 100) / 100,
      filePath: doc.filePath,
    };
  }).filter(Boolean);
}

// 生成包含关键词的文本片段
function generateSnippet(content, queryTokens, maxLen = 200) {
  if (!content) return '';
  const lower = content.toLowerCase();
  
  // 找第一个命中关键词的位置
  let bestPos = -1;
  for (const t of queryTokens) {
    const pos = lower.indexOf(t.toLowerCase());
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
      bestPos = pos;
    }
  }

  if (bestPos === -1) {
    // 无命中，返回开头
    return content.slice(0, maxLen).replace(/\n/g, ' ');
  }

  // 以命中位置为中心，取前后内容
  const half = Math.floor(maxLen / 2);
  const start = Math.max(0, bestPos - half);
  const end = Math.min(content.length, start + maxLen);
  let snippet = content.slice(start, end).replace(/\n/g, ' ');
  
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  
  return snippet;
}

// 判断用户意图是否需要检索
function shouldSearch(message) {
  if (!message) return false;
  // 用户显式标记
  if (message.includes('@笔记') || message.includes('@文件') || message.includes('@知识库')) return true;
  // 问句模式
  if (/[?？]/.test(message)) return true;
  // 中文提问关键词
  if (/怎么|如何|什么|为什么|谁|哪里|哪个|多少|能不能|可否|帮我|查一|找一|记得|有没有/.test(message)) return true;
  // 英文提问关键词
  if (/\b(how|what|why|who|where|when|which|can you|find|search|look up|remember|know)\b/i.test(message)) return true;
  return false;
}

// ===== 全量重建索引 =====

async function rebuildIndex() {
  console.log('[rag] 开始重建索引...');
  const idx = emptyIndex();
  index = idx;

  let count = 0;

  // 1. 索引笔记
  try {
    if (fs.existsSync(NOTES_DIR)) {
      const noteFiles = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.json'));
      for (const f of noteFiles) {
        try {
          const note = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, f), 'utf8'));
          if (!note.content || note.content.trim().length < 10) continue; // 跳过空笔记
          const docId = 'note_' + note.id;
          idx.docs[docId] = {
            type: 'note', id: note.id, title: note.title || '',
            content: note.content || '', filePath: '', updated: note.updated || '',
          };
          const tokens = tokenize((note.title || '') + ' ' + (note.content || ''));
          const freq = {};
          for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
          for (const [token, count] of Object.entries(freq)) {
            if (!idx.inverted[token]) idx.inverted[token] = {};
            idx.inverted[token][docId] = count;
          }
          count++;
        } catch (e) { /* skip corrupted files */ }
      }
    }
  } catch (e) { console.error('[rag] 笔记索引失败:', e.message); }

  // 2. 索引文本文件（递归扫描 files/）
  try {
    if (fs.existsSync(FILES_DIR)) {
      const textExts = ['.txt', '.md', '.json', '.csv', '.log', '.html', '.css',
                        '.js', '.xml', '.yml', '.yaml', '.env', '.py', '.sh', '.conf'];
      
      function scanDir(dir, base = FILES_DIR) {
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
          const fp = path.join(dir, name);
          try {
            const stat = fs.statSync(fp);
            if (stat.isDirectory()) {
              scanDir(fp, base);
            } else if (textExts.includes(path.extname(name).toLowerCase())) {
              const content = readTextFile(fp);
              if (!content || content.trim().length < 20) return;
              const relPath = path.relative(base, fp);
              const docId = 'file_' + relPath.replace(/[^a-zA-Z0-9_-]/g, '_');
              idx.docs[docId] = {
                type: 'file', id: relPath, title: name,
                content, filePath: relPath, updated: stat.mtime.toISOString(),
              };
              const tokens = tokenize(name + ' ' + content);
              const freq = {};
              for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
              for (const [token, cnt] of Object.entries(freq)) {
                if (!idx.inverted[token]) idx.inverted[token] = {};
                idx.inverted[token][docId] = cnt;
              }
              count++;
            }
          } catch (e) { /* skip */ }
        }
      }
      scanDir(FILES_DIR);
    }
  } catch (e) { console.error('[rag] 文件索引失败:', e.message); }

  // 3. 索引采集文本
  try {
    if (fs.existsSync(SCRAPE_DIR)) {
      for (const sessionDir of fs.readdirSync(SCRAPE_DIR)) {
        const sp = path.join(SCRAPE_DIR, sessionDir);
        if (!fs.statSync(sp).isDirectory()) continue;
        // 读取 session 元信息
        const metaPath = path.join(sp, 'meta.json');
        let title = sessionDir;
        try {
          if (fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            title = meta.title || sessionDir;
          }
        } catch {}
        const content = readScrapeText(sessionDir);
        if (!content || content.trim().length < 30) continue;
        const docId = 'scrape_' + sessionDir.replace(/[^a-zA-Z0-9_-]/g, '_');
        idx.docs[docId] = {
          type: 'scrape', id: sessionDir, title,
          content, filePath: sessionDir, updated: '',
        };
        const tokens = tokenize(title + ' ' + content);
        const freq = {};
        for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
        for (const [token, cnt] of Object.entries(freq)) {
          if (!idx.inverted[token]) idx.inverted[token] = {};
          idx.inverted[token][docId] = cnt;
        }
        count++;
      }
    }
  } catch (e) { console.error('[rag] 采集索引失败:', e.message); }

  idx.docCount = count;
  idx.built = Date.now();
  saveIndex();
  console.log('[rag] 索引重建完成:', count, '篇文档');
  return count;
}

// ===== 格式化检索结果为上下文文本 =====

function formatContext(results) {
  if (!results.length) return '';
  let ctx = '\n\n## 本地知识库\n';
  ctx += '以下是本地笔记和文件中与当前问题相关的内容，优先参考：\n\n';
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const sourceLabel = r.type === 'note' ? '📝 笔记' :
                        r.type === 'file' ? '📄 文件' :
                        r.type === 'scrape' ? '🌐 采集' : '📌 来源';
    ctx += `---\n[${sourceLabel} "${r.title}"]\n${r.snippet}\n`;
  }
  ctx += '---\n如果以上内容与当前问题无关，忽略即可，正常回答。\n';
  return ctx;
}

// ===== 导出 =====

module.exports = {
  loadIndex,
  rebuildIndex,
  indexDoc,
  removeDocFromIndex,
  search,
  shouldSearch,
  formatContext,
  tokenize,
};
