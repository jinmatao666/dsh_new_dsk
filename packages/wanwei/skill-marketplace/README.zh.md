---
description: "浏览平台与 SkillHub 技能，管理本地安装并使用技能。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-skill-marketplace

[English](README.md) | 中文

## 概述

本插件展示推荐技能、平台技能和 SkillHub 技能三个同级区块，管理本地安装和个人上传。

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

万维产品配置提供平台目录和本地技能安装。官方 DSH 技能包负责发现和运行已安装技能。

市场包含仅由平台技能组成的推荐区、平台技能区以及独立的 SkillHub 区。SkillHub 搜索、分类和分页独立于平台筛选。我的安装包含本机 SkillHub 记录，支持离线使用和卸载。[SkillHub 适配器](../skillhub/README.zh.md) 负责上游请求与限制。

### 组合方式

产品组合包在[补丁文件](../../bundle/wanwei-desktop/cordis.patch.yml)中持有 `wanwei-skill-marketplace` 配置项。产品安装需要配置 OneAPI Host 和原生桥；本包不要求用户在浏览器输入提供方秘密。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

产品客户端读取平台目录和 SkillHub 目录；原生桥管理安装来源。使用技能将实际本地名称预置到可编辑的会话草稿，用户发送后才执行。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [产品组合](../../bundle/wanwei-desktop/README.zh.md) — 桌面挂载哪些私有插件。

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

- 平台目录与上传审核依赖 OneAPI；SkillHub 目录依赖其公开 API。
- 原生安装需要万维桌面；额外的技能运行依赖由用户配置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护人员的工作上下文 — 点击展开</summary>

无。

</details>
