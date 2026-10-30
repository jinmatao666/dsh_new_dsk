# Agent Note: Workbench open except knowledge AdminAuth

Status: implemented

English | [中文](2026-10-30-workbench-user-permissions-open.zh.md)

## Problem

Ordinary users can sign into the workbench, but non-knowledge modules still hit `PermissionGuard` / `admin_permissions` and `AdminAuth`, so 模型配置, 技能管理, 专家管理, 使用统计, 模型日志, 系统设置, and 用户权限 failed with empty data or 暂无权限. Product wants role and permission gates only on 知识库 until a unified redesign; other workbench modules must match administrator capability for any signed-in user.

## Decision

**Frontend:** `hasPermission` returns true for any signed-in user (`role >= 1`). Workbench `App.js` routes no longer wrap pages in `PermissionGuard`. System settings deployment tabs load and save for any signed-in user (no super-admin-only gate). Knowledge UI keeps `isAdmin()` / `isRoot()` for admin-only controls.

**Backend:** Non-knowledge workbench APIs use `UserAuth` instead of `AdminAuth`, including user management (create stays `RootAuth`), role, government-organization, admin token, top-up, channel, model_definition, group, usage admin, expert admin, skill admin/write/category, personal-skill admin list, version-note/release, recharge-package, admin user-prompts, platform log list/search/stat, and `/api/option/` (system deployment settings). `/api/knowledge-admin/*` stays `AdminAuth`. Root-only actions inside opened modules (promote user, admin roles, org-tree edit, personal-skill review) stay root-only. Peer checks on user management still use `managementActorRole`. Local one-api must set `PARVIS_CAPABILITIES` including `remote_skills` or skill routes return 403 from `RequireRemoteSkills`, not from role checks.

## Alternatives considered

**Keep AdminAuth and only remove PermissionGuard:** rejected because APIs still returned 无权进行此操作.

**Open knowledge-admin to UserAuth as well:** rejected; product keeps administrator restriction on 知识库.

**Change `isAdmin()` to treat every signed-in user as admin:** rejected because Knowledge and other admin-only UI would open incorrectly.

## Consequences

Any logged-in account can operate the listed workbench modules like an administrator. Knowledge managed APIs and admin-only Knowledge UI remain administrator-gated. A later unified permission model should replace these widenings rather than stacking more exceptions.

## Testing

`TestManagementActorRoleElevatesOrdinaryUsers` covers user-management elevation. Knowledge admin routes remain covered by existing AdminAuth tests. Sidebar permission filtering still uses `hasPermission` (now open for signed-in users).
