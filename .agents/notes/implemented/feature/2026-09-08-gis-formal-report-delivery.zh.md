# Agent Note: GIS 正式报告交付

Status: implemented

[English](2026-09-08-gis-formal-report-delivery.md) | 中文

## Problem

三个 GIS Skill 将 Markdown 分析底稿直接写入 Word 正文。完整坐标系 WKT、属性字段代码、数据路径、Markdown 强调标记和原始接口链接使成果难以作为正式报告阅读。

## Decision

每个 GIS Skill 的 Word 正文统一为“项目与数据概况、核心分析结论、专业研判、实施建议与结论、数据来源与使用限制”。项目概况使用紧凑表格，仅保留数据类型、要素数量、可获得时的项目面积和可读的坐标系说明。正文不展示原始数据路径、完整 WKT、属性字段代码和原始响应链接；这些内容保留在 JSON 与 Excel 交付物中用于追溯。

三个 Skill 保留各自的结果汇总表和领域分析文字。示例包版本统一为 `1.4.6`，管理员发布后，已安装的桌面端可识别这次报告版式更新。

## Alternatives considered

**在 Word 正文保留全部原始字段** — 不采用。追溯不要求向报告读者暴露内部 GIS 记录；现有 Excel 与 JSON 交付物保留这些细节。

**只生成通用文字而不保留 Skill 专项结果表** — 不采用。三个服务回答的问题不同，因此结果汇总保持专项化，文档层级保持统一。

## Consequences

读者获得突出结论与项目影响的简洁报告。管理员仍可获得原始响应数据进行审计和排错，但需要通过动态 Skill 发布流程发布 `1.4.6` 包，桌面端市场才会分发新版报告生成器。

## Verification

三个导出器均使用代表性地质响应生成 DOCX 与 XLSX。DOCX XML 解析确认五个正式章节存在，且 Word 正文不含完整 WKT、属性字段、数据路径、JSON 链接或 Markdown 强调标记。由于本机没有可供文档渲染器调用的 LibreOffice 或 Microsoft Word，视觉渲染验证暂缓。
