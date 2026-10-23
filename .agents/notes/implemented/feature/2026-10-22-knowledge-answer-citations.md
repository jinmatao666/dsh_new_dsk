# Agent Note: Knowledge-answer citations locate through RAGFlow chunk positions

Status: implemented

English | [中文](2026-10-22-knowledge-answer-citations.zh.md)

## Problem

Desktop knowledge Q&A returned plain answers without clickable sources. Users could not jump from a claim to the PDF region RAGFlow retrieved.

## Decision

After each completion, OneAPI parses RAGFlow `reference` chunks into `citations` (`document_id`, quote, optional `page`, `positions` as `[page, left, right, top, bottom]`). Only chunks cited by answer markers are returned. The assistant prompt asks for `##i$$`; the parser and desktop also accept RAGFlow `[ID:i]` (0-based chunk index). Streaming sends citations only on the final SSE event. The desktop replaces those markers with blue numbered controls inline in the answer; it does not append a separate source list. Click opens the document. PDFs render with pdf.js (not an iframe): prefer RAGFlow boxes normalized against `page.getViewport({ scale: 1 })`, else search the text layer with the quote, else scroll to the page with a mid-page fallback highlight. Mapping is by RAGFlow document id inside the current library—there is no separate local policy index.

## Alternatives considered

**Iframe PDF preview:** rejected because it cannot draw highlight overlays or drive page locate reliably.

**Local full-text index for locate:** rejected; coordinates already arrive from RAGFlow chunks, with quote search only as a fallback.

## Consequences

Existing RAGFlow chat assistants keep their old prompt until recreated or updated; new and recovered chats get citation markers. Client bundles `pdfjs-dist` into the knowledge-base plugin with `disableWorker: true`.
