// lib/safePath.js - 路径安全工具（防目录穿越）
const path = require('path');

/**
 * 安全拼接：name 必须是非空相对路径，解析后必须仍位于 base 之内
 * @param {string} base - 基目录（绝对路径）
 * @param {string} name - 用户输入的相对路径
 * @returns {string|null} 安全的绝对路径；非法输入返回 null
 */
function safeJoin(base, name) {
  if (typeof name !== 'string' || name === '') return null;
  if (name.includes('\0')) return null;
  const normalized = path.normalize(name);
  if (path.isAbsolute(normalized)) return null;
  const joined = path.join(base, normalized);
  const rel = path.relative(base, joined);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return joined;
}

/** 安全解码 URL 片段：非法编码返回空串（避免 decodeURIComponent 抛异常） */
function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return ''; }
}

module.exports = { safeJoin, safeDecode };
