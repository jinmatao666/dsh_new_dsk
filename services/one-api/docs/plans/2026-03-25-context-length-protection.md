# Context Length Protection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现双层 context length 保护机制，防止超长请求导致配额大量浪费。

**Architecture:** 第一层在 `relay/controller/text.go` 发送前主动截断消息；第二层在 `controller/relay.go` 检测上游返回的 context length 错误后停止重试。配置通过环境变量（默认值）和数据库 option（模型级别）两种方式管理，与现有 `ModelRatio` 模式完全一致。

**Tech Stack:** Go, Gin, GORM, `relay/adaptor/openai.CountTokenMessages`

---

### Task 1: 添加配置变量到 config.go

**Files:**
- Modify: `common/config/config.go`

**Step 1: 在 config.go 末尾添加两个变量**

在文件末尾（`EnforceIncludeUsage` 和 `TestPrompt` 之后）添加：

```go
// Context Length Protection
var DefaultContextLimit = env.Int("DEFAULT_CONTEXT_LIMIT", 120000)
var ModelContextLimits = map[string]int{}
var ModelContextLimitsRWMutex sync.RWMutex
```

注意：`sync` 已在文件顶部 import，`env` 包也已 import。

**Step 2: 确认编译通过**

```bash
cd packages/one-api && go build ./common/config/...
```

Expected: 无错误输出

**Step 3: Commit**

```bash
git add packages/one-api/common/config/config.go
git commit -m "feat: add DefaultContextLimit and ModelContextLimits config vars"
```

---

### Task 2: 新建 context_limit.go 工具文件

**Files:**
- Create: `common/config/context_limit.go`

**Step 1: 创建文件，内容如下**

```go
package config

import (
	"encoding/json"
	"strings"
)

// ModelContextLimits2JSONString 序列化为 JSON 字符串
func ModelContextLimits2JSONString() string {
	ModelContextLimitsRWMutex.RLock()
	defer ModelContextLimitsRWMutex.RUnlock()
	jsonBytes, _ := json.Marshal(ModelContextLimits)
	return string(jsonBytes)
}

// UpdateModelContextLimitsByJSONString 从 JSON 字符串更新配置，线程安全
func UpdateModelContextLimitsByJSONString(jsonStr string) error {
	ModelContextLimitsRWMutex.Lock()
	defer ModelContextLimitsRWMutex.Unlock()
	ModelContextLimits = make(map[string]int)
	return json.Unmarshal([]byte(jsonStr), &ModelContextLimits)
}

// GetModelContextLimit 根据模型名称获取 context limit
// 匹配规则：模型名包含 key（不区分大小写）即命中，未命中返回 DefaultContextLimit
func GetModelContextLimit(modelName string) int {
	ModelContextLimitsRWMutex.RLock()
	defer ModelContextLimitsRWMutex.RUnlock()
	lowerModel := strings.ToLower(modelName)
	for key, limit := range ModelContextLimits {
		if strings.Contains(lowerModel, strings.ToLower(key)) {
			return limit
		}
	}
	return DefaultContextLimit
}
```

**Step 2: 确认编译通过**

```bash
cd packages/one-api && go build ./common/config/...
```

Expected: 无错误输出

**Step 3: Commit**

```bash
git add packages/one-api/common/config/context_limit.go
git commit -m "feat: add context limit config helpers"
```

---

### Task 3: 集成到 model/option.go

**Files:**
- Modify: `model/option.go`

**Step 1: 在 InitOptionMap() 中添加初始化项**

在 `config.OptionMap["RetryTimes"]` 那行之后、`config.OptionMapRWMutex.Unlock()` 之前添加：

```go
config.OptionMap["ModelContextLimits"] = config.ModelContextLimits2JSONString()
config.OptionMap["DefaultContextLimit"] = strconv.Itoa(config.DefaultContextLimit)
```

**Step 2: 在 updateOptionMap() 的 switch 中添加处理**

在 `case "Theme":` 之后添加：

```go
case "ModelContextLimits":
    err = config.UpdateModelContextLimitsByJSONString(value)
case "DefaultContextLimit":
    intVal, parseErr := strconv.Atoi(value)
    if parseErr == nil {
        config.DefaultContextLimit = intVal
    }
```

**Step 3: 确认编译通过**

```bash
cd packages/one-api && go build ./model/...
```

Expected: 无错误输出

**Step 4: Commit**

```bash
git add packages/one-api/model/option.go
git commit -m "feat: integrate ModelContextLimits into option system"
```

---

### Task 4: 在 relay/controller/helper.go 添加截断函数

**Files:**
- Modify: `relay/controller/helper.go`

**Step 1: 在文件末尾添加截断函数**

```go
// truncateMessagesToLimit 截断消息列表，使 token 数不超过 limit
// 保留 system 消息（第一条）和最新消息，从中间删除最老的非 system 消息
func truncateMessagesToLimit(messages []relaymodel.Message, modelName string, limit int) []relaymodel.Message {
	if len(messages) == 0 {
		return messages
	}
	// 找出 system 消息（保留）
	var systemMsgs []relaymodel.Message
	var otherMsgs []relaymodel.Message
	for _, msg := range messages {
		if msg.Role == role.System {
			systemMsgs = append(systemMsgs, msg)
		} else {
			otherMsgs = append(otherMsgs, msg)
		}
	}
	// 从最老的非 system 消息开始删除
	for len(otherMsgs) > 1 {
		candidate := append(systemMsgs, otherMsgs...)
		tokens := openai.CountTokenMessages(candidate, modelName)
		if tokens <= limit {
			return candidate
		}
		otherMsgs = otherMsgs[1:] // 删除最老的一条
	}
	// 只剩 system + 最后一条消息
	return append(systemMsgs, otherMsgs...)
}
```

注意：`openai` 和 `role` 包已在文件顶部 import，`relaymodel` 也已 import。

**Step 2: 确认编译通过**

```bash
cd packages/one-api && go build ./relay/controller/...
```

Expected: 无错误输出

**Step 3: Commit**

```bash
git add packages/one-api/relay/controller/helper.go
git commit -m "feat: add truncateMessagesToLimit helper"
```

---

### Task 5: 第一层保护 — relay/controller/text.go 主动截断

**Files:**
- Modify: `relay/controller/text.go`

**Step 1: 在 `getPromptTokens` 之后、`preConsumeQuota` 之前插入截断逻辑**

当前代码（text.go 第47-53行）：

```go
// pre-consume quota
promptTokens := getPromptTokens(textRequest, meta.Mode)
meta.PromptTokens = promptTokens
preConsumedQuota, bizErr := preConsumeQuota(ctx, textRequest, promptTokens, ratio, meta)
```

替换为：

```go
// pre-consume quota
promptTokens := getPromptTokens(textRequest, meta.Mode)

// context length protection: truncate if over limit
if meta.Mode == relaymode.ChatCompletions && len(textRequest.Messages) > 0 {
    modelLimit := config.GetModelContextLimit(textRequest.Model)
    if promptTokens > modelLimit {
        truncated := truncateMessagesToLimit(textRequest.Messages, textRequest.Model, modelLimit)
        if len(truncated) < len(textRequest.Messages) {
            logger.Infof(ctx, "messages truncated from %d to %d messages, model=%s, tokens=%d->%d",
                len(textRequest.Messages), len(truncated), textRequest.Model, promptTokens,
                openai.CountTokenMessages(truncated, textRequest.Model))
            textRequest.Messages = truncated
            promptTokens = getPromptTokens(textRequest, meta.Mode)
        }
        if promptTokens > modelLimit {
            return openai.ErrorWrapper(
                fmt.Errorf("输入内容过长（约 %d tokens），已截断至最少消息数仍超出模型限制（%d tokens），请开始新对话", promptTokens, modelLimit),
                "context_length_exceeded",
                http.StatusBadRequest,
            )
        }
    }
}

meta.PromptTokens = promptTokens
preConsumedQuota, bizErr := preConsumeQuota(ctx, textRequest, promptTokens, ratio, meta)
```

需要在 import 中确认 `config`、`relaymode`、`openai` 都已引入（当前文件已有 `config`、`openai`；需要添加 `relaymode`）。

**Step 2: 检查并补充 import**

在 text.go 的 import 块中添加（如果没有）：

```go
"github.com/songquanpeng/one-api/relay/relaymode"
```

**Step 3: 确认编译通过**

```bash
cd packages/one-api && go build ./relay/controller/...
```

Expected: 无错误输出

**Step 4: Commit**

```bash
git add packages/one-api/relay/controller/text.go
git commit -m "feat: add proactive context length truncation before relay"
```

---

### Task 6: 第二层保护 — controller/relay.go 被动拦截

**Files:**
- Modify: `controller/relay.go`

**Step 1: 在文件末尾（`RelayNotFound` 之后）添加检测函数**

```go
// isContextLengthError 检测是否为 context length 超限错误
func isContextLengthError(bizErr *model.ErrorWithStatusCode) bool {
	if bizErr == nil {
		return false
	}
	keywords := []string{
		"context_length_exceeded", "context length", "maximum context",
		"prompt is too long", "tokens exceeds", "超出最大长度",
		"input is too long", "exceeds the limit",
	}
	msg := strings.ToLower(bizErr.Error.Message)
	code := strings.ToLower(fmt.Sprintf("%v", bizErr.Error.Code))
	for _, kw := range keywords {
		if strings.Contains(msg, kw) || strings.Contains(code, kw) {
			return true
		}
	}
	return false
}
```

需要在 import 中添加 `"strings"` 和 `"fmt"`（检查是否已有）。

**Step 2: 修改 Relay() 中的重试逻辑**

在 `Relay()` 函数中，`shouldRetry` 判断之后、重试循环之前，添加 context length 错误的提前拦截：

当前代码（relay.go 第65-69行）：

```go
retryTimes := config.RetryTimes
if !shouldRetry(c, bizErr.StatusCode) {
    logger.Errorf(ctx, "relay error happen, status code is %d, won't retry in this case", bizErr.StatusCode)
    retryTimes = 0
}
```

替换为：

```go
retryTimes := config.RetryTimes
if !shouldRetry(c, bizErr.StatusCode) {
    logger.Errorf(ctx, "relay error happen, status code is %d, won't retry in this case", bizErr.StatusCode)
    retryTimes = 0
}
if isContextLengthError(bizErr) {
    logger.Errorf(ctx, "context length error from upstream channel %d, stopping retry to prevent quota waste", channelId)
    retryTimes = 0
}
```

**Step 3: 确认编译通过**

```bash
cd packages/one-api && go build ./controller/...
```

Expected: 无错误输出

**Step 4: 完整编译整个项目**

```bash
cd packages/one-api && go build ./...
```

Expected: 无错误输出

**Step 5: Commit**

```bash
git add packages/one-api/controller/relay.go
git commit -m "feat: stop retry on context length error to prevent quota waste"
```

---

### Task 7: 验证与使用说明

**验证方式（手动测试）：**

1. 设置环境变量 `DEFAULT_CONTEXT_LIMIT=10` 后启动服务，发送一条普通消息，应收到 `context_length_exceeded` 400 错误
2. 通过管理后台 → 系统设置 → 找到 `ModelContextLimits` 字段，填入：
   ```json
   {"minimax": 200000, "gpt-4": 128000, "claude": 200000, "gemini": 900000}
   ```
   保存后立即生效（无需重启）

**如何维护模型最大输入：**

- 管理后台路径：系统设置 → `ModelContextLimits`
- 格式：JSON，key 为模型名关键词（不区分大小写，包含匹配），value 为 token 数
- 示例：`{"minimax": 200000, "gpt-4o": 128000, "claude": 200000}`
- 未配置的模型使用 `DefaultContextLimit`（默认 120000，可通过环境变量 `DEFAULT_CONTEXT_LIMIT` 修改）
- 修改后无需重启，下次请求即生效
