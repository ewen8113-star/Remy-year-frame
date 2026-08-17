#!/bin/zsh
set -e

PROJECT_DIR="/Users/ewen/Desktop/My Project/remy-year-frame"
cd "$PROJECT_DIR"

echo "正在更新并启动人头马年框系统..."
echo "项目目录: $PROJECT_DIR"

if [ ! -d "node_modules" ]; then
  echo "正在安装依赖..."
  npm install
fi

if command -v git >/dev/null 2>&1 && [ -d .git ]; then
  echo "正在拉取最新代码..."
  git fetch origin || true
  git pull --ff-only || echo "代码已是最新，或需要先处理未提交修改。将继续启动现有代码。"
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "正在用 PM2 启动/重载服务..."
  npm run service:start
  npm run service:save
else
  echo "未检测到 PM2，使用前台模式启动。关闭此窗口会停止服务。"
  npm start
  exit 0
fi

echo ""
echo "已完成。请用浏览器打开："
echo "  http://localhost:3088/"
echo "同事可访问："
echo "  http://$(scutil --get LocalHostName 2>/dev/null || hostname).local:3088/"
echo ""
echo "窗口可关闭。"
sleep 2
