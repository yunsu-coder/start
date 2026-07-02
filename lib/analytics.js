// ===== 数据分析模块 — 心跳记录 + 聚合查询 =====
const fs = require('fs');
const path = require('path');
const ANALYTICS_DIR = path.join(__dirname, '..', 'analytics');

if (!fs.existsSync(ANALYTICS_DIR)) fs.mkdirSync(ANALYTICS_DIR, { recursive: true });

// ---- 记录心跳 ----
function recordHeartbeat(panel) {
  const now = new Date();
  const dateKey = now.toISOString().slice(0, 10);
  const file = path.join(ANALYTICS_DIR, 'heartbeat-' + dateKey + '.json');
  const entry = JSON.stringify({ t: now.toISOString(), p: panel || 'home' }) + '\n';
  fs.appendFile(file, entry, () => {});
}

// ---- 读取指定日期范围的心跳数据 ----
function readHeartbeats(daysBack) {
  const heartbeats = [];
  const now = new Date();
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    const file = path.join(ANALYTICS_DIR, 'heartbeat-' + dateKey + '.json');
    try {
      const text = fs.readFileSync(file, 'utf-8');
      text.trim().split('\n').forEach(line => {
        try { heartbeats.push(JSON.parse(line)); } catch {}
      });
    } catch {}
  }
  return heartbeats;
}

// ---- 聚合在线时长 ----
function aggregateOnlineTime(heartbeats, range) {
  const byPanel = { total: 0 };
  const byHour = {};  // for day view
  const byDay = {};   // for week/month view
  const byMonth = {}; // for year view

  heartbeats.forEach(h => {
    byPanel.total += 15;
    const key = h.p || 'home';
    byPanel[key] = (byPanel[key] || 0) + 15;

    const t = new Date(h.t);
    const hKey = t.getHours() + '时';
    const dKey = t.toISOString().slice(5, 10); // MM-DD
    const mKey = t.toISOString().slice(0, 7);  // YYYY-MM

    byHour[hKey] = (byHour[hKey] || 0) + 15;
    byDay[dKey] = (byDay[dKey] || 0) + 15;
    byMonth[mKey] = (byMonth[mKey] || 0) + 15;
  });

  // 转为分钟
  const toMin = function(obj) {
    const r = {}; Object.keys(obj).forEach(function(k) { r[k] = Math.round(obj[k] / 60); });
    return r;
  };

  return {
    total: Math.round(byPanel.total / 60),
    byPanel: toMin(byPanel),
    timeSeries: range === 'day' ? toMin(byHour) : range === 'year' ? toMin(byMonth) : toMin(byDay)
  };
}

// ---- 判断是否在日期范围内 ----
function inRange(dateStr, days) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  cutoff.setHours(0, 0, 0, 0);
  return d >= cutoff;
}

// ---- 文件统计 ----
function getFileStats(days) {
  const FILES_DIR = path.join(__dirname, '..', 'files');
  const types = {};
  let total = 0, totalSize = 0;
  const byDay = {};
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  function scan(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.forEach(e => {
      if (e.name.startsWith('.')) return;
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { scan(fp); return; }
      let stat;
      try { stat = fs.statSync(fp); } catch { return; }
      if (stat.mtime < cutoff) return; // 不在范围内
      total++;
      totalSize += stat.size;
      const ext = path.extname(e.name).toLowerCase().slice(1) || 'other';
      types[ext] = (types[ext] || 0) + 1;
      const dk = stat.mtime.toISOString().slice(0, 10);
      byDay[dk] = (byDay[dk] || 0) + 1;
    });
  }
  scan(FILES_DIR);
  var sizeStr = totalSize < 1024 ? totalSize + 'B' :
    totalSize < 1048576 ? (totalSize / 1024).toFixed(1) + 'K' :
    (totalSize / 1048576).toFixed(1) + 'M';
  return { total, totalSize, totalSizeStr: sizeStr, types, byDay };
}

// ---- 笔记统计 ----
function getNoteStats(days) {
  const NOTES_DIR = path.join(__dirname, '..', 'notes');
  let total = 0, totalWords = 0, chapters = 0;
  const dailyWords = {};

  try {
    const files = fs.readdirSync(NOTES_DIR);
    files.forEach(f => {
      if (!f.endsWith('.json')) return;
      try {
        const note = JSON.parse(fs.readFileSync(path.join(NOTES_DIR, f), 'utf-8'));
        const dateStr = note.updated || note.created || '';
        if (!inRange(dateStr, days)) return;
        total++;
        const text = (note.content || '');
        const cn = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
        const en = text.replace(/[一-鿿㐀-䶿]/g, ' ').split(/\s+/).filter(w => /[a-zA-Z]/.test(w)).length;
        const words = cn + en;
        totalWords += words;
        if (note.chapterOrder > 0) chapters++;
        const dk = dateStr.slice(0, 10);
        if (dk) dailyWords[dk] = (dailyWords[dk] || 0) + words;
      } catch {}
    });
  } catch {}

  return { total, totalWords, chapters, dailyWords };
}

// ---- 翻译统计 ----
function getTranslateStats(days) {
  const TRANS_DIR = path.join(__dirname, '..', 'translate');
  let total = 0;
  const byPair = {};
  const byDay = {};

  try {
    const files = fs.readdirSync(TRANS_DIR);
    files.forEach(f => {
      if (!f.endsWith('.json')) return;
      try {
        const t = JSON.parse(fs.readFileSync(path.join(TRANS_DIR, f), 'utf-8'));
        const ts = t.timestamp ? new Date(t.timestamp) : null;
        if (!ts || !inRange(ts.toISOString(), days)) return;
        total++;
        const pair = (t.from || 'auto') + '→' + (t.to || '?');
        byPair[pair] = (byPair[pair] || 0) + 1;
        const dk = ts.toISOString().slice(0, 10);
        byDay[dk] = (byDay[dk] || 0) + 1;
      } catch {}
    });
  } catch {}
  return { total, byPair, byDay };
}

// ---- 主聚合函数 ----
function getStats(range) {
  const daysMap = { day: 1, week: 7, month: 30, year: 365 };
  const days = daysMap[range] || 7;

  const heartbeats = readHeartbeats(days);
  const onlineTime = aggregateOnlineTime(heartbeats, range);
  const files = getFileStats(days);
  const notes = getNoteStats(days);
  const translate = getTranslateStats(days);
  const pomodoro = { sessions: 0, totalMinutes: 0 };

  return { onlineTime, files, notes, translate, pomodoro, range, days };
}

module.exports = { recordHeartbeat, getStats };
