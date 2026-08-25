#!/bin/zsh
set -e

PROJECT_DIR="/Users/ewen/Desktop/My Project/remy-year-frame"
PM2_PLIST="$HOME/Library/LaunchAgents/pm2.$USER.plist"

cd "$PROJECT_DIR"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "未检测到 PM2，请先安装：npm install -g pm2"
  exit 1
fi

npm run service:start
npm run service:save

if [ ! -f "$PM2_PLIST" ]; then
  pm2 startup launchd -u "$USER" --hp "$HOME" || true
fi

echo "已配置 PM2 常驻服务。"
echo "访问地址：http://localhost:3088/"
echo "局域网访问：http://$(scutil --get LocalHostName 2>/dev/null || hostname).local:3088/"
echo "查看状态：npm run service:status"
echo "查看日志：npm run service:logs"
