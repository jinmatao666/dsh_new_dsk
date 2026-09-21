# Agent Note: Meeting minutes use a dedicated Word layout

Status: implemented

English | [中文](2026-09-20-meeting-minutes-word-layout.zh.md)

## Problem

The meeting-minutes skill rendered its final document with the generic Markdown-to-Word formatter. The content was complete, but the Letter page size, uniform table widths, literal bullet characters, and generic heading spacing made long minutes difficult to scan and produced an especially dense action-item table.

## Decision

The meeting-minutes skill applies a meeting-specific formatting pass after the shared Markdown renderer creates the DOCX. The pass preserves the generated text and changes only presentation: A4 portrait pages, a centered meeting subtitle, black heading hierarchy, native list paragraphs, restrained table shading, content-specific column widths, repeating table headers, and compact page numbering. Other office skills continue to use the generic renderer without this formatting pass.

## Alternatives considered

**Change the shared Markdown renderer** — rejected because document summaries and comparison reports have different layout needs, and meeting-specific table widths would degrade those outputs.

**Encode all formatting in the model prompt** — rejected because a language model can control Markdown structure but cannot reliably set DOCX page geometry, table widths, cell padding, or repeating headers.

## Consequences

Meeting minutes have a stable formal layout while retaining the same factual content and output file type. The skill owns a small DOCX post-processing function, and future meeting-specific formatting changes remain isolated from the shared office renderer.
