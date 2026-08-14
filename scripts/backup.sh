#!/bin/bash
# scripts/backup.sh — 从生产服务器拉取数据备份（rsync 硬链接增量快照，保留最近 14 份）
# 用法：bash scripts/backup.sh
# 说明：
#   - 依赖本机到服务器的 SSH key 认证（与 sync-deploy.sh 相同）
#   - 每次运行生成一份完整快照，重复文件通过硬链接共享，占用极小
#   - 恢复：把 ~/dashboard-backups/<日期>/ 下的目录拷回服务器对应位置
set -uo pipefail
HOME="${HOME:-/Users/gzhysu}"

SERVER="ubuntu@152.32.254.202"
DEST="/home/ubuntu/dashboard"
BK_ROOT="${HOME}/dashboard-backups"
TODAY=$(date +%Y%m%d-%H%M)
BK_DIR="${BK_ROOT}/${TODAY}"

# 上一份快照（作为硬链接增量基准）
PREV=$(ls -1dt "${BK_ROOT}"/*/ 2>/dev/null | head -1 | sed 's:/*$::' || true)

mkdir -p "${BK_DIR}"
if [ -n "${PREV:-}" ]; then
  echo "📦 备份开始: ${TODAY}（增量基准: $(basename "${PREV}")）"
else
  echo "📦 备份开始: ${TODAY}（首次全量）"
fi

sync_dir() {
  local name="$1"
  local src="${SERVER}:${DEST}/${name}/"
  if [ -n "${PREV:-}" ]; then
    rsync -az --link-dest="${PREV}/${name}" -e "ssh -o ConnectTimeout=10" "${src}" "${BK_DIR}/${name}/" 2>/dev/null
  else
    rsync -az -e "ssh -o ConnectTimeout=10" "${src}" "${BK_DIR}/${name}/" 2>/dev/null
  fi
  local rc=$?
  if [ $rc -eq 0 ]; then echo "  ✓ ${name}/"; else echo "  ⚠️ ${name}/ 同步失败（rc=${rc}，可能为空目录）"; fi
}

sync_dir files
sync_dir notes
sync_dir works
sync_dir translate
sync_dir scrape
sync_dir wallpapers

# 轮转：保留最近 14 份
ls -1dt "${BK_ROOT}"/*/ 2>/dev/null | tail -n +15 | while read -r old; do
  rm -rf "${old}" && echo "  🗑 清理过期备份: $(basename "${old}")"
done

SIZE=$(du -sh "${BK_DIR}" 2>/dev/null | cut -f1)
echo "✅ 备份完成: ${BK_DIR}（${SIZE}）"
echo "   当前共 $(ls -1dt "${BK_ROOT}"/*/ 2>/dev/null | wc -l | tr -d ' ') 份快照"
