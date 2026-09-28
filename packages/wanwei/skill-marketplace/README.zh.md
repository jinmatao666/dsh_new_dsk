---
description: "在官方 DSH 技能运行时负责执行技能的前提下，使用万维桌面技能市场和已上架的独立专家网站。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-skill-marketplace

[English](README.md) | 中文

## 概述

万维桌面通过此插件浏览已上架技能、管理本地安装并查看个人上传审核记录。插件也能从 OneAPI 发现任意已上架的独立专家网站，在主窗口 Tab 打开工作台。插件不负责专家任务历史或成果文件；这些记录由各网站保存。

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

万维桌面组合包在官方浏览器 UI 之后挂载此 Client 插件；它不是独立应用。

### 适用情况

桌面需要 OneAPI 提供的目录和本地技能安装时，使用万维产品 profile。官方 DSH 技能包仍负责发现和运行已安装技能。独立专家需要已上架的目录资料、可用的身份接口和已批准的 HTTPS 网站。

市场包含仅由平台官方技能组成的推荐区、所有已发布的平台技能以及独立的 SkillHub 区。两个目录各有独立搜索；搜索平台技能时收起推荐区，不筛选 SkillHub。SkillHub 卡片沿用平台布局，详情以完整页面显示，返回时保留列表位置。我的安装包含本机 SkillHub 记录，支持离线使用、卸载和手动更新。[SkillHub 适配器](../skillhub/README.zh.md) 负责上游请求与限制。

### 组合方式

开始使用已安装技能会暂存其 slash token 和友好名称。输入框在可编辑问题旁显示紧凑的行内技能标签；会话标签序列化为同一 slash token。产品样式留在万维 UI 包中。

产品组合包在[补丁文件](../../bundle/wanwei-desktop/cordis.patch.yml)中持有 `wanwei-skill-marketplace` 配置项。产品安装需要配置 OneAPI Host 和原生桥；本包不要求用户在浏览器输入提供方秘密。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Client 从产品 Remote 读取已发布的技能和专家目录。专家 ID 必须符合启动接口规则：3–80 个小写 ASCII 字母、数字或连字符，以字母开头；无效条目不显示。安装技能会刷新官方浏览器技能目录。选择专家后，Host 取得一次性打开票据，随后在主窗口 Tab 中打开限定来源的原生子 Webview。出现独立弹窗时，原生视图隐藏到弹窗关闭。专家网站负责自己的任务和成果。

相同的启动参数及展示回调变化保留原生网站会话。专家 ID、地址或票据变化会替换视图；关闭 Tab 后不再上报迟到的显隐和定位错误。

目录组件拥有每次待完成的启动请求。退出登录或组件卸载使请求失效，迟到的成功响应不能重新打开网站，迟到的失败不能覆盖当前提示。待完成的启动请求不能重复提交。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [产品组合](../../bundle/wanwei-desktop/README.zh.md) — 桌面挂载哪些私有插件。
- [专家网站计划](../../../WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md) — 交付与验收范围。

-----

<a id="model-experience"></a>
## Model Experience

### 技能调用草稿

#### What the model sees

点击“使用技能”只把 `/office-meeting-minutes` 等斜杠标记预置到无会话草稿。只有用户发送提示词后模型才看到这段文本；技能名称的展示不会修改提交内容。

#### Token effect

打开草稿不消耗模型 token。发送后的提示词使用标准 DSH 模型请求及其通常的 token 统计。

#### KV Cache effect

发送前不影响缓存。发送后普通提示词变化可能影响缓存复用。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 已发布技能、上传审核记录和专家发现需要可访问的 OneAPI 服务。
- 专家网站 Tab 依赖万维桌面原生桥。网页容器、权限与下载行为仍需在 Windows、两个 macOS 架构和 Linux 上验收。
- 网站任务记录和成果保存在各自网站，不进入技能市场或平台对话。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护人员的工作上下文 — 点击展开</summary>

无。

</details>
