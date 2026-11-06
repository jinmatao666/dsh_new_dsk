---
description: "将管理员配置的土地市场与政策宝典页面作为独立桌面功能入口展示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-portals

[English](README.md) | 中文

## 概述

本插件挂载两个独立功能入口：土地市场与政策宝典。各入口可见性跟随 OneAPI 当前部署环境开关。打开后全屏嵌入管理员配置的页面地址（不显示功能面板标题区，仅保留右上角返回），并最大化桌面窗口。iframe 加载期间显示与知识库文档预览相同的居中加载指示。未配置地址时显示配置占位，不显示空白框架。

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

管理员在管理工作台「系统设置 → 功能设置」控制入口显示，并通过土地市场、政策宝典旁的「地址配置」填写页面地址。停用本插件的配置项会移除这两个入口。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

可见性与地址通过 `wanweiNetwork` 读取 `/api/desktop-config`。打开面板时关闭侧栏，并调用已有的 `maximize_expert_window` 原生命令。注册时使用 `headerChrome: 'back-only'`，去掉 WANWEI Buddy / 标题 / 副标题，仅浮层返回按钮。内容使用 iframe，以便展示管理员配置的任意 http(s) 地址，无需专家票据。`PortalPage` 在 iframe 的 `load` 事件触发前用全屏加载层盖住页面；配置地址变更时重新显示加载层。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [功能面板](../feature-panels/README.zh.md)
- [OneAPI 鉴权](../oneapi-auth/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

本包不注册面向模型的提示词、工具或会话事件。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 拒绝 iframe 嵌入的站点会显示空白；本包不会为此改用原生子 webview 或外部浏览器。
- 最大化复用专家窗口原生命令；缺少该命令的旧桌面版本会保持当前窗口尺寸。

-----

<a id="dev-note"></a>
## 开发备注

针对性 Client 覆盖见 `tests/portals.client.spec.tsx`。
