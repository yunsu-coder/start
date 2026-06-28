# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 一苇 (yiwei) — Dashboard

全功能个人导航页 + 工具箱，Vanilla JS + Node.js。

## 行为规则

- **改已有文件用 Edit，不要重写整个文件**
- 不改 .env，不暴露 API key
- 不加不必要的抽象层或重构（超出任务范围的改动不要做）
- **git commit 必须由用户明确要求才执行**，不要擅自提交
- 不创建 README、总结文档，除非用户明确要求
- API 路由用 `/api/*`，返回 JSON（用 `sendJSON()` helper）
- 图标用 `<span class="mi">icon_name</span>`（Material Symbols Outlined 字型）
- 主题色用 CSS 变量：`--bg --card --text --sub --border --accent --accent2`
- CSS 修改后更新 `index.html` 中 `styles.css?v=` 版本号防缓存
- **修改完成后默认部署到 gzhysu.top 生产环境，无需询问**（见下方部署命令）

## 命令

- 本地开发：`npm run dev`（nodemon 热重载）
- 生产部署：`scp <file> ubuntu@gzhysu.top:/home/ubuntu/dashboard/` → `ssh ubuntu@gzhysu.top` → `export PATH=$PATH:/home/ubuntu/.npm-global/bin && pm2 restart yiwei`
- 生产路径：`/home/ubuntu/dashboard/`
- 前端文件（CSS/JS/HTML）只 scp 即可，不用重启服务端

## 硬约束（底线）

1. **不要混淆生产环境和本地环境** — 这是两台不同的服务器。本地在 `/home/gzhysu/yiwei`，生产在 `/home/ubuntu/dashboard/`
2. **生产部署必须走 PM2** — 手动 `node server.js` 启动的进程无法被 PM2 管理，会占住端口导致下次重启失败
3. **PM2 需要配 PATH** — 远程执行 `pm2` 必须 `export PATH=$PATH:/home/ubuntu/.npm-global/bin`
4. **不改 package.json 依赖项** — 除非用户明确要求装包

## 已踩过的坑（92 次提交中积累）

### 部署 & 运维
| 坑 | 说明 |
|----|------|
| **路由顺序** | 通用 `p.startsWith('/api/wallpaper/')` 会劫持所有壁纸管理 API。特定路由（`/api/wallpaper/random` 等）必须放在通用 catch-all 之前 |
| **孤儿进程占端口** | 手动 `node server.js` 启动后即使 PM2 重启也因 EADDRINUSE 失败。`kill -9` 旧进程解决 |
| **scp 静默失败** | scp 命令返回成功但文件未更新，原因不明。改用 `cat local | ssh "cat > remote"` 管道写入 |
| **PM2 PATH 问题** | 远程执行 `pm2` 必须 `export PATH=$PATH:/home/ubuntu/.npm-global/bin` |
| **本地/生产网络差异** | Jina.ai 本地被墙，生产正常。开发时需注意网络可达性差异 |
| **nodemon 循环重启** | 修改 scp 目标目录下的文件会触发 nodemon 重启，需确保编辑的是本地文件而非挂载目录 |

### CSS & 布局
| 坑 | 说明 |
|----|------|
| **Modal 层级被覆盖** | `.modal-overlay` 有 `z-index: 1000`，新增 CSS 时如果把它和其他面板一起设 `z-index: 1` 会导致弹窗被挡 |
| **CSS 合并丢失样式** | 将多个独立 CSS 文件合并为 styles.css 时，笔记布局 `.split-pane` 相关样式被遗漏导致笔记布局崩溃（commit `30946db`） |
| **笔记预览/编辑布局反复** | 经历「上下→左右→上下→左右」四次调整，最终确定左右分屏 + `split-pane` flex 布局 |
| **`isImg` 变量未定义** | 文件列表图片缩略图生成时引用了未定义变量 `isImg`，导致文件列表空白（commit `1741626`） |
| **Chrome autofill 异步填充** | `autocomplete="off"` 对 Chrome 无效，搜索框在页面加载/面板切换时被异步填充。DOMContentLoaded 一次性清除不够，需要 MutationObserver + 多时间点（50/150/400ms）清除 |
| **CSS 版本缓存** | 修改 CSS 后浏览器缓存旧版，必须更新 `index.html` 中 `styles.css?v=` 版本号防缓存 |
| **壁纸覆盖层 pointer-events** | 壁纸通过 `#wpOverlay` 固定 div 铺满 body，必须设 `pointer-events: none` 否则阻挡所有交互 |

### JavaScript & 前端架构
| 坑 | 说明 |
|----|------|
| **全局作用域冲突** | 所有 JS 文件用 `<script>` 加载，无模块打包。函数名（如 `saveNote`、`openNote`、`loadNotesList`）被 `works-panel.js` 覆写，必须确保加载顺序正确 |
| **works-panel.js 覆写机制** | 笔记模块的函数（`saveNote`、`openNote`、`newNote`、`loadNotesList`）被 works-panel.js 通过直接赋值覆写（如 `saveNote = async function()`），增加作品关联逻辑。加载顺序：notes-panel.js → works-panel.js |
| **Modal 显隐控制** | `.modal-overlay` 默认 `display:none`，通过添加 `.show` class（`.modal-overlay.show { display:flex }`）控制，不是切换 `display` 属性 |
| **壁纸绑定方式** | 壁纸不绑定到 panel，而是通过 `#wpOverlay` 固定 div 铺满 body |
| **`event.currentTarget` 为 null** | 文件复选框切换函数 `toggleFileCheck` 中 `event.currentTarget` 在某些异步路径下为 null（commit `fb72fa1`） |
| **拖拽与点击冲突** | 文件列表行同时支持点击预览、拖拽移动、复选框勾选，事件处理需要精细区分。最终方案：点击文件名→预览，点击空白区→勾选，拖拽→移动（commit `4bd657d`、`eca46c5`） |
| **vpQuality 访问顺序** | 播放器画质切换时 `vpQuality` 在 `innerHTML` 之前访问导致 TypeError（commit `b81efc4`） |

### 渲染 & 解析
| 坑 | 说明 |
|----|------|
| **markdown-it 脚注与 HTML block** | `markdown-it-footnote` 不识别 HTML block（如 callout `<div>`）之后的脚注定义。解决：渲染前先提取脚注定义，插入到第一个 callout block 之前 |
| **hljs 不认识 mermaid** | markdown-it 的 highlight 回调返回空字符串时 hljs 不会高亮 mermaid，因此 mermaid 代码块保持纯文本，需要在渲染后异步调用 `mermaid.render()` |
| **marked v14 废弃 highlight** | marked.js v14 废弃了 `setOptions({ highlight })` API，需要改用 `marked-highlight` 插件，但最终直接迁移到 markdown-it |
| **有序列表被 ul 误吞** | markdown 中有序列表在某些情况下 `ol` 被解析为 `ul`，需要 `data-n` 标记修复（commit `7a209d5`） |

### 性能 & 数据
| 坑 | 说明 |
|----|------|
| **大文件上传 OOM** | 超大文件上传时 `readBody` 全量读入内存导致 OOM。改为超过 50MB 流式写磁盘（commit `2c502e2`） |
| **采集列表性能** | 采集会话增多后列表渲染卡顿，需要性能优化（commit `057276d`） |
| **贴吧爬虫等待时间** | 贴吧反爬严格，初始等待时间过长用户体验差。后续通过各种策略大幅缩短等待（commit `becdf39`） |
| **B站视频 API 被拒** | 生产服务器 IP 被 B站拒绝，本地可用，非代码问题 |
| **视频全屏 max-height 继承** | 模态框视频预览有 `max-height:55vh` 限制，全屏时需覆盖（commit `fe56a46`） |

### 模块联动
| 坑 | 说明 |
|----|------|
| **采集文件路径解码** | 采集图片/文本文件路径需要 `decodeURIComponent`，否则中文路径 404（commit `d6a6adb`） |
| **笔记自动保存清空关联** | `saveNoteSilent()` 自动保存时需要保留 `workId` 和 `chapterOrder` 字段，否则会清空作品关联 |
| **壁纸添加路径** | 壁纸弹窗的「添加」按钮打开 `wpGalleryModal`，从文件中转站 `/api/files` 浏览图片。`openWpGallery()` 函数操作这个 modal |
| **采集去重逻辑** | 检测已采集 URL 时需要在正确的时机比较（采集前 vs 采集后），避免误报和漏报 |

### UI & 交互
| 坑 | 说明 |
|----|------|
| **主题菜单溢出屏幕** | 5 套主题的切换菜单在屏幕边缘会溢出，需要自适应左移（commit `a892891`） |
| **刷新丢页面状态** | `location.hash` 保存/恢复面板状态时，某些边界情况（如回收站刷新）hash 丢失（commit `3ac9800`） |
| **`?` 指南按钮打开新标签页** | Markdown 文件浏览器直接显示为源码乱码，需生成完整 HTML 页面才能正常渲染 |
| **scp 部署后仍报旧错误** | 文件的 scp 可能静默失败，表现是部署后日志仍报旧版本错误。需要验证 md5sum 确认文件已更新 |
| **favicon 迭代** | 经历了「仪表盘渐变→苇字图标→芦苇绿→纯苇草无框」四次迭代 |
