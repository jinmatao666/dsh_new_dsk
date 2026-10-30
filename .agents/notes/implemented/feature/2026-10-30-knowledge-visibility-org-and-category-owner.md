# Agent Note: Knowledge visibility by organization and category owner

Status: implemented

English | [中文](2026-10-30-knowledge-visibility-org-and-category-owner.zh.md)

## Problem

Any workbench user with role ≥ 10 was treated as a knowledge catalog administrator: `/api/knowledge-admin/bases` and desktop `MergeAdminPersonalKnowledgeBases` exposed every personal library, and every custom category tab was listed to those users. A product-department account such as `yxh` could open an administrator's personal library and see category tabs they did not create. Visibility must not be keyed to a hard-coded tab name such as 授权知识库; any user-created category needs the same ownership rule.

## Decision

`knowledgeAdmin` is true only for root (`role >= 100`) or an explicit `knowledge_admin` create flag. Non-root callers use `ListAuthorizedKnowledgeBases`, which enforces owner/grant/public-common rules and does **not** merge colleagues' personal libraries (same-node peer merge was withdrawn; see [org-peer personal directory](2026-10-30-knowledge-personal-directory-org-peers.md)). Root alone may call `ListManagedKnowledgeBases` and merge every personal library. `KnowledgeCategory` gains `owner_user_id` (creator). Category list/update/delete are scoped by that owner (or root), by category type/access, never by display name. The workbench uses `isRoot()` for the full people directory and managed catalog URL; ordinary users keep scoped `/api/knowledge-bases` and the same personal directory layout via [org-peer personal directory](2026-10-30-knowledge-personal-directory-org-peers.md). Managed document handlers authorize through `GetAuthorizedKnowledgeBase` so role-10 cannot open arbitrary library ids. See [workbench knowledge categories](2026-10-23-knowledge-library-categories.md) and [personal directory by organization](2026-10-29-knowledge-personal-directory-by-organization.md).

## Alternatives considered

**Keep role ≥ 10 as knowledge catalog admin:** rejected because ordinary administrators in one department were seeing every personal library and every category tab.

**Hide only tabs named 授权知识库:** rejected because category names are user-defined; ownership and access must apply to every created tab.

**Expand peer visibility through ancestor organization nodes:** deferred; first ship same-node peers so a headquarters-only administrator is not visible to a product-department peer unless they share a node.

## Consequences

Existing categories with `owner_user_id = 0` remain listable when public or when the caller already has an accessible library inside; editing or deleting them is root-only until reassigned by creating anew. Desktop and workbench non-root sessions stop receiving foreign personal libraries outside the caller's organization nodes. Role-10 users still use AdminAuth routes for other products, but knowledge catalog breadth matches root-only.

## Testing

Model tests cover same-node peer personal merge (excluding other-org owners) and category listing/management by owner rather than by tab name. Workbench React tests mock `isRoot` for the full directory; ordinary-user organization directory coverage lives with [org-peer personal directory](2026-10-30-knowledge-personal-directory-org-peers.md).
