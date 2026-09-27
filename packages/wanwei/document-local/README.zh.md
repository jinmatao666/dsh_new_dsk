---
description: "万维桌面端自有的本地办公文档文本提取工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-document-local

[English](README.md) | 中文

## 概述

桌面端注册 `extract_document`，通过打包的 Node 辅助程序提取本地 PDF、DOCX 和 XLSX 文本。此产品工具不修改官方 DSH 文档组件。

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

通过万维桌面 Bundle 和 `tools` Service 挂载此包。`helperPath` 与 `nodeBinary` 可指定打包后的辅助程序和可执行文件；部署时可用 `DSH_DOCUMENT_TOOL` 与 `DSH_NODE_BINARY` 覆盖。普通默认值是产品脚本 `products/wanwei-desktop/scripts/document-tool.mjs` 和当前 Node 可执行文件。

-----

<a id="understand-the-implementation"></a>
## 实现方式

<details>
<summary>实现细节——点击展开</summary>

[`src/index.ts`](src/index.ts) 在 Windows 上隐藏辅助进程控制台，并读取其 JSON 响应。没有可提取文字的扫描 PDF 返回 `needs_vision`，其他解析失败返回 `unavailable`。文档格式的实际处理属于辅助程序。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [产品文档辅助程序](../../../products/wanwei-desktop/scripts/document-tool.mjs)——解析实现。
- [万维 Bundle](../../bundle/wanwei-desktop/README.zh.md)——产品组装。

-----

<a id="model-experience"></a>
## 模型体验

### 本地文档解析

#### 模型看到的内容

`extract_document` 工具结果渲染含状态、路径、消息、提取文本和警告的 `<document>` 块。`needs_vision` 明确表示不能臆造扫描件内容。

#### Token 影响

辅助程序本身不调用模型。返回给 Agent 的提取文本会占用后续模型上下文 token；可用 `max_chars` 限制长度。

#### KV Cache 影响

不同的提取文本会改变后续提示词，可能使下游缓存无法复用。此包没有独立缓存。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只提取文本**——扫描 PDF 需要配置视觉/OCR 能力；提取本身不验证语义或版式。
- **依赖打包辅助程序**——找不到辅助程序时工具调用报错，不会静默安装依赖。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护背景——点击展开</summary>

本地文档行为应留在此产品包及其产品辅助程序中，不应进入官方 DSH UI 包。

</details>
