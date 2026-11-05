# Agent Note: 管理工作台知识库文件清单视觉对齐

Status: implemented

[English](2026-11-04-workbench-knowledge-file-list-design.md) | 中文

## Problem

管理工作台知识库文件清单（`{name}-文件清单`）与个人人员文件清单在目录页头对齐之后，仍使用 Lucide 行操作、扁平表盘与短分页，与 js.design 文件清单画板不一致。

## Decision

在不改文档接口、上传上限与解析轮询的前提下，把两类文件清单对齐 js.design 清单画板。打开库标题为 `{name}-文件清单`；返回为描边文字按钮；上传为实心 `#106af3` 并配 `icon-file-upload.png`。搜索为通栏输入加贴边蓝色「搜索」。表格置于白卡片（边框 `#e8edf5`、`box-shadow: 0 3px 4px`、表头 `#eff6ff`）。行操作以 `services/one-api/web/air/public/knowledge-icons/` 下切图（`icon-file-browse.png`、`icon-file-download.png`、`icon-file-chunks.png`、`icon-file-summary.png`、`icon-file-delete.png`）替换 Lucide。分页对齐桌面知识库条：蓝色条数「共 N 条，每页20条」、`第 x 页 / y`、上一页/下一页、页码与「跳至 [输入] 页」（回车提交）。个人人员文件清单复用同一卡片、切图与分页；列与「预览」文案不变。订阅审核分页仍用原有 `zjugis-table-pagination`。

## Alternatives considered

**只改打开库清单、人员清单继续用 Lucide。** 否决：两套清单共用同一画板，个人标签下会来回切换。

**用 Lucide 加 CSS 近似操作图标。** 否决：产品切图为视觉真源，与个人目录顶栏及桌面 knowledge-covers 一致（见[个人知识库目录视觉对齐](2026-11-04-workbench-personal-knowledge-directory-design.zh.md)）。

**分页用单独「跳转」按钮。** 否决：画板无该按钮，桌面知识库分页已用回车提交。

## Consequences

管理工作台构建需带上新增的六枚 `icon-file-*.png`，否则图标 404，但布局与操作仍可用。文档加载、多文件上传（20MB）、解析轮询及管理员摘要/重新解析仍见 [RAGFlow 知识库](2026-10-21-ragflow-knowledge-library.zh.md)。
