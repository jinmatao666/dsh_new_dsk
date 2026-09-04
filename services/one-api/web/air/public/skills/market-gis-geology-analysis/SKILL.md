---
name: market-gis-geology-analysis
description: 分析 GeoJSON 或 Shape 面范围内的地质灾害隐患分区和地质环境条件；当用户要求调用 ZJUGIS GIS_Service 开展地质条件分析时使用。
---

# 地质条件分析

使用本技能目录中的 `scripts/invoke.ps1` 调用地质条件分析服务。需要接口字段说明时读取 `references/api.md`。

## 输入

- 当前工作区中的 Polygon 或 MultiPolygon GeoJSON、`.shp` 文件、完整 Shape 文件夹，或包含完整 Shape 文件的 ZIP。
- Shape 数据集至少需要同名的 `.shp`、`.shx`、`.dbf` 文件；`.prj` 用于自动识别坐标系，存在 `.cpg` 时将其随数据集一并保留。
- 优先读取 `.prj` 和 `.dbf` 字段。用户只给出一个 ZIP、文件夹或 `.shp` 时直接使用；工作区存在多个候选数据集且用户未指定时才询问。
- 只有无法从 `.prj` 或用户说明确定坐标系时才询问用户，不得混用经纬度与投影坐标。
- 可选分区名称字段，默认“分区名称”。

## 执行

1. 当前已是 Workspace Write 时直接运行脚本，不得再次申请 `workspace-write` 提权；只有命令执行器单独要求外部网络授权时才等待用户确认。完全访问模式按当前授权直接执行。
2. 使用 Windows PowerShell 运行：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <技能目录>/scripts/invoke.ps1 -InputPath <GeoJSON、.shp、ZIP 或文件夹路径> -OutputDirectory <当前工作区>`。
3. 用户指定字段时追加 `-YfxFieldName <字段名>`；运维指定其他服务地址时追加 `-BaseUrl <地址>`。
4. 脚本仅临时解压和转换 Shape 数据，结束后清理过程文件；只保留带时间戳的原始 JSON 和 Markdown 分析文档，不覆盖已有文件。

## 交付

- 原始分析结果 JSON。
- Markdown 分析文档，包含自动识别的输入类型、坐标系、属性字段、返回字段和记录数。
- 读取 `references/api.md` 与两份产物后，在对话中说明已定义的实际返回字段、输入范围和两个输出路径。

只概述 `references/api.md` 已定义且接口实际返回的字段。字段含义不明确时保留原字段名并标注“待 GIS 服务字段字典确认”，不得虚构地质结论。
