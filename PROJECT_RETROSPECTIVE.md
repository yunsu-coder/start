# 一苇 · 开发回顾

> 92 次提交，4 个月，从 `v1.0.0 - 个人导航页起始站` 到一个勉强及格的产品。

---

## 数字

| 指标 | 数值 |
|------|------|
| 总提交 | 92 |
| 开发周期 | 2026年3月 → 2026年6月（~4个月） |
| 功能模块 | 首页 / 文件站 / 笔记 / 采集 / 阅读器 / 翻译 / 对话 / 壁纸（8个） |
| 前端代码 | Vanilla JS，无框架，全局作用域 |
| 后端 | Node.js 原生 http 模块，JSON 文件存储 |
| 年度成本 | API Key ¥220 + 服务器域名 ¥200 = ¥420 |
| 设备适配 | iPhone 12 mini / iPad Pro 11" / 14" 笔记本 / 23.8" 显示器 |
| 部署方式 | SCP → PM2，gzhysu.top |

---

## 时间线

### 第一阶段（3月）：地基

`de00c5a` → `9f1d742`：Markdown 解析、文件上传下载、基础面板切换、location.hash 路由。

**核心挑战**：什么都没有，每加一个功能都是一次「先搞清楚怎么做」的研究。Markdown 渲染从 `marked.js` 开始，表格、有序列表、删除线、任务列表、代码高亮一样一样往上堆。

### 第二阶段（3月下旬-4月上）：文件系统 + 采集

`5774a04` → `c7d587b`：多级目录、面包屑导航、拖拽移动、回收站、OCR、贴吧爬虫。

**核心挑战**：拖拽、点击、勾选三件事挤在一个文件行上，事件冲突调试到怀疑人生。最终方案是「文件名区域触发预览，空白区域触发勾选，拖拽走独立事件」。贴吧爬虫的反爬策略变化频繁，等待时间调了好几版。

### 第三阶段（4月中-5月）：播放器 + 主题

`fc0cf5c` → `3075e94`：自定义视频播放器、倍速、快捷键、队列播放、VLC 转码流、5 套配色主题。

**核心挑战**：视频画质切换的 `vpQuality` 变量在 `innerHTML` 之前访问 → TypeError。全屏视频 `max-height: 55vh` 继承导致撑不满屏幕。主题菜单在屏幕边缘溢出。这些都是 CSS 优先级和 JS 执行顺序的细节问题。

### 第四阶段（5月-6月上）：重构 + 夯实

`afa5b97` → `4f02cda`：合并 app.js/core.js，拆分面板模块，全局异步 I/O 改造，壁纸系统重构，玻璃拟态升级，动画体系重写。

**核心挑战**：CSS 合并时丢失了笔记布局的关键样式（`.split-pane` 相关规则），导致笔记面板崩溃。这是整个项目最危险的一次改动——2100 行 CSS 的合并，漏掉 10 行就能让一个面板挂掉。

### 第五阶段（6月）：打磨

`7f86e6a` → `0cc586f`：笔记 Prose 风格、markdown-it 迁移、Callout 容器、五断点响应式、采集重构（Jina + imgminer 替换手写爬虫）。

**核心挑战**：markdown-it 的脚注插件不识别 HTML block 后的定义，需要在渲染前预处理。Chrome autofill 会异步填充搜索框，DOMContentLoaded 一次性清除不够。scp 命令静默失败，部署后线上仍报旧错误。

---

## 最痛苦的五件事

### 1. 全局作用域

没有模块系统，所有函数挂在 `window` 上。函数名冲突靠「加载顺序」解决——`works-panel.js` 必须在 `notes-panel.js` 之后加载，因为它通过直接赋值覆写 `saveNote`、`openNote` 等函数。这是一个随时可能炸的定时炸弹。

### 2. CSS 合并丢失样式

把 5 个独立 CSS 文件合并成一个 `styles.css` 时，手动复制粘贴，漏掉了 `.split-pane .no-preview` 和 `.split-pane .preview-only` 的关键规则。笔记面板布局直接废了。教训：CSS 合并一定要 diff 验证，不能靠肉眼。

### 3. Chrome Autofill

`autocomplete="off"` 在现代 Chrome 上完全没用。搜索框会在页面加载、面板切换、甚至 hover 时被异步填充。最终用了 MutationObserver 监听面板激活 + 三个时间点（50/150/400ms）多次清除才解决。这是被浏览器「过度智能」折磨的典型案例。

### 4. SCP 静默失败

`scp file user@host:/path/` 返回 exit code 0，但文件根本没更新。用户报 bug → 检查代码 → 本地是对的 → 怀疑缓存 → 最终发现线上文件 md5 和本地不同。切换成 `cat local | ssh "cat > remote"` 才彻底解决。

### 5. 脚注 + Callout 的 DOM 顺序

markdown-it-footnote 要求脚注定义在 HTML block 之前才能被识别。但 Callout 容器被预处理成 `<div class="callout">` HTML block，导致其后的脚注定义全部失效。解决：先提取所有脚注定义，再插入到第一个 Callout block 之前。这是一个数据流顺序问题，调试时从渲染结果反向推导了半小时。

---

## 如果重来一次

1. **第一天就用模块打包。** 全局作用域是技术债，越晚还利息越高。哪怕用最简单的 IIFE 包裹也比裸奔强。
2. **CSS 用 CSS Variables + 断点系统从第一天设计。** 后期追加大型响应式重构，2136 行 CSS 里翻查散落的 `@media`，纯属自虐。
3. **生产环境加健康检查。** PM2 挂了 189 次才被发现，加个 5 分钟的 cron curl 就能避免。
4. **笔记模块应该是最早打磨的。** 它是整个产品里最深的模块，也是最有价值的模块。前三个月花在播放器、贴吧爬虫上的时间，如果拿来打磨笔记的标签系统、版本历史、全文搜索，产品成熟度会高得多。
5. **部署脚本化。** 每次手动 `scp` + `ssh pm2 restart` 是效率黑洞。一个 `deploy.sh` 省下的时间可以多修 3 个 bug。

---

## 最满意的几行代码

**笔记渲染管线**（`js/notes-panel.js`）：
```javascript
// 原始 MD → 脚注提取 → Callout 预处理 → markdown-it(7插件) → 后处理 → 预览 DOM
var mdClean = md.replace(FOOTNOTE_DEF_RE, ...);       // 0. 提取脚注
var processed = preprocessCallouts(mdClean);           // 1. Callout
if (footnoteDefs) processed = footnoteDefs + '\n\n' + processed; // 2. 插入
var h = renderer.render(processed);                    // 3. 主渲染
h = h.replace(/<img /g, '<img loading="lazy" ');      // 4. 后处理
```

**采集降级管线**（`lib/scraper.js`）：
```javascript
// 文本：Jina.ai → cheerio 兜底
// 图片：imgminer(100张/页,含CSS背景图) → cheerio $('img') 兜底
```

**触摸检测**（`js/notes-panel.js`）：
```javascript
var dockEnabled = !('ontouchstart' in window || navigator.maxTouchPoints > 0);
```

---

## 结语

这不是一个商业产品，甚至不是一个「产品」。它是一个人用四个月的晚上和周末，一行一行垒出来的个人工具。它不完美——全局作用域是定时炸弹，CSS 有冗余，有些模块只做到 60 分——但它能用，而且每天都在用。

最重要的不是代码，是**你知道自己有能力从零到一完成一个完整的 web 应用**。下次再出发，起点会是这里。

---

*92 commits, 4 months, 1 person.*
*Built with Vanilla JS, Node.js, and a lot of stubbornness.*
