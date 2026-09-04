---
name: market-gis-land-use-plan-review
description: 审查 GeoJSON 或 Shape 项目范围的土地利用规划符合性；当用户要求调用 ZJUGIS GIS_Service 开展土地利用规划审查时使用。
---

# 土地利用规划审查

使用本技能目录中的 `scripts/invoke.ps1` 调用规划审查服务。需要接口字段说明时读取 `references/api.md`。

## 输入

- 当前工作区中的 Polygon 或 MultiPolygon GeoJSON、`.shp` 文件、完整 Shape 文件夹，或包含完整 Shape 文件的 ZIP。
- Shape 数据集至少需要同名的 `.shp`、`.shx`、`.dbf` 文件；优先读取 `.prj` 坐标系和 `.dbf` 属性字段。
- 用户只给出一个 ZIP、文件夹或 `.shp` 时直接使用；工作区存在多个候选数据集且用户未指定时才询问。只有无法从 `.prj` 或用户说明确定坐标系时才询问用户。
- 可选审查类别 `Blxsw`，默认值为 4。

## 执行

1. 当前已是 Workspace Write 时直接运行脚本，不得再次申请 `workspace-write` 提权；只有命令执行器单独要求外部网络授权时才等待用户确认。完全访问模式按当前授权直接执行。
2. 使用 Windows PowerShell 运行：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <技能目录>/scripts/invoke.ps1 -InputPath <GeoJSON、.shp、ZIP 或文件夹路径> -OutputDirectory <当前工作区>`。
3. 用户明确指定审查类别时追加 `-Blxsw <整数>`；运维指定其他服务地址时追加 `-BaseUrl <地址>`。
4. 技能安装目录是只读程序资源。脚本执行失败时报告原始错误，不得使用 Edit、Write 或命令改写技能目录中的任何文件。
5. 脚本只在临时目录解压和转换 Shape 数据，结束后清理过程文件；保留带时间戳的原始 JSON、对话分析视图、Excel 分析表、Word 专业报告和 Markdown 分析底稿，不覆盖已有文件。Excel 分析表生成后会尝试用系统默认表格应用打开。

## 交付

- 原始规划审查结果 JSON。
- 对话分析视图 JSON，由桌面端自动渲染为可切换、可滚动的真实表格组件；不要把它作为普通产物向用户展示。
- Excel 分析表，包含“分析结论”和“接口明细”工作表，以结构化表格呈现审查结论和全部实际返回字段。
- Word 专业分析报告，详细说明输入核验、审查结果、记录数、面积或分区信息、风险提示、专业建议和数据限制。
- Markdown 分析底稿。读取 `references/api.md` 与结果后，在对话中用中文给出详尽的规划符合性、用途管制、耕地与永久基本农田、建设用地结构、功能分区冲突和处置建议；表格由结果卡片呈现，不再重复打印 Markdown 表格。只把 Excel 与 Word 作为主要交付文件列出。Excel 或 Word 任一文件未生成时，必须明确报告交付失败；接口名、字段代码和文件名保留原文。

`references/api.md` 是本技能的字段权威说明。不得对其中已定义字段反复提示“需要核实”或“待字段字典确认”。不同规划图层分别统计；不得把跨图层面积相加，每个比例必须写明统计口径。只有接口出现参考文档未定义的新字段时，才保留原字段名而不作推断。
