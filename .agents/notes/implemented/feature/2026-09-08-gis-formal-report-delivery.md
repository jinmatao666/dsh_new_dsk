# Agent Note: GIS formal report delivery

Status: implemented

English | [中文](2026-09-08-gis-formal-report-delivery.zh.md)

## Problem

The three GIS Skills exported Word files by copying their Markdown working draft into the report body. Raw coordinate-system WKT, property-field codes, source paths, Markdown emphasis markers, and original API links made the result difficult to read as a professional report.

## Decision

Each GIS Skill produces the same formal Word body: project and data overview, core analysis conclusions, professional assessment, implementation recommendations and conclusions, then data sources and use limitations. The overview is a compact table limited to data type, feature count, project area when available, and a readable coordinate-system description. The report body excludes raw source paths, complete WKT, property-field codes, and original response links. Those details remain available in the JSON and Excel deliverables for traceability.

The Skills retain their different result tables and domain-specific analysis text. Their sample package versions are `1.4.6`, so existing desktop installations can recognize the report-layout update after administrators publish the release.

## Alternatives considered

**Keep every raw field in the Word body** — rejected. Traceability does not require exposing internal GIS records to report readers; the existing Excel and JSON artifacts retain those details.

**Generate a generic narrative without Skill-specific result tables** — rejected. The three services answer different questions, so their result summaries remain specialized while the document hierarchy is shared.

## Consequences

Readers receive a concise report that emphasizes findings and project implications. Administrators still have raw response data for audit and troubleshooting, but must publish the `1.4.6` packages through the dynamic Skill release workflow before the desktop market distributes the revised report generator.

## Verification

All three exporters generate a DOCX and XLSX from a representative geology response. DOCX XML parsing confirms the five formal sections exist and that complete WKT, property fields, source paths, JSON links, and Markdown emphasis markers are absent from the Word body. Local visual rendering is deferred because this workstation has neither LibreOffice nor Microsoft Word available to the document renderer.
