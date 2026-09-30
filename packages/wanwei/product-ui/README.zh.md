---
description: "万维自有的桌面品牌、主题、文件导入和成果展示层。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-product-ui

[English](README.md) | 中文

## 概述

此客户端插件负责万维品牌、主题覆盖、桌面文件导入入口和空间分析成果展示。它通过通用 DSH Slot 与 Service 注册，不把产品行为写入官方 UI 包。

## 目录

- [使用此包](#use-this-package)
- [实现方式](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

通过万维桌面 Bundle 挂载，顺序在客户端平台操作注册表及官方会话、成果、渲染、侧边栏插件之后。产品主题来自 `src/client/theme.css`；通用官方 DSH 网页应用不挂载它。

-----

品牌组件使用 -100 优先级注册，与默认优先级的官方品牌插件共存。

文件选择与原生拖入通过 `inputActions.appendReferences` 追加文件或目录标签；标签显示名称，序列化保留路径引用。导入不会覆盖现有文字和引用。原生拖入进度在导入期间持续显示；完成提示三秒后消失，失败提示六秒后消失。新一次导入会重置提示计时。

原生拖入提示只覆盖对话输入框。文件夹标签用文件夹图标区分，不再显示仅用于路径表示的末尾斜杠；序列化引用仍保留斜杠。工作区已有同名目标时，桌面端复制到带序号的新位置，标签显示实际目标名称。

会话归档保存等待原生持久化完成，再请求文件管理器定位实际保存路径。打开目录失败时保留保存路径并返回警告，不报告下载失败。

技能成果识别接受产品结果标记及明确的分析视图、Word、Excel 路径标记，不按空格或中文文件名拆分。报告非零 shell 退出码的输出不贡献产品成果。声明路径不代表文件一定存在；打开时仍使用工作区文件服务。

<a id="understand-the-implementation"></a>
## 实现方式

<details>
<summary>实现细节——点击展开</summary>

[`src/client/product.tsx`](src/client/product.tsx) 提供品牌标记 Slot、文件导入操作与产品成果解析。[`src/client/AnalysisResultCard.tsx`](src/client/AnalysisResultCard.tsx) 渲染空间分析结果。原生文件操作依赖产品桌面桥，不由通用平台操作 Service 实现。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [产品 Bundle](../../bundle/wanwei-desktop/README.zh.md)——组装顺序。
- [通用平台操作](../../client/platform-actions/README.zh.md)——外壳操作契约。

-----

<a id="model-experience"></a>
## 模型体验

### 产品展示

#### 模型看到的内容

`WANWEI_RESULT=` 标记只用于 UI 成果展示解析；渲染不会另添模型消息。经会话输入框写入的导入文件路径会成为用户下一次请求的一部分。

#### Token 影响

品牌与成果卡片渲染不消耗模型 token。用户随后提及导入文件的请求按普通 DSH 规则计费和统计。

#### KV Cache 影响

纯 UI 展示不改变缓存键。导入文件后改变的用户请求可能改变提示词及其下游缓存行为。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **依赖桌面桥**——文件导入与成果文件操作需要万维原生外壳；纯浏览器 DSH 不具备这些能力。
- **成果协议归属**——`WANWEI_RESULT=` 属于万维产品标记，不是官方 DSH 文档格式。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护背景——点击展开</summary>

产品选择器和标记解析应留在此包；官方 UI 包只能暴露通用 Slot 或 Service。

</details>
