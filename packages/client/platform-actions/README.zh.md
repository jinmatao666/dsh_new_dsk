---
description: "由嵌入式产品外壳提供的可选浏览器端操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-platform-actions

[English](README.md) | 中文

## 概述

这个通用 Cordis Service 允许产品外壳注册打开目录和原生保存文件的可选操作，官方 DSH 组件无需内置某个桌面桥。

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

先于产品层消费者挂载客户端插件。产品外壳调用 `ctx.platformActions.register({ openDirectory, saveFile })`，并保留返回的注销函数。消费者调用操作前先检查 `canOpenDirectory()` 或 `canSaveFile()`。

-----

<a id="understand-the-implementation"></a>
## 实现方式

<details>
<summary>实现细节——点击展开</summary>

[`src/client/index.ts`](src/client/index.ts) 同一时间只维护一个可选提供方。未注册的操作会返回不可用错误；注销只移除相同实例。Service 本身不实现原生能力。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [客户端 Service 测试](tests/service.client.spec.ts)——注册、调用和注销行为。

-----

<a id="model-experience"></a>
## 模型体验

### 平台操作

#### 模型看到的内容

`platformActions` 注册表本身不产生模型提示词、工具或结果。是否影响模型取决于使用它的插件。

#### Token 影响

注册和直接 UI 调用不消耗模型 token。

#### KV Cache 影响

注册表不改变模型消息或缓存键。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **提供方可选**——产品外壳未注册前操作不可用；通用网页应用不会因此自动获得桌面文件系统权限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护背景——点击展开</summary>

此包不能引入产品名称、原生桥全局变量或平台专属路径。

</details>
