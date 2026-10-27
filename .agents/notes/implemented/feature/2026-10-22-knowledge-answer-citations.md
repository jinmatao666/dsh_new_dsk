# Agent Note: Knowledge-answer citations locate through RAGFlow chunk positions

Status: implemented

English | [中文](2026-10-22-knowledge-answer-citations.zh.md)

## Problem

Desktop knowledge Q&A returned plain answers without clickable sources. Users could not jump from a claim to the PDF region RAGFlow retrieved.

## Decision

After each completion, OneAPI parses RAGFlow `reference` chunks into `citations` (`document_id`, quote, optional `page`, `positions` as `[page, left, right, top, bottom]`). Only chunks cited by answer markers are returned. The assistant prompt asks for `##i$$` and one marker per index; the parser and desktop also accept RAGFlow `[ID:i]` (0-based chunk index). Streaming sends citations only on the final SSE event. The desktop replaces those markers with blue numbered controls inline in the answer, keeping only the first control per citation index when the model repeats the same marker; it does not append a separate source list. Click opens the document. Only PDF and Word citations render locate controls. PDFs render with pdf.js (not an iframe): prefer a text-layer box from the citation quote, else RAGFlow boxes scaled from page-image / 0–1000 / unit space onto `page.getViewport({ scale: 1 })` and clamped to the page, else scroll to the page with a mid-page fallback highlight. Mapping is by RAGFlow document id inside the current library—there is no separate local policy index.

## Alternatives considered

**Iframe PDF preview:** rejected because it cannot draw highlight overlays or drive page locate reliably.

**Local full-text index for locate:** rejected; coordinates already arrive from RAGFlow chunks, with quote search only as a fallback.

**Paint every repeated `##i$$` as its own control:** rejected; models often stamp the same index on every list item, which crowded the answer without extra locate targets.

**Always prefer raw RAGFlow boxes over quote search:** rejected; DeepDoc positions are often in a larger page-image pixel space than pdf.js points, so unscaled boxes miss the text and overflow the page.

## Consequences

Existing RAGFlow chat assistants keep their old prompt until recreated or updated; `UpdateChat` on conversation ensure also raises `max_tokens`/`max_token` to 4096 (via both `llm` and `llm_setting`) so long numbered lists are not cut mid-item by the 512 default, and refreshes the completeness rule so overview-plus-list knowledge is not answered with only the first sentence. New and recovered chats get the one-marker-per-index instruction. Client-side first-hit dedupe still applies to answers that repeat markers. Preview asks put the user question first for retrieval. Client bundles `pdfjs-dist` into the knowledge-base plugin with a main-thread worker host.
