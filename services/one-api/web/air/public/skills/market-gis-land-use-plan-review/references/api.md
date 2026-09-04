# GIS_Service 土地利用规划审查接口

- 方法：`POST`
- 路径：`/Analysis.svc/OneKeyAnalysis`
- 内容类型：`text/plain; charset=utf-8`
- `GeoJson`：ArcGIS `{ hasZ, hasM, rings }` 对象序列化后的字符串
- `Blxsw`：审查类别，当前默认值为 4
- 固定开关：`IsAnaXzCoverBp=false`、`IsAnaGh=true`、`IsAnaGhWithCZJSKZQ=false`

## 已确认的返回字段

| 返回属性 | 含义 | 可安全解读的字段 |
| --- | --- | --- |
| `YZT_GHSCB` | 规划审查表 | `SFZXCQFW` 是否位于重点城区范围、`YDZMJ` 用地总面积、`YXJSQMJ` 允许建设区面积、`YTJJSQMJ` 有条件建设区面积、`XZJSQMJ` 限制建设区面积、`JZJSQMJ` 禁止建设区面积、`SFZYJBNT` 是否占用永久基本农田、`JBNTMJ` 占用基本农田面积。 |
| `YZT_GNQMJB_LIST` | 功能区面积表 | 由允许建设区、有条件建设区等功能分区切分后的地块信息；只有服务返回的字段与值可确认时才概述。 |

`Blxsw` 的完整业务字典尚未提供。必须保留原始响应；除本页已定义字段外，不能根据字段名称猜测规划结论。
