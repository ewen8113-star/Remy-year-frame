#!/bin/zsh
set -e

PROJECT_DIR="/Users/ewen/Desktop/My Project/remy-year-frame"
URL="http://localhost:${PORT:-3088}/"
HEALTH_URL="http://localhost:${PORT:-3088}/api/health"
cd "$PROJECT_DIR"

echo "正在启动 Remy Year Frame..."
echo "项目目录: $PROJECT_DIR"

if [ ! -d "node_modules" ]; then
  echo "未检测到 node_modules，正在安装依赖..."
  npm install
fi

if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
  echo "服务已在运行，直接打开浏览器。"
  open "$URL" >/dev/null 2>&1 || true
  exit 0
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "使用 PM2 启动常驻服务..."
  npm run service:start
  npm run service:save
  open "$URL" >/dev/null 2>&1 || true
  npm run service:status
else
  echo "未检测到 PM2，使用前台模式启动。关闭此窗口会停止服务。"
  open "$URL" >/dev/null 2>&1 || true
  npm start
fi
