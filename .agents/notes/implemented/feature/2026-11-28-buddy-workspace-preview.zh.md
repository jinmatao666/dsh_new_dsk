# Agent Note: Buddy 工作区文件预览

[English](2026-11-28-buddy-workspace-preview.md) | 中文

## Problem

Buddy 需要工作区文件浏览、预览和文件引用，同时支持上游界面包独立升级。

## Decision

面板放在万维产品界面层，受限文件系统操作放在产品桌面壳。复用输入框引用和产物展示接口。支持展开目录、搜索子路径和保存已打开文件标签。DOCX 使用 docx-preview，PDF 使用 pdf.js，工作表使用 SheetJS。旧 Office 格式和演示文稿通过已安装的 LibreOffice 转换。文本编辑和 DOCX 唯一单文本段替换通过摘要校验及临时文件替换保存。

## Alternatives considered

直接引用 Parvis 运行时组件会依赖其 Solid 和后端服务，重写上游面板则增加升级冲突。因此在 React 和桌面桥中适配产品交互。

## Consequences

产品界面与桌面壳需要一起重建。LibreOffice 转换需要本机安装或 SOFFICE_PATH。XLSX 当前最多显示 500 行、50 列的格式化数值。演示文稿渲染、Word 富文本编辑、图片兼容和桌面拖拽仍需继续对齐，并用真实文件对照 Parvis 验收。前端和原生保存、路径测试仅验证已实现部分，不能视为完整迁移效果一致。
