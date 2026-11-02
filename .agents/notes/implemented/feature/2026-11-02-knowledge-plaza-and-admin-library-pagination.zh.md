# Agent Note: 知识库广场与管理工作台知识库分页

Status: implemented

[English](2026-11-02-knowledge-plaza-and-admin-library-pagination.md) | 中文

## Problem

桌面知识库广场主页一次性滚动展示全部卡片，没有分页，目录一大就难浏览，外层若 `overflow: hidden` 还可能裁掉底栏。OneAPI 管理工作台在授权、公开等分类页同样一次铺开全部知识库卡片，且搜索、排序、新建工具栏会随列表滚走。个人知识库已走组织目录界面，不需要卡片分页。

## Decision

广场主页客户端按每页 12 张（`PLAZA_PAGE_SIZE`）分页，分页条对齐技能市场（上一页/下一页、「第 N 页 / 总页数」、页码、跳转）。目录有条目时即显示分页条（与文件列表一致，单页也显示）。卡片在 `.dsh-knowledge-plaza-list` 内滚动；分页条是广场壳的 `flex: none` 子项（不放进可被压成 0 高的 catalog），主页广场壳 `overflow: hidden`。搜索与重新打开回到第 1 页。

管理工作台除「个人知识库」外的分类页，对筛选后的卡片列表按每页 12 个（`LIBRARY_PAGE_SIZE`）分页，使用现有 `zjugis-table-pagination`；分类有卡片时即显示分页条（单页也显示）。目录壳 `.knowledge-library-catalog` 为纵向 flex：卡片网格单独滚动，分页条 `flex: none` 钉底；知识库页占满内容区高度，避免分页随整页一起滚走。搜索、排序、新建知识库工具栏在 `.knowledge-sticky` 置顶。个人范围仍用目录界面，不显示该工具栏与卡片分页。分类、关键词、排序变化回到第 1 页。

## Alternatives considered

广场服务端分页 — 否决；现有广场接口已返回调用方可订阅目录，客户端切片与桌面文件列表分页一致，无需新协议。仅用 sticky CSS 固定工具栏而不移入 `.knowledge-sticky` — 否决；叠在高度可变的 sticky 头下需要脆弱的 `top`。给个人目录人员卡片分页 — 否决；需求排除个人，且该面已有文件分页。

## Consequences

广场与管理工作台分类网格需重新构建客户端（桌面 bundle 或 OneAPI air 构建）后线上才可见分页；仅发 OneAPI 源码包不会更新 Tauri UI。广场空目录仍不显示分页条。广场布局仍要求外层高度受限（与早前文件列表裁切同类风险）。
