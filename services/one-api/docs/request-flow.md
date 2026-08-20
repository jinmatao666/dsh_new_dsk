# Parvis 请求完整链路

## 概览

用户发送一条消息后，请求经过 opencode 客户端 → one-api 网关 → 上游 LLM 提供商，响应原路返回。

## 链路图

```
用户输入消息
    │
    ▼
┌──────────────────────────────────────────────┐
│  1. opencode 客户端 (TypeScript)              │
│                                              │
│  session/llm.ts → LLM.stream()              │
│    ├─ 构建 system prompt + messages          │
│    ├─ Token.estimate() 估算，截断旧消息       │
│    ├─ provider/provider.ts 加载 SDK          │
│    │   ├─ 读取 model.api.url (API 网关地址)  │
│    │   ├─ 设置 apiKey、headers               │
│    │   └─ 创建 AI SDK 实例                   │
│    └─ streamText() 发送 HTTP 请求            │
│       POST {baseURL}/v1/chat/completions     │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  2. one-api 网关 (Go)                        │
│                                              │
│  router/relay.go                             │
│    POST /v1/chat/completions                 │
│         │                                    │
│         ▼                                    │
│  middleware.TokenAuth()                      │
│    → 验证 API Key，获取 userId/group         │
│         │                                    │
│         ▼                                    │
│  middleware.Distribute()                     │
│    → 根据 model + group 选择 channel（渠道） │
│    → 设置 channel 的 BaseURL、APIKey 等      │
│         │                                    │
│         ▼                                    │
│  controller/relay.go → Relay()               │
│    → 判断 relayMode (chat/completion/embed)  │
│         │                                    │
│         ▼                                    │
│  relay/controller/text.go → RelayTextHelper()│
│    ├─ 解析请求体 → GeneralOpenAIRequest      │
│    ├─ 模型名映射（用户模型 → 渠道实际模型）   │
│    ├─ tiktoken 计算 promptTokens             │
│    ├─ context 截断（超出模型限制时）          │
│    ├─ 预扣额度 preConsumeQuota               │
│    ├─ 选择 Adaptor（OpenAI/Anthropic/...）   │
│    ├─ ConvertRequest() 转换请求格式          │
│    ├─ DoRequest() → HTTP 请求上游 LLM       │
│    ├─ DoResponse() → 解析/转发响应           │
│    └─ postConsumeQuota() → 异步结算          │
│         ├─ 用模型返回的实际 token 算 quota   │
│         ├─ 多退少补预扣差额                  │
│         └─ 写入 logs 表                      │
└──────────────────┬───────────────────────────┘
                   │ 转发请求
                   ▼
┌──────────────────────────────────────────────┐
│  3. 上游 LLM 提供商                          │
│  (OpenAI / Anthropic / 阿里 / DeepSeek ...)  │
│                                              │
│  返回 SSE 流式响应 or JSON 响应              │
│  包含 usage: {prompt_tokens,completion_tokens}│
└──────────────────┬───────────────────────────┘
                   │ 响应流
                   ▼
┌──────────────────────────────────────────────┐
│  4. one-api 转发响应回客户端                  │
│     同时记录 logs（token 数 + quota）         │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│  5. opencode 客户端接收                       │
│     AI SDK 解析流式响应 → 展示给用户          │
│     提取 usage → 显示 token 统计 + 费用       │
└──────────────────────────────────────────────┘
```

## 详细步骤

### 1. opencode 客户端构建请求

**关键文件：**
- `packages/opencode/src/session/llm.ts` — 主入口 `LLM.stream()`
- `packages/opencode/src/provider/provider.ts` — SDK 初始化、baseURL 设置

**流程：**
1. `LLM.stream()` 构建 system prompt 和 messages
2. `Token.estimate()` 用 `字符数 ÷ 4` 粗略估算 token 数，超出 context 限制时截断旧消息
3. `Provider.getSDK()` 加载 AI SDK，配置 `baseURL`（来自 `model.api.url`）、`apiKey`、`headers`
4. `streamText()` 发送 HTTP POST 请求到 `{baseURL}/v1/chat/completions`

### 2. one-api 网关处理请求

#### 2.1 路由入口

**文件：** `packages/one-api/router/relay.go`

所有 `/v1/chat/completions` 请求经过：
1. `middleware.CORS()` — CORS 头
2. `middleware.GzipDecodeMiddleware()` — 解压
3. `middleware.TokenAuth()` — 验证 API Token
4. `middleware.Distribute()` — 选择渠道

#### 2.2 Token 认证

**文件：** `packages/one-api/middleware/`

验证请求中的 API Key，获取对应的 `userId` 和 `group`。

#### 2.3 渠道分发

**文件：** `packages/one-api/middleware/distributor.go`

`Distribute()` 函数：
1. 从请求体提取 `model` 字段
2. `CacheGetRandomSatisfiedChannel(userGroup, requestModel)` — 根据用户分组和模型选择一个可用渠道
3. `SetupContextForSelectedChannel()` — 设置渠道的 `BaseURL`、`APIKey`、`ChannelType` 等

同一个模型可配置多个渠道，按负载随机分配。

#### 2.4 请求转发

**文件：** `packages/one-api/relay/controller/text.go` — `RelayTextHelper()`

1. **解析请求** — JSON → `GeneralOpenAIRequest`
2. **模型名映射** — 用户模型名 → 渠道实际模型名（如 `gpt-4` → `claude-3-sonnet`）
3. **设置 system prompt** — 如果渠道配置了强制 system prompt
4. **tiktoken 计算 promptTokens** — 精确计算输入 token 数
5. **context 截断** — 超出模型 context 限制时，保留 system 消息和最新消息，从中间删除最老的
6. **预扣额度** — `preConsumeQuota = (promptTokens + maxTokens) × modelRatio × groupRatio`
7. **选择 Adaptor** — 根据 `ChannelType` 选择对应的适配器（OpenAI / Anthropic / Azure / Gemini 等）
8. **ConvertRequest()** — 将通用 OpenAI 格式转换为提供商特定格式
9. **DoRequest()** — 向上游 LLM 发起 HTTP 请求
10. **DoResponse()** — 解析响应，流式转发回客户端

### 3. 上游 LLM 返回响应

LLM 提供商返回 SSE 流式响应或 JSON 响应，包含 `usage` 字段：
```json
{
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567
  }
}
```

### 4. 结算与日志记录

**文件：** `packages/one-api/relay/controller/helper.go` — `postConsumeQuota()`

异步执行：
1. 从模型返回的 `usage` 中取 `prompt_tokens` 和 `completion_tokens`（实际值）
2. 计算 quota：`quota = ceil((promptTokens + completionTokens × completionRatio) × modelRatio × groupRatio)`
3. 多退少补：`quotaDelta = 实际quota - 预扣quota`，更新用户余额
4. 写入 `logs` 表，记录 token 数、quota、模型、渠道等

### 5. 客户端接收响应

**文件：** `packages/opencode/src/session/llm.ts`

AI SDK 解析流式响应，提取 `usage` 信息，展示给用户（token 统计 + 费用）。

## Token 计算对比

| 阶段 | 位置 | 方式 | 用途 |
|------|------|------|------|
| 客户端预估 | opencode `util/token.ts` | `字符数 ÷ 4` | 消息截断预判 |
| 网关预估 | one-api `openai/token.go` | `tiktoken` 精确编码 | 预扣额度 + context 截断 |
| 最终值 | LLM 提供商返回 | 模型实际计算 | 写入 logs，最终计费 |

## Quota 计算公式

```
quota = ceil((prompt_tokens + completion_tokens × completionRatio) × modelRatio × groupRatio)
```

- `modelRatio` — 模型价格倍率，基准为 `1 = $0.002/1K tokens`
- `completionRatio` — 输出 token 相对输入的倍率（如 Claude 3 为 5，GPT-4o 为 4）
- `groupRatio` — 用户分组倍率（用于差异化定价）

## 关键设计

1. **Adaptor 模式** — 每个 LLM 提供商一个适配器，统一接入接口
2. **预扣机制** — 请求前预扣，完成后多退少补，防止余额不足
3. **渠道选择** — 同模型多渠道，支持负载均衡和故障转移
4. **双重 token 计算** — 本地 tiktoken 用于预估，模型返回值用于最终计费
