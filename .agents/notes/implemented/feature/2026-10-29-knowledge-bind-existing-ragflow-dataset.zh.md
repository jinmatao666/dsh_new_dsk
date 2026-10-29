# Agent Note: 管理工作台关联已有 RAGFlow 知识库

Status: implemented

中文 | [English](2026-10-29-knowledge-bind-existing-ragflow-dataset.md)

## 问题

用户常已在 RAGFlow 知识库管理平台（`{RAGFLOW_BASE_URL}/datasets`）建好知识库。新建原先只会调用 RAGFlow 创建空白库，已有内容无法直接归入 OneAPI，除非重新上传。

## 决策

新建为每位已登录用户提供两种来源：新建空白 RAGFlow 知识库（行为不变），或关联 `GET {RAGFLOW_BASE_URL}/api/v1/datasets`（使用已配置的 `RAGFLOW_API_KEY`）已返回的知识库。`GET /api/knowledge-bases/ragflow-datasets` 与 `GET /api/knowledge-admin/ragflow-datasets`（均为 UserAuth）遍历该列表，并排除已写入 `knowledge_bases.ragflow_dataset_id` 的编号。`POST /api/knowledge-bases` 与 `POST /api/knowledge-admin/bases` 接受可选的 `ragflow_dataset_id`：OneAPI 校验知识库存在，对重复关联返回 409，写入本地库记录，且该路径不调用 RAGFlow 创建，也不在失败时补偿删除。关联之后，文件与删除行为与其它受管知识库相同。

## 曾考虑的替代方案

**打开 RAGFlow 页面并让用户粘贴知识库编号：** 否决，因为 OneAPI 服务端已持有 API 密钥，可直接列库而不向浏览器暴露凭据。

**自动把所有未绑定知识库导入管理工作台：** 否决，因为归入分类、命名、封面与上架仍须由用户显式选择。

**仅允许管理员关联：** 否决；凡可新建知识库的已登录用户，均可将未绑定的 RAGFlow 知识库关联到自己的（或分类下的）本地库。

## 后果

OneAPI 的 `RAGFLOW_BASE_URL` 与 `RAGFLOW_API_KEY` 必须指向用户在浏览器中使用的同一 RAGFlow 源。关联不会复制文件；本地库指向已有 dataset id。删除本地知识库仍会删除该 RAGFlow 知识库。已绑定到本地行的知识库不会出现在选择列表中。选择列表展示该共享 API 密钥可见的全部未绑定库，因此同一 RAGFlow 租户被多名 OneAPI 用户共用时，创建者都能看到这份库存。

## 测试

RAGFlow 客户端测试覆盖带信封字段 `total_datasets` 的分页列表、按 id 读取与翻页。OneAPI 控制器测试覆盖未绑定列表过滤、管理员与普通用户成功关联且不创建远端库，以及重复关联冲突。管理工作台页面测试对管理员与普通用户均选择「选择已有知识库」并提交 `ragflow_dataset_id`。
