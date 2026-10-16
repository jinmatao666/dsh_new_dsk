---
description: "展示独立的万维连接器页面，入口显示由后台控制。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-connectors

[English](README.md) | 中文

## 概述

用户可以浏览连接器分类，查看现有演示弹窗。系统设置分别控制互联网和纯内网部署的入口显示；默认互联网开启、纯内网隐藏。桌面端启动或登录刷新时应用配置。挂载它不需要技能市场、专家库或自动化插件。

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

现有连接器数据和交互是演示。弹窗操作不会授权真实服务或保存凭据。

两种网络模式下打开页面都会通过部署配置刷新 RPC 检查配置的平台。请求失败显示断开插头占位；成功后显示本地演示目录。重新打开页面会再次检查。此检查只验证平台可达性，不代表第三方连接器健康或已授权。管理员入口显示开关仍有效。

停用本插件的配置项会移除其入口；不需要停用其他业务插件。共用鉴权、渲染和侧边栏服务仍由各提供方负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Client 拥有连接器列表、选择状态和弹窗。它从 feature-panels 导入共用展示组件，并使用圆角 Select 控件。实例控制器在侧边栏导航或退出登录时关闭页面，卸载时解绑监听。

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

- 本页未实现真实授权、持久凭据和服务执行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护人员的工作上下文 — 点击展开</summary>

无。

</details>
