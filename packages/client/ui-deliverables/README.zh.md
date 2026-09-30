---
description: "Web GUI 的产出文件与可点击文件引用：已完成轮次末尾的产出文件行，以及收尾正文中的行内代码链接；供产出物体验的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deliverables

[English](README.md) | 中文

## 概述

本包在已完成轮次末尾列出最终交付物，并打开收尾正文中引用的已记录文件。成功的修改调用和可识别的工具结果提供真实路径；收尾引用只选择交付顺序，不凭空创建路径。中间文件保留在工作区和执行历史中，但不挤占最终交付物列表。正式提供的 Web patch 加载本包；删除其 cordis.yml 条目会同时移除指引、文件行与正文链接。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与 `ui-conversation` 一起挂载本插件；已完成轮次随即以产出文件行收尾，位于收尾消息正文与其动作页脚之间。每个标签项经 Host 打开器打开文件，相对路径按会话 cwd 解析；该行首次显示时会查询 `session.canOpenWorkspacePath()`，只有页面为 loopback 且查询成功返回 `true` 时，**在文件夹中显示**动作才会打开会话工作区。

### 该行

该行展示能放下的最大前缀——至多六个标签项，文本为文件名、完整路径作为 `title`——并为本地化后的精确 `+ N 个文件` 宽度预留空间，因此剩余计数始终可见，既不换行也不横向滚动。

收尾回复通过 Markdown 链接或行内代码引用的已记录文件按引用顺序展示。没有可解析的引用时，DOCX、XLSX、PPTX 和 PDF 输出优先于其他变更文件；没有这些文档时，其他已记录文件仍可展示。`_draft.txt`、临时目录和中间文件目录等已知过程路径从列表中排除，但不会删除。显式引用可以交付 Markdown 或源码文件；有歧义的文件名和未记录的路径不会创建条目。正文链接仍可以访问完整的已记录路径列表。

### 行内代码链接

URI 形式的本地引用只有在解码后的完整路径精确匹配已记录成果时才会解析。解析器不根据 URI 的标签或文件名猜测；行内代码中有歧义的文件名仍保持不可点击。

收尾正文承载同一份词表：行内代码 token 按精确路径解析，或当它恰好等于某条产出路径的 basename 且该路径唯一时解析——两条路径共享同一 basename 时保持惰性而不猜测，因此提及绝不打开错误的文件。解析成功的提及保留代码标签，并采用 Markdown 样式表的链接样式，完整路径作为其 `title`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Node 半部注册静态 `ui:deliverable-file-references` 系统提示词段，要求模型点名成功创建或修改的主要文件，并把这些文件以及正文中提到的其他本轮变更文件写成 Markdown 行内代码。浏览器半部把 `ProducedFiles` 注册进 chat 视图的 `conversation.chat.turnTail` 洞。`deliverablesDefinition` 根据 `write`、`edit` 和有修改作用的 `str_replace_editor` 命令中经过校验的原始参数，把每个轮次成功的第一方修改调用折叠进 `DeliverablesTurnData`。读取、删除、不受支持的工具、格式错误的调用和失败结果不贡献任何条目。新的修改工具必须增加显式 Client contribution 才能加入列表。本包还提供 chat 视图按收尾消息查询的 `chatFileMentions` 服务；把插件组合出去会同时移除两个表面，视图的空链以零成本留下。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当产出物面不够用时阅读以下页面。它们从该行进入 turn-tail 洞与词表背后的决策。

- [ui-conversation](../ui-conversation/README.zh.md)——声明 `conversation.chat.turnTail` 洞并渲染收尾正文。
- [工作区文件链接](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.zh.md)——产出文件行与宿主打开路径背后的决策。
- [行内文件提及](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.zh.md)——收尾正文可点击提及背后的决策。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

### 可点击文件引用指引

#### 模型看到的内容

一段固定提示词要求模型在最终回复中点名成功创建或修改的主要文件，并将这些文件以及正文中提到的其他本轮变更文件写成采用精确路径或唯一 basename 的 Markdown 行内代码，例如 `out/report.html`。

#### Token 影响

加载本包时增加一段固定提示词；不增加工具 schema、工具结果或按轮次变化的上下文。

#### KV Cache 影响

该段落在本包挂载期间始终以 first-party 顺序 9000 保持静态，因此留在可复用的提示词前缀中，不会随轮次改变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前产出物词表。它们是当前包约束，不是通用文件链接对比或任务积压。

- **提及匹配只认精确路径或唯一 basename**——后缀式提及保持惰性；等真实的收尾消息形态产生需求后再放宽匹配规则。
- **终端输出识别范围有限**——只有可识别的成功输出路径或已注册的运行结果解析器才能提供文件；仅在回复中点名未记录的文件，不能让它成为交付物。
- **原生文件夹交接以 Host 桌面为目标**——经非 loopback authority 访问的浏览器会省略该动作，报告没有原生打开器的部署也一样；若 SSH 转发让远端 Host 看似 loopback 本地，部署必须为 Session Controller 设置 `nativeOpen: false`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
