#!/bin/bash
cd "$(dirname "$0")"

# 啟動後端
cd backend
npm start &
BACKEND_PID=$!

# 等後端啟動
sleep 2

# 啟動前端
cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo "會計系統已啟動"
echo "後端: http://localhost:8093"
echo "前端: http://localhost:8094"
echo ""
echo "按 Ctrl+C 停止"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
