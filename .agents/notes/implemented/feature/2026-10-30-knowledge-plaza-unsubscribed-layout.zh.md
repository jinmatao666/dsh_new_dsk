# Agent Note: 未订阅广场详情分栏与维护者显示名

Status: implemented

[English](2026-10-30-knowledge-plaza-unsubscribed-layout.md) | 中文

## Problem

未订阅的广场详情把封面、元信息与文件目录叠在一列窄栏里，已订阅时右侧问答位空着。维护者在账号中心有显示名时，广场仍可能落到登录用户名。

## Decision

审核中或未订阅详情使用 `with-files`：左栏为封面、标题、维护者显示名、描述、统计与订阅按钮；右栏为只读内容树。已订阅与「我的」仍用 `with-chat`（文件在左栏封面下、问答在右），见 [广场已订阅分栏问答](2026-10-29-knowledge-plaza-subscribed-qa.zh.md)。`userDisplayNames` 先叠加账号中心身份，再优先用 `display_name`，否则回退 `username`，写入广场与管理列表的 `owner_username`。

## Alternatives considered

未订阅保持单栏 — 否决；相对已订阅分栏右侧空白不完整。用 `@` 登录名表示维护者 — 否决；产品要求与其他处一致的显示名。

## Consequences

桌面 Client 样式与广场详情结构需与 OneAPI 显示名叠加同发。卡片元信息仍展示维护者；详情在描述上方只展示一次。

## Required verification

打开未订阅广场卡片，确认左封面/元信息与右文件列表铺满宽度，维护者为账号显示名。打开已订阅卡片，确认右侧仍为问答、文件仍在左栏封面下。
