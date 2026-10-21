# Agent Note：服务端托管的 RAGFlow 知识库

状态：已实现

[English](2026-10-21-ragflow-knowledge-library.md) | 中文

## 问题

桌面用户需要带部门权限的个人及共享资料库，并为检索对话提供隔离状态。把 RAGFlow 凭据发送到浏览器会使用户绕过 OneAPI 授权；复用同一个 RAGFlow 聊天助手则会让知识库或模型切换影响无关对话。

## 决策

OneAPI 存储知识库、用户或部门授权以及对话映射。`RAGFLOW_BASE_URL` 和 `RAGFLOW_API_KEY` 只保存在服务端环境中，由 OneAPI 代理数据集、文档、聊天助手、会话、回答和相关问题操作。桌面列表和文档操作在访问 RAGFlow 前按当前用户校验授权：个人知识库仅所有者可见，共享知识库需所有权或用户/部门授权，已上架共性知识库对全体用户可见，已下架知识库保持隐藏。管理员在桌面列表与管理工作台接口均可看到全部知识库。

万维桌面通过产品 Bundle 挂载独立的知识库 Client 插件。侧栏入口与自动化和连接器共用按网络环境配置的管理员开关。桌面问答对当前选中知识库调用 `POST /api/knowledge-bases/:id/chat/completions`。OneAPI 校验该库授权后，按用户与知识库复用或创建隔离的 RAGFlow 助手与会话，再返回回答和相关问题。打开知识库时通过 `GET /api/knowledge-bases/:id/chat/messages` 读取已映射的 RAGFlow 会话，并返回纯文本的用户与助手消息。

回答使用纯文本：RAGFlow 助手提示词禁止 Markdown 排版，OneAPI 在返回前再剥离残留 Markdown。流式问答对该完成接口使用 `stream: true`；Host 暴露 `POST /api/desktop-knowledge-chat`，桌面按累计片段渲染回答，而不是等整段一次性出现。

## 考虑过的替代方案

**浏览器直接调用 RAGFlow：**不采用，因为这会暴露部署 API Key，并绕过本地用户和部门授权。

**每个知识库复用一个聊天助手：**不采用，因为模型切换和 `@` 知识库选择会改变其他用户的活动对话。

**仅在一元回答到达后做客户端打字机：**不采用，因为令牌仍只在结束时到达；渐进展示需要经 Host 鉴权代理的 RAGFlow SSE。

## 后果

OneAPI 与桌面插件需要配套部署。RAGFlow 创建失败不会产生本地知识库记录；本地创建失败会补偿删除远端数据集。桌面页面支持创建、列表、文档上传、选中高亮、在个人/共享知识库之间移动与复制、经 RAGFlow 同步的删除、基于切片的文档预览、原文件下载、带历史恢复的隔离问答和相关问题。本地文件夹上传仍把嵌套文件逐个写入当前知识库；OneAPI 转发 RAGFlow `parent_path`，在 RAGFlow 接受时把文档名改成相对路径，并额外把该路径写入本地 `KnowledgeDocumentPath` 表（因为 RAGFlow 列表常只返回文件名）。文档列表会把这些行合并进 `location`，内容区据此渲染可展开的文件夹树。移动与复制先下载源文件再上传到已授权目标数据集（同名时可保留全部或替换），移动再通过 RAGFlow `DELETE /api/v1/datasets/{datasetId}/documents` 删除源文件。上传成功后，OneAPI 立即返回文档元数据，并异步调用 RAGFlow `POST /api/v1/datasets/{datasetId}/chunks`（携带新文件的 `document_ids`），使切片在不阻塞客户端的情况下启动。管理工作台 `/knowledge` 管理共性、共享和个人知识库的标签、文件清单、上传、通过 RAGFlow 分页 List chunks 接口浏览全部切片、手动重新切片、摘要、下载和删除，并展示所有者以便管理员定位用户创建的知识库；授权编辑仍由管理接口负责。上下架可见性仍由服务端过滤桌面目录，管理工作台 UI 不再切换。
