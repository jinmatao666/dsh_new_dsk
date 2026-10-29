---
description: "浏览已上架专家并打开独立原生工作台，不需要挂载技能市场。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-expert-library

[English](README.md) | 中文

## 概述

“刷新目录”会重新获取已上架专家和分类位置，无需重启桌面端或关闭已运行的工作台。专家卡片顺序和分类导航顺序分别沿用后台设置。

卡片顺序沿用后台目录，分类导航独立按照后台分类位置排列。上架元数据保留各专家的联网要求标记。内网未确认可联网时，需要联网的卡片按照后台设置隐藏或灰化；可离线使用的专家保持可用并排在灰化卡片前面，组内仍按后台顺序显示。灰化卡片悬停提示网络不可达，不能打开详情或启动新工作台。全部专家被隐藏时显示专家库占位和内网策略说明。网络刷新确认恢复后重新可用，已运行的工作台保持打开。

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

活动工作台通过页面主体和专家容器的弹性布局占满面板剩余高度。原生视图等待有效尺寸；目录模式保留普通滚动。[布局回归测试](tests/workbench-composition.mjs)启动桌面 profile，检查真实浏览器尺寸，不模拟元素大小。

原生操作串行执行：创建返回隐藏的子视图，定位后才显示；销毁先等待正在执行的操作，再隐藏并关闭。仅在原生调用确认后记录可见状态。桥接失败会移除对应标签，并在目录中显示错误；关闭失败重试一次。桌面端隐藏或关闭视图后恢复主视图焦点，在本地应用数据目录的 `logs/expert-webviews.log` 记录生命周期事件，不记录地址或票据。

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

目录访问判断通过注入的 `wanweiNetwork.catalogAccess` 服务方法跨插件传递。客户端入口只提供网络类型；消费者不导入认证插件的运行时辅助函数。

需要联网的技能与专家分别按 `internetSkillPolicy` 和 `internetExpertPolicy` 独立控制展示。缺失值沿用旧统一策略；需使用新版桌面端才能应用独立选择。
