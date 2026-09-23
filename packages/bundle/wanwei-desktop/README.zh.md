---
description: "在官方 dsh 浏览器应用之上组装万维自有插件的私有桌面产品层。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-wanwei-desktop`

[English](README.md) | 中文

## 概述

`wanwei-desktop` profile 将此私有 bundle 作为 [`dsh-base`](../base/README.zh.md) 与 [`dsh-web-app`](../web-app/README.zh.md) 之后最后一个由产品方持有的配置层。此层组装万维认证、模型治理、技能、桌面集成与界面包，并禁用官方 DeepSeek 适配器和可编辑的模型设置页，使桌面端使用 OneAPI 受管模型目录。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

### 启动产品 Profile

随附的 `wanwei-desktop` 模板依次包含 `dsh-base`、`dsh-web-app` 与此 bundle：

```sh
pnpm dsh --profile wanwei-desktop --dump-default-config
pnpm dsh --profile wanwei-desktop
```

产品 Profile 初始化后，第一条命令在不启动应用的情况下打印默认生效配置树。第二条命令启动浏览器应用，并实时重载 profile patch。

### 可获得的能力

此层禁用 `llm-deepseek` 和 `ui-settings-models`，再挂载万维自有插件。OneAPI 认证插件提供唯一受管 Provider 和只读的“模型”设置页；官方 base 与 Web bundle 不承载这些私有配置。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部结构——点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 持有产品配置；[`src/index.ts`](src/index.ts) 锚定 bundle 包；[`src/invariant.ts`](src/invariant.ts) 持有本包的 invariant 注册。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [Bundle 包](../README.zh.md)——profile 配置层所有权与官方应用 bundle。
- [应用启动](../../boot/app-boot/README.zh.md#profiles)——模板初始化与配置层顺序。
- [CLI Profile](../../../apps/cli/README.zh.md#profiles)——启动器行为与配置 dump。

-----

<a id="model-experience"></a>
## 模型体验

### 仅负责组装

#### 模型看到的内容

此组装层不添加提示词、工具、消息或结果。所挂载的功能包各自持有模型可见行为。

#### Token 影响

组装层直接 token 影响为零。所挂载的功能包各自记录 token 影响。

#### KV Cache 影响

此层不直接改变缓存行为。所挂载的功能包分别记录自身缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **服务端依赖**——模型发现需要连接已配置的 OneAPI 服务；桌面端不提供本地 Provider 配置作为回退。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护工作上下文——点击展开</summary>

无。

</details>
