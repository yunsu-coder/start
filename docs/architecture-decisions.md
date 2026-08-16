# 架构决策记录（2026-08）

> P0 安全加固 + P1 架构优化的完整记录、技术评估与部署/回滚指南。

## 一、已完成改造

### P0 安全（已全部完成并验证）

| 项 | 内容 | 提交 |
|---|---|---|
| P0-2 | 统一路径校验 lib/safePath.js（safeJoin/safeDecode），覆盖 storage.js 全部入口 + server.js 直接拼接点，拒绝目录穿越 | cc62028 |
| P0-3 | Basic Auth 认证层（.env 配置 AUTH_USER/AUTH_PASS 后全站启用，timing-safe 比较）+ 9 个敏感接口限流（每 IP 每分钟） | b116242 |
| P0-4 | API Key 服务端化：.env 的 CHAT_API_KEY/CHAT_BASE_URL/CHAT_MODEL、TRANS_API_KEY/TRANS_BASE_URL/TRANS_MODEL，前端留空 Key 即用服务器配置；新增 /api/config/status（不泄露密钥） | a2d1e4a |
| P0-5 | 移除 .claude/deploy.sh 明文 SSH 密码（改用 key 认证），新增 .env.example 文档 | 0cea4fc |

### P1 架构（已完成）

| 项 | 内容 | 提交 |
|---|---|---|
| P1-1 | server.js 1615 行 → 120 行分发器；路由拆分为 routes/{misc,files,notes,tasks,translate,scrape,wallpaper,chat}.js；公共助手入 lib/http.js | 2fec12b |
| P1-2 | scripts/backup.sh（rsync 硬链接增量快照，保留 14 份）+ scripts/install-backup-launchd.sh（每日 03:00） | b1961bd |
| P1-3 | test/smoke.js：50 项 API 断言（含认证模式、穿越防护），无认证 49/49、带认证 50/50 通过 | 2fec12b |
| P1-4 | 笔记历史版本：每次保存自动快照（保留 10 份），支持查看/恢复，前端工具栏「历史」按钮 | b1961bd |
| P1-6 | SQLite 迁移评估（见下） | 本文档 |

## 二、评估结论

### P1-5：前端 esbuild 打包 —— 暂不引入 ❌

**评估**：本项目前端是「多文件 IIFE + window 全局命名空间」架构（Yiwei.* + window 函数互相调用，脚本按固定顺序加载）。esbuild 打包会改变作用域语义（module scope 隔离全局），需要大改前端架构；若只做逐文件 minify（bundle:false），收益约 30% 体积，但：
- 引入构建步骤与现有「改完即部署」工作流冲突（PostToolUse hook 部署源文件，index.html 需指向产物并每次重建）
- 已有 gzip + /public/vendor/ 长期缓存 + ?v= 版本号，首屏性能已足够
- 出问题时的排障成本高于收益

**结论**：保持零构建架构。若未来 JS 总体积显著增长，再评估 esbuild + ESM 渐进改造（每次只转换一个面板，测试后合入）。

### P1-6：SQLite 迁移 —— 暂不迁移 ❌

**评估**：
- 数据量：笔记/作品/任务/翻译历史均为小 JSON 文件（预计 < 数百个、总 < 50MB），JSON 文件存储完全够用且可直接备份/查看
- 现有代码大量直接读文件（listNotes/saveNote/getWork 等），迁移需改全部 storage 层 + 路由 + 前端，风险高
- SQLite 的优势（并发写入、全文检索、事务）在单用户场景用不上；全文检索已有 RAG（lib/rag.js）

**结论**：保持 JSON 存储。数据安全由「每日备份（P1-2）+ 笔记历史版本（P1-4）+ git 仓库」三层保障。

## 三、部署指南（重要）

> ✅ 本次改造**已于 2026-08-14 部署到生产**（gzhysu.top）并完成线上验证（401/认证/限流/全端点）。
> 你的 Mac 上的 launchd sync-deploy.sh 会自动增量同步 css/js/lib/index.html/server.js，
> 但**认证开关需要你手动配置**。按顺序执行：

### 1. 部署代码

```bash
cd /Users/gzhysu/Desktop/start
bash .claude/sync-deploy.sh          # 增量同步代码到服务器
ssh ubuntu@152.32.254.202 "sudo systemctl restart yiwei || sudo systemctl restart dashboard"
```

### 2. 启用认证（强烈建议）

```bash
# 在服务器上编辑 .env（注意：先备份旧 .env）
ssh ubuntu@152.32.254.202 "cp /home/ubuntu/dashboard/.env /home/ubuntu/dashboard/.env.bak"
ssh ubuntu@152.32.254.202 "sudo tee -a /home/ubuntu/dashboard/.env > /dev/null" <<'EOF'

AUTH_USER=你的用户名
AUTH_PASS=你的强密码
CHAT_API_KEY=你的key        # 可选：不填则前端需自配 Key
CHAT_BASE_URL=https://vip.apiyi.com/v1/chat/completions
CHAT_MODEL=grok-4.3
TRANS_API_KEY=你的key        # 可选
TRANS_BASE_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
TRANS_MODEL=glm-4-flash
EOF
ssh ubuntu@152.32.254.202 "sudo systemctl restart yiwei || sudo systemctl restart dashboard"
```

> 配置 AUTH_USER/AUTH_PASS 后，全站需要登录（浏览器弹出 Basic Auth 对话框），
> 未配置则保持免认证（本地开发模式）。⚠️ **上线后请立即用无凭据访问 https://gzhysu.top 验证返回 401**。

### 3. 启用每日备份（在 Mac 上）

```bash
cd /Users/gzhysu/Desktop/start
bash scripts/install-backup-launchd.sh   # 安装每日 03:00 备份任务
bash scripts/backup.sh                   # 立即试跑一次
# 备份在 ~/dashboard-backups/<日期>/，保留 14 份
```

### 4. 验证清单

```bash
curl -I https://gzhysu.top/                       # 未认证 → 401；认证后 → 200
curl -s https://gzhysu.top/api/config/status      # 返回 auth:true 及 key 有无
# 浏览器打开 gzhysu.top → 登录 → 检查 8 个面板 + 笔记「历史」按钮
```

## 四、回滚指南

| 场景 | 命令 |
|---|---|
| 回滚到 P0 改造前 | `git reset --hard baseline-pre-p0 && bash .claude/sync-deploy.sh` |
| 撤销某个功能 | `git revert <commit-hash>`（每个功能独立提交，可单独撤销） |
| 笔记/文件被误删 | 服务器回收站（.trash）→ 每日备份（~/dashboard-backups）→ 笔记历史版本 |
| 线上坏了紧急恢复 | 服务器上有部署前的旧文件（重启前的磁盘状态），或 git revert 后重新部署 |

## 五、遗留事项

- [x] 生产 .env 已配置 AUTH_USER/AUTH_PASS（2026-08-14）
- [x] 备份功能按用户决定停用（2026-08-16）：launchd 任务已卸载、备份目录已清理；scripts/ 保留备用
- [ ] Nginx 层可再叠加 rate_limit 与 fail2ban（Node 层限流已生效，可暂缓）
- [ ] deploy.sh 的 scp 路径是硬编码的 Mac 路径，换机器需同步修改
