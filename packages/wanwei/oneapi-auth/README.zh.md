---
description: "使用 OneAPI 登录万维桌面，并在不向浏览器暴露生成令牌的情况下使用后台管理的模型、搜索和专家网页票据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-oneapi-auth

[English](README.md) | 中文

## 概述

用户登录配置的 OneAPI 服务并使用账户获准的模型。桌面读取后台管理的模型目录，不提供本地提供方编辑。Host 还会获取已上架专家资料与一次性网站票据，并把 OneAPI token 留在 Client 之外。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

万维产品组合包挂载 Host 和 Client 两部分。浏览器只接收认证状态和模型标识，不接收密码或生成令牌。

### 配置

[产品补丁](../../bundle/wanwei-desktop/cordis.patch.yml)提供提供方路由和生成令牌引用。Host 优先使用显式 OneAPI 地址，其次读取启动环境中的 `DSH_ONEAPI_URL`，最后使用本地开发地址。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `DSH_ONEAPI_URL`，其次 `http://127.0.0.1:3000` | 不含 `/v1` 的显式 OneAPI 地址优先于启动环境。 |
| `provider` | `dsh-server` | 受管理的 DSH 模型提供方路由。 |
| `credentialRef` | `DSH_ONEAPI_TOKEN` | 已存储的生成令牌引用。 |
| `tokenName` | `DSH Desktop Auto Token` | 自动创建的 OneAPI 令牌名称。 |
| `defaultModel` | 可选 | 首选默认模型标识。 |
| `defaultInput` | `[text]` | 模型标识公开的输入模态；仅在支持时启用图像。 |
| `installId` | 可选 | 新安装后要求登录的构建标记。 |
| `developmentBypass` | `false` | 仅供源码开发环境跳过登录浮层。 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

回环 Host 向 OneAPI 交换凭据，将生成令牌交给 DSH 凭据提供方，读取可用模型并配置受管理的 pi-ai 提供方。Client 通过 slot 渲染登录页、账户区和只读模型区。Host 使用同一已登录令牌调用配置的 `oneapi-bailian` 搜索提供方，并申请一次性专家打开票据。只有网站地址与短时票据传给 Client。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [产品组合](../../bundle/wanwei-desktop/README.zh.md) — 挂载顺序与模型设置覆盖。
- [独立专家计划](../../../WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md) — 网页身份和验收范围。

-----

<a id="model-experience"></a>
## Model Experience

### 受管理的模型请求

#### What the model sees

`dsh-server` 提供方仅提供已登录 OneAPI 账户获准的模型。登录状态和生成令牌不会加入模型提示词。

#### Token effect

登录和读取模型目录不消耗模型 token。用户请求通过所选模型及标准 DSH LLM 提供方处理，并使用通常的用量统计。

#### KV Cache effect

认证本身不改变提示词或缓存键。模型选择和后续请求遵循通常的提供方缓存行为。

### 受管理的网页搜索

#### What the model sees

`oneapi-bailian` 搜索提供方通过现有 DSH 网页工具路径返回结果；后台选择的搜索模型和令牌不作为提示词文本出现。

#### Token effect

搜索请求使用已配置的 OneAPI 服务。当 agent 使用结果时，工具结果 token 按通常方式进入模型上下文。

#### KV Cache effect

不同搜索结果可能改变后续提示词及缓存复用；本包不管理模型缓存。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 模型发现、受管理搜索和专家目录需要可访问的 OneAPI 服务。桌面没有本地编辑提供方的兜底方式。
- 独立专家打开需要另行部署 OneAPI `/api/expert-web` 接口和数据库表；普通登录接口不包含该能力。
- 网站票据和子 Webview 权限仍需真实服务与跨平台桌面验收。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护人员的工作上下文 — 点击展开</summary>

无。

</details>
客户端认证忽略过期状态响应及与登录、退出重叠的刷新结果；已取消的刷新不会发布离线状态。这只约束客户端状态更新顺序，不会取消 Host 已受理的认证操作。
