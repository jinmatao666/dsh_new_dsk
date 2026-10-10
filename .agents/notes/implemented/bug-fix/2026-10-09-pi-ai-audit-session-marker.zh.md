# Agent Note: pi-ai 审计会话标识

Status: implemented

[English](2026-10-09-pi-ai-audit-session-marker.md) | 中文

## 问题

桌面网关记录用户问题供管理员审计。多步骤任务会发送多个包含相同问题的模型请求。缺少会话标识时，网关无法按会话与用户问题序号分组，而会记录为多个独立问题。

## 决策

[pi-ai 适配器](../../../../packages/llm/llm-pi-ai/src/adapter.ts) 将 `GenerateOptions.sessionId` 作为 `x-deepseek-harness-session-id` 发送，与直连 DeepSeek 适配器和网关接受的标头一致。标识属于单次请求，不包含会话内容，并覆盖 profile 标头中大小写不敏感的同名项。未提供会话的请求不发送该标识，即使 profile 配置了静态值。

## 考虑过的替代方案

**按问题文字去重。** 这会合并文字相同的不同用户提交，也无法确定所属会话。**使用静态 profile 标头。** 这会把不同会话分配到同一个标识。

## 影响

适配器测试覆盖运行时标头优先级和省略行为。Loader 组合测试观察到连续请求保留同一标识、不同会话发送不同标识。现有后台仍负责分组、Token 汇总和逐次模型调用日志。缺少会话标识的历史记录保持不变；部署验证需要更新后的桌面端，以及已部署网关的分组实现。
