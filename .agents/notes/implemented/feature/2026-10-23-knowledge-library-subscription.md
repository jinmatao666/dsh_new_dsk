# Agent Note: Knowledge library subscription plaza

Status: implemented

English | [中文](2026-10-23-knowledge-library-subscription.zh.md)

## Problem

Libraries filed under a workbench category that requires authorization must not appear under that category name on the desktop. Users need a marketplace to discover them, apply for access against that library, see them under 订阅知识库 only after an administrator approves the request, and later leave that subscription so the library returns to the plaza.

## Decision

Published libraries in categories with `require_auth` true are listed on `GET /api/knowledge-bases/plaza` for every signed-in user except the library owner and callers who already hold an approved subscription or user grant for that library. Owners and approved subscribers already see those libraries under 订阅知识库, so plaza cards only show `subscription_status` of `none` or `pending`. The desktop sidebar never uses auth category names as groups: it shows non-empty open categories after Personal, and places every accessible auth-category library under 订阅知识库. Others discover those libraries only through 知识库广场. The plaza card opens a detail view whose 订阅 control posts `POST /api/knowledge-bases/:id/subscribe`, creating a pending `knowledge_subscription_applications` row aimed at that library (and its owner context). Opening a library from 订阅知识库 shows 取消订阅, which calls `DELETE /api/knowledge-bases/:id/subscribe` to remove the caller's user grant and mark the application rejected so the library reappears on the plaza for a fresh subscribe.

The workbench Knowledge page exposes 审核, which loads a paginated pending list from `GET /api/knowledge-admin/subscription-applications`. Approving through `POST /api/knowledge-admin/subscription-applications/:id/review` with `decision: approve` inserts a user grant so `ListAuthorizedKnowledgeBases` includes the library for the applicant; rejecting marks the application rejected and leaves access closed. Document and chat routes still require authorization; the plaza only exposes marketplace metadata.

Open categories (`require_auth` false) keep the earlier sidebar and visibility rules from [knowledge categories](2026-10-23-knowledge-library-categories.md).

## Alternatives considered

**Keep auth-required categories as desktop sidebar groups and rely on administrator-written grants only:** rejected because users had no self-service discovery or application path matching the plaza and subscribe flow.

**Let library owners review applications on a personal endpoint:** rejected for this release because the audit UI belongs on the existing administrator Knowledge workbench; the application still names the target library and its owner for the reviewer.

**Make plaza detail open documents without a grant:** rejected because browsing content would bypass the authorization switch that the category records.

**Keep approved libraries on the plaza with a disabled 已订阅 control:** rejected because the subscribed set already lives under 订阅知识库; duplicate plaza cards confused discovery and unsubscribe.

## Consequences

Desktop Host, Client, and OneAPI must ship the plaza, subscribe, unsubscribe, and review routes together. Approving an application is the grant path for user self-service; department grants and direct grant APIs remain available for shared-style administration. Canceling a subscription only removes the caller's user grant and subscription application; department grants are unchanged. Deleting a library removes its subscription applications with its grants.
