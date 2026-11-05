# Agent Note: Knowledge plaza detail matches js.design

Status: implemented

English | [中文](2026-11-04-knowledge-plaza-detail-design.zh.md)

## Problem

Plaza detail (none / pending / approved / owned) still used an older hero: stacked cover on unsubscribed layouts, description and a separate maintainer line, boxed meta cells, and a disabled 已订阅 / 我的 button for grant-backed libraries. Product js.design frames require a horizontal cover card, 授权知识库 + category tags, card-layout stats, a cyan 订阅 CTA only when unsubscribed, an orange/blue cover ribbon when subscribed or owned, content rows with size and upload time, and Q&A only for grant-backed detail.

## Decision

Unsubscribed and pending detail keeps `with-files` ([unsubscribed layout](2026-10-30-knowledge-plaza-unsubscribed-layout.md)): horizontal cover + meta on the left, read-only content on the right, cyan gradient 订阅 (or disabled 审核中). Approved and owned detail keeps `with-chat` ([plaza subscribed Q&A](2026-10-29-knowledge-plaza-subscribed-qa.md)): the same horizontal hero, cover ribbon (已订阅 / 我的) instead of a status button, content under the hero, Q&A on the right. Detail meta reuses plaza `cardLayout` (维护者 / 文件数量 / 更新时间 / 文件大小); subscriber count sits in the action column with the person glyph. The detail header shows the library cover thumbnail, name, and 知识库详情 subtitle. Content tab uses the plaza book cutout; file rows show size and `YYYY-MM-DD HH:mm`.

## Alternatives considered

Keep the disabled 已订阅 button beside the cover ribbon — rejected; the design treats grant state as a cover badge only. Stack the unsubscribed cover above meta to fill the left column — rejected; both design frames use a side-by-side hero. Show description in the hero — rejected; the frames put narrative elsewhere and keep the card to tags, title, stats, and subscribe actions.

## Consequences

Visual ownership of plaza detail chrome sits with this note; column split and authorization rules stay with the linked layout and Q&A notes. Tests assert ribbon text and the absence of a 订阅 button on approved/owned detail, and still drive 订阅 → 审核中 for none.

## Required verification

`pnpm exec vitest run packages/wanwei/knowledge-base/tests/knowledge-page.client.spec.tsx`. Open an unsubscribed plaza card and confirm horizontal cover, 订阅, and right-hand content; open an approved card and confirm the 已订阅 ribbon, left content tree, and right Q&A.
