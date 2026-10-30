# Agent Note: Owned auth libraries on plaza as 我的

Status: implemented

English | [中文](2026-10-30-knowledge-owned-on-plaza.zh.md)

## Problem

Self-built auth-category libraries were listed under sidebar 订阅知识库 and omitted from 知识库广场. That stretched the word 订阅 (true subscriptions are grant-backed after workbench review) and hid the owner's marketplace card. Owners still need Q&A and file open without a sidebar pin.

## Decision

`ListKnowledgePlaza` returns the caller's own published auth-category libraries with `subscription_status: owned`, sorted after every non-owned card. Desktop plaza cards and detail show 我的 with the same Q&A and openable-file behavior as `approved` ([plaza subscribed Q&A](2026-10-29-knowledge-plaza-subscribed-qa.md)). Sidebar 订阅知识库 lists only `subscribed_by_viewer` rows. Owned libraries stay out of that group and never offer 取消订阅. This partially supersedes the owned-omission and sidebar-owned rules in [knowledge library subscription plaza](2026-10-23-knowledge-library-subscription.md) and the "owned remain plaza-hidden" consequence in [plaza subscribed Q&A](2026-10-29-knowledge-plaza-subscribed-qa.md).

Subscription review stays on the Knowledge workbench (`GET/POST /api/knowledge-admin/subscription-applications…`) for signed-in workbench users; owner-only personal review remains rejected per the subscription plaza note.

## Alternatives considered

**Keep owned libraries under 订阅知识库 and off the plaza:** rejected; product wants 订阅 to mean approved grants only, with owner entry on the plaza.

**Mark owned cards as 已订阅 instead of 我的:** rejected; ownership is not a subscription application.

**Pin owned libraries in the sidebar as well as the plaza:** deferred; plaza is the owner entry for now.

## Consequences

Desktop Client and OneAPI plaza list must ship together. Composer and sidebar pickers that reuse `libraryNavGroups` no longer surface owned auth libraries; owners open them from the plaza. Personal-type auth categories remain excluded from the plaza query.

## Required verification

As owner of a published shared auth library, open 知识库广场 and confirm the card is last among mixed results, shows 我的, opens split Q&A, and does not appear under 订阅知识库. As a subscriber after approval, confirm the library still appears under 订阅知识库 and on the plaza as 已订阅.
