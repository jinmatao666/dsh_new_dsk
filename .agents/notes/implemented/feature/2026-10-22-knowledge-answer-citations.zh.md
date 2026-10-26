# Agent Note：知识库问答引用通过 RAGFlow 切块坐标定位

Status: implemented

[English](2026-10-22-knowledge-answer-citations.md) | 中文

## Problem

桌面知识库问答只返回纯文本，没有可点击来源，用户无法从结论跳到 RAGFlow 检索到的 PDF 区域。

## Decision

每次补全结束后，OneAPI 解析 RAGFlow `reference` 切块为 `citations`（含 `document_id`、摘录、可选 `page`、以及 `[page, left, right, top, bottom]` 的 `positions`）。只返回答案标注命中的切块。助手提示词要求使用 `##i$$` 且同一序号只标一次；解析与桌面端同时接受 RAGFlow 的 `[ID:i]`（切块从 0 起算）。流式仅在最终 SSE 事件携带 citations。桌面端把标注换成答案内的蓝色序号，同一引用序号只保留首次控件（模型重复标注时仍剥离后续标记）；不在文末另加来源列表；点击打开文档。仅 PDF 与 Word 显示定位控件。PDF 用 pdf.js 渲染（不用 iframe）：优先用摘录在文本层取框，否则将 RAGFlow 框从页图／0–1000／单位空间缩放到 `page.getViewport({ scale: 1 })` 并裁到页内，再否则滚到目标页并画页中部兜底框。定位按当前库内 RAGFlow 文档 id 匹配，不依赖本地政策全文索引。

## Alternatives considered

**iframe 预览 PDF：** 拒绝，难以叠高亮与可靠翻页定位。

**本地全文索引定位：** 拒绝；坐标已由 RAGFlow 切块提供，摘录搜索只作兜底。

**每个重复的 `##i$$` 都画成控件：** 拒绝；模型常在每条列举后重复同一序号，答案会被挤满且没有新的定位目标。

**始终优先原始 RAGFlow 框、摘录搜索只作兜底：** 拒绝；DeepDoc 坐标常在大于 pdf.js 点阵的页图像素空间，未缩放时会偏出正文并溢出页面。

## Consequences

已有 RAGFlow 助手会保留旧提示词，直到重建或更新；会话 ensure 时的 `UpdateChat` 也会把 `max_tokens`／`max_token` 提到 4096（同时写 `llm` 与 `llm_setting`），避免长编号列表被默认 512 截断在条目中间，并刷新「须完整作答」规则，避免知识里有总述加分项时只答首句。新建与恢复的对话才会带「同一序号只标一次」的说明。客户端仍会对重复标注做首次去重。预览提问把用户问题放在前面以便检索。客户端将 `pdfjs-dist` 打进知识库插件，并在主线程挂载 worker API。
