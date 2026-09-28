---
description: "在万维桌面浏览公开 SkillHub 技能并下载指定版本的技能包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-skillhub

[English](README.md) | 中文

## 概述

用户在万维市场中浏览和搜索公开的 SkillHub 技能。下载固定为明确的远端版本。桌面端负责本地安装和来源记录。平台推荐继续只包含平台技能。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

[万维 Bundle](../../bundle/wanwei-desktop/cordis.patch.yml) 将此插件挂载到经过认证的本机 Host 连接。访问 SkillHub 不依赖 OneAPI 认证插件。原生安装仅在产品桌面端可用。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | 必填 | SkillHub HTTPS 来源地址。 |
| `timeoutMs` | 必填 | 上游请求超时，单位毫秒。 |
| `maxJsonBytes` | 必填 | 流式 JSON 响应的最大字节数。 |
| `maxArchiveBytes` | 必填 | 下载 ZIP 最大字节数；桌面安装还限制包大小不超过 16 MiB。 |
| `downloadHosts` | 必填 | 下载重定向允许访问的准确 HTTPS 对象存储主机名。 |

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Host 校验上游响应并转换为产品数据，包括公开下载量和图标地址。栅格图标仅从腾讯 `cloudcache.tencent-cloud.com` 主机代理读取，不跟随重定向，大小限制为 256 KiB；不支持的图标使用本地默认图形。下载限制重定向次数，通过认证 RPC 返回 base64 字节及传输 SHA-256 摘要。此摘要检测传输变化，不是发布者签名。桌面端先暂存安装内容再启用目录，并记录远端标识、远端版本、实际本地技能名称和来源。手动更新只替换匹配 SkillHub 安装记录的目录，发布新版本前保留旧目录。卸载需要匹配本地记录。平台安装和删除拒绝操作 SkillHub 所有的目录。

本地记录在离线时仍可使用。点击使用将实际安装的技能名称放入现有会话草稿。市场负责界面，此插件不导入客户端 UI，也不修改智能体循环。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [技能市场](../skill-marketplace/README.zh.md) — 界面与技能调用。
- [产品边界](../../../WANWEI_DECOUPLING_RULES.md) — 所有权约束。
- [SkillHub API](https://github.com/Tencent/skillhub/blob/main/docs/api/README.md) — 上游要求。

<a id="model-experience"></a>
## 模型体验

### 公开技能发现

#### 模型看到什么

浏览、下载和安装不发送模型请求。安装后的技能通过现有文件系统 Provider 被发现。模型仅通过正常的技能加载流程接收 `SKILL.md` 指令。

#### Token 影响

目录操作不消耗模型 Token。发送草稿中的技能命令和加载指令使用正常的 DSH Token 计量。

#### KV Cache 影响

目录操作不改变模型上下文。加载技能可能改变后续请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 公开 API 可用性、商用条款和未来团队密钥要求由 SkillHub 决定；产品不内置共享凭据。
- 不支持付费下载、私有技能和自动版本更新；SkillHub 返回较新版本时可手动更新。技能依赖的额外运行时、工具与凭据由用户管理。
- 原生导入沿用现有的 128 个条目、解压后 16 MiB 和 16 层目录限制。同名冲突会被拒绝，不自动改名或覆盖。
- 上游存储或图标主机名变化时需要更新适配器。远端说明通过现有受控 Markdown 渲染器展示。

<a id="dev-note"></a>
### 开发备注

无。
