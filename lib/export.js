// lib/export.js — 文档导出引擎（PDF / DOCX / TXT / MD）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getBrowser } = require('./browser');

// ===== Markdown → HTML（与客户端对齐）=====
function md2html(md) {
  let s = (md || '');

  // ① 保护代码块和行内代码
  const codeBlocks = [];
  const inlineCodes = [];
  s = s.replace(/``([\s\S]*?)``/g, (_, c) => { inlineCodes.push(c); return '\x02' + (inlineCodes.length - 1) + '\x02'; });
  s = s.replace(/`([^`]+)`/g, (_, c) => { inlineCodes.push(c); return '\x01' + (inlineCodes.length - 1) + '\x01'; });
  s = s.replace(/```(\S*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push({ lang, code });
    return '\x00' + (codeBlocks.length - 1) + '\x00';
  });

  // ② HTML 转义
  s = s.replace(/&(?!\w+;)/g, '&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  // ③ 表格（支持对齐）
  s = s.replace(/^\|(.+)\|\s*$\n\|[-:\s|]+\|\s*$(?:\n\|.+\|\s*$)*/gm, (match) => {
    const lines = match.trim().split('\n');
    if (lines.length < 2) return match;
    const alignRow = lines[1].split('|').filter(c => c.trim());
    const aligns = alignRow.map(c => {
      const t = c.trim();
      if (t.startsWith(':') && t.endsWith(':')) return 'center';
      if (t.endsWith(':')) return 'right';
      return 'left';
    });
    const hc = lines[0].split('|').filter(c => c.trim()).map((c, i) =>
      '<th' + (aligns[i] ? ' style="text-align:' + aligns[i] + '"' : '') + '>' + c.trim() + '</th>').join('');
    const rc = lines.slice(2).map(r => '<tr>' + r.split('|').filter(c => c.trim()).map((c, i) =>
      '<td' + (aligns[i] ? ' style="text-align:' + aligns[i] + '"' : '') + '>' + c.trim() + '</td>').join('') + '</tr>').join('');
    return '<table><thead><tr>' + hc + '</tr></thead><tbody>' + rc + '</tbody></table>';
  });

  // ④ 水平线
  s = s.replace(/^(?:[-\*_]){3,}\s*$/gm, '<hr>');

  // ⑤ 标题
  s = s.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  s = s.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  s = s.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  s = s.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // ⑥ 引用块（支持嵌套）
  s = s.replace(/^(?:&gt;\s?.+\n?)+/gm, (match) => {
    const lines = match.split('\n').filter(l => l.trim());
    let depth = 1;
    for (const line of lines) {
      const m = line.match(/^(&gt;\s?)+/);
      if (m) depth = Math.max(depth, m[0].match(/&gt;/g).length);
    }
    let inner = lines.map(l => l.replace(/^(&gt;\s?)+/, '')).join('<br>').trim();
    for (let i = 0; i < depth; i++) inner = '<blockquote>' + inner + '</blockquote>';
    return inner;
  });

  // ⑦ 任务列表
  s = s.replace(/^[*-] \[x\] (.+)$/gim, '<li class="task done"><input type="checkbox" checked disabled> $1</li>');
  s = s.replace(/^[*-] \[ \] (.+)$/gim, '<li class="task"><input type="checkbox" disabled> $1</li>');

  // ⑧ 列表
  s = s.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
  s = s.replace(/^[*-]\s+(.+)$/gm, '<li>$1</li>');
  s = s.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // ⑨ 段落
  const lines = s.split('\n');
  let result = [], inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isBlock = /^<(h[1-6]|hr|table|blockquote|ul|ol|pre|div|p)\b/.test(line) || /^<\/(ul|ol|table|blockquote)>/.test(line);
    if (isBlock) {
      if (inBlock) result[result.length-1] += '\n' + line;
      else { result.push(line); inBlock = true; }
    } else if (line.trim() === '') { inBlock = false; }
    else {
      if (inBlock) result[result.length-1] += '\n' + line;
      else { result.push(line); inBlock = true; }
    }
  }
  s = result.map(block => {
    if (/^<\/?/.test(block.trim())) return block;
    return '<p>' + block.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
  }).join('\n');

  // ⑩ 行内格式
  s = s.replace(/==(.+?)==/g, '<mark>$1</mark>');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  s = s.replace(/~(.+?)~/g, '<sub>$1</sub>');
  s = s.replace(/\^(.+?)\^/g, '<sup>$1</sup>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 链接和图片
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 恢复代码块和行内代码
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => {
    const b = codeBlocks[+i];
    const escaped = b.code.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return '<pre><code class="' + (b.lang || '') + '">' + escaped + '</code></pre>';
  });
  s = s.replace(/\x01(\d+)\x01/g, (_, i) =>
    '<code>' + inlineCodes[+i].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code>');
  s = s.replace(/\x02(\d+)\x02/g, (_, i) =>
    '<code>' + inlineCodes[+i].replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</code>');

  return s || '<p></p>';
}

// ===== 导出 PDF（Puppeteer）=====
async function exportToPDF(title, content, html) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // 如果客户端传了已渲染的 HTML，直接用；否则走服务端 md2html
  const bodyHtml = html || md2html(content);

  const docHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escHtml(title || '文档')}</title>
<style>
  @page { margin: 2cm; size: A4; }
  body {
    font-family: "Noto Sans SC", "Source Han Sans SC", "PingFang SC", sans-serif;
    font-size: 11pt; line-height: 1.9; color: #222; max-width: 800px; margin: 0 auto;
  }
  h1 { font-size: 22pt; border-bottom: 2px solid #333; padding-bottom: 8px; margin-top: 32px; margin-bottom: 16px; page-break-after: avoid; }
  h2 { font-size: 17pt; margin-top: 28px; margin-bottom: 12px; page-break-after: avoid; }
  h3 { font-size: 14pt; margin-top: 22px; margin-bottom: 10px; page-break-after: avoid; }
  h4, h5, h6 { page-break-after: avoid; }
  p { margin: 0.5em 0; orphans: 3; widows: 3; }
  code { background: #f0f0f0; padding: 1px 5px; border-radius: 3px; font-size: 9.5pt; font-family: "SF Mono","Fira Code","Consolas",monospace; }
  pre { background: #f5f5f5; padding: 10px 12px; border-radius: 6px; overflow-x: auto; font-size: 9pt; line-height: 1.5; page-break-inside: avoid; border: 1px solid #e0e0e0; }
  pre code { background: none; padding: 0; font-size: inherit; }
  blockquote { border-left: 4px solid #bbb; margin: 0.8em 0; padding: 0.4em 1em; color: #555; font-style: italic; page-break-inside: avoid; }
  blockquote blockquote { border-left-color: #ddd; }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; page-break-inside: avoid; }
  th { background: #555; color: #fff; padding: 6px 10px; border: 1px solid #555; font-weight: 600; }
  td { border: 1px solid #ccc; padding: 5px 10px; }
  tr:nth-child(even) td { background: #f9f9f9; }
  img { max-width: 100%; page-break-inside: avoid; }
  ul, ol { margin: 0.5em 0; padding-left: 1.8em; }
  li { margin: 0.15em 0; }
  li.task { list-style: none; margin-left: -1.5em; }
  li.task.done { text-decoration: line-through; opacity: 0.6; }
  li.task input { margin-right: 0.4em; }
  hr { border: none; border-top: 1px solid #ccc; margin: 1.2em 0; }
  mark { background: #ffe08a; padding: 0 3px; border-radius: 2px; }
  del { opacity: 0.6; }
  a { color: #1e66f5; }
</style></head><body>
${title ? '<h1>' + escHtml(title) + '</h1>' : ''}
${bodyHtml}
</body></html>`;

  await page.setContent(docHtml, { waitUntil: 'networkidle0', timeout: 15000 });
  const pdf = await page.pdf({
    format: 'A4',
    margin: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' },
    printBackground: true,
  });
  await page.close();
  return pdf;
}

// ===== 导出 DOCX =====
async function exportToDOCX(title, content) {
  const docx = require('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, TableOfContents,
          AlignmentType, BorderStyle } = docx;

  const lines = (content || '').split('\n');
  const paragraphs = [];

  if (title) {
    paragraphs.push(
      new Paragraph({ children: [new TextRun({ text: title, bold: true, size: 32 })],
        alignment: AlignmentType.CENTER, spacing: { after: 400 } })
    );
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith('### ')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: line.slice(4), bold: true, size: 22 })],
        spacing: { before: 200, after: 100 },
      }));
    } else if (line.startsWith('## ')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: line.slice(3), bold: true, size: 26 })],
        spacing: { before: 300, after: 150 },
      }));
    } else if (line.startsWith('# ')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: line.slice(2), bold: true, size: 30 })],
        spacing: { before: 400, after: 200 },
      }));
    } else if (line.startsWith('---') || line.startsWith('***')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: '————————————', color: '999999' })],
        alignment: AlignmentType.CENTER, spacing: { before: 200, after: 200 },
      }));
    } else if (line.startsWith('- ')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: '• ' + line.slice(2), size: 22 })],
        indent: { left: 400 }, spacing: { after: 60 },
      }));
    } else if (line.startsWith('> ')) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: line.slice(2), italics: true, color: '666666', size: 22 })],
        indent: { left: 400 }, spacing: { after: 100 },
        border: { left: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
      }));
    } else if (line === '') {
      paragraphs.push(new Paragraph({ spacing: { after: 60 }, children: [] }));
    } else {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: line, size: 22 })],
        spacing: { after: 80 },
      }));
    }
    i++;
  }

  const doc = new Document({ sections: [{ children: paragraphs }] });
  return await Packer.toBuffer(doc);
}

// ===== 导出 TXT / MD =====
function exportToTXT(title, content) {
  let txt = '';
  if (title) txt += title + '\n' + '='.repeat(title.length) + '\n\n';
  txt += content || '';
  return Buffer.from(txt, 'utf8');
}

function exportToMD(title, content) {
  let md = '';
  if (title) md += '# ' + title + '\n\n';
  md += content || '';
  return Buffer.from(md, 'utf8');
}

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { exportToPDF, exportToDOCX, exportToTXT, exportToMD };
