# Agent Note: Ordinary-user personal directory mirrors admin org tree

Status: implemented

English | [中文](2026-10-30-knowledge-personal-directory-org-peers.zh.md)

## Problem

Root already browses personal libraries as organization tree → people → open person. Ordinary users still saw a flat personal card grid, even after same-node peer libraries were merged into `ListAuthorizedKnowledgeBases`. Product required the same directory structure with a narrower roster: only the caller's membership branch and peers.

## Decision

Every signed-in workbench user sees the personal-tab directory layout. Root keeps `/api/government-organization/` plus `/api/user/`. Non-root loads `GET /api/knowledge-bases/organization-directory`, which returns membership nodes plus ancestors (no sibling branches) and **only the caller's own** account/memberships — colleagues on the same node (for example `jmt` next to `yxh`) are not listed and their personal libraries are not merged into `ListAuthorizedKnowledgeBases`. Non-root never calls the administrator organization or user roster APIs. 未分配组织 appears for non-root only when they have no membership nodes. Edit/delete menus stay root/admin-owned. Supersedes the ordinary-user flat-card clause in [personal directory by organization](2026-10-29-knowledge-personal-directory-by-organization.md); same-node peer personal merge from [org and category owner](2026-10-30-knowledge-visibility-org-and-category-owner.md) is withdrawn for ordinary users.

## Alternatives considered

**Reuse AdminAuth organization GETs for everyone:** rejected; that would expose the full tree and every membership label to ordinary accounts.

**Keep flat cards and only filter libraries:** rejected; the required UX is the same tree/people drill-down as root, not a shorter card list.

**Include sibling departments under a shared parent:** rejected; peer libraries are same-node only, so sibling branches would list people whose personal libraries the caller cannot open.

## Consequences

Ordinary users without memberships see an empty tree hint and 未分配组织 when library owners exist. Parent selection still includes descendant peers on the caller's membership path. Document preview for peers uses the scoped `/api/knowledge-bases/:id/...` routes already authorized by `GetAuthorizedKnowledgeBase`.

## Testing

Model tests assert directory nodes exclude sibling orgs, users are self-only even when a colleague shares the node, and authorized personal libraries exclude that colleague. Workbench React tests mock `/api/knowledge-bases/organization-directory`, assert no `/api/user/` or administrator organization calls, show only self under the membership node, and keep create-library on the user create path.
