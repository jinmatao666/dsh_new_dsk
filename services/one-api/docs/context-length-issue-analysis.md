# One-API 异常 Token 计数问题分析与解决方案

## 问题现象

**时间**：2026-03-24
**用户**：parvis_1092
**问题**：单次请求消耗 1,563,159 tokens（约 156 万），导致大量配额浪费

### 数据统计

- 失败请求次数：214 次
- 单次 prompt tokens：约 1,563,159
- 单次消耗配额：约 47,000,000（4700 万）
- 总浪费配额：约 10,000,000,000（100 亿）
- 目标模型：MiniMax/MiniMax-M2.7

## 根本原因分析

### 1. 超长上下文输入

**可能原因**：
- 用户对话历史过长，累积了大量消息
- 消息中包含 base64 编码的图片（单张图片可能占用数十万 tokens）
- 客户端未正确管理对话上下文，持续追加历史消息

### 2. 缺乏保护机制

**原系统问题**：
- ❌ 发送前不检查 token 数量是否超限
- ❌ 上游返回 context length 错误后，继续跨渠道重试
- ❌ 每次重试都消耗配额，导致配额快速耗尽
- ❌ 没有模型级别的 context limit 配置

### 3. 恶性循环

```
客户端发送超长请求 (156万 tokens)
    ↓
One-API 预扣配额 (4700万)
    ↓
MiniMax 返回空响应或错误
    ↓
客户端认为失败，重新发送相同请求
    ↓
重复 214 次 → 浪费 100 亿配额
```

## 解决方案

### 双层保护机制

#### 第一层：主动截断（发送前）

**位置**：`relay/controller/text.go` - `RelayTextHelper()`

**逻辑**：
1. 计算 prompt tokens
2. 获取模型的 context limit
3. 如果超限，自动截断最老的消息
4. 截断后仍超限，返回明确错误

**代码**：
```go
if meta.Mode == relaymode.ChatCompletions && len(textRequest.Messages) > 0 {
    modelLimit := getModelContextLimit(textRequest.Model)
    if promptTokens > modelLimit {
        // 尝试截断
        truncated := truncateMessagesToLimit(textRequest.Messages, textRequest.Model, modelLimit)
        if len(truncated) < len(textRequest.Messages) {
            textRequest.Messages = truncated
            promptTokens = getPromptTokens(textRequest, meta.Mode)
        }
        // 截断后仍超限，返回错误
        if promptTokens > modelLimit {
            return openai.ErrorWrapper(
                fmt.Errorf("输入内容过长..."),
                "context_length_exceeded",
                http.StatusBadRequest,
            )
        }
    }
}
```

#### 第二层：被动拦截（上游返回错误后）

**位置**：`controller/relay.go` - `Relay()`

**逻辑**：
1. 检测上游返回的 context length 错误
2. 停止跨渠道重试
3. 截断消息后重新发送
4. 仍失败则返回明确错误

**关键函数**：
```go
func isContextLengthError(bizErr *model.ErrorWithStatusCode) bool {
    // 检测错误码和错误消息中的关键词
    keywords := []string{
        "context_length_exceeded", "context length", "maximum context",
        "prompt is too long", "tokens exceeds", "超出最大长度",
    }
    // ...
}
```

### 配置系统

#### 1. 默认 Context Limit（环境变量）

```bash
export DEFAULT_CONTEXT_LIMIT=120000
```

- 适用于所有未在 ModelContextLimits 中配置的模型
- 默认值：120000 tokens

#### 2. 模型级别 Context Limit（数据库配置）

**后端实现**：
- 配置项：`ModelContextLimits`
- 存储格式：JSON 字符串
- 实时生效：修改后无需重启

**配置示例**：
```json
{
  "minimax": 200000,
  "glm": 200000,
  "gpt-4": 120000,
  "claude": 190000,
  "gemini": 900000
}
```

**匹配规则**：
- 模型名称包含 key（不区分大小写）即匹配
- 例如：`MiniMax/MiniMax-M2.7` 匹配 `minimax` → 200000

## 修改的文件

### 后端文件

1. **common/config/config.go**
   - 添加 `DefaultContextLimit` 环境变量配置
   - 添加 `ModelContextLimits` map

2. **common/config/context_limit.go**（新增）
   - JSON 序列化/反序列化函数
   - 线程安全的读写锁

3. **relay/controller/helper.go**
   - `getModelContextLimit()` - 获取模型 context limit
   - `truncateMessagesToLimit()` - 二分查找截断消息

4. **relay/controller/text.go**
   - 主动截断逻辑（发送前检查）

5. **controller/relay.go**
   - `isContextLengthError()` - 检测 context length 错误
   - `truncateRequestBody()` - 截断请求体
   - 被动拦截逻辑（错误后处理）

6. **model/option.go**
   - 集成 `ModelContextLimits` 配置项
   - 初始化默认

## 效果验证

### 测试场景 1：超长请求主动截断

**输入**：prompt_tokens = 250,000，模型 limit = 200,000

**预期**：
- 日志：`messages truncated from X to Y, new prompt tokens: Z`
- 请求成功发送（截断后）

### 测试场景 2：截断后仍超限

**输入**：只有 system + 1 条消息，仍超过 200,000 tokens

**预期**：
- 返回 400 错误
- 错误消息：`输入内容过长（约 X tokens），已截断至最少消息数仍超出模型限制，请开始新对话`

### 测试场景 3：上游返回 context length 错误

**输入**：上游返回 `context_length_exceeded` 错误

**预期**：
- 不跨渠道重试
- 自动截断后重新发送
- 日志：`context length error from upstream channel X, attempting truncation`

## 预防建议

### 客户端层面

1. **限制对话历史长度**
   - 只保留最近 N 轮对话
   - 定期清理过长的对话

2. **图片处理**
   - 压缩图片后再转 base64
   - 使用 URL 而非 base64（如果模型支持）

3. **错误处理**
   - 收到 `context_length_exceeded` 错误后，清理对话历史
   - 不要无限重试相同请求

### 服务端层面

1. **监控告警**
   - 监控单次请求 token 数超过阈值（如 100K）
   - 监控用户短时间内的配额消耗速度

2. **配额保护**
   - 设置单次请求最大配额限制
   - 用户配额不足时提前拦截

## 总结

通过双层保护机制，可以有效防止类似问题再次发生：

✅ **主动保护**：发送前检查并截断
✅ **被动保护**：错误后停止重试并截断
✅ **可配置**：支持环境变量和数据库配置
✅ **实时生效**：修改配置无需重启

