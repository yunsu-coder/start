// lib/export.js — 文档导出引擎（PDF / DOCX / TXT / MD）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getBrowser } = require('./browser');

// ===== Markdown → HTML =====
function md2html(md) {
  let h = (md || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/!\[(.*?)\]\((.+?)\)/g, '<img src="$2" alt="$1" style="max-width:100%;">')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');
  return '<p>' + h + '</p>';
}

// ===== 导出 PDF（Puppeteer）=====
async function exportToPDF(title, content) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${escHtml(title || '文档')}</title>
<style>
  @page { margin: 2cm; }
  body { font-family: "Noto Sans SC", "Source Han Sans SC", sans-serif;
    font-size: 12pt; line-height: 1.8; color: #222; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 20pt; border-bottom: 2px solid #333; padding-bottom: 6px; margin-top: 30px; }
  h2 { font-size: 16pt; margin-top: 24px; }
  h3 { font-size: 14pt; margin-top: 18px; }
  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 10pt; }
  pre { background: #f5f5f5; padding: 10px; border-radius: 6px; overflow-x: auto; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 16px; color: #666; }
  img { max-width: 100%; }
</style></head><body>
${title ? '<h1>' + escHtml(title) + '</h1>' : ''}
${md2html(content)}
</body></html>`;

  await page.setContent(html, { waitUntil: 'networkidle0' });
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
