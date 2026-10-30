# Agent Note: 知识库内容栏默认宽度为问答留位

Status: implemented

[English](2026-10-30-knowledge-content-width-default.md) | 中文

## Problem

桌面知识库页默认以 400px 打开中间内容栏。在常见技能市场宽度下，该栏加上 224px 侧栏会把右侧问答挤窄。拖拽计算还按 210px 侧栏留白，而 CSS 实际占用 224px，拖动分隔条时内容栏可超过预期的问答下限。

## Decision

`CONTENT_DEFAULT` 为 280px，CSS `--dsh-knowledge-content-width` 回退值与之一致。`CHAT_MIN` 为 280px（980px 媒体查询下为 240px），使网格与 `contentSpan` 保留可用问答轨。`contentSpan` 使用与 `.dsh-knowledge` 相同的 `NAV_DESKTOP` 224 / `NAV_NARROW` 180 计算内容上限与相对指针宽度。用户仍可用分隔条在上限内加宽内容栏。

## Alternatives considered

保持 400px 仅抬高问答下限 — 否决；报告的问题是首次打开的比例，不只是拖拽上限。把内容默认降到 `CONTENT_MIN`（260px）— 否决；文档列表仍需容纳名称与工具栏，不应强迫每位用户再拖宽。

## Consequences

相同外壳宽度下，首次打开问答大约多出 120px。拖拽仍在 `[CONTENT_MIN, contentSpan.max]` 内覆盖默认值。分隔条测试用 `clientX − NAV_DESKTOP` 钉住宽度。
