# Agent Note: 按账号保存知识库广场喜欢状态

Status: implemented

[English](2026-11-12-knowledge-plaza-likes.md) | 中文

## Problem

仅保存在页面中的爱心会在刷新后丢失。用订阅授权保存喜欢，会让偏好改变访问权限。

## Decision

OneAPI 按用户编号与知识库编号保存喜欢，独立于订阅和授权。登录后的 POST 和 DELETE 请求通过 `/api/knowledge-bases/:id/like` 幂等保存，仅接受调用者广场中可见的知识库。列表和详情响应包含 `liked_by_viewer`。删除知识库时同时删除喜欢记录。

桌面卡片的爱心位于分类行右侧；详情爱心位于左侧头图区域的右上角。两处共享保存后的状态。保存成功后爱心才切换；请求失败时保留原值并显示错误。加载广场会恢复用户保存的偏好。

## Alternatives considered

仅用页面状态或本地存储无法跨设备提供账号专属偏好。订阅记录会耦合偏好和授权。

## Consequences

后端迁移创建具有复合主键的独立表。喜欢不会提交订阅申请，也不会授权文档访问。模型和 HTTP 测试覆盖幂等性与账号隔离；桌面测试覆盖重新挂载恢复、卡片与详情同步及保存失败。

本地刷新通过 `scripts/start-wanwei.ps1 -Refresh` 先编译 TypeScript 再打包，随后构建 OneAPI 并重启后端与桌面服务。仅打包可能保留旧的认证编译代码，遗漏喜欢请求处理。
