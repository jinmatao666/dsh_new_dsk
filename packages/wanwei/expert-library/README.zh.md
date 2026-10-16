---
description: "浏览已上架专家并打开独立原生工作台，不需要挂载技能市场。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-expert-library

[English](README.md) | 中文

## 概述

用户可以查看管理员编写的专家介绍，在同一标签行打开多个工作台。重复打开专家会选中已有标签，不重复申请票据。本页依赖 OneAPI 和桌面原生桥。两种部署模式都会尝试访问配置的服务；目录请求失败显示专家卡片占位，不禁用入口，也不误报空目录。重新打开页面会再次加载目录。

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

已上架卡片使用后台配置的名称、副标题、简介、标签和上传图片。图片在 48 像素底框内占用 42 像素方形区域。详情展示后台配置的区块和底部说明，旧记录使用兜底展示。

停用本插件的配置项会移除其入口；不需要停用其他业务插件。共用鉴权、渲染和侧边栏服务仍由各提供方负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

专家 ID 接受 3–80 个小写 ASCII 字母、数字或连字符，并以字母开头。插件实例拥有目录加载和待完成的启动请求。退出登录或卸载会使迟到的响应失效；待完成的启动不能重复提交。切换标签时原生视图保持挂载，弹窗打开时隐藏，关闭标签时销毁。相同的启动参数保留网站会话，ID、地址或票据变化则替换视图。

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

- 原生 Webview 的定位、权限和下载仍需在 Windows、macOS 和 UOS 上验收。专家任务记录和产物由网站保存。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护人员的工作上下文 — 点击展开</summary>

无。

</details>
