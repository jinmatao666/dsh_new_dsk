---
description: "在独立功能插件之间复用万维页面外壳、短暂提示和实例拥有的导航。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-feature-panels

[English](README.md) | 中文

## 概述

产品插件可以共用侧边栏和覆盖层样式，而不共享目录或业务状态。每个调用方使用自身挂载 Context 分配控制器。打开一个页面会通过本地浏览器事件关闭另一个可见页面，卸载只影响所属实例。

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

入口可见性由管理员配置，不根据网络模式标签推断。共用的 `ServiceUnavailable` 组件接收本地化文案和服务专属插画类型；调用方仅在实际服务请求失败后显示它。云端技能、专家卡片和断开插头插画直接内置，无需联网。占位不显示重试按钮或原始诊断信息。

万维桌面产品通过[组合补丁](../../bundle/wanwei-desktop/cordis.patch.yml)挂载本插件。它没有单独的插件配置字段。

当功能导入本包的 Client 导出时，保持这个共用提供方挂载。它没有自己的业务入口，不包含专家、技能、连接器或自动化数据。

调用方从 `@deepseek-ai/dsh-wanwei-feature-panels/client` 导入辅助函数。有调用方挂载时保持本提供方启用；停用业务功能只移除该功能的入口。共用鉴权、渲染和侧边栏服务仍由各提供方负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Client 导出面板控制器、注册辅助函数、页面外壳、提示和交互分类。调用方提供标题、图标、内容及可选的可见性观察对象。隐藏入口不渲染占位，并关闭对应页面；侧栏保持设置固定在其余菜单下方。控制器监听属于调用方 Context；回调失败不会中断其他监听，退出登录关闭页面，卸载关闭页面并移除监听。调宽和所属下拉交互会保留当前页面。

[Client 入口](src/client/index.ts)提供实现。[Host 入口](src/index.ts)支持模块发现，不注册业务服务。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [产品组合](../../bundle/wanwei-desktop/README.zh.md) — profile 归属。
- [鉴权与网络策略](../oneapi-auth/README.zh.md) — 共用服务。
- [独立页面决策](../../../.agents/notes/implemented/architecture/2026-10-10-independent-wanwei-pages.zh.md) — 生命周期和依赖依据。

-----

<a id="model-experience"></a>
## Model Experience

无，因为此 Client 展示不注册提示词或工具；网站执行和 Host 模型提供方负责下游请求和 token 消耗。

#### KV Cache effect

不直接修改模型上下文或缓存复用。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 调用方必须在 dsh.client.external 声明 Client 模块并挂载本提供方。本包是展示基础设施，不是第五个业务功能。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护人员的工作上下文 — 点击展开</summary>

无。

</details>
