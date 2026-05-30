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

## 已踩过的坑

| 坑 | 说明 |
|----|------|
| **路由顺序** | 通用 `p.startsWith('/api/wallpaper/')` 会劫持所有壁纸管理 API。特定路由（`/api/wallpaper/random` 等）必须放在通用 catch-all 之前 |
| **孤儿进程占端口** | 手动 `node server.js` 启动后即使 PM2 重启也因 EADDRINUSE 失败。`kill -9` 旧进程解决 |
| **Modal 层级被覆盖** | `.modal-overlay` 有 `z-index: 1000`，新增 CSS 时如果把它和其他面板一起设 `z-index: 1` 会导致弹窗被挡 |
| **壁纸不是绑在 panel 上** | 壁纸通过 `#wpOverlay` 固定 div 铺满 body，`pointer-events: none`，不是设 `background-image` |
| **前端全局作用域** | 所有 JS 文件在 index.html 用 `<script>` 加载，无模块打包。函数名不能冲突 |
| **Modal 用 class 控制** | `.modal-overlay` 默认 `display:none`，通过添加 `.show` class（`.modal-overlay.show { display:flex }`）控制显隐 |
| **添加壁纸走文件模块** | 壁纸弹窗的「添加」按钮打开 `wpGalleryModal`，从文件中转站 `/api/files` 浏览图片。`openWpGallery()` 函数操作这个 modal |
