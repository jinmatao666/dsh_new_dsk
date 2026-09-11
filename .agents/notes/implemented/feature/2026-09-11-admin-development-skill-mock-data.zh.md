# Agent Note: 后台开发技能模拟数据

Status: implemented

[English](2026-09-11-admin-development-skill-mock-data.md) | 中文

## Problem

本地 One API 后台前端需要展示有内容的技能库与分类管理页面，同时不依赖正在运行的服务，也不保存演示记录。

## Decision

仅当前端在开发模式运行且设置 `REACT_APP_USE_SKILL_MOCK_DATA=true` 时，这两个页面才加载已有的静态模拟记录。

其他构建方式继续使用现有的 API 加载路径。

模拟模式会拒绝保存、删除和变更上架状态的操作，因此预览数据不会修改 One API 服务。

## Alternatives considered

向本地 One API 数据库写入种子数据。

这需要单独的服务并会在前端之外创建状态，而当前预览只需要表格数据。

默认启用模拟记录。

这样可能使发布构建展示演示条目，而不是服务端数据。

## Consequences

开发者设置一个明确的本地环境变量后，即可查看有内容的后台管理页面。

生产镜像仍从 One API 读取技能和分类记录。
