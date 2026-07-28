#!/bin/zsh
set -e

PROJECT_DIR="/Users/ewen/Desktop/My Project/remy-year-frame"

cd "$PROJECT_DIR"

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete remy-year-frame >/dev/null 2>&1 || true
  pm2 save
fi

echo "已从 PM2 中移除 Remy Year Frame 服务。"
