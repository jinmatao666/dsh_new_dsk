---
description: "展示独立的万维自动化页面，不启动调度器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-automations

[English](README.md) | 中文

## 概述

用户可以浏览现有任务模板、历史和创建演示。系统设置分别控制互联网和纯内网部署的入口显示；默认都开启。桌面端启动或登录刷新时应用配置。挂载它不需要技能市场、专家库或连接器插件。

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

万维桌面产品通过[组合补丁](../../bundle/wanwei-desktop/cordis.patch.yml)挂载本插件。它没有单独的插件配置字段。

创建和删除操作显示演示反馈。打开本页不会调度后台任务或执行模板。

停用本插件的配置项会移除其入口；不需要停用其他业务插件。共用鉴权、渲染和侧边栏服务仍由各提供方负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Client 拥有模板标签、选择状态和提示。它仅使用 feature-panels 提供展示和导航。实例控制器在侧边栏导航或退出登录时关闭页面，卸载时解绑监听。

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

- 本页未实现持久任务配置、调度和真实执行历史。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护人员的工作上下文 — 点击展开</summary>

无。

</details>
