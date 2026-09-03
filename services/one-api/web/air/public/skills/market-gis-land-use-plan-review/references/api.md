# GIS_Service 土地利用规划审查接口

- 方法：`POST`
- 路径：`/Analysis.svc/OneKeyAnalysis`
- 内容类型：`text/plain; charset=utf-8`
- `GeoJson`：ArcGIS `{ hasZ, hasM, rings }` 对象序列化后的字符串
- `Blxsw`：审查类别，当前默认值为 4
- 固定开关：`IsAnaXzCoverBp=false`、`IsAnaGh=true`、`IsAnaGhWithCZJSKZQ=false`

服务尚未提供 `Blxsw` 和返回字段的完整业务字典。必须保留原始响应，不能根据字段名称猜测规划结论。
