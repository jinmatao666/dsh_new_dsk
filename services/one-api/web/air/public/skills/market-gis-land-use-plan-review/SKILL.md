---
name: market-gis-land-use-plan-review
description: 审查 GeoJSON 项目范围的土地利用规划符合性；当用户要求调用 ZJUGIS GIS_Service 开展土地利用规划审查时使用。
---

# 土地利用规划审查

使用本技能目录中的 `scripts/invoke.ps1` 调用规划审查服务。需要接口字段说明时读取 `references/api.md`。

## 输入

- 当前工作区中的 Polygon 或 MultiPolygon GeoJSON 文件。
- 输入坐标系说明。坐标系未知时先询问用户。
- 可选审查类别 `Blxsw`，默认值为 4。

## 执行

1. 在 Workspace Write 模式下，调用脚本前先获得网络访问授权；完全访问模式按当前授权直接执行。
2. 使用 Windows PowerShell 运行：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <技能目录>/scripts/invoke.ps1 -GeoJsonFile <文件路径> -OutputDirectory <当前工作区>`。
3. 用户明确指定审查类别时追加 `-Blxsw <整数>`；运维指定其他服务地址时追加 `-BaseUrl <地址>`。
4. 保留脚本生成的时间戳 JSON，不覆盖已有文件。

## 交付

- 原始规划审查结果 JSON。
- 简要说明输入范围、请求参数和输出路径。

`Blxsw` 与 `IsAnaGhWithCZJSKZQ` 的业务字典尚未提供。除非用户给出明确取值，不要修改默认值或臆造审查结论。
