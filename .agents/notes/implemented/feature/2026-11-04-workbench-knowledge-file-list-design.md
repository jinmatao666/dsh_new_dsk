# Agent Note: Workbench knowledge file-list design alignment

Status: implemented

English | [中文](2026-11-04-workbench-knowledge-file-list-design.zh.md)

## Problem

The management workbench library file list (`{name}-文件清单`) and the personal person file list still used Lucide row actions, a flat table plate, and a short pager after the personal-directory chrome was aligned, so the drill-down inventory did not match the js.design file-list frame.

## Decision

Align both workbench file-list surfaces with the js.design inventory frame without changing document APIs, upload limits, or parse polling. The opened-library title is `{name}-文件清单`; back is a bordered text control; upload is solid `#106af3` with staged `icon-file-upload.png`. Search is a full-width field with an attached blue `搜索` button. The table sits in a white card (`border #e8edf5`, `box-shadow: 0 3px 4px`, header wash `#eff6ff`). Row actions replace Lucide with staged cutouts under `services/one-api/web/air/public/knowledge-icons/` (`icon-file-browse.png`, `icon-file-download.png`, `icon-file-chunks.png`, `icon-file-summary.png`, `icon-file-delete.png`). The pager matches the desktop knowledge strip: blue count in `共 N 条，每页20条`, then `第 x 页 / y`, prev/next, numbered pages, and `跳至 [input] 页` (Enter submits). The personal person file list reuses the same card, glyphs, and pager; its columns and `预览` label stay unchanged. Subscription-review pagination keeps the prior `zjugis-table-pagination` strip.

## Alternatives considered

**Restyle only the opened-library list and leave the personal person list on Lucide.** Rejected; both inventories share the same design frame and operators move between them on the Personal tab.

**Approximate action glyphs with Lucide and CSS color.** Rejected; product cutouts are the visual source, matching the personal-directory chrome and desktop knowledge-covers approach ([personal directory design](2026-11-04-workbench-personal-knowledge-directory-design.md)).

**Paginate with a jump button instead of Enter-to-submit.** Rejected; the design strip has no separate jump control, and the desktop knowledge pager already uses Enter.

## Consequences

Workbench builds must include the six new `icon-file-*.png` assets or those images 404 while layout and actions still work. Document load, multi-file upload (20MB), parse polling, and admin-only summary/re-parse stay as in [RAGFlow knowledge library](2026-10-21-ragflow-knowledge-library.md).
