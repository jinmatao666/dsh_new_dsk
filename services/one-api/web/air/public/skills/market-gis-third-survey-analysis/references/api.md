# GIS_Service 三调土地利用现状分析接口

- 方法：`POST`
- 路径：`/Analysis.svc/SanDXzAnalysis`
- 内容类型：`text/plain; charset=utf-8`
- `GeoJson`：ArcGIS `{ hasZ, hasM, rings }` 对象序列化后的字符串
- `Xznf`：三调年度，默认 2024
- `Blxsw`：当前示例值为 4
- 分析开关与原始 Apifox 示例保持一致

## 已确认的返回字段

| 返回属性 | 含义 | 可安全解读的字段 |
| --- | --- | --- |
| `YZT_TDFLMJB_HZB` | 土地分类面积汇总表 | `HJMJ` 合计面积、`GDMJ` 耕地面积、`JSYDMJ` 建设用地面积、`GYJSYDMJ` 国有建设用地面积、`JTJSYDMJ` 集体建设用地面积、`WLYDMJ` 未利用地面积、`NYDMJ` 农用地面积、`JBNTMJ` 基本农田面积。 |
| `YZT_TDFLMJB` | 一个地块的土地分类面积信息 | `QSDWDM` 权属单位代码、`QSDWMC` 权属单位名称；其他地类面积属性使用对应地类名称的拼音首字母缩写。 |
| `YZT_DKDLMJB` | 一个地块按不同地类切分后的面积信息 | `DLBM` 地类编码、`DLMC` 地类名称。 |
| `YZT_TDQSDLMJ` | 按权属单位汇总的土地权属地类面积信息 | 记录含义与 `YZT_TDFLMJB` 相近，每个权属单位一条记录。 |

必须保存原始响应。仅解读本页列出的字段；其他字段的业务含义未确认时保留原字段名，不得猜测。
