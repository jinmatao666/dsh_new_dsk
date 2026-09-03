---
name: market-gis-geology-analysis
description: 分析 GeoJSON 面范围内的地质灾害隐患分区和地质环境条件；当用户要求调用 ZJUGIS GIS_Service 开展地质条件分析时使用。
---

# 地质条件分析

使用本技能目录中的 `scripts/invoke.ps1` 调用地质条件分析服务。需要接口字段说明时读取 `references/api.md`。

## 输入

- 当前工作区中的 Polygon 或 MultiPolygon GeoJSON 文件。
- 输入坐标系说明。坐标系未知时先询问用户，不得混用经纬度与投影坐标。
- 可选分区名称字段，默认“分区名称”。

## 执行

1. 在 Workspace Write 模式下，调用脚本前先获得网络访问授权；完全访问模式按当前授权直接执行。
2. 使用 Windows PowerShell 运行：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <技能目录>/scripts/invoke.ps1 -GeoJsonFile <文件路径> -OutputDirectory <当前工作区>`。
3. 用户指定字段时追加 `-YfxFieldName <字段名>`；运维指定其他服务地址时追加 `-BaseUrl <地址>`。
4. 保留脚本生成的时间戳 JSON，不覆盖已有文件。

## 交付

- 原始分析结果 JSON。
- 简要说明输入范围、服务地址、分析开关和输出路径。

只概述接口真实返回的字段。字段含义不明确时保留原字段名并标注“待 GIS 服务字段字典确认”，不得虚构地质结论。
