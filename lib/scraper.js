// lib/scraper.js - 网页采集引擎（HTTP 抓取 + 浏览器渲染 + 截图 PDF）
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { URL } = require('url');
const cheerio = require('cheerio');
const sharp = require('sharp');
const { getBrowser, resetBrowserTimer } = require('./browser');
const { loadFontMap, decodeText } = require('./font');

const SCRAPE_DIR = path.join(__dirname, '..', 'scrape');
const FILES_DIR = path.join(__dirname, '..', 'files');

// ===== HTTP 抓取 =====

function fetchUrl(urlStr, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const opts = {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    };
    const req = mod.get(urlStr, opts, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchUrl(new URL(res.headers.location, urlStr).href, timeout).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('连接超时')); });
    req.on('error', reject);
  });
}

function downloadImage(urlStr, timeout = 8000, referer = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const ref = referer || `${u.protocol}//${u.host}/`;
    const req = mod.get(urlStr, {
      timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',  // 不让服务器压缩，避免 gzip 问题
        'Referer': ref,
      },
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return downloadImage(new URL(res.headers.location, urlStr).href, timeout, referer).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      const encoding = res.headers['content-encoding'];
      const stream = encoding === 'gzip' ? res.pipe(zlib.createGunzip())
        : encoding === 'deflate' ? res.pipe(zlib.createInflate())
        : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress())
        : res;
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (buf.length < 100) return reject(new Error('无效图片'));
        resolve(buf);
      });
      stream.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    req.on('error', reject);
  });
}



// ===== B站视频抓取 =====

async function scrapeBilibili(urlStr) {
  // 处理 b23.tv 短链接
  if (urlStr.includes('b23.tv')) {
    try {
      const redirectBuf = await fetchUrl(urlStr, 5000);
      // b23.tv redirects via 302, fetchUrl follows redirects and returns final HTML
      // The final URL contains the BV number
      // Actually fetchUrl follows redirects but returns the buffer, not the final URL
      // Let's resolve the redirect ourselves
    } catch {}
    // Fall back to trying to extract from the redirect
    try {
      const resolved = await new Promise((resolve, reject) => {
        const https = require('https');
        const req = https.get(urlStr, { timeout: 5000 }, res => {
          // b23.tv typically returns 302 with Location header
          if ([301,302,307,308].includes(res.statusCode)) {
            resolve(res.headers.location);
          } else {
            resolve(null);
          }
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
      });
      if (resolved) urlStr = resolved;
    } catch {}
  }

  const bvidMatch = urlStr.match(/BV[a-zA-Z0-9]{10}/);
  if (!bvidMatch) return null;
  const bvid = bvidMatch[0];

  // B站 API 需要 Referer
  const apiHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131',
    'Referer': 'https://www.bilibili.com/',
  };

  const https = require('https');
  function apiGet(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: apiHeaders, timeout: 10000 }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('超时')); });
    });
  }

  // 1. 获取视频信息
  const infoRes = await apiGet('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
  const info = JSON.parse(infoRes.toString());
  if (info.code !== 0) throw new Error('B站API错误: ' + (info.message || ''));
  
  const v = info.data;
  const cid = v.cid;
  const title = safeName(v.title.slice(0, 50));
  
  // 2. 获取播放地址
  const playRes = await apiGet(
    'https://api.bilibili.com/x/player/playurl?bvid=' + bvid + '&cid=' + cid + '&qn=80&fnval=1&fourk=1'
  );
  const play = JSON.parse(playRes.toString());
  if (play.code !== 0) throw new Error('播放地址获取失败');
  
  const durl = play.data.durl;
  if (!durl || !durl.length) return null;
  
  const results = [];
  for (let i = 0; i < durl.length; i++) {
    const seg = durl[i];
    // 加上 Referer 和 Range 头
    const buf = await new Promise((resolve, reject) => {
      const http = require('https');
      const u = new URL(seg.url);
      http.get(seg.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131',
          'Referer': 'https://www.bilibili.com/',
          'Range': 'bytes=0-' + (seg.size - 1),
        },
        timeout: 60000,
      }, res => {
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
    
    const ext = '.mp4';
    const name = 'vid_' + title.slice(0, 30).replace(/_+/g,'_') + (durl.length > 1 ? '_p' + (i+1) : '') + ext;
    results.push({ name, url: seg.url, size: buf.length, buf });
  }
  return { results, title: v.title };
}

// ===== 浏览器级抓取 =====

async function fetchWithBrowser(urlStr) {
  const b = await getBrowser();
  resetBrowserTimer();
  const page = await b.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      window.chrome = { runtime: {} };
    });
    await page.goto(urlStr, { waitUntil: 'networkidle2', timeout: 25000 });
    // 滚动页面触发懒加载
    await page.evaluate(async () => {
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 500));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 2000));
    return Buffer.from(await page.content());
  } finally {
    await page.close();
  }
}


// ===== 网络拦截式媒体抓取（深度模式）=====

async function captureMediaWithBrowser(urlStr, sessionDir) {
  const b = await getBrowser();
  resetBrowserTimer();
  const page = await b.newPage();
  const captured = [];
  try {
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    await page.setViewport({ width: 1920, height: 1080 });
    
    // 拦截所有响应，捕获音频
    page.on("response", async (resp) => {
      const url = resp.url();
      const ct = resp.headers()["content-type"] || "";
      const cl = parseInt(resp.headers()["content-length"] || "0");
      if ((ct.includes("audio") || /\.(mp3|wav|ogg|flac|aac|m4a)(\?|$)/i.test(url)) && cl > 10000) {
        try {
          const buf = await resp.buffer();
          if (buf.length > 10000) {
            const ext = (url.split("?")[0].match(/\.(\w{3,4})$/)?.[1] || "mp3").slice(0,5);
            captured.push({ url, buf, ext, size: buf.length });
          }
        } catch {}
      }
    });
    
    await page.goto(urlStr, { waitUntil: "networkidle2", timeout: 25000 });
    // 滚动触发懒加载
    await page.evaluate(async () => {
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 800));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 3000));
    
    // 尝试点击播放按钮触发加载
    await page.evaluate(() => {
      const btns = document.querySelectorAll('[class*="play"], [class*="Play"], [aria-label*="play" i], [aria-label*="Play" i], button:has([class*="play"])');
      btns.forEach(b => b.click());
    });
    await new Promise(r => setTimeout(r, 3000));
    
    // 保存到磁盘
    const results = [];
    for (let i = 0; i < captured.length; i++) {
      const c = captured[i];
      const name = `mus_${String(i + 1).padStart(4, "0")}.${c.ext}`;
      fs.writeFileSync(path.join(sessionDir, "images", name), c.buf);
      results.push({ name, url: c.url, size: c.size });
    }
    return results;
  } finally {
    await page.close();
  }
}

// ===== 跟踪详情页抓大图 =====

async function scrapeDetailPage(detailUrl, pageUrl) {
  let html, fromBrowser = false;
  try { html = (await fetchUrl(detailUrl, 8000)).toString(); }
  catch { return null; }

  // 尝试从静态 HTML 提取
  let best = await extractImagesFromHtml(html, detailUrl, pageUrl);

  // 静态 HTML 没找到大图 → 用浏览器渲染 SPA 页面
  if (!best || (best.meta && best.meta.width < 1200)) {
    try {
      const browserHtml = (await fetchWithBrowser(detailUrl)).toString();
      const browserBest = await extractImagesFromHtml(browserHtml, detailUrl, pageUrl);
      if (browserBest) {
        if (!best || (browserBest.meta.width || 0) > (best.meta.width || 0)) {
          best = browserBest;
          fromBrowser = true;
        }
      }
    } catch {}
  }

  // 还是没找到 → Puppeteer 高 DPI 截图兜底
  if (!best) {
    try {
      best = await screenshotDetailPage(detailUrl);
    } catch {}
  }

  return best;
}

async function extractImagesFromHtml(html, detailUrl, pageUrl) {
  const $ = cheerio.load(html);
  const candidates = [];

  // 找所有 img，收集高分辨率候选
  $('img').each((i, el) => {
    const $el = $(el);
    let src = $el.attr('data-original') || $el.attr('data-src') ||
              $el.attr('data-full') || $el.attr('data-hires') ||
              $el.attr('data-large') || $el.attr('src');
    if (!src) return;
    try { candidates.push(new URL(src, detailUrl).href); } catch {}
  });

  // 也找直接链接到图片的 <a>
  $('a').each((i, el) => {
    const href = $(el).attr('href');
    if (href && /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(href)) {
      try { candidates.push(new URL(href, detailUrl).href); } catch {}
    }
  });

  if (!candidates.length) return null;

  // 去重 + 过滤明显缩略图 URL
  const unique = [...new Set(candidates)].filter(u => {
    const lower = u.toLowerCase();
    return !lower.includes('getcroppingimg') && !lower.includes('_256.') && !lower.includes('-150x150');
  });

  // 下载并比较，取最大的
  let best = null, bestSize = 0;
  const toCheck = unique.slice(0, 15);

  for (const imgUrl of toCheck) {
    try {
      const buf = await downloadImage(imgUrl, 8000, pageUrl);
      if (buf.length < 10240) continue; // <10KB 跳过
      const meta = await sharp(buf).metadata();
      const pixels = (meta.width || 0) * (meta.height || 0);
      if (pixels > bestSize) { best = { url: imgUrl, buf, meta }; bestSize = pixels; }
    } catch {}
  }
  return best;
}

// Puppeteer 截图兜底（SPA 站无直接图片链接时用）
async function screenshotDetailPage(detailUrl) {
  const b = await getBrowser();
  resetBrowserTimer();
  const page = await b.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    // 2x DPI + 大视口 = 高分辨率截图
    await page.setViewport({ width: 1920, height: 1200, deviceScaleFactor: 2 });
    await page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 25000 });
    await new Promise(r => setTimeout(r, 4000));

    // 找到页面上最大的可见图片元素
    const imgInfo = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'))
        .filter(el => el.naturalWidth > 400 && el.clientWidth > 400);
      if (!imgs.length) return null;
      imgs.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
      const el = imgs[0];
      const rect = el.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, nw: el.naturalWidth, nh: el.naturalHeight };
    });

    if (imgInfo && imgInfo.w > 400) {
      const buf = await page.screenshot({
        clip: { x: imgInfo.x, y: imgInfo.y, width: imgInfo.w, height: imgInfo.h },
        type: 'png',
      });
      if (buf.length > 20000) {
        const meta = await sharp(buf).metadata();
        return { url: detailUrl, buf, meta };
      }
    }
    return null;
  } finally {
    await page.close();
  }
}

// ===== 截图模式 =====

async function screenshotPage(urlStr, sessionDir) {
  const b = await getBrowser();
  resetBrowserTimer();
  const page = await b.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 780, height: 1200 });
    await page.goto(urlStr, { waitUntil: 'networkidle2', timeout: 25000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise(r => setTimeout(r, 3000));

    const title = await page.title();

    // 展开所有容器让内容流入文档流
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach(el => {
        const st = getComputedStyle(el);
        if (/hidden|scroll|auto/.test(st.overflow + st.overflowY)) {
          el.style.setProperty('overflow', 'visible', 'important');
          el.style.setProperty('overflow-y', 'visible', 'important');
        }
        if (st.height !== 'auto' && !st.height.includes('%'))
          el.style.setProperty('height', 'auto', 'important');
        if (st.maxHeight !== 'none')
          el.style.setProperty('max-height', 'none', 'important');
        if (st.position === 'fixed' || st.position === 'sticky')
          el.style.setProperty('position', 'static', 'important');
      });
      document.body.style.setProperty('height', 'auto', 'important');
      document.body.style.setProperty('overflow', 'visible', 'important');
      document.documentElement.style.setProperty('height', 'auto', 'important');
      document.documentElement.style.setProperty('overflow', 'visible', 'important');
    });
    await new Promise(r => setTimeout(r, 1000));

    const results = [];
    const pngName = 'screenshot.png';
    const pngPath = path.join(sessionDir, pngName);
    await page.screenshot({ path: pngPath, fullPage: true, type: 'png' });
    results.push({ name: pngName, title, size: fs.statSync(pngPath).size, type: 'png' });

    const pdfName = 'screenshot.pdf';
    const pdfPath = path.join(sessionDir, pdfName);
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '25px', right: '25px' } });
    results.push({ name: pdfName, title, size: fs.statSync(pdfPath).size, type: 'pdf' });

    return { title, results };
  } finally {
    await page.close();
  }
}

// ===== Jina.ai 文本提取 =====

async function fetchTextWithJina(url) {
  try {
    const md = (await fetchUrl('https://r.jina.ai/' + url, 15000)).toString();
    if (!md || md.length < 50) return null;
    // 提取标题（Jina 返回的第一行格式: "Title: xxx"）
    const titleMatch = md.match(/^Title:\s*(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : '';
    return { title, markdown: md };
  } catch { return null; }
}

// ===== imgminer 图片发现 =====

async function discoverImagesWithImgminer(url) {
  try {
    const { getImages } = require('imgminer');
    const result = await getImages(url, { maxImages: 100, deepScan: true });
    if (!result?.images?.length) return null;
    // 去重 + 过滤 data: URI 和太小尺寸
    const seen = new Set();
    const images = [];
    for (const img of result.images) {
      if (!img.url || img.url.startsWith('data:')) continue;
      const normalized = img.url.split('?')[0];
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      images.push({ url: img.url });
    }
    return images;
  } catch { return null; }
}

// ===== 主采集函数 =====

async function doScrape(urls, type, opts = {}) {
  // URL 去重：检查是否已经采集过
  const existingSessions = listSessions();
  const alreadyScraped = urls.filter(url =>
    existingSessions.some(s => s.url === url || (s.urls && s.urls.includes(url)))
  );
  if (alreadyScraped.length && !opts.force) {
    // 过滤掉已采集的 URL
    const newUrls = urls.filter(url => !alreadyScraped.includes(url));
    if (!newUrls.length) {
      // 全部重复，但仍允许强制重采
      if (opts.skipDup) {
        return {
          sessionId: 'dup_skipped', url: urls[0], urlCount: urls.length, type,
          title: '已全部采集过', images: [], texts: [], errors: [],
          imageCount: 0, textCount: 0, errorCount: 0,
          skippedLowRes: 0, detailFollowed: 0, dedupSkipped: alreadyScraped.length,
          time: new Date().toISOString(),
        };
      }
    } else {
      urls = newUrls;
    }
  }

  const sessionId = Date.now().toString(36) + '_' + crypto.randomBytes(3).toString('hex');
  const sessionDir = path.join(SCRAPE_DIR, sessionId);
  const imgDir = path.join(sessionDir, 'images');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(imgDir, { recursive: true });

  const minWidth = opts.minWidth || 0;
  const minHeight = opts.minHeight || 0;
  const followDetail = opts.followDetail !== false;
  const deepRender = opts.deepRender !== false; // 默认开启深度渲染

  const result = {
    sessionId, url: urls[0], urlCount: urls.length, type,
    title: '', images: [], texts: [], errors: [],
    imageCount: 0, textCount: 0, errorCount: 0,
    skippedLowRes: 0, detailFollowed: 0,
    time: new Date().toISOString(),
  };

  // 收集页面所有可能指向详情页的链接
  const allDetailUrls = [];

  for (const url of urls) {
    try {
      // ---------- B站视频专用抓取 ----------
      // ---------- B站视频专用抓取 ----------
      if (url.includes('bilibili.com/video/')) {
        try {
          const bili = await scrapeBilibili(url);
          if (bili && bili.results) {
            for (const r of bili.results) {
              if (r.buf) {
                const imgDir = path.join(sessionDir, 'images');
                fs.writeFileSync(path.join(imgDir, r.name), r.buf);
                delete r.buf;
                result.images.push(r);
                result.imageCount++;
              }
            }
            if (bili.title) result.title = bili.title;
          }
        } catch(e) {
          result.errors.push({ url, error: 'B站: ' + e.message });
          result.errorCount++;
        }
        continue; // 跳过常规 HTML 抓取
      }

      // ---------- 获取 HTML ----------
      const isFanqie = url.includes('fanqienovel.com');
      let htmlBuf;
      if (isFanqie || deepRender) {
        htmlBuf = await fetchWithBrowser(url);
        // 深度模式：额外用网络拦截抓音视频
        if (deepRender && (type === 'both' || type === 'images' || type === 'video' || type === 'music')) {
          try {
            const mediaResults = await captureMediaWithBrowser(url, sessionDir);
            for (const r of mediaResults) {
              result.images.push(r);
              result.imageCount++;
            }
          } catch {}
        }
      } else {
        try { htmlBuf = await fetchUrl(url, 8000); }
        catch (e) { htmlBuf = await fetchWithBrowser(url); }
      }
      const html = htmlBuf.toString();
      const $ = cheerio.load(html);
      if (!result.title) result.title = $('title').text().trim() || url;

      // ---------- 文本提取（Jina.ai 优先，cheerio 兜底）----------
      if (type === 'text' || type === 'both') {
        let fullText = null, txtName = null;
        // 1. 尝试 Jina.ai Reader API（浏览器渲染 + AI 去噪）
        const jina = await fetchTextWithJina(url);
        if (jina && jina.markdown) {
          if (!result.title && jina.title) result.title = jina.title;
          fullText = jina.markdown;
          const titlePrefix = (jina.title || result.title || url).slice(0, 40);
          txtName = 'text_' + safeName(titlePrefix).replace(/_+/g, '_').slice(0, 50) + '.md';
        }
        // 2. Jina 失败 → cheerio 兜底
        if (!fullText) {
          const meta = {};
          $('meta[name]').each((i, el) => {
            const name = ($(el).attr('name') || '').toLowerCase();
            if (['description','author','keywords','date'].includes(name))
              meta[name] = $(el).attr('content') || '';
          });
          meta.title = $('title').text().trim();
          let bestText = extractText($('body'), $);
          if (/[\uE000-\uF8FF]/.test(bestText)) {
            const fontMap = loadFontMap();
            if (Object.keys(fontMap).length > 0) bestText = decodeText(bestText, fontMap);
          }
          bestText = cleanText(bestText);
          const header = [];
          if (meta.title) header.push('标题：' + meta.title);
          if (meta.author) header.push('作者：' + meta.author);
          if (meta.description) header.push('摘要：' + meta.description.slice(0, 200));
          fullText = (header.length ? header.join('\n') + '\n\n---\n\n' : '') + bestText.slice(0, 500000);
          const titlePrefix = (meta.title || result.title).slice(0, 30);
          txtName = 'text_' + safeName(titlePrefix).replace(/_+/g, '_').slice(0, 50) + '.txt';
        }
        fs.writeFileSync(path.join(sessionDir, txtName), fullText);
        result.texts.push({ name: txtName, title: result.title, size: Buffer.byteLength(fullText), url });
        result.textCount++;
      }

      // ---------- 图片提取 ----------
      if (type === 'images' || type === 'both' || type === 'video' || type === 'music') {
        // 收集页面所有详情页链接（供后续图片匹配）
        // 只保留看起来像内容详情页的链接
        const pageDetailUrls = [];
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href');
          if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
          if (/\.(jpg|jpeg|png|gif|webp|bmp|svg|css|js|ico)(\?|$)/i.test(href)) return;
          // 过滤明显不是详情页的链接
          const lower = href.toLowerCase();
          const isNav = /\/(login|register|about|contact|faq|privacy|terms|tag|tags|user|profile|settings|upload|random|toplist|forum|search|api)\b/.test(lower);
          if (isNav) return;
          try {
            const full = new URL(href, url).href;
            // 只取同域名的链接作为详情页候选
            if (new URL(full).hostname === new URL(url).hostname) {
              pageDetailUrls.push(full);
            }
          } catch {}
        });
        // 去重，优先保留包含数字/字母 ID 的路径
        const uniqueDetailUrls = [...new Set(pageDetailUrls)]
          .filter(u => /\d{8,}/.test(u)) // 只保留含长数字ID的（真正的详情页）
          .slice(0, 50);
        // 如果过滤后为空，放宽条件取所有同域名链接
        if (!uniqueDetailUrls.length) {
          uniqueDetailUrls.push(...[...new Set(pageDetailUrls)].filter(u => {
            try { return new URL(u).hostname === new URL(url).hostname; } catch { return false; }
          }).slice(0, 50));
        }

        let detailIdx = 0;
        const MAX_DETAIL_FOLLOW = 10; // 最多跟踪 10 个详情页

        let imgCandidates = [];

        // 1. 主路径：cheerio 解析（浏览器渲染后的 HTML 或静态 HTML）
        $('img').each((i, el) => {
          if (imgCandidates.length >= 100) return false;
          const $el = $(el);
          let src = $el.attr('data-original') || $el.attr('data-src') ||
                    $el.attr('data-full') || $el.attr('data-hires') ||
                    $el.attr('data-large') || $el.attr('src');
          const srcset = $el.attr('srcset');
          if (srcset) {
            const candidates = srcset.split(',').map(s => {
              const parts = s.trim().split(/\s+/);
              return { url: parts[0], val: parseInt(parts[1]) || (parts[1]==='2x'?2:1) };
            });
            candidates.sort((a, b) => b.val - a.val);
            if (candidates[0]?.url) src = candidates[0].url;
          }
          const $parent = $el.closest('a');
          let detailUrl = null;
          if ($parent.length) {
            const href = $parent.attr('href');
            if (href && /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(href)) {
              src = href;
            } else if (href && !href.startsWith('#') && !href.startsWith('javascript')) {
              try { detailUrl = new URL(href, url).href; } catch {}
            }
          }
          if (src) {
            try {
              const resolved = new URL(src, url).href;
              const upgraded = upgradeImageUrl(resolved);
              let finalDetail = detailUrl;
              if (!finalDetail) {
                const wallhavenMatch = resolved.match(/wallhaven\.cc\/(?:small|lg)\/\w+\/(\w+)\.\w+/i);
                if (wallhavenMatch) {
                  finalDetail = resolved.replace(/th\.wallhaven\.cc\/(?:small|lg)\/\w+\/\w+\.\w+/i,
                    'wallhaven.cc/w/' + wallhavenMatch[1]);
                }
              }
              if (!finalDetail && uniqueDetailUrls.length) finalDetail = uniqueDetailUrls[detailIdx++ % uniqueDetailUrls.length];
              imgCandidates.push({ orig: resolved, upgraded: upgraded !== resolved ? upgraded : null, detailUrl: finalDetail || null });
            } catch {}
          }
        });

        // 2. 补充：imgminer 深度扫描（CSS 背景图、cheerio 可能遗漏的图片）
        try {
          const minerImages = await discoverImagesWithImgminer(url);
          if (minerImages && minerImages.length) {
            const seen = new Set(imgCandidates.map(c => c.orig.split('?')[0]));
            for (const img of minerImages) {
              if (imgCandidates.length >= 150) break;
              const normalized = img.url.split('?')[0];
              if (seen.has(normalized)) continue;
              seen.add(normalized);
              let detailUrl = uniqueDetailUrls.length ? uniqueDetailUrls[detailIdx++ % uniqueDetailUrls.length] : null;
              imgCandidates.push({ orig: img.url, upgraded: upgradeImageUrl(img.url), detailUrl: detailUrl || null });
            }
          }
        } catch {}



      // ---------- 视频提取 ----------
      if (type === 'both' || type === 'video') { // 视频
        $('video, video source, a[href]').each((i, el) => {
          const tag = (el.tagName || '').toLowerCase();
          let src = '';
          if (tag === 'video' || tag === 'source') {
            src = $(el).attr('src') || '';
          } else if (tag === 'a') {
            const href = $(el).attr('href') || '';
            if (/\.(mp4|webm|mov|mkv|avi|flv|m3u8|mpd)(\?|$)/i.test(href)) {
              src = href;
            }
          }
          if (src) {
            try {
              const resolved = new URL(src, url).href;
              // 避免重复
              if (!imgCandidates.some(c => c.orig === resolved)) {
                const ext = (path.extname(new URL(resolved).pathname).split('?')[0] || '.mp4').toLowerCase();
                if (['.mp4', '.webm', '.mov', '.mkv', '.avi'].includes(ext)) {
                  imgCandidates.push({ orig: resolved, upgraded: null, detailUrl: null, isVideo: true });
                }
              }
            } catch {}
          }
        });
      }

      // ---------- 音频提取 ----------
      if (type === 'both' || type === 'music') {
        $('audio, audio source, a[href]').each((i, el) => {
          const tag = (el.tagName || '').toLowerCase();
          let src = '';
          if (tag === 'audio' || tag === 'source') {
            src = $(el).attr('src') || '';
          } else if (tag === 'a') {
            const href = $(el).attr('href') || '';
            if (/\.(mp3|wav|ogg|flac|aac|m4a|wma)(\?|$)/i.test(href)) {
              src = href;
            }
          }
          if (src) {
            try {
              const resolved = new URL(src, url).href;
              if (!imgCandidates.some(c => c.orig === resolved)) {
                imgCandidates.push({ orig: resolved, upgraded: null, detailUrl: null, isAudio: true });
              }
            } catch {}
          }
        });
      }

      // ---------- 文档提取 ----------
      if (type === 'both' || type === 'images') {
        const docExts = ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.csv','.zip','.rar','.7z'];
        $('a[href]').each((i, el) => {
          const href = $(el).attr('href') || '';
          const lower = href.toLowerCase();
          if (docExts.some(ext => lower.includes(ext))) {
            try {
              const resolved = new URL(href, url).href;
              if (!imgCandidates.some(c => c.orig === resolved)) {
                imgCandidates.push({ orig: resolved, upgraded: null, detailUrl: null, isDoc: true });
              }
            } catch {}
          }
        });
      }

        // 类型过滤：video 只保留视频，music 只保留音频
        if (type === 'video') {
          const videoExts = ['.mp4','.webm','.mov','.mkv'];
          imgCandidates = imgCandidates.filter(c => {
            try { const ext = new URL(c.orig).pathname.split('?')[0].toLowerCase().match(/\.\w{3,4}$/)?.[0] || ''; return videoExts.includes(ext); } catch { return false; }
          });
        } else if (type === 'music') {
          const musicExts = ['.mp3','.wav','.ogg','.flac','.aac','.m4a'];
          imgCandidates = imgCandidates.filter(c => {
            try { const ext = new URL(c.orig).pathname.split('?')[0].toLowerCase().match(/\.\w{3,4}$/)?.[0] || ''; return musicExts.includes(ext); } catch { return false; }
          });
        }

        const CONCURRENCY = 4;
        const globalBase = result.images.length;
        let downloaded = 0;

        for (let i = 0; i < imgCandidates.length; i += CONCURRENCY) {
          const batch = imgCandidates.slice(i, i + CONCURRENCY);
          const batchResults = await Promise.allSettled(
            batch.map(async (cand, bi) => {
              try {
                const ext = (path.extname(new URL(cand.orig).pathname).split('?')[0] || '.jpg').toLowerCase();
                if (['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'].includes(ext.slice(0,5))) { const buf = await downloadImage(cand.orig, 30000, url); if (!buf || buf.length < 1024) return null; const idx = globalBase + i + bi + 1; const imgName = 'mus_' + String(idx).padStart(4,'0') + ext.slice(0,5); fs.writeFileSync(path.join(imgDir, imgName), buf); return { name: imgName, url: cand.orig, size: buf.length }; }
                if (['.mp4', '.webm', '.mov', '.mkv'].includes(ext.slice(0,5))) { const buf = await downloadImage(cand.orig, 30000, url); if (!buf || buf.length < 1024) return null; const idx = globalBase + i + bi + 1; const imgName = 'vid_' + String(idx).padStart(4,'0') + ext; fs.writeFileSync(path.join(imgDir, imgName), buf); return { name: imgName, url: cand.orig, size: buf.length }; }
                const docExts = ['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.csv','.zip','.rar','.7z','.txt'];
                if (docExts.includes(ext)) { const buf = await downloadImage(cand.orig, 30000, url); if (!buf || buf.length < 1024) return null; const idx = globalBase + i + bi + 1; const name = 'doc_' + String(idx).padStart(4,'0') + ext; fs.writeFileSync(path.join(imgDir, name), buf); return { name, url: cand.orig, size: buf.length }; }
                if (!['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.mp4', '.webm', '.mov', '.mkv'].includes(ext.slice(0, 5))) return null;

                // 先下载原始 URL（传原页面 URL 作为 Referer）
                let buf = null, finalUrl = cand.orig;
                try { buf = await downloadImage(cand.orig, 8000, url); } catch {}

                let w = 0, h = 0;
                if (buf && ext !== '.svg') {
                  try {
                    const meta = await sharp(buf).metadata();
                    w = meta.width || 0; h = meta.height || 0;
                  } catch {}
                }

                // 太低分辨率 → 尝试升级版 URL
                const tooSmall = (minWidth > 0 && w < minWidth) || (minHeight > 0 && h < minHeight);
                if (buf && tooSmall && cand.upgraded) {
                  try {
                    const upgradedExt = (path.extname(new URL(cand.upgraded).pathname).split('?')[0] || ext).toLowerCase();
                    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'].includes(upgradedExt.slice(0, 5))) {
                      const buf2 = await downloadImage(cand.upgraded, 8000, url);
                      const meta2 = await sharp(buf2).metadata();
                      if ((meta2.width || 0) > w || (meta2.height || 0) > h) {
                        buf = buf2; finalUrl = cand.upgraded;
                        w = meta2.width || 0; h = meta2.height || 0;
                      }
                    }
                  } catch {}
                }

                // 还是太小 → 跟踪详情页找大图（不超过上限）
                const stillTooSmall = (minWidth > 0 && w < minWidth) || (minHeight > 0 && h < minHeight);
                const needsBetter = !buf || stillTooSmall || (w > 0 && h > 0 && w < 800 && h < 600);
                if (followDetail && result.detailFollowed < MAX_DETAIL_FOLLOW && needsBetter) {
                  // 优先用候选关联的 detailUrl，否则从 uniqueDetailUrls 取
                  let detailUrl = cand.detailUrl;
                  if (!detailUrl && uniqueDetailUrls.length > 0) {
                    detailUrl = uniqueDetailUrls[result.detailFollowed % uniqueDetailUrls.length];
                  }
                  if (detailUrl) {
                    const detail = await scrapeDetailPage(detailUrl, url);
                  if (detail && detail.buf) {
                    const dp = (detail.meta.width || 0) * (detail.meta.height || 0);
                    const cp = w * h;
                    if (dp > cp) {
                      buf = detail.buf; finalUrl = detail.url;
                      w = detail.meta.width || 0; h = detail.meta.height || 0;
                      result.detailFollowed++;
                    }
                  }
                  } // end if (detailUrl)
                }

                // 最终检查：如果仍不满足最低分辨率，跳过
                if (buf && (minWidth > 0 || minHeight > 0) && ext !== '.svg') {
                  if (w < minWidth || h < minHeight) {
                    return { _skip: true, w, h };
                  }
                }

                if (!buf) return null;
                const idx = globalBase + i + bi + 1;
                const imgName = `img_${String(idx).padStart(4, '0')}${ext.slice(0, 5)}`;
                fs.writeFileSync(path.join(imgDir, imgName), buf);
                return { name: imgName, url: finalUrl, size: buf.length };
              } catch { return null; }
            })
          );
          for (const r of batchResults) {
            if (r.status === 'fulfilled' && r.value) {
              if (r.value._skip) { result.skippedLowRes++; continue; }
              result.images.push(r.value); downloaded++;
            }
          }
        }
        result.imageCount += downloaded;
      }
    } catch (e) {
      result.errors.push({ url, error: e.message });
      result.errorCount++;
    }
  }

  fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(result.images, null, 2));
  fs.writeFileSync(path.join(sessionDir, 'result.json'), JSON.stringify(result, null, 2));
  return result;
}

// ===== URL 升级：尝试从缩略图 URL 推导原图 URL =====

function upgradeImageUrl(imgUrl) {
  try {
    const u = new URL(imgUrl);
    // 去掉常见尺寸查询参数
    const sizeParams = ['w', 'width', 'h', 'height', 'size', 'quality', 'resize', 'thumb', 'thumbnail'];
    for (const p of sizeParams) u.searchParams.delete(p);
    // 去掉 URL path 里的缩略图后缀: -150x150, _thumb, _small, -preview 等
    u.pathname = u.pathname.replace(/[-_](?:\d{2,4}x\d{2,4}|thumb|small|medium|tn|thumbnail|preview|mini)(?=\.\w{3,4}$)/i, '');
    return u.toString();
  } catch { return imgUrl; }
}

// ===== 辅助 =====

function safeName(name) {
  return name.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
}

// 智能文本提取：保留段落结构
function extractText(el, $) {
  const clone = el.clone();
  // 移除无关元素
  clone.find('script, style, nav, header, footer, .nav, .header, .footer, .sidebar, .ad, .advertisement, [class*="comment"], [class*="share"], [class*="related"], .recommend, .widget, .social, .breadcrumb, [role="navigation"], [role="banner"]').remove();
  // 块级元素 → 换行
  clone.find('p, div, li, h1, h2, h3, h4, h5, h6, section, article, blockquote, pre, table, tr').each((i, el) => {
    $(el).append('\n');
  });
  clone.find('br').replaceWith('\n');
  let text = clone.text();
  // 清理多余空白
  text = text.replace(/\n[ \t]+/g, '\n').replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  // 合并过短的相邻行
  const lines = text.split('\n');
  const merged = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { merged.push(''); continue; }
    const prev = merged[merged.length - 1];
    if (prev && prev.length < 40 && !prev.endsWith('。') && !prev.endsWith('！') && !prev.endsWith('？')) {
      merged[merged.length - 1] = prev + trimmed;
    } else {
      merged.push(trimmed);
    }
  }
  return merged.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 文本后处理：去除噪音、空行压缩、长度截断
function cleanText(text) {
  // 去常见噪音行
  return text
    .split('\n')
    .filter(line => {
      const t = line.trim();
      if (!t) return true; // 保留空行
      if (t.length < 3 && !/^[#\-*]/.test(t)) return false;
      if (/^(copyright|©|all rights|隐私|备案|粤ICP|京ICP|沪ICP|苏ICP|举报|投诉|广告|赞助|推广)/i.test(t)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// ===== 采集历史 =====

let _sessionCache = null;
let _sessionCacheTime = 0;

function listSessions() {
  // 缓存 5 秒
  const now = Date.now();
  if (_sessionCache && now - _sessionCacheTime < 5000) return _sessionCache;

  const sessions = [];
  if (fs.existsSync(SCRAPE_DIR)) {
    for (const dir of fs.readdirSync(SCRAPE_DIR)) {
      const rp = path.join(SCRAPE_DIR, dir, 'result.json');
      if (fs.existsSync(rp)) {
        try {
          const raw = JSON.parse(fs.readFileSync(rp, 'utf8'));
          // 贴吧采集会话
          if (raw.kw !== undefined) {
            sessions.push({
              sessionId: raw.sessionId || dir,
              type: 'tieba',
              kw: raw.kw,
              title: raw.kw + '吧',
              threadCount: raw.threadCount || 0,
              fetchedCount: raw.fetchedCount || 0,
              textSize: raw.textSize || 0,
              textFile: raw.textFile || '',
              errorCount: (raw.errors || []).length,
              time: raw.time,
            });
            continue;
          }
          // 常规采集会话（只保留前3张图片和文本名称）
          const summary = {
            sessionId: raw.sessionId, url: raw.url, urlCount: raw.urlCount, type: raw.type,
            title: raw.title, imageCount: raw.imageCount, textCount: raw.textCount,
            errorCount: raw.errorCount, skippedLowRes: raw.skippedLowRes || 0,
            detailFollowed: raw.detailFollowed || 0,
            time: raw.time,
            images: (raw.images || []).slice(0, 3).map(i => ({ name: i.name, size: i.size })),
            texts: (raw.texts || []).slice(0, 3).map(t => ({ name: t.name, title: t.title, size: t.size })),
          };
          sessions.push(summary);
        } catch {}
      }
    }
    sessions.sort((a, b) => new Date(b.time) - new Date(a.time));
  }
  _sessionCache = sessions;
  _sessionCacheTime = now;
  return sessions;
}

function invalidateSessionCache() { _sessionCache = null; _sessionCacheTime = 0; }

function getSession(sid) {
  const rp = path.join(SCRAPE_DIR, sid, 'result.json');
  if (!fs.existsSync(rp)) return null;
  return JSON.parse(fs.readFileSync(rp, 'utf8'));
}

function deleteSession(sid) {
  const sp = path.join(SCRAPE_DIR, sid);
  if (fs.existsSync(sp)) fs.rmSync(sp, { recursive: true });
  invalidateSessionCache();
}

function transferSession(sid, items) {
  const sessionDir = path.join(SCRAPE_DIR, sid);
  if (!fs.existsSync(sessionDir)) return [];
  const imgDir = path.join(sessionDir, 'images');
  const transferred = [];

  if (fs.existsSync(imgDir)) {
    for (const img of fs.readdirSync(imgDir)) {
      if (items && items.length && !items.includes(img)) continue;
      let dest = path.join(FILES_DIR, img);
      let counter = 1;
      while (fs.existsSync(dest)) {
        const ext = path.extname(img), base = path.basename(img, ext);
        dest = path.join(FILES_DIR, base + '_' + (counter++) + ext);
      }
      fs.copyFileSync(path.join(imgDir, img), dest);
      transferred.push(img);
    }
  }

  for (const f of fs.readdirSync(sessionDir)) {
    if (f.startsWith('.') || ['result.json', 'meta.json', 'images'].includes(f)) continue;
    const fp = path.join(sessionDir, f);
    if (fs.statSync(fp).isDirectory()) continue;
    if (items && items.length && !items.includes(f)) continue;
    let dest = path.join(FILES_DIR, f);
    let counter = 1;
    while (fs.existsSync(dest)) {
      const ext = path.extname(f), base = path.basename(f, ext);
      dest = path.join(FILES_DIR, base + '_' + (counter++) + ext);
    }
    fs.copyFileSync(fp, dest);
    transferred.push(f);
  }
  return transferred;
}


module.exports = {
  doScrape, listSessions, getSession, deleteSession, transferSession, invalidateSessionCache,
  fetchUrl, downloadImage, safeName, scrapeDetailPage, upgradeImageUrl,
  extractImagesFromHtml, screenshotDetailPage, fetchWithBrowser, extractText, cleanText,
  scrapeBilibili, captureMediaWithBrowser,
};
