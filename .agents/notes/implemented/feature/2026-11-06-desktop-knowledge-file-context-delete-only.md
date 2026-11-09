# Agent Note: Desktop knowledge file context is delete-only on personal

Status: implemented

English | [中文](2026-11-06-desktop-knowledge-file-context-delete-only.zh.md)

## Problem

The desktop Knowledge file context menu offered move, copy, and delete for every selected library. Callers could start transfers from 公共知识库 and 订阅知识库, and personal libraries still exposed move and copy even though the product only wants delete there.

## Decision

File context actions are group-scoped through `libraryIsDesktopPersonal` / `libraryAllowsDesktopFileDelete` (same uncategorized personal rows as [desktop knowledge upload is personal-only](2026-11-06-desktop-knowledge-upload-personal-only.md)). Under 个人知识库, right-click selects the file and shows delete only. Under 公共知识库 and 订阅知识库, right-click does not open a menu and offers no file actions. The desktop move/copy transfer dialog is removed; Host `copy` / `move` API methods remain for other callers.

## Alternatives considered

**Keep move and copy on personal, hide them only on public and subscription.** Rejected; the product requirement removes those actions from personal as well.

**Gate the menu on `owned_by_viewer` across kinds.** Rejected; public and subscription groups must stay action-free even when browsing an owned row—the rule is sidebar-group scoped.

## Consequences

Personal libraries retain delete with confirmation. Public and subscribed selections show no context menu. Dismissing the menu (outside click, scroll, or resize) or canceling the delete dialog also clears the right-click selection highlight. Focused Client tests cover personal delete-only, menu dismissal clearing selection, and the absent menu on public and subscription selections.
