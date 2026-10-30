# Agent Note：知识库订阅广场

Status: implemented

[English](2026-10-23-knowledge-library-subscription.md) | 中文

## 问题

管理工作台里「需要授权」的分类下的知识库，不应以该分类名出现在其他人的桌面侧栏。其他人只能通过广场发现并申请订阅；仅在管理员同意后，申请人才在「订阅知识库」中看到该库，并应能取消订阅，使该库重新回到广场。

## 决策

`require_auth` 为 true 的分类中，已上架知识库通过 `GET /api/knowledge-bases/plaza` 向登录用户展示。已获授权的调用者看到 `subscription_status: approved`；其余为 `none` 或 `pending`；调用者自建库为 `owned` 并排在列表最后（见 [自建授权库在广场标「我的」](2026-10-30-knowledge-owned-on-plaza.zh.md)）。桌面 `GET /api/knowledge-bases` 始终走 `ListAuthorizedKnowledgeBases`，并为每行标注 `owned_by_viewer` 与 `subscribed_by_viewer`（非所有者且持有授权）；管理员全量目录只在 `/api/knowledge-admin/bases`，不得灌进桌面列表。桌面侧栏不以授权分类名建分组：固定显示「个人知识库」和「订阅知识库」（无库时显示「暂无知识库」）；「公共知识库」合并全部无需授权的公开库（有库才显示）；「订阅知识库」只列 `subscribed_by_viewer` 行。广场状态为 `none` 的库不得同时出现在「订阅知识库」。广场卡片展示名称、摘要、维护者、更新时间、文件数量、文件大小和已订阅人数（`document_count`、`document_bytes`、`subscriber_count`）。库上存有 `cover` 图片数据 URL 时，卡片和详情使用该图；否则仍用预制的自然资源封面（[知识库封面](2026-10-29-knowledge-library-cover.zh.md)）。点击卡片进入详情，状态为 `none` 时「订阅」调用 `POST /api/knowledge-bases/:id/subscribe`。已订阅与「我的」详情的分栏问答与打开文件由 [广场保留已订阅库并分栏问答](2026-10-29-knowledge-plaza-subscribed-qa.zh.md) 与 [自建授权库在广场标「我的」](2026-10-30-knowledge-owned-on-plaza.zh.md) 负责。从「订阅知识库」打开已授权（非自建）库时提供「取消订阅」；自建库不提供该按钮。

管理工作台知识库页提供「审核」，分页读取 `GET /api/knowledge-admin/subscription-applications` 的待审列表。通过 `POST /api/knowledge-admin/subscription-applications/:id/review` 且 `decision: approve` 时写入用户授权，使 `ListAuthorizedKnowledgeBases` 对该申请人包含该库；`reject` 则标记拒绝并保持不可访问。文件字节与问答仍要求授权；广场目录名称在未授权前仍可见。

无需授权的分类（`require_auth` false）仍遵循 [知识库分类](2026-10-23-knowledge-library-categories.zh.md) 的侧栏与可见性规则。

## 考虑过的替代方案

**继续把需要授权的分类做成桌面侧栏分组，只靠管理员手写授权：**不采用。用户没有与广场、订阅流程匹配的自助发现与申请路径。

**由知识库所有者在个人接口上审核：**本版不采用。审核界面落在既有管理员知识库工作台；申请记录仍标出目标知识库及其所有者供审核人查看。

**广场详情在无授权时也可打开文档：**不采用。浏览正文会绕过分类记录的授权开关。

**已批准库仍留在广场并以禁用的「已订阅」展示：**原先因重复发现而否决；现已由 [广场保留已订阅库并分栏问答](2026-10-29-knowledge-plaza-subscribed-qa.zh.md) 取代——已订阅卡片留在广场并分栏问答。

**管理员桌面列表返回托管全量目录：**不采用。授权分类库会未订阅就进入「订阅知识库」，创建者广场为空，取消订阅报「该知识库不支持订阅申请」。

## 后果

桌面 Host、Client 与 OneAPI 须同时发布广场、订阅、取消订阅与审核路由。同意申请是用户自助订阅的授权路径；部门授权与直接授权 API 仍可用于共享式管理。取消订阅只移除该用户的用户授权与订阅申请，不影响部门授权。删除知识库时一并删除其订阅申请与授权。
