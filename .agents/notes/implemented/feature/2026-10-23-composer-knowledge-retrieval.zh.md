# Agent Note：输入框知识库检索把 RAGFlow 切片交给会话模型作答

Status: implemented

[English](2026-10-23-composer-knowledge-retrieval.md) | 中文

## Problem

桌面用户只能在知识库页面基于知识库提问，由 RAGFlow 聊天助手生成回答。普通会话无法使用知识库内容，一个问题也无法同时使用多个知识库。

## Decision

`dsh-wanwei-knowledge-base` 在 `conversation.composer.tools` 注册输入框工具行上的「知识库」开关。开启后弹出选择面板，分组来自与桌面侧栏相同的 `libraryNavGroups` 函数，因此面板展示的知识库类型始终与侧栏一致。用户可跨分组最多选择 20 个知识库。当前会话的所选编号通过 `/desktop-knowledge-base` 的 `retrieval-scope` 操作发送到 Host；首次发送新建会话时由暂存会话转交逻辑应用到新会话。关闭开关会隐藏选择面板并发送空范围。

`dsh-wanwei-oneapi-auth` 在 Host 内存中按会话编号保存范围，并注册 `agent/pre-step` 监听。在设置了范围的会话中，轮次第 1 步取最新一条 `user` 来源消息的文本，调用 OneAPI `POST /api/knowledge-bases/retrieval`，并追加一条来自 `wanwei-knowledge-retrieval` 的 `notice` 用户消息，内容为包含摘录、文件名和知识库名的 JSON 记录，检索结果带文件标识时还包含需授权的原文件路径。OneAPI 用 `GetAuthorizedKnowledgeBase` 校验每个知识库，以映射后的数据集编号调用 RAGFlow `POST /api/v1/retrieval`，并丢弃不属于所请求数据集的切片。回答由会话自身的模型生成。无结果和检索失败都会记录为简短说明，便于模型告知用户，轮次继续执行。

会话界面从该日志消息派生轮次内的文件链接，也识别书名号内的普通文件名。点击文件名会在当前会话上方打开 PDF 弹框。引用提示把实际使用的文件集中到开头的来源和结尾的引用文件。此前检索过资料的会话在关闭检索后，会记录提示要求模型回答时不沿用此前的库内资料。

## Alternatives considered

**通过 RAGFlow 聊天助手作答：** 拒绝，因为回答会绕过会话模型及其工具和历史，而且每个助手只绑定一个数据集。

**在浏览器中把切片拼到用户消息前面：** 拒绝，因为用户消息将不再是用户输入的内容，而且 Client 需要一个并不存在的提交拦截点。

**把范围记录为持久会话事件：** 拒绝，因为范围是界面选择，开关会在每次切换会话时重新发送；模型真正看到的检索切片已记入日志。

**依赖模型生成 Markdown 链接：** 拒绝，因为模型可能只输出普通文件名。日志中的检索文件标识让会话界面能把文件名解析为实际原件。

**打开知识库面板查看原件：** 拒绝，因为这会让用户离开回答。会话内弹框使用户关闭原件后仍能继续查看回答。

## Consequences

Host 重启后范围会丢失；输入框为当前会话挂载时开关会重新发送范围。检索会增加每个设置了范围的轮次第一步的延迟，上限为 `knowledgeRetrievalTimeoutMs`。OneAPI 构建必须与桌面构建一起发布 `POST /api/knowledge-bases/retrieval`。知识库页面中独立的问答路径见[知识库问答引用](2026-10-22-knowledge-answer-citations.zh.md)。

源码启动会先重建共享 UI 原语，再构建 Web 前端以及会话和知识库客户端包。仅重建插件会使平台预置的 Markdown 渲染组件继续使用旧产物。检索测试覆盖清空范围与记录文件路径。会话测试覆盖文件名链接和轮次内来源投影。预览测试覆盖原件弹框的打开与关闭。
