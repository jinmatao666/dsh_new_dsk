---
description: "由 OneAPI 管控的万维桌面端本地图片识别工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-vision

[English](README.md) | 中文

## 概述

`recognize_image` 工具读取本地图片，请管理员指定的 OneAPI 视觉模型生成文字描述。上游模型密钥留在 OneAPI，桌面端使用当前登录用户的令牌。

## 目录

- [使用此包](#use-this-package)
- [实现方式](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

通过万维桌面 Bundle 和 `tools`、`fs`、`credentials` Service 挂载。显式 `baseURL` 优先于启动环境中的 `DSH_ONEAPI_URL`，后者缺省为 `http://127.0.0.1:3000`；地址不含 `/v1`。`credentialRef` 默认是 `DSH_ONEAPI_TOKEN`。管理员须在 OneAPI 选择 `vision_model`，并向用户授权该支持图片的模型。

-----

<a id="understand-the-implementation"></a>
## 实现方式

<details>
<summary>实现细节——点击展开</summary>

[`src/index.ts`](src/index.ts) 通过 DSH FS 校验文件，只接受不超过 8 MiB 的 PNG/JPEG/WebP/GIF，校验服务端模型选择和用户权限，再调用 OneAPI 聊天补全。即使当前会话模型只支持文本，也返回文字描述。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [OneAPI 登录](../oneapi-auth/README.zh.md)——用户令牌和托管模型。
- [万维 Bundle](../../bundle/wanwei-desktop/README.zh.md)——产品组装。

-----

<a id="model-experience"></a>
## 模型体验

### 图片识别

#### 模型看到的内容

`recognize_image` 工具结果包含 `<path>`、`<vision_model>` 和 `<recognition>` 文本。视觉请求使用管理员指定的模型，不一定是当前聊天模型。

#### Token 影响

视觉请求会产生 OneAPI 模型用量。其文字描述在当前聊天模型继续处理时还可能占用上下文 token。

#### KV Cache 影响

不同的描述会改变后续聊天提示词，可能降低缓存复用率。此包没有独立模型缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **需要配置模型**——管理员未选定用户获授权的图片模型时，识别失败。
- **格式与大小限制**——仅支持不超过 8 MiB 的 PNG/JPEG/WebP/GIF；PDF 扫描件应使用其他流程。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护背景——点击展开</summary>

上游视觉提供方的密钥不能复制到桌面端或官方 DSH 包。

</details>
