# Agent Note: Administrator-only workbench knowledge category creation

Status: implemented

English | [中文](2026-11-11-workbench-knowledge-category-creation.zh.md)

## Problem

Ordinary workbench users could create knowledge categories through both the visible action and its authenticated API, although category creation is an administrator operation.

## Decision

The workbench shows the create-category action only when `isAdmin()` is true. `CreateManagedKnowledgeCategory` rejects callers below `RoleAdminUser` with HTTP 403 before reading the request body. Administrator and root roles may create categories. Category ownership and existing read, edit, delete and subscription-review rules remain with the [category owner policy](../feature/2026-10-30-knowledge-visibility-org-and-category-owner.md).

This supersedes the create-category permission in [workbench knowledge categories](../feature/2026-10-23-knowledge-library-categories.md). That note still owns category types, library assignment and category navigation.

## Alternatives considered

**Hide the action without enforcing the role on the server.** Rejected because a signed-in ordinary user could still invoke the creation API directly.

## Consequences

Existing categories keep their owners and visibility. React tests cover common, administrator and root action visibility. Controller tests cover role rejection before parsing and administrator access to request validation.
