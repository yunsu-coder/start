# 启动页

> 个人浏览器启动页 —— 导航 + 云盘 + 笔记 + 采集 + 阅读 + 翻译 + AI 对话

![screenshot](screenshots/home.png)

## 功能

| 模块 | 能力 |
|------|------|
| **首页** | 搜索引擎快捷入口、书签网格、系统状态监控 |
| **文件站** | 多级目录、列表/网格双视图、拖拽移动、回收站、批量上传 |
| **笔记** | Markdown 实时预览、Callout 容器、Mermaid 图表、任务列表、小说章节管理、图片粘贴上传 |
| **采集** | 网页文本/图片/视频/音频批量采集、URL 序列展开、Jina.ai 深度提取 |
| **阅读器** | EPUB/TXT/Markdown 阅读、章节目录、进度记忆、字体切换 |
| **翻译** | 多语种互译、语法检查、历史记录 |
| **对话** | 4 家 AI 可切换（DeepSeek/豆包/Kimi/通义）、流式 SSE、多轮会话、工具调用 |
| **壁纸** | 全局壁纸、轮播、文件中转站选图 |

## 技术栈

- **前端**：Vanilla JS，无框架，CSS 变量驱动 5 套主题
- **后端**：Node.js 原生 http 模块，JSON 文件存储
- **渲染**：markdown-it（7 插件）+ highlight.js + Mermaid
- **部署**：Ubuntu + PM2 + Nginx，¥420/年（API + 服务器 + 域名）

## 设备适配

| 设备 | 断点 |
|------|------|
| iPhone 12 mini | ≤420px |
| iPad Pro 11" | 834–1194px |
| 14" 笔记本 | 1195–1512px |
| 23.8" 显示器 | 1513px+ |

## 快速开始

```bash
npm install
npm run dev        # 本地开发 → http://localhost:3000
```

## 开发回顾

92 次提交，4 个月，从零到一。详见 [PROJECT_RETROSPECTIVE.md](./PROJECT_RETROSPECTIVE.md)。
