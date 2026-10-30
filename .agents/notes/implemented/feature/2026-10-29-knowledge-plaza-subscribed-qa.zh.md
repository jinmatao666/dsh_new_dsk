# Agent Note: 广场保留已订阅库并分栏问答

Status: implemented

[English](2026-10-29-knowledge-plaza-subscribed-qa.md) | 中文

## Problem

审核通过后知识库会从广场消失，用户无法在广场继续按订阅人数浏览，也无法在同一详情面打开问答。广场详情没有问答，文件行也不能像桌面内容列表一样打开。

## Decision

`ListKnowledgePlaza` 保留已获授权的行（`subscription_status: approved` 与 `subscriber_count`），并包含调用者自建库为 `owned`（排在最后，见 [自建授权库在广场标「我的」](2026-10-30-knowledge-owned-on-plaza.zh.md)）。桌面广场列表不再过滤已订阅卡片。侧栏通过品牌资源卡打开广场，广场使用与专家和技能目录一致的视觉体系呈现资源中心页头、图片主导的目录卡、状态与分类徽标，以及自适应详情主视觉。已订阅与「我的」详情为两栏：左侧保留封面、元信息、订阅状态按钮与内容树；右侧与主界面知识问答相同（耗时、关联问题、万维Buddy）。打开已订阅或「我的」详情会选中该库，从而复用已授权的 `complete` / `messages` / `download` / `chunks`。文件行变为按钮并打开共用文档预览。审核中或未订阅时详情为两栏预览（左封面与元信息、右只读目录），不渲染问答区（见 [未订阅广场详情布局](2026-10-30-knowledge-plaza-unsubscribed-layout.zh.md)）。本决定取代 [知识库订阅广场](2026-10-23-knowledge-library-subscription.zh.md) 中「已订阅库不留在广场」的否决项。

## Alternatives considered

已订阅只留在「订阅知识库」、广场不再展示 — 否决；产品要求广场仍可见已订阅库并分栏问答。无授权即可下载或问答 — 否决；文档与对话路由仍须授权。

## Consequences

已订阅库同时出现在「订阅知识库」与广场。广场问答在选中该库后与主问答共享会话状态。自建库在广场标「我的」且不进「订阅知识库」（见 [自建授权库在广场标「我的」](2026-10-30-knowledge-owned-on-plaza.zh.md)）。更丰富的目录呈现不新增授权或数据依赖；所有徽标、统计、封面与操作均来自现有广场响应。

## Required verification

订阅并审核通过后打开知识库广场，确认卡片显示「已订阅」与订阅人数；进入详情右侧提问，左侧点击文件可打开预览。
