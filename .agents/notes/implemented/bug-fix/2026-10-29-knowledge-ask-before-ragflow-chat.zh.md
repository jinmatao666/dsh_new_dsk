# Agent Note: 在 RAGFlow 有切片后再发起知识问答

Status: implemented

[English](2026-10-29-knowledge-ask-before-ragflow-chat.md) | 中文

## Problem

广场与知识库问答会在任何解析状态检查之前调用 `ensureKnowledgeConversation`。RAGFlow 的 `CreateChat` / `UpdateChat` 在数据集 `chunk_num == 0` 时拒绝，并返回 `The dataset … doesn't own parsed file`。订阅者因此看到带该英文网关文案的「对话失败」，即便内容树已列出仍在解析、解析失败或完成但切片为零的文件。`answerKnowledgeConversation` 里原有的提示路径在首次提问时走不到，因为助手创建已经失败。

## Decision

`knowledgeAskDeferralFor` 在 `POST /api/knowledge-bases/:id/chat/completions` 的 `ensureKnowledgeConversation` 之前执行，并在 `answerKnowledgeConversation` 内再次执行。仍在解析的目标继续返回「文件正在解析，请稍后重试」。尚无检索切片的目标以正常回答返回「知识库尚无可检索内容，请等待文件解析完成后再试」。`mapRagflowMessage` 与 `NoParsedFiles` 映射该 RAGFlow 文案，供创建/更新竞态回退。`DocumentHasChunks` 是切片门槛；仅凭 run 状态不够。

## Alternatives considered

**仅在 502 上映射英文错误。** 桌面仍把该轮当作「对话失败」而非页内提示，且创建仍会先失败。

**把切片为零的 DONE 当作可问。** 这符合完成态，但不符合 RAGFlow 的创建/更新规则，网关错误依旧。

## Consequences

空库或未解析库的提问不再创建 RAGFlow 助手。运维须在管理工作台完成解析（或对失败文件重新解析）后问答才能成功。映射后的创建/更新失败仅作竞态回退。

## Testing

Go 测试覆盖解析中、已有切片、以及 DONE/FAIL 且切片为零时的 `knowledgeAskDeferralFor`，以及该 dataset 错误串上的 `NoParsedFiles` / `mapRagflowMessage`。
