# Agent Note: Workbench personal knowledge directory design alignment

Status: implemented

English | [中文](2026-11-04-workbench-personal-knowledge-directory-design.zh.md)

## Problem

The management workbench Personal knowledge tab already browsed organization → people → files, but its chrome (page wash, tabs, action glyphs, org selection, person cards) did not match the js.design personal-directory frame, so the shipped admin UI still read as an earlier flat roster.

## Decision

Align the workbench Personal tab with the js.design personal-directory frame without changing directory APIs or visibility rules. Page wash uses `#e9f1fd` with a soft radial highlight; sticky chrome stays transparent over that wash. Tabs use 18px labels, `#106af3` underline, and filled count pills. Chrome actions replace Lucide glyphs with staged transparent PNGs under `services/one-api/web/air/public/knowledge-icons/` (`icon-subscription-review.png`, `icon-new-category.png`, `icon-new-library.png`). The org sidebar is a white 15px-radius panel; the selected node uses `#e9f1fd` with dark label text (not a blue gradient fill). Person cards are 246px-tall gradient plates with solid-color surname avatars (white glyph), stacked `组织` / path and `注册` / date rows, and centered stats with the count above the `知识库` / `总大小` labels. Category-tab catalog chrome (header art, flat toolbar, banner more-menu) is owned by [workbench public knowledge catalog design](2026-11-04-workbench-public-knowledge-catalog-design.md).

## Alternatives considered

**Rebuild the personal directory as a separate route or package.** Rejected; the existing `Knowledge/index.js` already owns organization, people, and file drill-down, and splitting would duplicate auth and catalog loading.

**Keep Lucide icons and approximate the design in CSS only.** Rejected; product cutouts are the visual source for the three chrome actions, matching the desktop knowledge-covers approach.

**Paginate the people card grid.** Rejected earlier for this surface; the personal directory already has its own person file pager, and the design shows an unpaged card mosaic for the selected org node.

## Consequences

Workbench builds must include `public/knowledge-icons/` or the three chrome images 404 while layout still works. Directory data sources and root vs ordinary-user scoping stay as in [personal directory by organization](2026-10-29-knowledge-personal-directory-by-organization.md) and [org-peer personal directory](2026-10-30-knowledge-personal-directory-org-peers.md).
