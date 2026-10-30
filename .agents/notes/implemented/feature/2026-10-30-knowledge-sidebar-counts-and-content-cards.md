# Agent Note: Knowledge sidebar counts and card content pane

Status: implemented

English | [中文](2026-10-30-knowledge-sidebar-counts-and-content-cards.zh.md)

## Problem

The desktop knowledge page sidebar listed groups and libraries without totals, so users had to open each library to learn how much it held. The content pane rendered folders and files as dense single-line rows that read as a plain file list rather than a browsable library.

## Decision

`GET /api/knowledge/bases` returns `document_count` per desktop library. `fillDesktopDocumentCounts` asks RAGFlow for one page of size 1 per dataset, four requests at a time, and leaves the count at 0 when RAGFlow is unconfigured or a request fails. The client validates `document_count` as a non-negative integer at the RPC boundary. Each sidebar group header shows its library count. Each library is a sidebar card: its group selects a blue, teal, or violet accent; the icon tile, count badge, selected marker, border, and subtle background tint use that accent. The name and `{count} 个文件` share the first row, and the description (`暂无描述` when empty) occupies up to two lines below; the tooltip carries the complete description and the button's accessible name stays the library name. `KnowledgePage` keeps `documentCounts`, the totals from document loads made in this session, and prefers them over the list value so uploads and deletions update the selected row immediately.

The content pane is a `repeat(auto-fill, minmax(176px, 1fr))` card grid. A file card shows the type icon, a two-line name, the type label, and the size. Folder, PDF, document, spreadsheet, image, and generic-file cards use distinct amber, red, blue, green, violet, and slate accents across their top marker, icon tile, border, metadata, and subtle background tint. A collapsed folder is a card with its direct child count. An expanded folder spans the grid row as an amber-tinted section: a header bar with the name and count, followed by a nested card grid of its children. Search still expands every folder.

## Alternatives considered

Show only group counts — rejected; the request asks for a number on each sidebar item. Count files on the client by loading every library's documents — rejected; it multiplies full document listings on open. Drill-down folder navigation with breadcrumbs — rejected; it removes the existing expand-in-place behavior and its tests for no layout gain at the 280px default width.

## Consequences

Opening the knowledge page now makes one RAGFlow page request per listed library. The plaza catalog keeps its table rows. At the default content width the grid shows two cards per row; widening the pane adds columns.
