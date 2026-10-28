# Agent Note: Workbench knowledge categories

Status: implemented

English | [中文](2026-10-23-knowledge-library-categories.zh.md)

## Problem

Administrators need named knowledge-library groupings that decide who may open each library. Fixed common/shared catalog tabs are not enough; tabs and desktop nav must follow the categories they create, with Personal kept for uncategorized personal libraries.

## Decision

The workbench knowledge page keeps a 新建知识库分类 action at the top right. The dialog's 类型 field is one of 个人 / 公开 / 授权 (self-only, everyone, subscribe-then-see). OneAPI stores `type` plus `require_auth` derived from that choice: 个人 → `personal` + auth, 公开 → `common` without auth, 授权 → `shared` + auth. Workbench tabs are 个人知识库 plus each created category (no fixed 共性/共享 tabs). Creating on Personal makes an uncategorized personal library; creating on a category tab sets `knowledge_bases.category_id` and copies the category type into `kind`.

`ListAuthorizedKnowledgeBases` keeps the existing kind rule only when `category_id` is 0. A published library in a category with `require_auth` false is visible to every signed-in user. A published library in a category with `require_auth` true is visible to its owner or to a user or department grant. Offline libraries stay hidden. Administrators still receive the full catalog. The desktop sidebar shows 个人知识库, non-empty open categories, 我创建的 for owned auth-category libraries, and 订阅知识库 for granted (non-owned) auth-category libraries. Auth category names never appear as sidebar groups; others discover those libraries in the subscription plaza (own libraries appear there as `owned`). Once granted, the library appears under 订阅知识库; see [knowledge library subscription](2026-10-23-knowledge-library-subscription.md). Only an administrator can assign `category_id` when creating a library.

## Alternatives considered

**Encode the category as another `kind` string:** rejected because `kind` is a closed authorization rule. A category also needs its own name and an independent grant switch, and libraries in it must leave the built-in tabs.

**Show new categories only on the workbench:** rejected because desktop users would not see libraries an administrator filed under the new tab.

**Keep common/shared/personal type labels plus a separate grant switch:** rejected because the dialog now uses 个人 / 公开 / 授权 to name visibility directly and maps that choice onto the existing `type` and `require_auth` fields.

## Consequences

Workbench and desktop builds have to ship with the OneAPI routes `GET/POST /api/knowledge-admin/categories` and `GET /api/knowledge-bases/categories`. A category name is unique. The desktop does not create libraries inside a category; creation stays on the workbench tab. Grant editing for a category that requires authorization remains on the administration API and the subscription review path. See [RAGFlow knowledge library](2026-10-21-ragflow-knowledge-library.md) for the uncategorized kind rules.
