# Agent Note: Defer knowledge asks until RAGFlow has chunks

Status: implemented

English | [中文](2026-10-29-knowledge-ask-before-ragflow-chat.zh.md)

## Problem

Plaza and library Q&A call `ensureKnowledgeConversation` before any parse-status check. RAGFlow `CreateChat` and `UpdateChat` reject a dataset when `chunk_num == 0` with `The dataset … doesn't own parsed file`. Subscribers then see `对话失败` with that English gateway message even when the content tree lists files that are still parsing, failed, or finished with zero chunks. The existing tip path in `answerKnowledgeConversation` never ran for a first ask because chat creation already failed.

## Decision

`knowledgeAskDeferralFor` runs before `ensureKnowledgeConversation` on `POST /api/knowledge-bases/:id/chat/completions` and again inside `answerKnowledgeConversation`. Still-parsing targets keep the tip `文件正在解析，请稍后重试`. Targets with no retrieval chunks return `知识库尚无可检索内容，请等待文件解析完成后再试` as a normal answer. `mapRagflowMessage` and `NoParsedFiles` map the RAGFlow string for create/update races. `DocumentHasChunks` is the chunk gate; run status alone is not enough.

## Alternatives considered

**Only map the English error on 502 responses.** The desktop still treats the turn as `对话失败` instead of an in-pane tip, and create still fails before any tip path.

**Treat DONE with zero chunks as ready.** That matches finish state but not RAGFlow's create/update rule, so the gateway error remains.

## Consequences

Asks against empty or unparsed libraries no longer create RAGFlow assistants. Operators must finish parse (or re-parse failed files) in the workbench before Q&A works. Mapped create/update failures remain a race fallback only.

## Testing

Go tests cover `knowledgeAskDeferralFor` for parsing, ready-with-chunks, and DONE/FAIL with zero chunks, plus `NoParsedFiles` / `mapRagflowMessage` on the dataset error string.
