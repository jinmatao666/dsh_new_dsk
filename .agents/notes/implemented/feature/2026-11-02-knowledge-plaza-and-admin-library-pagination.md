# Agent Note: Knowledge plaza and admin library pagination

Status: implemented

English | [中文](2026-11-02-knowledge-plaza-and-admin-library-pagination.zh.md)

## Problem

The desktop Knowledge Plaza homepage listed every plaza card in one scrolling grid with no pager, so large catalogs were hard to browse and the earlier content-list clipping risk applied if the outer shell hid overflow. The OneAPI admin Knowledge workbench showed every library card for authorized and public category tabs without pagination, and the search / sort / new-library toolbar scrolled away with the grid, so operators lost those controls while scanning cards. Personal libraries already use the organization directory UI and do not need a card pager.

## Decision

Plaza homepage cards paginate client-side at 10 per page (`PLAZA_PAGE_SIZE`), reusing the skill-market page-number strip (previous/next, `第N 页 / total`, numbered buttons, jump). The pager shows whenever the catalog is non-empty (same rule as the file-list pager, including a single page). The card grid scrolls inside `.dsh-knowledge-plaza-list`; the pager is a `flex: none` child of the plaza shell (not nested in the catalog that can shrink to zero height), and the homepage shell uses `overflow: hidden`. Search and open reset to page 1.

Admin category tabs (everything except 个人知识库) paginate the filtered card list at 12 per page (`LIBRARY_PAGE_SIZE`) with the existing `zjugis-table-pagination` strip, shown whenever the filtered list is non-empty (including a single page). The catalog shell `.knowledge-library-catalog` is a flex column: the card grid scrolls on its own and the pager stays `flex: none` at the bottom; the Knowledge page fills the content pane height so the pager does not ride the outer page scroll. The search, sort, and 新建知识库 toolbar stays in `.knowledge-sticky` with the title and tabs. Personal scope keeps the directory UI and does not show that toolbar or card pager. Scope, keyword, and sort changes return to page 1.

## Alternatives considered

Server-side plaza pagination — rejected; the plaza API already returns the authorized catalog for the caller, and client slicing matches the desktop file-list pager without a new wire contract. Sticky-only CSS on the toolbar without moving it into `.knowledge-sticky` — rejected; a second sticky under a variable-height sticky header needs fragile `top` offsets. Paginating personal directory people cards — rejected; the request excludes personal and that surface already has its own file pager.

## Consequences

Desktop plaza and admin category grids both need a rebuilt client (desktop bundle or OneAPI air build) before production shows the pager; OneAPI source release alone does not update the Tauri UI. An empty plaza catalog still hides the pager. Plaza layout depends on the flex host remaining height-bounded (same class of failure as the earlier file-list clip if a parent stops constraining height).
