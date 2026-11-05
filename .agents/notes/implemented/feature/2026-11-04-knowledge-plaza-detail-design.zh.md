# Agent Note: 知识库广场详情对齐 js.design

Status: implemented

[English](2026-11-04-knowledge-plaza-detail-design.md) | 中文

## Problem

广场详情（未订阅 / 审核中 / 已订阅 / 我的）仍沿用旧主视觉：未订阅时封面竖排叠放、独立维护者行与描述、盒状统计格，以及已授权库上禁用的「已订阅 / 我的」按钮。产品 js.design 要求横向封面卡、授权知识库 + 分类标签、卡片式统计、仅未订阅时显示青色「订阅」、已订阅/我的用封面角标、内容行含大小与上传时间，且仅授权详情提供问答。

## Decision

未订阅与审核中仍用 `with-files`（见 [未订阅布局](2026-10-30-knowledge-plaza-unsubscribed-layout.zh.md)）：左侧横向封面与元信息，右侧只读内容，青色渐变「订阅」（或禁用「审核中」）。已订阅与我的仍用 `with-chat`（见 [广场已订阅问答](2026-10-29-knowledge-plaza-subscribed-qa.zh.md)）：同一横向主视觉，封面角标（已订阅 / 我的）替代状态按钮，内容在主视觉下、问答在右。详情元信息复用广场 `cardLayout`（维护者 / 文件数量 / 更新时间 / 文件大小）；订阅人数在操作列配人形图标。详情页头为库封面缩略图、名称与「知识库详情」副标题。内容页签用广场书本切图；文件行显示大小与 `YYYY-MM-DD HH:mm`。

## Alternatives considered

保留禁用的「已订阅」按钮并与角标并存 — 否决；设计仅用封面角标表示授权状态。未订阅封面叠在元信息上方以填满左栏 — 否决；两帧均为横向主视觉。在主视觉展示描述 — 否决；设计把叙述放在别处，卡片只保留标签、标题、统计与订阅操作。

## Consequences

广场详情视觉以本笔记为准；分栏与授权规则仍由所链布局与问答笔记负责。测试断言角标文案、已订阅/我的详情无「订阅」按钮，并覆盖未订阅点击订阅后变为「审核中」。

## Required verification

`pnpm exec vitest run packages/wanwei/knowledge-base/tests/knowledge-page.client.spec.tsx`。打开未订阅广场卡，确认横向封面、「订阅」与右侧内容；打开已订阅卡，确认「已订阅」角标、左侧内容树与右侧问答。
