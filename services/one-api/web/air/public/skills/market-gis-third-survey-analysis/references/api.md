# GIS_Service 三调土地利用现状分析接口

- 方法：`POST`
- 路径：`/Analysis.svc/SanDXzAnalysis`
- 内容类型：`text/plain; charset=utf-8`
- `GeoJson`：ArcGIS `{ hasZ, hasM, rings }` 对象序列化后的字符串
- `Xznf`：三调年度，默认 2024
- `Blxsw`：当前示例值为 4
- 分析开关与原始 Apifox 示例保持一致

服务尚未提供稳定的响应字段字典。必须保存原始响应；只有字段含义得到确认后才能做分类汇总。
