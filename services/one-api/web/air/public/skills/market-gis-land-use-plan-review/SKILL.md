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
4. 脚本只在临时目录解压和转换 Shape 数据，结束后清理过程文件；仅保留带时间戳的原始 JSON 和 Markdown 分析文档，不覆盖已有文件。

## 交付

- 原始规划审查结果 JSON。
- Markdown 分析文档，以中文说明输入核验、已确认字段的审查结果、记录数、面积或分区信息和数据限制。
- 读取 `references/api.md` 与两份产物后，在对话中用中文概述已定义的实际返回字段、请求参数和两个输出路径；接口名、字段代码和文件名保留原文。

`Blxsw` 与 `IsAnaGhWithCZJSKZQ` 的业务字典尚未提供。除 `references/api.md` 已定义字段外，不要修改默认值或臆造审查结论。
