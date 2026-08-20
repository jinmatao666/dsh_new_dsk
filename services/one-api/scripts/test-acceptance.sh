#!/usr/bin/env bash
# 一键验收脚本：触发错误请求 + 中断流式请求，覆盖 §12.11 ~ §12.14。
#
# 用法：
#   ./scripts/test-acceptance.sh <token> [base_url] [model]
#
# 前提：
#   1) OneAPI 已经在跑（双击 ~/Desktop/重启OneAPI.command）
#   2) token 是后台 → 令牌 里复制的 sk-xxx
#   3) model 填一个**真实可用**的模型名（用于流式取消测试），默认 qwen3.6-plus
#
# 这个脚本不启动服务，只发请求、打印 Request ID，让你自己回后台搜索验证。

set -u

TOKEN="${1:-${ONEAPI_TOKEN:-}}"
BASE_URL="${2:-http://localhost:3000}"
MODEL="${3:-qwen3.6-plus}"

if [[ -z "$TOKEN" ]]; then
  echo "❌ 缺少 token。用法：$0 <sk-xxx> [base_url] [model]"
  echo "   或先 export ONEAPI_TOKEN=sk-xxx"
  exit 1
fi

if ! curl -sf "$BASE_URL/api/status" >/dev/null 2>&1; then
  echo "❌ OneAPI 不在 $BASE_URL，请先启动（双击 重启OneAPI.command）"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "OneAPI 后台日志查询能力 - 验收测试"
echo "  接口:  $BASE_URL"
echo "  模型:  $MODEL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# ============================================================
# 测试 1：错误请求（不存在的模型）→ 验证 §12.11/12.12/12.13
# ============================================================
echo "【测试 1】触发一次错误请求（不存在的模型名）"
echo "  期望：后台出现 1 条「类型=错误」红色标签、Quota=0 的记录"
echo

RESP=$(curl -sS -i -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nonexistent-model-xxx-acceptance-test",
    "stream": false,
    "messages": [{"role": "user", "content": "test"}]
  }' 2>&1)

ERR_REQ_ID=$(echo "$RESP" | grep -i 'X-Oneapi-Request-Id' | awk '{print $2}' | tr -d '\r')
ERR_HTTP_CODE=$(echo "$RESP" | head -1 | awk '{print $2}')

echo "  HTTP 状态码: $ERR_HTTP_CODE"
echo "  Request ID:  $ERR_REQ_ID"
echo "  ✅ 已发送。回后台搜索这个 Request ID 验证。"
echo

# ============================================================
# 测试 2：中途断开流式请求 → 验证 §12.14 client_canceled
# ============================================================
echo "【测试 2】发起流式请求然后立即中断"
echo "  期望：后台出现 1 条「状态=client_canceled」（或类似）的记录"
echo

# 发起流式请求，500ms 后强制超时
CANCEL_RESP=$(curl -sS -i --max-time 0.5 -N -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"stream\": true,
    \"messages\": [{\"role\": \"user\", \"content\": \"请详细解释量子纠缠\"}]
  }" 2>&1 || true)

CANCEL_REQ_ID=$(echo "$CANCEL_RESP" | grep -i 'X-Oneapi-Request-Id' | awk '{print $2}' | tr -d '\r' | head -1)

if [[ -z "$CANCEL_REQ_ID" ]]; then
  echo "  ⚠️  Request ID 没拿到（可能 0.5s 太短服务端还没返回 header）"
  echo "  这个用例需要看后台是否新增一条 status=client_canceled 的记录"
else
  echo "  Request ID:  $CANCEL_REQ_ID"
  echo "  ✅ 已中断。回后台用此 Request ID 搜索验证。"
fi
echo

# ============================================================
# 测试 3：正常请求作为对照组
# ============================================================
echo "【测试 3】对照：发一次正常请求（验证错误请求不影响正常计费）"
echo

OK_RESP=$(curl -sS -i -X POST "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL\",
    \"stream\": false,
    \"messages\": [{\"role\": \"user\", \"content\": \"你好\"}]
  }" 2>&1)

OK_REQ_ID=$(echo "$OK_RESP" | grep -i 'X-Oneapi-Request-Id' | awk '{print $2}' | tr -d '\r')
OK_HTTP_CODE=$(echo "$OK_RESP" | head -1 | awk '{print $2}')

echo "  HTTP 状态码: $OK_HTTP_CODE"
echo "  Request ID:  $OK_REQ_ID"
echo "  ✅ 已发送。这条应该是正常计费记录（类型=Consume，绿色「正常」状态）。"
echo

# ============================================================
# 总结
# ============================================================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 验收清单（去后台 → 日志 → 搜索 Request ID）："
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo
echo "🔴 错误请求 (12.11/12.12/12.13):"
echo "   Request ID: $ERR_REQ_ID"
echo "   验收点："
echo "   - [ ] 12.11 后台能搜到这条"
echo "   - [ ] 12.12 这条 Quota=0（点详情看花费列）"
echo "   - [ ] 12.13 类型列显示「错误」红色标签"
echo
echo "🟡 取消请求 (12.14):"
echo "   Request ID: ${CANCEL_REQ_ID:-(未拿到，看后台新增的 client_canceled 记录)}"
echo "   验收点："
echo "   - [ ] 12.14 状态列显示 client_canceled 或类似"
echo
echo "🟢 正常请求（对照组）:"
echo "   Request ID: $OK_REQ_ID"
echo "   验收点："
echo "   - [ ] 类型=Consume，状态=正常（绿色），有正常的 Quota 数值"
echo
echo "💡 顺手验收（不需要新请求）："
echo "   - [ ] 12.2 后台「仅看慢请求」过滤"
echo "   - [ ] 12.3 后台「仅看错误」过滤（应该能看到上面那条错误请求）"
echo "   - [ ] 12.4 列颜色（5703ms 的请求首响应列应该显示红色）"
echo "   - [ ] 12.6 翻一条旧日志看新字段是否显示「-」"
echo "   - [ ] 12.7 详情弹窗点「复制」按钮"
echo
