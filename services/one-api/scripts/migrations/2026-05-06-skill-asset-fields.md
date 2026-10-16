# GIS to Excel 技能

将 GDB 图层属性数据填入 Excel 模板表。

## 触发条件

用户需要处理以下任务时使用：
- 将 GIS 数据（GDB）导入 Excel 表格
- 根据模板填写 GIS 属性数据
- 进行单位换算（如亩与平方米的转换）
- 执行数据质检

## 工作流程

### 步骤 1：确认输入文件

确认以下文件存在且路径正确：
- **GDB 数据库**：如 `数据库.gdb`
- **Excel 模板**：如 `模板.xlsx`

### 步骤 2：探查 GDB 图层

检查 GDB 中有哪些图层，以及目标图层的字段结构：

```bash
python scripts/gdb_to_excel.py inspect-gdb 数据库.gdb --layer DCDYTB --sample 3
```

参数说明：
| 参数 | 说明 |
|------|------|
| `--layer` | 指定图层名（不指定则列出所有图层） |
| `--sample` | 每字段显示几条样本（默认 2） |

### 步骤 3：探查 Excel 模板

查看模板表头结构，确认数据起始行：

```bash
python scripts/gdb_to_excel.py inspect-template 模板.xlsx --data-row 6
```

参数说明：
| 参数 | 说明 |
|------|------|
| `--data-row` | 数据起始行号 |

### 步骤 4：建议字段映射

自动对比 GDB 字段名与 Excel 表头，生成映射建议：

```bash
python scripts/gdb_to_excel.py suggest-mapping 数据库.gdb DCDYTB 模板.xlsx --header-row 5
```

参数说明：
| 参数 | 说明 |
|------|------|
| `--header-row` | 表头最后一行行号（默认 5） |

输出包括：
- 每列的表头路径（多层表头会拼接）
- 建议的 GDB 字段名
- 字段类型
- JSON 格式的映射，供下一步使用

### 步骤 5：执行填表

根据建议调整映射后，执行填表：

```bash
python scripts/gdb_to_excel.py fill 数据库.gdb DCDYTB 模板.xlsx \
  --mapping '{"1":"DCDYBH","2":"XZMC","5":"MJ"}' \
  --convert-fields '{"MJ":666.6667}' \
  --data-row 6
```

参数说明：
| 参数 | 说明 |
|------|------|
| `--mapping` | 列号→GDB字段的映射 JSON |
| `--convert-fields` | 需要换算的字段及除数 JSON |
| `--data-row` | 数据起始行（默认 6） |
| `--output` | 输出文件路径（可选） |

换算规则：`写入值 = 原始值 ÷ 除数`，如 `--convert-fields '{"MJ":666.6667}'` 表示亩→平方米（1亩=666.6667平方米）

### 步骤 6：质检（可选）

若需质检，参考 `references/低效用地质检.md` 中的规则进行数据核验。

## 脚本路径

所有命令均通过 `scripts/gdb_to_excel.py` 执行：

```bash
python scripts/gdb_to_excel.py <命令> [参数]
```

查看帮助：

```bash
python scripts/gdb_to_excel.py -h
```

## 注意事项

- 填表结果输出到 `成果<时间戳>/` 目录下，不修改原始模板
- 映射 JSON 的键为 Excel 列号（从 1 开始），值为 GDB 字段名
- 换算字段的值会除以指定的除数，不填则保持原始单位


<!-- file: README.md -->
```md
# gis-to-excel

GDB 图层属性数据 → Excel 填表工具。

## 功能

从 GeoDatabase 图层读取属性数据，按字段映射填入 Excel 模板，支持任意单位换算。

## 目录结构

```
gis-to-excel/
├── SKILL.md                      # 工作流程技能定义（供 AI 助手使用）
├── scripts/
│   └── gdb_to_excel.py           # 核心转换脚本
└── references/
    └── 低效用地质检.md           # 低效用地调查质检规则参考
```

## 快速开始

### 依赖

```bash
pip install fiona openpyxl
```

### 工作流程

**1. 探查 GDB 图层结构**

```bash
python scripts/gdb_to_excel.py inspect-gdb 数据库.gdb --layer DCDYTB
```

**2. 探查 Excel 模板结构**

```bash
python scripts/gdb_to_excel.py inspect-template 模板.xlsx --data-row 6
```

**3. 自动建议字段映射**

```bash
python scripts/gdb_to_excel.py suggest-mapping 数据库.gdb DCDYTB 模板.xlsx --header-row 5
```

**4. 执行填表**

```bash
python scripts/gdb_to_excel.py fill 数据库.gdb DCDYTB 模板.xlsx \
  --mapping '{"1":"DCDYBH","2":"XZMC",...}' \
  --convert-fields '{"MJ":666.6667,...}' \
  --data-row 6
```

输出文件保存在 `成果<时间戳>/` 目录下，不修改原始模板。

## 脚本命令

| 命令 | 说明 |
|------|------|
| `inspect-gdb` | 查看 GDB 图层字段及样本数据 |
| `inspect-template` | 查看 Excel 模板表头结构 |
| `suggest-mapping` | 自动建议 GDB 字段→Excel 列的映射 |
| `fill` | 执行填表 |

详细用法：`python scripts/gdb_to_excel.py -h`

```

<!-- file: references/低效用地质检.md -->
```md
# 低效用地调查 — 质检规则码与填表经验

本文件仅在处理**浙江省低效用地调查年度更新**相关任务时参考。

## 质检规则码分类

| 规则码前缀 | 含义 | 是否可通过重新填表修复 |
|-----------|------|----------------------|
| **10101-1-xx** | 表1-1 清单与 DCQTB 图层不一致 | 是（若任务含表1-1填写） |
| **10101-2-xx** | 表1-2 清单与 DCDYTB 图层不一致 | 是（修正映射后重新填表） |
| **10101-3-xx** | 表1-3 汇总表与 DCQTB 不一致 | 是（若任务含表1-3填写） |
| **10101-4-xx** | 表1-4 汇总表与 DCDYTB 不一致 | 是（若任务含表1-4填写） |
| 3xxx | 属性结构/值域/面积一致性 | 否 — GDB 属性数据问题 |
| 4xxx | 空间拓扑/碎片多边形/已报备地块 | 否 — GDB 空间数据问题 |
| 5xxx | 图层间逻辑一致性（DCQTB↔DCDYTB） | 否 — GDB 数据本身不一致 |
| 8xxx | 与三调变更成果比对 | 否 — GDB 数据问题 |
| 9xxx | 增量库面积变化检查 | 否 — 历史数据比对问题 |

## DCDYTB → 表1-2 已知高频错误（经实际质检验证）

| 规则码 | 检查字段 | 典型表现 | 原因与修正 |
|--------|---------|---------|-----------|
| 10101-2-24 | 审批使用权类型(F26) | GDB SYQLX="G"，Excel="国有" | **映射错误**：该列应映射到 `SYQLX`（代码），不是 `ZDSPSXLX`（文字）。质检器按 SYQLX 字段值比对 |
| 10101-2-14 | 不动产权证号(F16) | Excel为空 | **映射遗漏**：F16 → `BDCQZ` |
| 10101-2-15 | 土地登记时间(F17) | Excel为空 | **映射遗漏**：F17 → `DJSJ` |
| 10101-2-16 | 登记面积(F18) | Excel=0 | **映射遗漏**：F18 → `DJMJ`，面积转亩时需加入 convert-fields |
| 10101-2-05 | 历史遗留用地面积(F7) | Excel=0 | **映射遗漏**：F7 → `QZLSYLYDMJ`，面积转亩时需加入 convert-fields |
| 10101-2-06 | 是否纳入城中村改造(F8) | GDB="是"，Excel="否" | **数据过时**：需以最新 GDB 数据重新填表 |

## DCDYTB → 表1-2 完整映射参考（39列）

**必须逐列核对实际模板后使用**，不同县市模板列序可能不同。

| 列号 | Excel 列头 | GDB 字段 | 说明 |
|-----|-----------|---------|------|
| 1 | 调查单元编号 | `DCDYBH` | |
| 2 | 所在镇（街道）| `XZMC` | |
| 3 | 所在调查区编号 | `DCQBH` | |
| 4 | 包含宗地编号 | `ZDBH` | |
| 5 | 面积 | `MJ` | 转亩 |
| 6 | 使用状况 | `SYZK` | |
| 7 | 历史遗留用地面积 | `QZLSYLYDMJ` | 转亩 |
| 8 | 是否纳入城中村改造项目 | `SFCZC` | |
| 9 | 拟改造模式 | `GZMS` | |
| 10 | 工作进展 | `GZJZ` | |
| 11 | 规划用途 | `GHYT` | |
| 12 | 是否低效 | `SFDX` | |
| 13 | 是否三地 | `SFSD` | |
| 14 | 是否拆后土地 | `SFCHTD` | |
| 15 | 产权人 | `CQR` | |
| 16 | 土地证编号 | `BDCQZ` | |
| 17 | 土地登记时间 | `DJSJ` | |
| 18 | 登记面积 | `DJMJ` | 转亩 |
| 19 | 使用权类型（登记）| `SYQLX` | |
| 20 | 登记用途 | `DJYT` | |
| 21 | 用地单位 | `XZTDSYR` | |
| 22 | 批准文号 | `PZWH` | |
| 23 | 批准时间 | `PZSJ` | |
| 24 | 批准面积 | `PZMJ` | 转亩 |
| 25 | 批准用途 | `PZYT` | |
| 26 | 使用权类型（审批）| `SYQLX` | 同列19，均取 SYQLX |
| 27 | 现状土地使用人 | `XZTDSYR` | |
| 28 | 用地发生时间 | `YDSJ` | |
| 29 | 处罚文号 | `CFWH` | |
| 30 | 现状地类 | `XZDL` | |
| 31 | 权属性质 | `QSXZ` | |
| 32 | 现状用途 | `XZYT` | |
| 33 | 产业类型 | `CYLX` | |
| 34 | 容积率 | `RJL` | |
| 35 | 建筑密度 | `JZMD` | |
| 36 | 地均固定资产投资 | `DJGDZCTZ` | |
| 37 | 地均入库税金 | `DJRKSJ` | |
| 38 | 环境状况 | `HJZK` | |
| 39 | 基础设施配套 | `JCSSPTSP` | |

**易错点**：
- 列26（审批使用权类型）映射到 **`SYQLX`**，**不是** `ZDSPSXLX`
- 列19 和列26 都映射到同一个 GDB 字段 `SYQLX`
- 面积转亩时 `--convert-fields` 必须包含：`MJ`、`DJMJ`、`PZMJ`、`QZLSYLYDMJ`、`WHFSXTDMJ`

## 完整命令参考

```bash
python3 scripts/gdb_to_excel.py fill 数据库.gdb DCDYTB 表1-2模板.xlsx \
  --mapping '{"1":"DCDYBH","2":"XZMC","3":"DCQBH","4":"ZDBH","5":"MJ","6":"SYZK","7":"QZLSYLYDMJ","8":"SFCZC","9":"GZMS","10":"GZJZ","11":"GHYT","12":"SFDX","13":"SFSD","14":"SFCHTD","15":"CQR","16":"BDCQZ","17":"DJSJ","18":"DJMJ","19":"SYQLX","20":"DJYT","21":"XZTDSYR","22":"PZWH","23":"PZSJ","24":"PZMJ","25":"PZYT","26":"SYQLX","27":"XZTDSYR","28":"YDSJ","29":"CFWH","30":"XZDL","31":"QSXZ","32":"XZYT","33":"CYLX","34":"RJL","35":"JZMD","36":"DJGDZCTZ","37":"DJRKSJ","38":"HJZK","39":"JCSSPTSP"}' \
  --convert-fields '{"MJ":666.6667,"DJMJ":666.6667,"PZMJ":666.6667,"QZLSYLYDMJ":666.6667,"WHFSXTDMJ":666.6667}' \
  --data-row 6
```

```

<!-- file: scripts/gdb_to_excel.py -->
```py
#!/usr/bin/env python3
"""
GDB -> Excel 填表工具
从 GeoDatabase 图层读取属性数据，按字段映射填入 Excel 模板。
支持任意单位换算（通过 --convert-fields 指定换算系数）。
"""

import argparse
import json
import os
import sys
from copy import copy
from datetime import datetime

try:
    import fiona
    import openpyxl
except ImportError as e:
    print(f"[ERROR] 缺少依赖: {e}")
    print("请运行: pip3 install fiona openpyxl")
    sys.exit(1)


# ─────────────────────────────────────────────
# 1. 探查 GDB 图层
# ─────────────────────────────────────────────
def inspect_gdb(gdb_path: str, layer: str = None, sample: int = 2):
    """列出图层或打印字段结构及样本数据"""
    layers = fiona.listlayers(gdb_path)
    if layer is None:
        print("可用图层:")
        for i, l in enumerate(layers):
            with fiona.open(gdb_path, layer=l) as src:
                print(f"  [{i}] {l}  ({len(src)} 条记录)")
        return

    if layer not in layers:
        print(f"[ERROR] 图层 '{layer}' 不存在，可用: {layers}")
        sys.exit(1)

    with fiona.open(gdb_path, layer=layer) as src:
        print(f"\n图层: {layer}  ({len(src)} 条记录)")
        print(f"\n{'字段名':<30} {'类型':<20} {'样本值'}")
        print("-" * 70)
        # 收集样本
        samples = []
        for feat in src:
            samples.append(feat["properties"])
            if len(samples) >= sample:
                break
        for name, ftype in src.schema["properties"].items():
            vals = [str(s.get(name, "")) for s in samples]
            print(f"  {name:<28} {ftype:<20} {' | '.join(vals)}")


# ─────────────────────────────────────────────
# 2. 探查 Excel 模板结构
# ─────────────────────────────────────────────
def inspect_template(template_path: str, data_row: int = None):
    """打印模板表头，自动检测数据起始行"""
    wb = openpyxl.load_workbook(template_path)
    ws = wb.active
    print(f"\nExcel 模板: {os.path.basename(template_path)}")
    print(f"工作表: {ws.title}  共 {ws.max_row} 行 x {ws.max_column} 列")

    print("\n各行内容（非空）:")
    for r in range(1, min(11, ws.max_row + 1)):
        row_vals = [(c, ws.cell(r, c).value)
                    for c in range(1, ws.max_column + 1)
                    if ws.cell(r, c).value is not None]
        if row_vals:
            print(f"  行{r}: {[(openpyxl.utils.get_column_letter(c), v) for c, v in row_vals]}")

    if data_row:
        print(f"\n数据起始行: {data_row}")
        print(f"\n{'列':<6} {'字母':<6} 表头路径（从第1行到第{data_row-1}行）")
        print("-" * 60)
        for c in range(1, ws.max_column + 1):
            headers = []
            for r in range(1, data_row):
                v = ws.cell(r, c).value
                if v and str(v).strip():
                    headers.append(str(v).strip())
            if headers:
                letter = openpyxl.utils.get_column_letter(c)
                print(f"  {c:<4} {letter:<6} {' > '.join(headers)}")


# ─────────────────────────────────────────────
# 3. 建议字段映射
# ─────────────────────────────────────────────
def suggest_mapping(gdb_path: str, layer: str, template_path: str, header_row: int):
    """对比 GDB 字段名与 Excel 表头，输出建议映射供人工确认"""
    with fiona.open(gdb_path, layer=layer) as src:
        gdb_fields = list(src.schema["properties"].keys())
        gdb_types  = src.schema["properties"]

    wb = openpyxl.load_workbook(template_path)
    ws = wb.active

    print(f"\n=== 字段映射建议 ===")
    print(f"GDB 图层: {layer}  |  模板: {os.path.basename(template_path)}")
    print(f"\n{'列':<5} {'字母':<5} {'表头':<35} {'建议GDB字段':<25} {'字段类型'}")
    print("-" * 90)

    mapping_json = {}
    for c in range(1, ws.max_column + 1):
        # 收集该列所有非空表头
        header_parts = []
        for r in range(1, header_row):
            v = ws.cell(r, c).value
            if v and str(v).strip():
                header_parts.append(str(v).strip())
        if not header_parts:
            continue
        header_str = " > ".join(header_parts)
        last_header = header_parts[-1]

        # 匹配逻辑：精确 > 包含
        match = None
        for f in gdb_fields:
            if f == last_header:
                match = f
                break
        if not match:
            for f in gdb_fields:
                if last_header in f or f in last_header:
                    match = f
                    break

        letter = openpyxl.utils.get_column_letter(c)
        match_str  = match or "—"
        type_str   = gdb_types.get(match, "") if match else ""
        print(f"  {c:<3} {letter:<5} {header_str:<35} {match_str:<25} {type_str}")
        if match:
            mapping_json[str(c)] = match

    print(f"\n自动映射 JSON（供 fill 命令使用，请人工核对后调整）:")
    print(json.dumps(mapping_json, ensure_ascii=False, indent=2))


# ─────────────────────────────────────────────
# 4. 核心填表
# ─────────────────────────────────────────────
def fill_table(
    gdb_path: str,
    layer: str,
    template_path: str,
    output_path: str,
    col_map: dict,            # {col_index(int): "GDB_FIELD"}
    convert_fields: dict = None,  # {"GDB_FIELD": divisor}，如 {"MJ": 666.6667}
    data_start_row: int = 6,
    style_ref_row: int = None,
):
    """
    主填表函数。
    col_map 示例:  {1: "DCDYBH", 2: "XZMC", 5: "MJ"}
    convert_fields 示例: {"MJ": 666.6667, "DJMJ": 666.6667}
      → 写入时 val = round(val / divisor, 4)
    """
    if convert_fields is None:
        convert_fields = {}
    if style_ref_row is None:
        style_ref_row = data_start_row

    print(f"\n读取图层 {layer} ...")
    records = []
    with fiona.open(gdb_path, layer=layer) as src:
        for feat in src:
            records.append(dict(feat["properties"]))
    print(f"  共 {len(records)} 条记录")

    wb = openpyxl.load_workbook(template_path)
    ws = wb.active

    # 样式参考
    ref_styles = {}
    for col_idx in col_map:
        cell = ws.cell(row=style_ref_row, column=col_idx)
        ref_styles[col_idx] = {
            "font":          copy(cell.font)      if cell.font      else None,
            "border":        copy(cell.border)    if cell.border    else None,
            "alignment":     copy(cell.alignment) if cell.alignment else None,
            "number_format": cell.number_format,
        }

    print(f"  写入 Excel，起始行 {data_start_row} ...")
    for i, rec in enumerate(records):
        row = data_start_row + i
        for col_idx, field in col_map.items():
            val = rec.get(field)
            # 单位换算
            if field in convert_fields and val is not None:
                divisor = convert_fields[field]
                val = round(float(val) / divisor, 4)
            cell = ws.cell(row=row, column=col_idx, value=val)
            s = ref_styles.get(col_idx, {})
            if s.get("font"):          cell.font          = copy(s["font"])
            if s.get("border"):        cell.border        = copy(s["border"])
            if s.get("alignment"):     cell.alignment     = copy(s["alignment"])
            if s.get("number_format"): cell.number_format = s["number_format"]

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    wb.save(output_path)
    print(f"  已保存: {output_path}")
    print(f"  行范围: {data_start_row} ~ {data_start_row + len(records) - 1}")
    return len(records)


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="GDB 图层 → Excel 填表工具",
        formatter_class=argparse.RawTextHelpFormatter,
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    # inspect-gdb
    p1 = sub.add_parser("inspect-gdb", help="查看 GDB 图层结构及样本数据")
    p1.add_argument("gdb")
    p1.add_argument("--layer", "-l")
    p1.add_argument("--sample", "-n", type=int, default=2, help="显示几条样本（默认2）")

    # inspect-template
    p2 = sub.add_parser("inspect-template", help="查看 Excel 模板结构")
    p2.add_argument("template")
    p2.add_argument("--data-row", "-d", type=int)

    # suggest-mapping
    p3 = sub.add_parser("suggest-mapping", help="自动建议字段映射并输出 JSON")
    p3.add_argument("gdb")
    p3.add_argument("layer")
    p3.add_argument("template")
    p3.add_argument("--header-row", "-r", type=int, default=5,
                    help="表头最后一行行号（默认5）")

    # fill
    p4 = sub.add_parser("fill", help="执行填表")
    p4.add_argument("gdb")
    p4.add_argument("layer")
    p4.add_argument("template")
    p4.add_argument("--output",  "-o", help="输出路径（不填则自动生成）")
    p4.add_argument("--out-dir", default="成果", help="输出目录前缀（默认'成果'）")
    p4.add_argument("--mapping", "-m", required=True,
                    help='列→字段映射 JSON，如 \'{"1":"FIELD_A","2":"FIELD_B"}\'')
    p4.add_argument("--convert-fields", "-c",
                    help=('需要换算的字段及除数，JSON 格式\n'
                          '如 \'{"MJ":666.6667,"DJMJ":666.6667}\' 表示这些字段值÷666.6667\n'
                          '不填则保持原始单位'))
    p4.add_argument("--data-row",  "-d", type=int, default=6)
    p4.add_argument("--style-row", "-s", type=int)

    args = parser.parse_args()

    if args.cmd == "inspect-gdb":
        inspect_gdb(args.gdb, args.layer, args.sample)

    elif args.cmd == "inspect-template":
        inspect_template(args.template, args.data_row)

    elif args.cmd == "suggest-mapping":
        suggest_mapping(args.gdb, args.layer, args.template, args.header_row)

    elif args.cmd == "fill":
        col_map = {int(k): v for k, v in json.loads(args.mapping).items()}
        convert_fields = json.loads(args.convert_fields) if args.convert_fields else {}
        style_row = args.style_row or args.data_row

        if args.output:
            out_path = args.output
        else:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            out_dir = f"{args.out_dir}{ts}"
            out_path = os.path.join(out_dir, os.path.basename(args.template))

        fill_table(
            gdb_path=args.gdb,
            layer=args.layer,
            template_path=args.template,
            output_path=out_path,
            col_map=col_map,
            convert_fields=convert_fields,
            data_start_row=args.data_row,
            style_ref_row=style_row,
        )


if __name__ == "__main__":
    main()

```





[{"content": "```bash\n# 规划{args.duration}个月')\n\n\nif __name__ == '__main__':\n    main()\n\n```"}]
