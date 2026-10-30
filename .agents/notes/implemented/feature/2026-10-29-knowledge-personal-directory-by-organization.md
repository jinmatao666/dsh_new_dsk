# Agent Note: Personal knowledge directory follows government organization

Status: implemented

English | [中文](2026-10-29-knowledge-personal-directory-by-organization.zh.md)

## Problem

Administrators already maintain a hierarchical government organization tree and memberships under 用户权限 → 组织架构. The workbench Personal knowledge tab still grouped people by the flat `department_name` string and opened with an 全部人员 roster, so the directory ignored the real tree and dumped every account before any filter.

## Decision

On the administrator Personal tab, the left directory loads `/api/government-organization/` and `/api/government-organization/memberships`. It renders the same adjacency tree as the organization editor (nodes only — no member leaves in the nav). Selecting a node lists people who have a direct membership on that node or any descendant; the page does not show an 全部人员 entry and does not render the people grid until a node is selected. Accounts with no membership appear under 未分配组织 when that set is non-empty. Ordinary users use the same left-tree / right-people layout via a scoped directory API; see [org-peer personal directory](2026-10-30-knowledge-personal-directory-org-peers.md). Category tabs and personal file drill-down are unchanged; this only replaces the Personal directory source of truth for who appears where. See also [knowledge categories](2026-10-23-knowledge-library-categories.md) and [government organization tree](2026-10-24-government-organization-tree.md).

## Alternatives considered

**Keep 全部人员 plus flat department_name groups:** rejected because it duplicates a second, stale hierarchy after the government tree is the owned org model.

**Embed people as tree leaves in the Personal nav (as the organization editor does):** rejected for this surface; the requirement is to browse by structure without listing every person in the tree. People stay on the right after a node is chosen.

**Only show people who already own a personal library:** deferred; membership still decides visibility under a node so admins can open empty owners. Library counts remain on the person card.

## Consequences

Personal browsing depends on organization nodes and memberships being maintained; an empty tree shows a setup hint instead of falling back to the full roster. Multi-node memberships can place one person under more than one selected path. Parent-node selection includes descendant members, so company-level clicks can still surface many people — that is intentional inheritance, not an 全部人员 shortcut.

## Testing

Workbench React tests mock the government organization and memberships APIs, assert no 全部人员 roster on load, filter by node and 未分配组织, and keep the person file-list / preview path. Ordinary-user coverage for the scoped peer directory lives with [org-peer personal directory](2026-10-30-knowledge-personal-directory-org-peers.md).
