#!/usr/bin/env bash
# 一键自测 relay timing 日志输出。
#
# 用法：
#   ./scripts/test-timing.sh [模式] [token] [base_url] [model]
#
# 模式：
#   summary  仅看慢请求 summary（默认）—— 把阈值压到 1ms，强制每个请求都输出 summary
#   detail   看每个阶段日志 + summary
#
# 示例：
#   ./scripts/test-timing.sh
#   ./scripts/test-timing.sh detail sk-xxx http://localhost:3000 gpt-4o
#
# 前提：
#   1) 已经在数据库里配好至少一个可用的 channel 和 model
#   2) 创建过一个 token（admin UI → 令牌）

set -e

MODE="${1:-summary}"
TOKEN="${2:-${ONEAPI_TOKEN:-}}"
BASE_URL="${3:-http://localhost:3000}"
MODEL="${4:-gpt-4o}"

if [[ -z "$TOKEN" ]]; then
  echo "❌ 缺少 token。用法：$0 [模式] <token> [base_url] [model]"
  echo "   或先 export ONEAPI_TOKEN=sk-xxx"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$(mktemp -t oneapi-timing.log)"
PORT=3000

# 解析 base_url 里的端口（默认 3000）
if [[ "$BASE_URL" =~ :([0-9]+) ]]; then
  PORT="${BASH_REMATCH[1]}"
fi

# 启动前先确认端口空闲，否则探活会误判成"另一个服务"
if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "❌ 端口 $PORT 已被占用，无法启动新服务（探活会探到旧服务，导致 timing 日志看不到）"
  echo "   解决：先关掉旧的 OneAPI"
  echo "     lsof -ti:$PORT | xargs kill"
  exit 1
fi

trap 'cleanup' EXIT INT TERM
cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo
    echo "🧹 关闭 OneAPI 服务 (pid=$SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  echo "📄 完整日志已保留：$LOG_FILE"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Relay Timing 自测脚本"
echo "  模式:    $MODE"
echo "  接口:    $BASE_URL"
echo "  模型:    $MODEL"
echo "  日志:    $LOG_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

case "$MODE" in
  summary)
    export RELAY_TIMING_SLOW_FIRST_CHUNK_MS=1
    export RELAY_TIMING_SLOW_TOTAL_MS=1
    ;;
  detail)
    export RELAY_TIMING_DETAIL_ENABLED=true
    ;;
  *)
    echo "❌ 未知模式: $MODE （仅支持 summary / detail）"
    exit 1
    ;;
esac

echo
echo "▶ 启动 OneAPI 服务..."
cd "$PKG_DIR"
go run . --port 3000 >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

echo "  pid=$SERVER_PID，等待服务就绪..."
for i in $(seq 1 60); do
  if curl -sf "$BASE_URL/api/status" >/dev/null 2>&1; then
    echo "✅ 服务已启动"
    break
  fi
  sleep 1
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "❌ 服务启动失败，最后 30 行日志："
    tail -n 30 "$LOG_FILE"
    exit 1
  fi
done

echo
echo "▶ 发送测试请求..."
RESP_FILE="$(mktemp -t oneapi-resp.XXXXXX.txt)"
HTTP_CODE=$(curl -s -o "$RESP_FILE" -w "%{http_code}" -N \
  -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"ping\"}]}" \
  || true)

echo "  HTTP 状态码: $HTTP_CODE"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "⚠️  请求未返回 200，响应前 500 字符："
  head -c 500 "$RESP_FILE"
  echo
fi
rm -f "$RESP_FILE"

# 给最后的 finished 阶段一点时间写盘
sleep 1

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Timing 日志（从 $LOG_FILE 中筛选）："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if grep -E "relay timing" "$LOG_FILE"; then
  echo
  echo "✅ 看到上述日志说明 timing 功能已正常工作"
else
  echo "❌ 没找到任何 'relay timing' 日志，可能原因："
  echo "   • RELAY_TIMING_ENABLED 被关闭"
  echo "   • 请求未走到 relay handler（例如 auth 失败）"
  echo "   • 当前 model/channel 用的不是 OpenAI streaming 适配器"
  echo
  echo "服务最后 30 行日志："
  tail -n 30 "$LOG_FILE"
fi
