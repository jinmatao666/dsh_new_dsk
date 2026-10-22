# Agent Note：知识库问答引用通过 RAGFlow 切块坐标定位

Status: implemented

[English](2026-10-22-knowledge-answer-citations.md) | 中文

## Problem

桌面知识库问答只返回纯文本，没有可点击来源，用户无法从结论跳到 RAGFlow 检索到的 PDF 区域。

## Decision

每次补全结束后，OneAPI 解析 RAGFlow `reference` 切块为 `citations`（含 `document_id`、摘录、可选 `page`、以及 `[page, left, right, top, bottom]` 的 `positions`）。只返回答案标注命中的切块。助手提示词要求使用 `##i$$`；解析与桌面端同时接受 RAGFlow 的 `[ID:i]`（切块从 0 起算）。流式仅在最终 SSE 事件携带 citations。拉取历史时按同样规则读取每条助手消息上保存的 RAGFlow `reference`，与纯文本内容一并返回 `citations`，刷新后仍可定位。桌面端把标注换成答案内的蓝色 `【n】`，不在文末另加来源列表；点击打开文档。PDF 用 pdf.js 渲染（不用 iframe）：优先按 RAGFlow 框相对 `page.getViewport({ scale: 1 })` 归一化高亮，否则用摘录在文本层搜索，再否则滚到目标页并画页中部兜底框。定位按当前库内 RAGFlow 文档 id 匹配，不依赖本地政策全文索引。

## Alternatives considered

**iframe 预览 PDF：** 拒绝，难以叠高亮与可靠翻页定位。

**本地全文索引定位：** 拒绝；坐标已由 RAGFlow 切块提供，摘录搜索只作兜底。

## Consequences

已有 RAGFlow 助手会保留旧提示词，直到重建或更新；新建与恢复的对话才会带引用标注。客户端将 `pdfjs-dist` 打进知识库插件，并使用 `disableWorker: true`。
