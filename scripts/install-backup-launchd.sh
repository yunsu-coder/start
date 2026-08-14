#!/bin/bash
# scripts/install-backup-launchd.sh — 安装每日 03:00 自动备份的 launchd 任务
# 用法：bash scripts/install-backup-launchd.sh
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.yiwei.backup.plist"
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/scripts/backup.sh"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.yiwei.backup</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>$HOME/dashboard-backups/backup.log</string>
  <key>StandardErrorPath</key><string>$HOME/dashboard-backups/backup.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "✅ launchd 已安装：每日 03:00 执行 $SCRIPT"
echo "   立即试跑：bash scripts/backup.sh"
