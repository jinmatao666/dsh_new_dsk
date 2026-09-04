---
name: market-gis-third-survey-analysis
description: 分析 GeoJSON 或 Shape 面范围的三调土地利用现状与图斑；当用户要求调用 ZJUGIS GIS_Service 开展三调现状分析时使用。
---

# 三调土地利用现状分析

使用本技能目录中的 `scripts/invoke.ps1` 调用三调现状分析服务。需要接口字段说明时读取 `references/api.md`。

## 输入

- 当前工作区中的 Polygon 或 MultiPolygon GeoJSON、`.shp` 文件、完整 Shape 文件夹，或包含完整 Shape 文件的 ZIP。
- Shape 数据集至少需要同名的 `.shp`、`.shx`、`.dbf` 文件；优先读取 `.prj` 坐标系和 `.dbf` 属性字段。
- 用户只给出一个 ZIP、文件夹或 `.shp` 时直接使用；工作区存在多个候选数据集且用户未指定时才询问。只有无法从 `.prj` 或用户说明确定坐标系时才询问用户。
- 三调年度，默认 2024。
- 输入坐标系说明。坐标系未知时先询问用户。

## 执行

1. 当前已是 Workspace Write 时直接运行脚本，不得再次申请 `workspace-write` 提权；只有命令执行器单独要求外部网络授权时才等待用户确认。完全访问模式按当前授权直接执行。
2. 使用 Windows PowerShell 运行：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <技能目录>/scripts/invoke.ps1 -InputPath <GeoJSON、.shp、ZIP 或文件夹路径> -OutputDirectory <当前工作区>`。
3. 用户指定年度时追加 `-Xznf <年度>`；运维指定其他服务地址时追加 `-BaseUrl <地址>`。
4. 脚本只在临时目录解压和转换 Shape 数据，结束后清理过程文件；保留带时间戳的原始 JSON、Excel 分析表、Word 专业报告和 Markdown 分析底稿，不覆盖已有文件。Excel 分析表生成后会尝试用系统默认表格应用打开。

## 交付

- 原始三调分析结果 JSON。
- Excel 分析表，包含“分析结论”和“接口明细”工作表，以表格呈现全部实际返回字段。
- Word 专业分析报告，详细说明输入核验、分类统计、记录数、面积或地类信息、结构研判、专业建议和数据限制。
- Markdown 分析底稿。读取 `references/api.md` 与全部产物后，在对话中先给出“结果表格”，用 Markdown 表格列出接口实际返回的关键字段、取值和已确认含义；再用中文给出详尽的地类结构研判、面积统计说明、专业建议、数据限制和四个输出路径。Excel 或 Word 任一文件未生成时，必须明确报告交付失败，不能宣称分析完成；接口名、字段代码和文件名保留原文。

只可依据 `references/api.md` 已定义的字段生成分类统计。未定义字段保留原始结果，不得猜测地类或面积含义。
