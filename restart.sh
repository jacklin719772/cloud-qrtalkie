#!/bin/bash
# QRTalkie Cloud - 重启前后台服务
# 用法: bash restart.sh [项目目录路径，默认为 /root/cloud-qrtalkie]

PROJECT_DIR="${1:-/opt/saas}"

echo "=== 进入项目目录: $PROJECT_DIR ==="
cd "$PROJECT_DIR" || { echo "错误: 目录不存在"; exit 1; }

echo "=== 拉取最新代码 ==="
sudo git pull

echo "=== 重启后端 API (端口 3001) ==="
fuser -k 3001/tcp 2>/dev/null
sleep 1
nohup node server/index.js > server.log 2>&1 &
echo "后端已启动 (PID: $!) (日志: server.log)"

echo "=== 重启前端 Vite (端口 5173) ==="
fuser -k 5173/tcp 2>/dev/null
sleep 1
nohup npx vite --host 0.0.0.0 --port 5173 --force > /dev/null 2>&1 &
echo "前端已启动 (PID: $!)"

echo "=== 完成! ==="
echo "后端: http://localhost:3001"
echo "前端: http://localhost:5173"
