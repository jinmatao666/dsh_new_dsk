# Agent Note：桌面端个人知识库仅所有者可见

Status: implemented

[English](2026-11-06-desktop-personal-knowledge-owner-only.md) | 中文

## 问题

桌面端 `GET /api/knowledge-bases` 在超管会话上调用 `MergeAdminPersonalKnowledgeBases`，管理员会在「个人知识库」下看到全部未归类个人库。产品规则是：桌面侧栏「个人知识库」只展示当前登录用户自己创建的库，即便该用户是管理员或超管。全量个人库管理仍留在管理工作台。

## 决策

`ListKnowledgeBases` 对任何角色都只返回 `ListAuthorizedKnowledgeBases`，不再合并他人个人库。超管仍通过 `/api/knowledge-admin/bases`（`ListManagedKnowledgeBases`）使用管理工作台全量目录。桌面侧栏分组把「个人知识库」限制为调用方拥有的行（`owned_by_viewer` / 所有者 id）。本决策部分取代[知识库按组织与分类创建者可见](2026-10-30-knowledge-visibility-org-and-category-owner.zh.md)中关于桌面端合并个人库的条款；该笔记中的分类归属与仅超管托管目录规则仍然有效。

## 考虑过的替代方案

**保留超管桌面合并，仅在 Client 过滤。** 不采用；他人个人库仍会离开 Host，并进入输入框检索选择器或其他桌面列表消费者。

**同时禁止 `GetAuthorizedKnowledgeBase(..., admin=true)` 打开他人个人库。** 延期；管理工作台与托管文档路由仍需要超管按 id 打开，而桌面端已不再列出这些 id。

## 后果

管理员打开桌面知识库面板时，「个人知识库」只显示自己的库（或为空）。管理工作台个人目录与托管目录行为不变。已删除无用的桌面辅助函数 `MergeAdminPersonalKnowledgeBases` 与 `ListUncategorizedPersonalKnowledgeBases`。

## 测试

OneAPI 控制器测试：超管 `ListKnowledgeBases` 只返回本人的个人库。Client 测试：「个人知识库」不展示 `owned_by_viewer: false` 的行。
