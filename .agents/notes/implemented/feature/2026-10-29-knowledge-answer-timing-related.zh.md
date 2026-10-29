# Agent Note: 知识库回答耗时与关联问题

Status: implemented

[English](2026-10-29-knowledge-answer-timing-related.md) | 中文

## Problem

桌面端知识库问答结束后，未展示本轮开始/结束时间与耗时，也未固定展示回答下方的关联追问。

## Decision

在知识库页为每条助手回复记录 `startedAt` / `endedAt`，完成作答后渲染一行耗时文案；关联问题去重后最多保留三条，文案为「推荐关联问题」，末尾无 `?` / `？` 时补 `？`。桌面端与 OneAPI 推荐结果均做同样处理。OneAPI `Recommend` 按序尝试 `/api/v1/sessions/related_questions`、`/api/v1/chat/recommendation`、旧拼写 `/api/v1/chat/recommandation`：当前部署仍只提供 sessions 路径，原先单独打的错误拼写 chat 路径返回 NotFound，推荐为空，界面不渲染。

## Alternatives considered

把耗时写入 RAGFlow 会话历史 — 否决：本次产品需求不要求历史回放带墙钟时间，且会话存储归属 RAGFlow。只调用 `/api/v1/chat/recommendation` — 否决：在各部署弃用 sessions 路径之前仍需兼容。

## Consequences

当前会话的回答会显示耗时与最多三条带问号的关联问题；从 RAGFlow 重新加载的历史仍无耗时字段。某条 Recommend 路由缺失时，只要旧别名仍可用，就不会再静默清空尾部推荐。

## Required verification

在桌面知识库面板提问一次，确认完成回答后出现耗时行，以及至多三个末尾带问号的关联问题按钮。
