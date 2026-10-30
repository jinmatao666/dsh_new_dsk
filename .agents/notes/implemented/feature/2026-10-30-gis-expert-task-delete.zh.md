# Agent Note: GIS 专家终态任务删除

Status: implemented

[English](2026-10-30-gis-expert-task-delete.md) | 中文

## Problem

`coordinate-transform`、`gis-format-converter`、`cad-redline-extractor` 会把失败与已完成任务留在各用户的任务记录中，直到保留期到期。运维与用户需要立刻去掉错误或过时记录，而不必等待 `EXPERT_RETENTION_DAYS`，也不必手工改 SQLite。

## Decision

三个专家各自提供面向所属会话的 `POST /api/tasks/<id>/delete`。仅终态（`succeeded`、`failed`、`cancelled`）可删；排队或运行中须先取消。删除会去掉 SQLite 行以及该专家数据根下对应任务目录。任务记录列表对终态行显示删除控件；任务详情页提供同一操作。归属仍按会话隔离：其他用户的 Cookie 得到 404。

## Alternatives considered

**仅靠保留期清理** 会让失败记录最多保留约三十天，提前清理还要登录主机。

**在 worker 仍占用进程时删除** 可能与即将完成的转换竞态；取消后若任务仍在 `worker._active` 中则拒绝，与图像类专家一致。

**三个专家目录共用一个库** 会破坏每个专家目录可独立交付的规则。

## Consequences

可在工作台清掉失败与已完成记录。进行中的转换仍须先取消。部署继续沿用既有 Compose 项目名与数据卷；无需 schema 迁移。

## Testing

Store 测试覆盖活跃态拒绝、跨用户拒绝与目录删除。Server 测试覆盖 HTTP 归属与须先取消的错误。前端静态检查断言各专家的删除控件与 `/delete` 调用点。
