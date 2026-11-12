# Agent Note: 仅管理员可新建管理工作台知识库分类

Status: implemented

[English](2026-11-11-workbench-knowledge-category-creation.md) | 中文

## Problem

普通工作台用户可以通过可见按钮及已登录接口新建知识库分类，而分类创建属于管理员操作。

## Decision

工作台仅在 `isAdmin()` 为 true 时显示新建分类按钮。`CreateManagedKnowledgeCategory` 在读取请求体前拒绝低于 `RoleAdminUser` 的调用者，返回 HTTP 403。管理员和超管可新建分类。分类归属及现有读取、编辑、删除和订阅审核规则由[分类创建者策略](../feature/2026-10-30-knowledge-visibility-org-and-category-owner.zh.md)约束。

本记录取代[工作台知识库分类](../feature/2026-10-23-knowledge-library-categories.zh.md)中的新建分类权限。该记录继续负责分类类型、知识库归类和分类导航。

## Alternatives considered

**只隐藏按钮而不在服务端校验角色。** 不采用，因为已登录的普通用户仍可直接调用创建接口。

## Consequences

已有分类保留归属与可见性。React 测试覆盖普通用户、管理员及超管的按钮可见性。控制器测试覆盖解析前的角色拒绝，以及管理员可进入请求参数校验。
