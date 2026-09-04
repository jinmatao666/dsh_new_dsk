# GIS_Service 地质条件分析接口

- 方法：`POST`
- 路径：`/Analysis.svc/OneKeyAnalysis`
- 内容类型：`text/plain; charset=utf-8`
- `GeoJson`：ArcGIS `{ hasZ, hasM, rings }` 对象序列化后的字符串
- 固定开关：`IsAnaXzCoverBp=false`、`IsAnaDzzhyfqk=true`、`IsAnaDzhjtj=true`
- `YfxFieldName`：分区名称字段，默认“分区名称”

## 已确认的返回字段

| 返回属性 | 含义 | 可安全解读的字段 |
| --- | --- | --- |
| `YZT_DZHJTJ_LIST` | 地质环境条件列表 | `DZHJTJ` 地质环境条件。 |
| `YZT_DZZHYFQK_LIST` | 地质灾害易发区情况列表 | `FQMC` 分区名称、`DJ` 等级、`ZYMJ` 占用面积。 |

必须原样保存响应。仅解读本页已定义字段；其他字段的地质业务含义未确认时保留原字段名，不得猜测。
