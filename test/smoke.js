// test/smoke.js — API 冒烟测试：启动临时服务实例，逐项断言核心端点
// 用法：node test/smoke.js [--auth]
const { spawn } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PORT = parseInt(process.env.SMOKE_PORT || '3199', 10);
const BASE = 'http://127.0.0.1:' + PORT;
const USE_AUTH = process.argv.includes('--auth');
const SMOKE_USER = process.env.SMOKE_USER || 'yiwei';
const SMOKE_PASS = process.env.SMOKE_PASS || 'test-pass-123';
const AUTH = { Authorization: 'Basic ' + Buffer.from(SMOKE_USER + ':' + SMOKE_PASS).toString('base64') };
const H = USE_AUTH ? AUTH : {};
const J = { 'Content-Type': 'application/json' };

let passed = 0, failed = 0;
function ok(label, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (extra !== undefined ? ' — ' + extra : '')); }
}

async function req(method, p, body, headers = {}) {
  const r = await fetch(BASE + p, { method, headers: { ...H, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  // 文本响应：直接读文本（json() 会先消费响应体）
  if (ct.includes('text/plain') || ct.includes('text/markdown')) {
    return { status: r.status, data: null, text: await r.text() };
  }
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data, text: '' };
}

async function main() {
  console.log('== 冒烟测试开始' + (USE_AUTH ? '（带认证）' : '') + ' ==');

  // 认证 + 滑块拼图 + 会话登录
  if (USE_AUTH) {
    const anon = await fetch(BASE + '/api/status');
    ok('无凭据 → 登录页（200）', anon.status === 200 && (await anon.text()).includes('一苇'));

    // 滑块拼图流程
    const c1 = await fetch(BASE + '/captcha/new');
    const c1j = await c1.json();
    ok('GET /captcha/new → token+bg+piece+y', c1.status === 200 && !!c1j.token && typeof c1j.bg === 'string' && typeof c1j.piece === 'string' && typeof c1j.y === 'number');
    ok('TEST_MODE 暴露 target', typeof c1j.target === 'number');

    const bgR = await fetch(BASE + c1j.bg);
    ok('验证码背景图', bgR.status === 200 && (bgR.headers.get('content-type') || '').includes('image'));
    const pieceR = await fetch(BASE + c1j.piece);
    ok('拼图块图片', pieceR.status === 200 && (pieceR.headers.get('content-type') || '').includes('png'));

    const wrong = await fetch(BASE + '/captcha/verify', { method: 'POST', headers: J, body: JSON.stringify({ token: c1j.token, offset: 0 }) });
    ok('错误位置 → 400', wrong.status === 400);

    const c2 = await fetch(BASE + '/captcha/new');
    const c2j = await c2.json();
    const right = await fetch(BASE + '/captcha/verify', { method: 'POST', headers: J, body: JSON.stringify({ token: c2j.token, offset: c2j.target }) });
    const sc = right.headers.get('set-cookie') || '';
    ok('正确位置 → 200 + 验证 Cookie', right.status === 200 && sc.includes('yiwei_captcha'));

    // 登录接口
    const noCap = await fetch(BASE + '/login', { method: 'POST', headers: J, body: JSON.stringify({ user: SMOKE_USER, pass: SMOKE_PASS }) });
    ok('无验证 Cookie 登录 → 403', noCap.status === 403);
    const bad = await fetch(BASE + '/login', { method: 'POST', headers: { ...J, Cookie: sc.split(';')[0] }, body: JSON.stringify({ user: SMOKE_USER, pass: 'wrong-pass' }) });
    ok('错误密码 → 401', bad.status === 401);
    const good = await fetch(BASE + '/login', { method: 'POST', headers: { ...J, Cookie: sc.split(';')[0] }, body: JSON.stringify({ user: SMOKE_USER, pass: SMOKE_PASS, remember: true }) });
    const ac = good.headers.get('set-cookie') || '';
    ok('正确凭据 → 200 + 会话 Cookie', good.status === 200 && ac.includes('yiwei_auth'));

    // 会话 Cookie 访问 API
    const sess = await fetch(BASE + '/api/status', { headers: { Cookie: ac.split(';')[0] } });
    ok('会话 Cookie 访问 API → 200', sess.status === 200);

    const media = await fetch(BASE + '/api/m3u/whatever.mp3');
    ok('媒体直连端点 → 401 + 登录框头', media.status === 401 && (media.headers.get('www-authenticate') || '').startsWith('Basic'));

    // 暴力破解锁定：累计 5 次失败后锁定（限 /login，不影响 Basic 认证的 API）
    let lockStatus = 0;
    for (let i = 0; i < 4; i++) {
      const r = await fetch(BASE + '/login', { method: 'POST', headers: { ...J, Cookie: sc.split(';')[0] }, body: JSON.stringify({ user: SMOKE_USER, pass: 'bad-pass-' + i }) });
      lockStatus = r.status;
    }
    ok('累计 5 次登录失败 → 429 锁定', lockStatus === 429);
  }

  // 首页与静态
  const home = await fetch(BASE + '/', { headers: H });
  ok('首页 HTML', home.status === 200 && (await home.text()).includes('<!DOCTYPE'));
  const fav = await fetch(BASE + '/favicon.svg', { headers: H });
  ok('favicon', fav.status === 200);

  // 系统状态 / 配置 / 天气 / 分析
  const st = await req('GET', '/api/status');
  ok('GET /api/status', st.status === 200 && st.data.mem_used);
  const cs = await req('GET', '/api/config/status');
  ok('GET /api/config/status', cs.status === 200 && typeof cs.data.auth === 'boolean');
  const wx = await req('GET', '/api/weather?city=shanghai');
  ok('GET /api/weather', wx.status === 200);
  const hb = await req('POST', '/api/analytics/heartbeat', { panel: 'home' });
  ok('POST /api/analytics/heartbeat', hb.status === 200);
  const as = await req('GET', '/api/analytics/stats?range=week');
  ok('GET /api/analytics/stats', as.status === 200);

  // 文件站全流程
  const fl = await req('GET', '/api/files?dir=');
  ok('GET /api/files', fl.status === 200 && Array.isArray(fl.data.files));
  const fc = await req('POST', '/api/files/create', { name: 'smoke-test.txt', content: 'hello smoke' });
  ok('POST /api/files/create', fc.status === 200);
  const fv = await req('GET', '/api/preview/smoke-test.txt');
  ok('GET /api/preview', fv.status === 200 && (fv.text || '').includes('hello smoke'));
  const fd = await req('GET', '/api/dl/smoke-test.txt');
  ok('GET /api/dl', fd.status === 200);
  const fr = await req('POST', '/api/files/rename', { name: 'smoke-test.txt', newName: 'smoke-renamed.txt' });
  ok('POST /api/files/rename', fr.status === 200);
  const fcp = await req('POST', '/api/files/copy', { name: 'smoke-renamed.txt', targetDir: 'smoke-dir2' });
  ok('POST /api/files/copy', fcp.status === 200);
  const fm = await req('POST', '/api/files/move', { name: 'smoke-renamed.txt', targetDir: 'smoke-dir' });
  ok('POST /api/files/move', fm.status === 200);
  const fdel = await req('DELETE', '/api/files/' + encodeURIComponent('smoke-dir/smoke-renamed.txt'));
  ok('DELETE /api/files (in subdir)', fdel.status === 200);
  const fdel2 = await req('DELETE', '/api/files/' + encodeURIComponent('smoke-dir2/smoke-renamed.txt'));
  ok('DELETE /api/files copy', fdel2.status === 200);
  const tr = await req('GET', '/api/trash');
  ok('GET /api/trash', tr.status === 200);
  // 恢复第一个进回收站的文件
  const trashItem = (tr.data || []).find(t => t.name.includes('smoke'));
  if (trashItem) {
    const rst = await req('POST', '/api/trash/restore/' + encodeURIComponent(trashItem.name));
    ok('POST /api/trash/restore', rst.status === 200);
  } else { ok('POST /api/trash/restore', false, '回收站未找到测试文件'); }
  // 清空回收站（收尾）
  const et = await req('DELETE', '/api/trash');
  ok('DELETE /api/trash (清空)', et.status === 200);

  // 文件夹
  const fld = await req('POST', '/api/folders', { name: 'smoke-folder' });
  ok('POST /api/folders', fld.status === 200);
  const frn = await req('PUT', '/api/folders/rename/smoke-folder', { newName: 'smoke-folder2' });
  ok('PUT /api/folders/rename', frn.status === 200);
  const fdl = await req('DELETE', '/api/folders/smoke-folder2');
  ok('DELETE /api/folders', fdl.status === 200);
  const fdl2 = await req('DELETE', '/api/folders/smoke-dir');
  ok('DELETE /api/folders (move target)', fdl2.status === 200);

  // 笔记
  const nl = await req('GET', '/api/notes');
  ok('GET /api/notes', nl.status === 200 && Array.isArray(nl.data));
  const nc = await req('POST', '/api/notes', { title: 'smoke note', content: '# 测试\n内容' });
  ok('POST /api/notes', nc.status === 200 && nc.data.id);
  const nid = nc.data.id;
  const ng = await req('GET', '/api/notes/' + nid);
  ok('GET /api/notes/:id', ng.status === 200 && ng.data.title === 'smoke note');
  const nu = await req('POST', '/api/notes', { id: nid, title: 'smoke note v2', content: 'updated' });
  ok('PUT 风格更新笔记', nu.status === 200);
  const nd = await req('DELETE', '/api/notes/' + nid);
  ok('DELETE /api/notes/:id', nd.status === 200);

  // 作品
  const wc = await req('POST', '/api/works', { title: 'smoke work' });
  ok('POST /api/works', wc.status === 200 && wc.data.id);
  const wid = wc.data.id;
  const wl = await req('GET', '/api/works');
  ok('GET /api/works', wl.status === 200 && Array.isArray(wl.data));
  const wg = await req('GET', '/api/works/' + wid);
  ok('GET /api/works/:id', wg.status === 200);
  const wr = await req('POST', '/api/works/' + wid + '/reorder', { chapterIds: [] });
  ok('POST /api/works/:id/reorder', wr.status === 200);
  const we = await req('GET', '/api/works/' + wid + '/export?format=md');
  ok('GET /api/works/:id/export', we.status === 200);
  const wd = await req('DELETE', '/api/works/' + wid);
  ok('DELETE /api/works/:id', wd.status === 200);

  // 任务
  const tc = await req('POST', '/api/tasks', { description: 'smoke task' });
  ok('POST /api/tasks', tc.status === 200 && tc.data.id);
  const tid = tc.data.id;
  const tl = await req('GET', '/api/tasks');
  ok('GET /api/tasks', tl.status === 200 && Array.isArray(tl.data));
  const tu = await req('POST', '/api/tasks/' + tid, { status: 'done' });
  ok('POST /api/tasks/:id', tu.status === 200);
  const td = await req('DELETE', '/api/tasks/' + tid);
  ok('DELETE /api/tasks/:id', td.status === 200);

  // 翻译
  const lg = await req('GET', '/api/translate/langs');
  ok('GET /api/translate/langs', lg.status === 200 && Array.isArray(lg.data));
  const th = await req('POST', '/api/translate/history', { original: 'hello', translated: '你好' });
  ok('POST /api/translate/history', th.status === 200 && th.data.id);
  const hid = th.data.id;
  const thl = await req('GET', '/api/translate/history');
  ok('GET /api/translate/history', thl.status === 200 && Array.isArray(thl.data));
  const thd = await req('DELETE', '/api/translate/history/' + hid);
  ok('DELETE /api/translate/history/:id', thd.status === 200);

  // 导出
  const ex = await req('POST', '/api/export', { title: 't', content: 'c', format: 'md' });
  ok('POST /api/export', ex.status === 200);

  // 壁纸
  const wl2 = await req('GET', '/api/wallpapers');
  ok('GET /api/wallpapers', wl2.status === 200 && Array.isArray(wl2.data.list));

  // 路径穿越防护
  const tr1 = await fetch(BASE + '/api/dl/' + encodeURIComponent('../../etc/passwd'), { headers: H });
  ok('穿越: /api/dl/../../etc/passwd 被拒', tr1.status === 404 || tr1.status === 403);
  const tr2 = await fetch(BASE + '/..%2F..%2Fetc%2Fpasswd', { headers: H });
  ok('穿越: 静态路径被拒', tr2.status === 403 || tr2.status === 404);
  const tr3 = await req('POST', '/api/files/create', { name: '../evil.txt', content: 'x' });
  ok('穿越: 创建文件 ../evil.txt 被拒', tr3.status === 403);
  const tr4 = await req('POST', '/api/notes', { id: '../../evil', title: 'x' });
  ok('穿越: 笔记 id 穿越被拒', tr4.status === 403);

  // 未定义路由 → 404
  const nf = await fetch(BASE + '/api/does-not-exist', { headers: H });
  ok('未知 API → 404', nf.status === 404);

  console.log('\n== 结果: ' + passed + ' 通过, ' + failed + ' 失败 ==');
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('测试崩溃:', e.message); process.exit(1); });
