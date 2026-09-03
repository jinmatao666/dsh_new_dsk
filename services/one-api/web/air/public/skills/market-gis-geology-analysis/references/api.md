# GIS_Service 地质条件分析接口

- 方法：`POST`
- 路径：`/Analysis.svc/OneKeyAnalysis`
- 内容类型：`text/plain; charset=utf-8`
- `GeoJson`：ArcGIS `{ hasZ, hasM, rings }` 对象序列化后的字符串
- 固定开关：`IsAnaXzCoverBp=false`、`IsAnaDzzhyfqk=true`、`IsAnaDzhjtj=true`
- `YfxFieldName`：分区名称字段，默认“分区名称”

服务尚未提供稳定的响应字段字典。脚本原样保存响应，调用者不得根据未知字段推断地质含义。
