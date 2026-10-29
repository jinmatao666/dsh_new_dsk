# Agent Note: Knowledge Q&A parsing tip and brand label

Status: implemented

English | [中文](2026-10-29-knowledge-qa-parsing-brand.zh.md)

## Problem

Asking a knowledge library while a just-uploaded file is still chunking surfaced a backend error instead of a product answer. The assistant brand next to the logo in desktop Q&A and preview Q&A still read 万维.

## Decision

Before RAGFlow completion, OneAPI checks document run status. A targeted `document_id` that is still waiting or running returns HTTP 200 with answer `文件正在解析，请稍后重试` (stream or non-stream). Without a document id, the same tip applies only when the library has files, none are ready, and at least one is still parsing. Lookup failures log and fall through to the existing completion path. The brand label beside `/brand-mark.svg` in both Q&A panes is `万维Buddy`. Related-question trailing marks stay owned by [knowledge answer timing and related questions](2026-10-29-knowledge-answer-timing-related.md).

## Alternatives considered

Mapping RAGFlow error strings after a failed completion — rejected as primary path; status is knowable from document metadata before the call. Changing every product string that contains 万维 — rejected; only the logo-adjacent Q&A brand was requested.

## Consequences

Users see a finished assistant turn with the parsing tip instead of a failed request when files are not chunked yet. Failed or cancelled documents are not treated as parsing. Greeting and “问问万维” copy are unchanged.

## Required verification

Upload a file, ask before parsing finishes, and confirm the tip answer without an error toast. Confirm Q&A and preview Q&A show 万维Buddy beside the logo.
