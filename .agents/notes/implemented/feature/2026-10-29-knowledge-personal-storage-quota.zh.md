# Agent Note：个人知识库存储容量限制

Status: implemented

[English](2026-10-29-knowledge-personal-storage-quota.md) | 中文

## 问题

管理员需要限制整套部署里个人知识库合计可用的存储量，并可按人设置上限。若管理工作台没有开关与上传校验，个人库除单文件 20MB 外没有产品级总量约束。

## 决策

系统设置新增「知识库设置」页签，提供默认关闭的「文件大小限制」开关。开启后点「设置」弹出对话框，配置个人知识库总量（MB），并按组织架构为具体人员分配可选额度。策略写入 `SystemDeploymentSettings.knowledgeQuota`，结构为 `{ enabled, totalBytes, allocations: [{ userId, quotaBytes }] }`。开启时保存必须有正的总量，且各人分配之和不得超过总量。上传以及复制/移动到个人库时调用 `enforcePersonalKnowledgeQuota`：仅设总量时，全部个人库的 RAGFlow 文档字节加本次文件不得超过总量；若某人有分配，则该所有者不得超过本人额度，且全体合计仍不得超过总量。超限返回中文友好提示。共享库与公共库不受影响。桌面 `GetDesktopConfig` 会清空 `knowledgeQuota`，避免登录前接口暴露管理策略。组织浏览见 [个人知识库按组织架构目录](2026-10-29-knowledge-personal-directory-by-organization.zh.md)。

## 考虑过的替代方案

**使用独立于 SystemDeploymentSettings 的 option 键：** 本变更不采用，以沿用现有仅超级管理员的 options 读写与表单脏状态；该字段在桌面配置响应中省略。

**仅在本地数据库列累计用量：** 延期。当前与广场统计一样汇总 RAGFlow 文档大小；RAGFlow 或列表不可用时失败关闭，不允许绕过。

**做成单文件大小开关而非总量：** 不采用。需求是个人库总量与按人份额；单文件 20MB 限制保持独立。

## 后果

开启开关但未设总量时无法保存，须先在对话框填写。未单独分配的人共用剩余总量。已分配的人有个人硬顶，并计入总量。开启后个人库上传会增加 RAGFlow 列表延迟。

## 测试

OneAPI controller 测试覆盖配额解析、总量与个人超额提示，以及部署配置校验。管理工作台 SystemSettings 测试覆盖新页签、对话框分配保存，以及未设总量时禁止保存。辅助函数单测覆盖 MB 换算与规范化。
