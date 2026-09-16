---
description: "在官方 dsh 浏览器应用之上组装万维自有插件的私有桌面产品层。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-wanwei-desktop`

[English](README.md) | 中文

## 概述

`wanwei-desktop` profile 将此私有 bundle 作为 [`dsh-base`](../base/README.zh.md) 与 [`dsh-web-app`](../web-app/README.zh.md) 之后最后一个由产品方持有的配置层。万维认证、模型治理、技能、桌面集成与界面包都通过这一处完成组装。在这些功能包完成迁移前，patch 刻意保持为空，因此首个组装版本保留官方浏览器行为。

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

第一条命令初始化 profile 并在不启动应用的情况下打印默认生效配置树。第二条命令启动浏览器应用，并实时重载 profile patch。

### 可获得的能力

当前配置层在官方 Web 应用之后预留一处由万维持有的 patch 位置，不修改任何运行时配置项。后续万维功能包都通过此 patch 接入，而不修改官方 base 或 Web bundle。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部结构——点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 是产品方持有的配置层，目前只包含空 patch 列表。[`src/index.ts`](src/index.ts) 锚定 bundle 包；[`src/invariant.ts`](src/invariant.ts) 预留包自有的 invariant 注册，但不会重复未来各功能包持有的运行时检查。

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

此包不提供任何模型可见内容。空的 `cordis.patch.yml` 不会添加提示词、工具、消息或结果，这些内容仍由官方 base 和 Web bundle 持有。

#### Token 影响

产品 patch 为空时直接 token 影响为零。未来插入的每个包分别持有并记录自身 token 影响。

#### KV Cache 影响

此空配置层保留官方组装的缓存行为。未来 patch 配置项只能通过其所有者包影响缓存复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **尚未挂载私有功能**——当前 profile 只验证独立产品层边界，行为与官方 Web 组装一致。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护工作上下文——点击展开</summary>

无。

</details>
