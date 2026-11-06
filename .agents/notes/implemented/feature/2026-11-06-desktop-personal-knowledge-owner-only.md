# Agent Note: Desktop personal knowledge is owner-only

Status: implemented

English | [中文](2026-11-06-desktop-personal-knowledge-owner-only.zh.md)

## Problem

Desktop `GET /api/knowledge-bases` called `MergeAdminPersonalKnowledgeBases` for root, so administrators saw every uncategorized personal library under 个人知识库. The product rule is that the desktop Personal group shows only libraries the signed-in user created, including when that user is an administrator or root. Full personal catalog management stays on the workbench.

## Decision

`ListKnowledgeBases` returns only `ListAuthorizedKnowledgeBases` for every role and no longer merges foreign personal libraries. Root still uses `/api/knowledge-admin/bases` (`ListManagedKnowledgeBases`) for the full workbench catalog. Desktop sidebar grouping keeps 个人知识库 to rows the caller owns (`owned_by_viewer` / owner id). This partially supersedes the desktop-merge clause in [knowledge visibility by organization and category owner](2026-10-30-knowledge-visibility-org-and-category-owner.md); category-owner and root-only managed-catalog rules there remain current.

## Alternatives considered

**Keep root desktop merge; filter only in the Client.** Rejected; foreign personal libraries would still leave the Host and appear in composer retrieval pickers or any other consumer of the desktop list.

**Also deny `GetAuthorizedKnowledgeBase(..., admin=true)` for other users' personal libraries.** Deferred; workbench and managed document routes still need root open-by-id, and desktop no longer lists those ids.

## Consequences

Administrators opening the desktop Knowledge panel see only their own 个人知识库 rows (or an empty Personal group). Workbench personal directory and managed catalog behavior are unchanged. `MergeAdminPersonalKnowledgeBases` and `ListUncategorizedPersonalKnowledgeBases` are removed as dead desktop helpers.

## Testing

OneAPI controller test: root `ListKnowledgeBases` returns only the caller's personal library. Client test: 个人知识库 omits rows with `owned_by_viewer: false`.
