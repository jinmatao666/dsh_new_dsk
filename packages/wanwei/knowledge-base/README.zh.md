---
description: "在万维桌面管理已授权的 RAGFlow 数据集、文档和隔离知识对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-wanwei-knowledge-base

[English](README.md) | 中文

## 概述

此 Client 插件增加由管理员控制的知识库入口。OneAPI 负责授权、本地记录和 RAGFlow 凭据；浏览器仅接收当前用户已授权的知识库元数据、文档元数据、解析预览文本、可下载文件字节、已保存的问答记录和回答。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

在 `dsh-wanwei-oneapi-auth` 和 `dsh-wanwei-feature-panels` 后挂载此插件。在 OneAPI 服务端配置 `RAGFLOW_BASE_URL` 和 `RAGFLOW_API_KEY`。每个新对话创建隔离的 RAGFlow 聊天助手和会话。

个人知识库仅对所有者可见。共享知识库对所有者以及 OneAPI 中获得用户或部门授权的成员可见。已上架的共性知识库对全体用户可见（桌面「订阅知识库」）。管理员可在管理工作台和桌面看到全部知识库。单文件上传上限为 1 GiB（界面显示为 1GB）。桌面按顺序将 1 MiB 分片写入本机私有临时存储；Host 转发文件时不生成完整文件的 JSON 数组。错误在知识库页面内显示。

<a id="model-experience"></a>
## 模型体验

### 浏览器发起的知识对话

#### 模型看到的内容

RAGFlow 接收所选数据集、用户的 `question` 和该对话的 RAGFlow 历史。Harness Agent Loop 不接收这些内容。

#### Token 影响

Token 使用由 RAGFlow 聊天助手及其配置模型负责。

#### KV Cache 影响

每个知识对话拥有独立的 RAGFlow 聊天助手和会话，因此缓存不会跨对话复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 上传被接受不代表支持内容解析；本包没有实现 MDB 解析。RAGFlow 和反向代理的上传限制也必须允许对应文件大小。原文件预览、下载及跨库复制/移动仍保留独立的 20 MiB 限制。上传需要本机临时磁盘空间；中断的上传按认证插件的 `knowledgeUploadIdleTimeoutMs` 配置过期清理。
- 创建对话框尚未提供用户及部门授权编辑；数据库和 API 已接受管理流程写入的授权记录。
- 上传成功后由服务端异步启动 RAGFlow 解析；桌面页面不提供手动重新切片。选中内容会高亮行背景；右键菜单仅保留移动、复制和删除。移动与复制只能选择个人或共享知识库，并由 OneAPI 同步（先下载再上传，移动时再调用 RAGFlow 删除源文件）。删除会调用 RAGFlow 文档删除接口。双击打开预览：图片和 PDF 使用原文件 blob，纯文本使用下载字节，其他类型回退到 RAGFlow 切片文本。
- 内容菜单可以把本地文件和本地文件夹上传到当前知识库。文件夹上传会遍历文件入库，并通过相对路径在内容列表中按文件夹树展示；网页链接、笔记、腾讯文档、录音纪要、从个人知识库导入和新建空文件夹会显示，但尚未接入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
