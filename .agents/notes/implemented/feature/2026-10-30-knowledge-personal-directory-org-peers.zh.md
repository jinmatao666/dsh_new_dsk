# Agent Note: 普通用户个人知识库采用与管理员相同的组织树目录

Status: implemented

[English](2026-10-30-knowledge-personal-directory-org-peers.md) | 中文

## Problem

超级管理员已按「组织树 → 人员 → 点开人员」浏览个人知识库。普通用户在 `ListAuthorizedKnowledgeBases` 已合并同节点同事个人库之后，仍看到扁平个人库卡片。产品要求结构与管理员一致，但名册更窄：仅调用方所属组织分支与同节点同事。

## Decision

所有已登录管理工作台用户都使用个人知识库目录布局。超级管理员仍读 `/api/government-organization/` 与 `/api/user/`。非超级管理员读 `GET /api/knowledge-bases/organization-directory`，返回其直属归属节点及全部祖先（不含兄弟分支），以及**仅本人**账号与归属——同节点同事（例如与 `yxh` 同部门的 `jmt`）不出现在人员列表，其个人库也不并入 `ListAuthorizedKnowledgeBases`。非超级管理员不请求管理员组织或全员用户接口。仅当自己没有任何归属节点时才出现「未分配组织」。编辑/删除菜单仍属超级管理员或管理员。取代[按组织架构浏览个人目录](2026-10-29-knowledge-personal-directory-by-organization.zh.md)中普通用户扁平卡片条款；[组织与分类所有者](2026-10-30-knowledge-visibility-org-and-category-owner.zh.md)中的同节点同事个人库合并对普通用户已撤回。

## Alternatives considered

**让所有人复用 AdminAuth 的组织 GET：** 否决；会把整棵树与全部成员标签暴露给普通账号。

**保留扁平卡片、只过滤知识库列表：** 否决；要求的是与超级管理员相同的树/人员下钻，而不是更短的卡片列表。

**在共享上级下展示兄弟部门：** 否决；同事个人库仅同节点可见，兄弟分支会列出调用方打不开个人库的人。

## Consequences

无归属的普通用户看到空树提示，并在存在库所有者时使用「未分配组织」。选中上级仍包含调用方归属路径上的子孙同事。同事文件预览走已由 `GetAuthorizedKnowledgeBase` 鉴权的 `/api/knowledge-bases/:id/...`。

## Testing

模型测试断言目录节点不含兄弟组织、即使用户与同事同节点也只返回本人，且授权个人库不含该同事。管理工作台 React 测试 mock `/api/knowledge-bases/organization-directory`，断言不调用 `/api/user/` 或管理员组织接口，归属节点下只显示本人，并保持用户创建路径上的新建知识库。
