---
name: market-gis-third-survey-analysis
description: 分析 GeoJSON 面范围的三调土地利用现状与图斑；当用户要求调用 ZJUGIS GIS_Service 开展三调现状分析时使用。
---

# 三调土地利用现状分析

使用本技能目录中的 `scripts/invoke.ps1` 调用三调现状分析服务。需要接口字段说明时读取 `references/api.md`。

## 输入

- 当前工作区中的 Polygon 或 MultiPolygon GeoJSON 文件。
- 三调年度，默认 2024。
- 输入坐标系说明。坐标系未知时先询问用户。

## 执行

1. 在 Workspace Write 模式下，调用脚本前先获得网络访问授权；完全访问模式按当前授权直接执行。
2. 使用 Windows PowerShell 运行：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <技能目录>/scripts/invoke.ps1 -GeoJsonFile <文件路径> -OutputDirectory <当前工作区>`。
3. 用户指定年度时追加 `-Xznf <年度>`；运维指定其他服务地址时追加 `-BaseUrl <地址>`。
4. 保留脚本生成的时间戳 JSON，不覆盖已有文件。

## 交付

- 原始三调分析结果 JSON。
- 简要说明输入范围、年度、请求参数和输出路径。

只有服务真实返回字段可以确认时才能生成分类统计。字段含义未知时保留原始结果，不得猜测地类或面积含义。
