# Agent Note：知识库按组织与分类创建者可见

Status: implemented

[English](2026-10-30-knowledge-visibility-org-and-category-owner.md) | 中文

## 问题

凡是 role ≥ 10 的管理工作台用户都被当成知识库目录管理员：`/api/knowledge-admin/bases` 与桌面端 `MergeAdminPersonalKnowledgeBases` 会暴露全部个人知识库，自定义分类页签也会全部列出。产品部账号如 `yxh` 能打开管理员的个人库，并看到自己未创建的分类页签。可见性不能按「授权知识库」这类写死的页签名处理；任意用户自建分类都应遵循同一套归属规则。

## 决策

`knowledgeAdmin` 仅对超级管理员（`role >= 100`）或显式的 `knowledge_admin` 创建标记为真。非超管走 `ListAuthorizedKnowledgeBases`：按所有者/授权/公开公共分类规则，**不再**并入同节点同事的个人库（同节点合并已撤回；见[组织同事个人目录](2026-10-30-knowledge-personal-directory-org-peers.zh.md)）。仅超管可调用 `ListManagedKnowledgeBases` 并合并全部个人库。`KnowledgeCategory` 增加 `owner_user_id`（创建者）。分类的列表/更新/删除按该所有者（或超管）以及类型与库内可访问性判定，不按显示名称。管理工作台用 `isRoot()` 决定全量人员目录与托管目录 URL；普通用户继续用范围受限的 `/api/knowledge-bases`，并通过[组织同事个人目录](2026-10-30-knowledge-personal-directory-org-peers.zh.md)使用相同的个人目录布局。托管文档处理经 `GetAuthorizedKnowledgeBase` 鉴权，避免 role-10 凭编号打开任意库。见 [管理工作台知识库分类](2026-10-23-knowledge-library-categories.zh.md) 与 [个人知识库按组织架构目录](2026-10-29-knowledge-personal-directory-by-organization.zh.md)。

## 考虑过的替代方案

**继续把 role ≥ 10 当作知识库目录管理员：** 不采用。部门内普通管理员会看到全部个人库与全部分类页签。

**只隐藏名为「授权知识库」的页签：** 不采用。分类名由用户自定；归属与访问必须作用于每一个自建页签。

**按祖先组织节点扩大同行可见范围：** 延期。先按同节点同行发布，避免仅挂在总部的管理员对产品部同行可见，除非双方共享节点。

## 后果

已有 `owner_user_id = 0` 的分类在公开或调用方已能打开库内知识库时仍可列出；编辑/删除仅超管可做，直至重新创建并归属。桌面端与管理工作台的非超管会话不再收到组织节点外的他人个人库。role-10 仍可使用其他产品的 AdminAuth 路由，但知识库目录广度与超管对齐。

## 测试

模型测试覆盖同节点同行个人库合并（排除其他组织所有者），以及按创建者而非页签名的分类列表/管理。管理工作台 React 测试用 `isRoot` mock 全量目录；普通用户组织目录覆盖见[组织同事个人目录](2026-10-30-knowledge-personal-directory-org-peers.zh.md)。
