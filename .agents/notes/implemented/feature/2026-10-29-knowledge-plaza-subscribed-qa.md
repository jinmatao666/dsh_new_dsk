# Agent Note: Plaza keeps subscribed libraries with split Q&A

Status: implemented

English | [中文](2026-10-29-knowledge-plaza-subscribed-qa.zh.md)

## Problem

After approval, a library left the Knowledge Plaza entirely, so users could not browse marketplace cards by subscriber count or reopen the same detail surface. The plaza detail also had no Q&A and file rows were not openable like the desktop content list.

## Decision

`ListKnowledgePlaza` keeps grant-backed rows with `subscription_status: approved` and `subscriber_count`, and includes the caller’s own libraries as `owned` sorted last ([owned on plaza](2026-10-30-knowledge-owned-on-plaza.md)). The desktop plaza list no longer filters approved cards. The sidebar opens the plaza through a branded resource card, and the plaza presents a resource-center header, image-led catalog cards, status and category badges, and a responsive detail hero in the same visual system as the Expert and Skill catalogs. Approved and owned plaza detail is a two-column layout: left keeps cover, meta, subscribe control (我的 / 已订阅), and the content tree; right is the same knowledge Q&A composer as the main pane (timing, related questions, 万维Buddy). Opening an approved or owned detail selects that library so `complete`, `messages`, `download`, and `chunks` reuse the authorized routes. File rows become buttons that open the shared document viewer. Pending or none status keeps a two-column preview (cover/meta left, read-only catalog right) with no Q&A pane ([unsubscribed plaza layout](2026-10-30-knowledge-plaza-unsubscribed-layout.md)). This supersedes the earlier rejection of keeping approved libraries on the plaza in [knowledge library subscription plaza](2026-10-23-knowledge-library-subscription.md).

## Alternatives considered

Hiding approved cards and only offering Q&A under 订阅知识库 — rejected; product wants marketplace discovery to retain subscribed libraries and open a split detail. Allowing download or chat without a grant — rejected; document and chat routes stay authorization-gated.

## Consequences

Subscribed libraries appear both under 订阅知识库 and on the plaza. Plaza Q&A shares the selected library’s session state with the main knowledge chat when the detail selects that id. Owned libraries appear on the plaza as 我的 and stay out of 订阅知识库 ([owned on plaza](2026-10-30-knowledge-owned-on-plaza.md)). The richer catalog presentation adds no authorization or data dependency; it derives every badge, statistic, cover, and action from the existing plaza response.

## Required verification

Subscribe and approve a library, open 知识库广场, confirm the card shows 已订阅 and subscriber count, open detail, ask a question on the right, and open a file from the left tree.
