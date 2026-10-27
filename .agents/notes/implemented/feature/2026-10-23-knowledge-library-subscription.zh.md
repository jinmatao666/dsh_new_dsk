# Agent Note：知识库订阅广场

Status: implemented

[English](2026-10-23-knowledge-library-subscription.md) | 中文

## 问题

管理工作台里「需要授权」的分类下的知识库，不应以该分类名出现在其他人的桌面侧栏。其他人只能通过广场发现并申请订阅；所有者本人在侧栏「订阅知识库」中直接可见，无需再进广场。仅在管理员同意后，申请人才在「订阅知识库」中看到该库，并应能取消订阅，使该库重新回到广场。

## 决策

`require_auth` 为 true 的分类中，已上架知识库通过 `GET /api/knowledge-bases/plaza` 向登录用户展示（排除调用者自己拥有的库，以及已对调用者批准订阅或已有用户授权的库），`subscription_status` 仅为 `none` 或 `pending`。已订阅库只出现在侧栏「订阅知识库」。桌面侧栏不以授权分类名建分组：个人知识库之后只展示有库的公开分类，并把当前用户可访问的授权分类库统一放在「订阅知识库」。侧栏底部「知识库广场」打开广场。点击卡片进入详情，「订阅」调用 `POST /api/knowledge-bases/:id/subscribe`，写入一条指向该知识库（及其所有者语境）的待审 `knowledge_subscription_applications` 记录。从「订阅知识库」打开某库时提供「取消订阅」，调用 `DELETE /api/knowledge-bases/:id/subscribe`，删除该用户授权并将申请标为拒绝，使该库重新出现在广场以便再次订阅。

管理工作台知识库页提供「审核」，分页读取 `GET /api/knowledge-admin/subscription-applications` 的待审列表。通过 `POST /api/knowledge-admin/subscription-applications/:id/review` 且 `decision: approve` 时写入用户授权，使 `ListAuthorizedKnowledgeBases` 对该申请人包含该库；`reject` 则标记拒绝并保持不可访问。文档与问答路由仍要求授权；广场只暴露目录元数据。

无需授权的分类（`require_auth` false）仍遵循 [知识库分类](2026-10-23-knowledge-library-categories.zh.md) 的侧栏与可见性规则。

## 考虑过的替代方案

**继续把需要授权的分类做成桌面侧栏分组，只靠管理员手写授权：**不采用。用户没有与广场、订阅流程匹配的自助发现与申请路径。

**由知识库所有者在个人接口上审核：**本版不采用。审核界面落在既有管理员知识库工作台；申请记录仍标出目标知识库及其所有者供审核人查看。

**广场详情在无授权时也可打开文档：**不采用。浏览正文会绕过分类记录的授权开关。

**已批准库仍留在广场并以禁用的「已订阅」展示：**不采用。订阅集合已在「订阅知识库」；广场重复卡片干扰发现与取消订阅。

## 后果

桌面 Host、Client 与 OneAPI 须同时发布广场、订阅、取消订阅与审核路由。同意申请是用户自助订阅的授权路径；部门授权与直接授权 API 仍可用于共享式管理。取消订阅只移除该用户的用户授权与订阅申请，不影响部门授权。删除知识库时一并删除其订阅申请与授权。
