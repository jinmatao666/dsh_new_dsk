# Agent Note: Knowledge library subscription plaza

Status: implemented

English | [中文](2026-10-23-knowledge-library-subscription.zh.md)

## Problem

Libraries filed under a workbench category that requires authorization must not appear under that category name on the desktop. Users need a marketplace to discover them, apply for access against that library, see them under 订阅知识库 only after an administrator approves the request, and later leave that subscription so the library returns to the plaza.

## Decision

Published libraries in categories with `require_auth` true are listed on `GET /api/knowledge-bases/plaza` for every signed-in user. The caller's own libraries appear with `subscription_status: owned` (detail shows a disabled 我的 control). Callers who already hold a user or department grant omit those cards — those libraries live only under 订阅知识库. Other callers see `none` or `pending`. Desktop `GET /api/knowledge-bases` is always grant-scoped via `ListAuthorizedKnowledgeBases` and annotates each row with `owned_by_viewer` and `subscribed_by_viewer` (grant without ownership); administrators use `/api/knowledge-admin/bases` for the full workbench catalog and must not receive that dump on the desktop list. The desktop sidebar never uses auth category names as groups: Personal is always present; 公共知识库 merges every open (non-auth) library and appears only when non-empty; 订阅知识库 holds only `subscribed_by_viewer` auth-category libraries and appears only when non-empty. Owned auth libraries stay off the sidebar and appear on the plaza as `owned`. A library that appears on the plaza with status `none` must not also appear under 订阅知识库. The plaza card opens a detail view whose 订阅 control posts `POST /api/knowledge-bases/:id/subscribe` when status is `none`. Opening a library from 订阅知识库 shows 取消订阅.

The workbench Knowledge page exposes 审核, which loads a paginated pending list from `GET /api/knowledge-admin/subscription-applications`. Approving through `POST /api/knowledge-admin/subscription-applications/:id/review` with `decision: approve` inserts a user grant so `ListAuthorizedKnowledgeBases` includes the library for the applicant; rejecting marks the application rejected and leaves access closed. Document and chat routes still require authorization; the plaza only exposes marketplace metadata.

Open categories (`require_auth` false) keep the earlier sidebar and visibility rules from [knowledge categories](2026-10-23-knowledge-library-categories.md).

## Alternatives considered

**Keep auth-required categories as desktop sidebar groups and rely on administrator-written grants only:** rejected because users had no self-service discovery or application path matching the plaza and subscribe flow.

**Let library owners review applications on a personal endpoint:** rejected for this release because the audit UI belongs on the existing administrator Knowledge workbench; the application still names the target library and its owner for the reviewer.

**Make plaza detail open documents without a grant:** rejected because browsing content would bypass the authorization switch that the category records.

**Keep approved libraries on the plaza with a disabled 已订阅 control:** rejected because the subscribed set already lives under 订阅知识库; duplicate plaza cards confused discovery and unsubscribe.

**Return the managed catalog on the desktop list for administrators:** rejected because owned and third-party auth-category libraries then appeared under 订阅知识库 without a subscription, emptied the plaza for the creating admin, and made 取消订阅 fail with 该知识库不支持订阅申请.

## Consequences

Desktop Host, Client, and OneAPI must ship the plaza, subscribe, unsubscribe, and review routes together. Approving an application is the grant path for user self-service; department grants and direct grant APIs remain available for shared-style administration. Canceling a subscription only removes the caller's user grant and subscription application; department grants are unchanged. Deleting a library removes its subscription applications with its grants.
