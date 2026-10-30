# Agent Note：管理工作台除知识库外放开权限

Status: implemented

[English](2026-10-30-workbench-user-permissions-open.md) | 中文

## 问题

普通用户已能登录管理工作台，但非知识库模块仍受 `PermissionGuard` / `admin_permissions` 与 `AdminAuth` 拦截，模型配置、技能管理、专家管理、使用统计、模型日志、系统设置、用户权限等出现空数据或「暂无权限」。产品要求在统一权限改造前，角色与权限门禁只保留在知识库；其余工作台模块对任意已登录用户应对齐管理员能力。

## 决策

**前端：** `hasPermission` 对任意已登录用户（`role >= 1`）返回 true。管理工作台 `App.js` 路由不再包裹 `PermissionGuard`。系统设置部署页签对任意已登录用户可加载与保存（不再仅限超级管理员）。知识库界面仍用 `isAdmin()` / `isRoot()` 控制管理员专属操作。

**后端：** 非知识库工作台 API 由 `AdminAuth` 改为 `UserAuth`，覆盖用户管理（创建仍为 `RootAuth`）、角色、组织架构、admin token、充值、渠道、模型定义、分组、使用统计管理、专家管理、技能管理读写与分类、个人技能管理列表、版本说明/发布、充值套餐、管理员用户提问、平台日志列表/搜索/统计，以及 `/api/option/`（系统部署配置）。`/api/knowledge-admin/*` 仍为 `AdminAuth`。已放开模块内的 Root 专属动作（提权、管理员角色、组织树编辑、个人技能审核）仍仅 Root。用户管理同级比较仍用 `managementActorRole`。本地 one-api 须在 `PARVIS_CAPABILITIES` 中包含 `remote_skills`，否则技能路由由 `RequireRemoteSkills` 返回 403，而非角色校验。

## 曾考虑的方案

**只去掉 PermissionGuard、后端仍用 AdminAuth：** 已否决，接口仍会返回无权进行此操作。

**同时放开 knowledge-admin：** 已否决；产品要求知识库继续保留管理员限制。

**把 `isAdmin()` 改成任意登录用户为真：** 已否决，会错误打开知识库等管理员专属 UI。

## 后果

任意已登录账号均可按管理员同等范围操作上述工作台模块。知识库管理 API 与知识库管理员专属 UI 仍受管理员门禁。后续统一权限模型应替换这些放宽，而不是继续叠加例外。

## 测试

`TestManagementActorRoleElevatesOrdinaryUsers` 覆盖用户管理提升。知识库管理路由仍由既有 AdminAuth 测试覆盖。侧栏权限过滤仍走 `hasPermission`（已登录即放开）。
