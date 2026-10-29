# Agent Note: Knowledge library subscription plaza

Status: implemented

English | [中文](2026-10-23-knowledge-library-subscription.zh.md)

## Problem

Libraries filed under a workbench category that requires authorization must not appear under that category name on the desktop. Users need a marketplace to discover them, apply for access against that library, see them under 订阅知识库 only after an administrator approves the request, and later leave that subscription so the library returns to the plaza.

## Decision

Published libraries in categories with `require_auth` true are listed on `GET /api/knowledge-bases/plaza` for every signed-in user except the caller’s own libraries. Grant holders see the same cards with `subscription_status: approved`; other callers see `none` or `pending`. Desktop `GET /api/knowledge-bases` is always grant-scoped via `ListAuthorizedKnowledgeBases` and annotates each row with `owned_by_viewer` and `subscribed_by_viewer` (grant without ownership); administrators use `/api/knowledge-admin/bases` for the full workbench catalog and must not receive that dump on the desktop list. The desktop sidebar never uses auth category names as groups: Personal and 订阅知识库 are always present (empty groups show 暂无知识库); 公共知识库 merges every open (non-auth) library and appears only when non-empty; 订阅知识库 lists owned auth-category libraries first, then `subscribed_by_viewer` rows. A library with plaza status `none` must not also appear under 订阅知识库. Plaza cards show name, description, maintainer, updated day, document count, document bytes, and user-grant subscriber count (`document_count`, `document_bytes`, `subscriber_count`). When `cover` is a stored image data URL, the card and the detail view use it; otherwise they keep the staged natural-resources photo ([knowledge library covers](2026-10-29-knowledge-library-cover.md)). The plaza card opens a detail view whose 订阅 control posts `POST /api/knowledge-bases/:id/subscribe` when status is `none`. Approved detail layout, Q&A, and file open are owned by [plaza subscribed Q&A](2026-10-29-knowledge-plaza-subscribed-qa.md). Opening a granted (non-owned) library from 订阅知识库 shows 取消订阅; owned libraries never show that control and never appear on the plaza.

The workbench Knowledge page exposes 审核, which loads a paginated pending list from `GET /api/knowledge-admin/subscription-applications`. Approving through `POST /api/knowledge-admin/subscription-applications/:id/review` with `decision: approve` inserts a user grant so `ListAuthorizedKnowledgeBases` includes the library for the applicant; rejecting marks the application rejected and leaves access closed. Document bytes and chat still require authorization; the plaza catalog names remain visible before a grant.

Open categories (`require_auth` false) keep the earlier sidebar and visibility rules from [knowledge categories](2026-10-23-knowledge-library-categories.md).

## Alternatives considered

**Keep auth-required categories as desktop sidebar groups and rely on administrator-written grants only:** rejected because users had no self-service discovery or application path matching the plaza and subscribe flow.

**Let library owners review applications on a personal endpoint:** rejected for this release because the audit UI belongs on the existing administrator Knowledge workbench; the application still names the target library and its owner for the reviewer.

**Make plaza detail open documents without a grant:** rejected because browsing content would bypass the authorization switch that the category records.

**Keep approved libraries on the plaza with a disabled 已订阅 control:** originally rejected for duplicate discovery; superseded — approved cards stay on the plaza with split Q&A per [plaza subscribed Q&A](2026-10-29-knowledge-plaza-subscribed-qa.md).

**Return the managed catalog on the desktop list for administrators:** rejected because owned and third-party auth-category libraries then appeared under 订阅知识库 without a subscription, emptied the plaza for the creating admin, and made 取消订阅 fail with 该知识库不支持订阅申请.

## Consequences

Desktop Host, Client, and OneAPI must ship the plaza, subscribe, unsubscribe, and review routes together. Approving an application is the grant path for user self-service; department grants and direct grant APIs remain available for shared-style administration. Canceling a subscription only removes the caller's user grant and subscription application; department grants are unchanged. Deleting a library removes its subscription applications with its grants.
