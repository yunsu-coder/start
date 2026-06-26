// lib/browser.js - Puppeteer 浏览器管理
let puppeteer = null;
let browserPromise = null;
let browser = null;
let browserIdleTimer = null;

async function getPuppeteer() {
  if (!puppeteer) {
    puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
  }
  return puppeteer;
}

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (!browserPromise) {
    const pptr = await getPuppeteer();
    browserPromise = pptr.launch({
      headless: true,
      executablePath: '/usr/bin/google-chrome',
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-extensions', '--disable-background-networking',
        '--disable-sync', '--no-first-run',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
        '--disable-blink-features=AutomationControlled',
        '--js-flags=--max-old-space-size=96',
        '--max-old-space-size=96',
        '--disable-accelerated-2d-canvas',
        '--disable-web-security',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    browser = await browserPromise;
    browserPromise = null;
  }
  return browser;
}

async function closeBrowser() {
  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
    browserPromise = null;
  }
}

function resetBrowserTimer() {
  if (browserIdleTimer) clearTimeout(browserIdleTimer);
  browserIdleTimer = setTimeout(() => closeBrowser(), 5 * 60 * 1000);
}

// 每 10 分钟清理残留 chrome 进程
setInterval(() => {
  const { execSync } = require('child_process');
  try { execSync('pkill -f "chrome.*headless" 2>/dev/null || true', { timeout: 3000 }); } catch {}
}, 10 * 60 * 1000);

// 退出时清理
process.on('SIGTERM', async () => { await closeBrowser(); process.exit(0); });
process.on('SIGINT', async () => { await closeBrowser(); process.exit(0); });

module.exports = { getBrowser, closeBrowser, resetBrowserTimer };
