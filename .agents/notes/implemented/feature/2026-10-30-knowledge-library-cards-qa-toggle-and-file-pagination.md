# Agent Note: Knowledge library cards, Q&A toggle, and paginated file list

Status: implemented

English | [中文](2026-10-30-knowledge-library-cards-qa-toggle-and-file-pagination.zh.md)

## Problem

The desktop knowledge page sidebar showed a small card with only a name, a file count, and a description, while the plaza card showed cover, category, maintainer, update time, file count, size, and subscribers. The Q&A pane was always open beside a content pane whose width the user had to drag, so the file list started narrow. The list had no pagination, an icon-only search toggle, no upload time, and no uploader, and the sidebar had no way to find a library by name.

## Decision

Q&A is closed by default, and the file content fills the width. Each sidebar library is a card with a select button and a separate Q&A toggle. The select button shows the plaza cover, a category chip (the administrator category name, or 个人 / 共享 / 公共 for uncategorized libraries), the 我的 or 已订阅 status chip, the name, the description, and the plaza `renderPlazaMeta` rows. The toggle opens or closes the Q&A pane for the selected library; pressing it on another library selects that library and opens the pane. With the pane open, the page is a three-column grid and the file grid collapses to one column. The drag divider, its keyboard handling, and `调整内容宽度` are removed.

`GET /api/knowledge/bases` adds `owner_username`, `document_bytes`, and `subscriber_count` to each desktop item, reusing the plaza figures: `plazaDatasetStats` for file count and bytes, `userDisplayNames`, and `knowledgeUserSubscriberCounts`. `fillDesktopDocumentCounts` is replaced by `fillDesktopCatalogMeta` and `fillDesktopDocumentStats`. The page keeps `documentStats` from this session's document loads and prefers them over the list values for the selected library.

RAGFlow does not report the uploader, so OneAPI records it in `knowledge_document_creators` (`knowledge_base_id`, `document_id`, `user_id`) when `uploadKnowledgeDocument` or a copy or move into a library stores a file. A transferred copy keeps the source uploader and falls back to the caller when none is recorded. Delete, move-away, replace, and library deletion remove the rows. `applyKnowledgeDocumentCreators` adds `creator_name` to the document list and omits it when the uploader is the caller or unknown. The desktop therefore shows a creator only for other users' files.

The sidebar search box filters libraries by name across groups, expands groups with matches, and shows 没有匹配的知识库 otherwise. The content toolbar has an always-visible file-name search and a button that flips between 最新上传 and 最早上传. Pagination slices the top-level folders and files (12 per page, `DOCUMENT_PAGE_SIZE`); a folder keeps its children on its page. The pager matches the skill-market catalog strip: previous/next, `第N 页 / total`, numbered page buttons with ellipsis, and a jump field. It occupies the last row of the content grid so the list scrolls above it; `.dsh-knowledge` uses `grid-template-rows: minmax(0, 1fr)` and `min-height: 0` on children so the content column cannot grow past the viewport and clip the pager. A search or sort change, or a library change, returns to page 1. File cards show the upload time (`YYYY-MM-DD HH:mm`) and the creator.

## Alternatives considered

Derive the creator from the RAGFlow document `created_by` — rejected; every upload uses the shared service account, so it names no user. Store the uploader in the existing `knowledge_document_paths` table — rejected; paths exist only for folder uploads and are deleted with their own lifecycle. Make the whole sidebar card one button with the Q&A toggle inside — rejected; nested buttons are invalid HTML and break keyboard and screen-reader use. Paginate by flattened file count — rejected; it splits an expanded folder across pages. Keep a resizable content pane next to the toggle — rejected; the request removes it, and the single-column list has no width to tune.

## Consequences

Opening the page costs up to ten RAGFlow page requests per library (as the plaza does) instead of one. Files uploaded before this change show no creator until they are re-uploaded. A server without these fields leaves the new meta rows at zero and `未知作者`; a client without them ignores the added JSON fields. This supersedes the sidebar card layout, count source, and grid width of the [sidebar counts note](2026-10-30-knowledge-sidebar-counts-and-content-cards.md); that note's folder-card design and rejected alternatives still apply.
