"""macOS GIS execution without PowerShell or third-party GIS packages."""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import re
import struct
import tempfile
import urllib.request
from xml.sax.saxutils import escape
import zipfile

KIND = Path(__file__).resolve().parents[1].name
NAMES = {
    "market-gis-geology-analysis": ("地质条件分析", "地质", "地质报告", "OneKeyAnalysis"),
    "market-gis-third-survey-analysis": ("三调土地利用现状分析", "三调", "三调报告", "SanDXzAnalysis"),
    "market-gis-land-use-plan-review": ("土地利用规划审查", "规划", "规划报告", "OneKeyAnalysis"),
}
DATASET_LABELS = {
    "YZT_DZHJTJ_LIST": "地质环境条件列表", "YZT_DZHJTJ": "地质环境条件列表",
    "YZT_DZZHYFQK_LIST": "地质灾害易发区列表", "YZT_DZZHYFQK": "地质灾害易发区列表",
    "YZT_TDFLMJB_HZB": "土地分类面积汇总表", "YZT_DKDLMJB": "地块地类面积明细",
    "YZT_GHSCB": "规划审查表", "YZT_GNQMJB_LIST": "土地用途功能区面积表",
}
FIELD_LABELS = {
    "DZHJTJ": "地质环境条件", "FQMC": "易发分区名称", "DJ": "分区等级",
    "ZYMJ": "重叠面积", "HJMJ": "合计面积", "NYDMJ": "农用地面积",
    "GDMJ": "耕地面积", "JSYDMJ": "建设用地面积", "WLYDMJ": "未利用地面积",
    "JBNTMJ": "永久基本农田面积", "DLMC": "地类名称", "DLBM": "地类编码",
    "YDZMJ": "用地总面积", "SFZYJBNT": "是否占用永久基本农田",
    "YXJSQMJ": "允许建设区面积", "YTJJSQMJ": "有条件建设区面积",
    "XZJSQMJ": "限制建设区面积", "JZJSQMJ": "禁止建设区面积",
    "SFZXCQFW": "是否位于中心城区范围", "GNQLX": "功能区类型",
    "SZJSYDQMJ": "城镇建设用地区面积", "ID": "记录编号",
}
INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff]")


def _xml_text(value):
    return escape(INVALID_XML.sub("", str(value)))


def _geometry(node, rings):
    if not isinstance(node, dict):
        return
    kind = node.get("type")
    if kind == "FeatureCollection":
        for feature in node.get("features", []):
            _geometry(feature, rings)
    elif kind == "Feature":
        _geometry(node.get("geometry"), rings)
    elif kind == "Polygon":
        rings.extend(node.get("coordinates", []))
    elif kind == "MultiPolygon":
        for polygon in node.get("coordinates", []):
            rings.extend(polygon)


def _shapefile(path):
    data = path.read_bytes()
    if len(data) < 100 or struct.unpack_from(">i", data, 0)[0] != 9994:
        raise ValueError("Shape 文件头无效")
    rings, features, offset = [], 0, 100
    while offset < len(data):
        if offset + 8 > len(data):
            raise ValueError("Shape 记录头不完整")
        size = struct.unpack_from(">i", data, offset + 4)[0] * 2
        start, end = offset + 8, offset + 8 + size
        if size < 4 or end > len(data):
            raise ValueError("Shape 记录长度无效")
        shape_type = struct.unpack_from("<i", data, start)[0]
        if shape_type in (5, 15, 25):
            if size < 44:
                raise ValueError("Shape 面记录不完整")
            part_count, point_count = struct.unpack_from("<2i", data, start + 36)
            point_start = start + 44 + 4 * part_count
            if part_count < 1 or point_count < 4 or point_start + 16 * point_count > end:
                raise ValueError("Shape 面坐标越界")
            parts = [struct.unpack_from("<i", data, start + 44 + 4 * i)[0] for i in range(part_count)]
            for i, first in enumerate(parts):
                last = parts[i + 1] if i + 1 < part_count else point_count
                if first < 0 or last > point_count or last - first < 4:
                    raise ValueError("Shape 边界环无效")
                rings.append([list(struct.unpack_from("<2d", data, point_start + 16 * j))
                              for j in range(first, last)])
            features += 1
        elif shape_type != 0:
            raise ValueError("仅支持面类型 Shape")
        offset = end
    if not rings:
        raise ValueError("Shape 文件不包含面几何")
    return rings, features


def _dbf_fields(path):
    data = path.read_bytes()
    if len(data) < 33:
        raise ValueError("DBF 文件长度不足")
    header = struct.unpack_from("<H", data, 8)[0]
    if header > len(data):
        raise ValueError("DBF 文件头无效")
    return [data[i:i + 11].split(b"\0", 1)[0].decode("ascii", "replace").strip()
            for i in range(32, header, 32) if data[i] != 13]


def _resolve(source, root):
    source = source.expanduser().resolve()
    if source.suffix.lower() in (".geojson", ".json"):
        data = json.loads(source.read_text(encoding="utf-8-sig"))
        rings = []
        _geometry(data, rings)
        if not rings:
            raise ValueError("GeoJSON 必须包含 Polygon 或 MultiPolygon 面几何")
        first = data.get("features", [{}])[0] if data.get("type") == "FeatureCollection" else data
        fields = list(first.get("properties", {})) if isinstance(first, dict) else []
        count = len(data.get("features", [])) if data.get("type") == "FeatureCollection" else 1
        return {"path": str(source), "kind": "GeoJSON", "rings": rings, "count": count,
                "crs": "GeoJSON 未内嵌坐标系，请使用用户说明或源数据元信息。", "fields": fields}
    if source.suffix.lower() == ".zip":
        with zipfile.ZipFile(source) as archive:
            for member in archive.infolist():
                name = member.filename.replace("\\", "/")
                segments = name.split("/")
                if (name.startswith("/") or ".." in segments or ":" in name or
                        member.is_dir() and name.rstrip("/") == ""):
                    raise ValueError("ZIP 包含不安全路径")
                destination = (root / name).resolve()
                if not destination.is_relative_to(root.resolve()):
                    raise ValueError("ZIP 路径越界")
            archive.extractall(root)
        directory = root
        kind = "空间矢量数据压缩包"
    elif source.is_dir():
        directory, kind = source, "空间矢量数据文件夹"
    elif source.is_file() and source.suffix.lower() == ".shp":
        directory, kind = source.parent, "空间矢量数据文件"
    else:
        raise ValueError("请提供 GeoJSON、面类型 .shp、Shape ZIP 或文件夹")
    shapes = list(directory.rglob("*.shp"))
    if len(shapes) != 1:
        raise ValueError(f"数据源必须包含且仅包含一个 .shp 文件；当前找到 {len(shapes)} 个")
    shape = shapes[0]
    for suffix in (".shx", ".dbf"):
        if not shape.with_suffix(suffix).is_file():
            raise ValueError(f"Shape 数据缺少同名 {suffix} 文件")
    rings, count = _shapefile(shape)
    projection = shape.with_suffix(".prj")
    return {"path": str(source), "kind": kind, "rings": rings, "count": count,
            "crs": projection.read_text(encoding="utf-8-sig").strip() if projection.is_file()
            else "未提供 .prj 坐标系文件", "fields": _dbf_fields(shape.with_suffix(".dbf"))}


def _request(source, options):
    geometry = json.dumps({"hasZ": False, "hasM": False, "rings": source["rings"]},
                          ensure_ascii=False, separators=(",", ":"))
    body = {"GeoJson": geometry, "IsAnaXzCoverBp": False}
    if KIND == "market-gis-geology-analysis":
        body.update(IsAnaDzzhyfqk=True, IsAnaDzhjtj=True,
                    YfxFieldName=options.get("-YfxFieldName") or "分区名称")
    elif KIND == "market-gis-third-survey-analysis":
        body.update(IsAnalysisXzDetail=True, Xznf=int(options.get("-Xznf", 2024)),
                    Blxsw=int(options.get("-Blxsw", 4)), IsAnaGh=False, IsAnaXz=True,
                    IsSD_GD=False, IsAnalysisSyqxx=False, IsQueryGeometry=False,
                    IsAnalysisTfh=True, IsAnalysisFGNYD=True, IsAnalysisJSYD09DL=True)
    else:
        body.update(Blxsw=int(options.get("-Blxsw", 4)), IsAnaGh=True,
                    IsAnaGhWithCZJSKZQ=False)
    endpoint = NAMES[KIND][3]
    base = options.get("-BaseUrl") or os.getenv("DSH_GIS_SERVICE_URL") or "http://60.191.110.206:38010"
    url = base.rstrip("/") + "/Analysis.svc/" + endpoint
    request = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                     headers={"Content-Type": "text/plain; charset=utf-8"}, method="POST")
    with urllib.request.urlopen(request, timeout=120) as response:
        raw = response.read().decode("utf-8-sig")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("GIS 服务返回的不是有效 JSON，已停止生成报告") from exc
    if not isinstance(parsed, dict):
        raise ValueError("GIS 服务返回的数据格式无效")
    return raw, parsed


def _records(response, field):
    value = response.get(field)
    return value if isinstance(value, list) else [value] if isinstance(value, dict) else []


def _value(item, field):
    value = item.get(field) if isinstance(item, dict) else None
    return "—" if value is None or value == "" else str(value)


def _label(field, labels):
    fallback = "接口数据集" if labels is DATASET_LABELS else "接口字段"
    return f"{labels.get(field, fallback)}（{field}）"


def _crs_name(source):
    value = source["crs"]
    if value.startswith(("GEOGCS[", "PROJCS[", "GEODCRS[", "PROJCRS[")):
        match = re.match(r'^[A-Z]+\["([^"]+)"', value)
        return match.group(1) if match else "坐标系名称未识别；完整定义见源数据"
    return value


def _result_rows(response):
    rows = []
    if KIND == "market-gis-geology-analysis":
        columns = ["分析图层", "空间判定", "等级", "占用面积（公顷）"]
        for field, label, value_field in (
            ("YZT_DZHJTJ_LIST", "地质环境条件", "DZHJTJ"),
            ("YZT_DZZHYFQK_LIST", "地质灾害易发分区", "FQMC"),
        ):
            for item in _records(response, field):
                rows.append([label, _value(item, value_field), _value(item, "DJ"),
                             _value(item, "ZYMJ")])
    elif KIND == "market-gis-third-survey-analysis":
        columns = ["土地利用指标", "面积（公顷）", "占项目面积比例"]
        for item in _records(response, "YZT_TDFLMJB_HZB"):
            total = _number(item.get("HJMJ"))
            for label, field in (("农用地", "NYDMJ"), ("耕地", "GDMJ"),
                                 ("建设用地", "JSYDMJ"), ("未利用地", "WLYDMJ"),
                                 ("永久基本农田", "JBNTMJ")):
                amount = _number(item.get(field))
                ratio = f"{amount / total:.2%}" if total and amount is not None else "—"
                rows.append([label, _value(item, field), ratio])
    else:
        columns = ["审查指标", "结果", "单位/说明"]
        for item in _records(response, "YZT_GHSCB"):
            for field in ("YDZMJ", "SFZYJBNT", "JBNTMJ", "YXJSQMJ", "YTJJSQMJ",
                          "XZJSQMJ", "JZJSQMJ", "SFZXCQFW"):
                rows.append([_label(field, FIELD_LABELS), _value(item, field),
                             "公顷" if field.endswith("MJ") else "服务返回值"])
    if not rows:
        rows.append(["未返回可展示的专项结果", *(["—"] * (len(columns) - 1))])
    return columns, rows


def _sections(source, response, columns, rows):
    title = NAMES[KIND][0]
    observed = ["；".join(f"{column}：{value}" for column, value in zip(columns, row)) + "。"
                for row in rows
                if row[0] != "未返回可展示的专项结果"]
    if not observed:
        observed = ["GIS 服务未返回可展示的专项记录；请检查接口原始结果，不作空间结论。"]
    advice = []
    conclusion = []
    if KIND == "market-gis-geology-analysis":
        for item in _records(response, "YZT_DZHJTJ_LIST"):
            condition = _value(item, "DZHJTJ")
            if "复杂" in condition:
                advice.append(f"地质环境为“{condition}”，工程实施前应重点核查地基、边坡、地下水和不良地质作用。")
            else:
                advice.append(f"地质环境为“{condition}”，仍需结合工程类型开展相应勘察。")
        for item in _records(response, "YZT_DZZHYFQK_LIST"):
            zone = _value(item, "FQMC")
            advice.append(f"地质灾害易发分区为“{zone}”；此项与地质环境条件分别统计，不应将面积跨图层相加。")
        conclusion.append("地质环境条件与灾害易发分区是两项独立的空间判定；工程影响应结合项目位置、工程类型和现场勘察资料分别核实。")
        conclusion.append("开展方案设计前，核对地基、边坡、地下水和不良地质作用；本次分析不能代替工程地质勘察或地质灾害危险性评估。")
    elif KIND == "market-gis-third-survey-analysis":
        for item in _records(response, "YZT_TDFLMJB_HZB"):
            total = _number(item.get("HJMJ"))
            construction = _number(item.get("JSYDMJ"))
            farmland = _number(item.get("NYDMJ"))
            basic = _number(item.get("JBNTMJ"))
            if total and construction is not None and construction / total >= 0.8:
                advice.append("建设用地占比达到八成；后续应核查现状用途、权属及专项管控。")
            elif total and farmland is not None and farmland / total >= 0.8:
                advice.append("农用地占比达到八成；项目边界和用地方案应优先核查农用地转用影响。")
            if basic is not None and basic > 0:
                advice.append(f"服务返回永久基本农田 {item['JBNTMJ']} 公顷；应优先核查避让及法定论证要求。")
            if total is not None:
                observed.insert(0, f"项目范围合计面积：{_value(item, 'HJMJ')} 公顷；下列占比均以该汇总面积为分母。")
            if _number(item.get("GDMJ")) and _number(item.get("GDMJ")) > 0:
                advice.append(f"汇总中耕地面积为 {_value(item, 'GDMJ')} 公顷；后续应以图斑明细定位具体范围，不将面积直接等同于拟占用面积。")
        land_types = _records(response, "YZT_DKDLMJB")
        if land_types:
            observed.append(f"接口返回 {len(land_types)} 条地块地类明细；完整字段与记录见 Excel“接口明细”工作表。")
            for item in land_types[:5]:
                parts = [f"地类：{_value(item, 'DLMC')}（{_value(item, 'DLBM')}）"]
                if _value(item, "TBMJ") != "—":
                    parts.append(f"图斑面积：{_value(item, 'TBMJ')} 公顷")
                if _value(item, "QSDWMC") != "—":
                    parts.append(f"权属单位：{_value(item, 'QSDWMC')}")
                observed.append("；".join(parts) + "。")
            if len(land_types) > 5:
                observed.append(f"以上展示前 5 条明细，其余 {len(land_types) - 5} 条保留在 Excel 中，不据此推断全量地类结构。")
        owners = _records(response, "YZT_TDQSDLMJ")
        if owners:
            observed.append(f"接口另返回 {len(owners)} 条权属地类面积记录；需按权属单位分别核对，不与土地分类汇总重复相加。")
            for item in owners[:3]:
                observed.append(f"权属单位：{_value(item, 'QSDWMC')}；汇总面积：{_value(item, 'HZMJ')} 公顷。")
        conclusion.append("本次三调现状分析用于识别项目范围内的地类构成与保护约束；以地类明细定位图斑，以权属记录核对协调主体。")
        conclusion.append("用地方案形成前，应与规划审查结果叠加核实用途一致性；涉及耕地或永久基本农田的事项需依规定进一步论证。")
    else:
        for item in _records(response, "YZT_GHSCB"):
            basic = _number(item.get("JBNTMJ"))
            restricted = _number(item.get("XZJSQMJ"))
            prohibited = _number(item.get("JZJSQMJ"))
            if basic is not None and basic > 0:
                advice.append(f"服务返回永久基本农田 {item['JBNTMJ']} 公顷；应优先核查项目边界与法定管控要求。")
            if (restricted or 0) > 0 or (prohibited or 0) > 0:
                advice.append("项目范围涉及限制或禁止建设区，应开展对应管控要求的专项核查。")
            advice.append("本结果是规划资料初审依据，不代替规划用地性质、建设边界与详细规划图则核验。")
        zones = _records(response, "YZT_GNQMJB_LIST")
        if zones:
            observed.append(f"接口返回 {len(zones)} 条土地用途功能区面积记录，完整字段见 Excel“接口明细”工作表。")
            for item in zones[:5]:
                observed.append(f"功能区类型：{_value(item, 'GNQLX')}；城镇建设用地区面积：{_value(item, 'SZJSYDQMJ')} 公顷。")
        conclusion.append("规划审查结果用于识别项目范围与规划管控要素的空间关系，不直接构成行政许可或合规认定。")
        conclusion.append("针对服务返回的永久基本农田、建设分区和功能区记录，逐项核对现行规划图则、项目边界与审批依据。")
    if not advice:
        advice.append("可展示记录不足，暂不生成专项判断；请核验接口明细与原始数据。")
    if not conclusion:
        conclusion.append(f"本次{title}依据输入范围与 GIS 服务返回记录整理；各图层按自身统计口径解释。")
    return [
        {"title": "核心分析结论", "kind": "analysis", "items": observed},
        {"title": "专业研判", "kind": "advice", "items": advice},
        {"title": "实施建议与结论", "kind": "conclusion", "items": conclusion},
        {"title": "数据来源与使用限制", "kind": "analysis",
         "items": [f"输入面要素 {source['count']} 个；坐标系：{_crs_name(source)}。"
                   "结论仅依据本次输入范围和 GIS 服务返回数据，不替代现场勘察、法定审查或原始数据核验。",
                   "不同图层和不同统计表的面积口径可能不同，不跨图层相加；缺失字段按未返回处理，不推定为零。"]},
    ]


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _detail_rows(response):
    rows = []
    for dataset, value in response.items():
        items = value if isinstance(value, list) else [value]
        for index, item in enumerate(items, 1):
            if isinstance(item, dict):
                rows.extend([[_label(dataset, DATASET_LABELS), index,
                              _label(key, FIELD_LABELS), str(val)] for key, val in item.items()])
            else:
                rows.append([_label(dataset, DATASET_LABELS), index, "值", str(item)])
    return rows


def _cell(value, row, column):
    letter = chr(65 + column)
    return f'<c r="{letter}{row}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'


def _worksheet(rows):
    body = "".join(f'<row r="{i}">' + "".join(_cell(value, i, j) for j, value in enumerate(row))
                   + "</row>" for i, row in enumerate(rows, 1))
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetData>' + body + '</sheetData></worksheet>')


def _xlsx(path, columns, rows, sections, details):
    sheets = [
        [columns, *rows],
        [["章节", "内容"], *[[s["title"], item] for s in sections for item in s["items"]]],
        [["数据集", "序号", "字段", "值"], *details],
    ]
    content = ('<?xml version="1.0" encoding="UTF-8"?>'
               '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
               '<Default Extension="xml" ContentType="application/xml"/>'
               '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
               + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                         for i in range(1, 4)) + '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>')
    names = ("结果汇总", "专业分析", "接口明细")
    workbook = ('<?xml version="1.0" encoding="UTF-8"?>'
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
                ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                + "".join(f'<sheet name="{name}" sheetId="{i}" r:id="rId{i}"/>'
                          for i, name in enumerate(names, 1)) + '</sheets></workbook>')
    book_rels = ('<?xml version="1.0" encoding="UTF-8"?>'
                 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                           for i in range(1, 4)) + '</Relationships>')
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in {"[Content_Types].xml": content, "_rels/.rels": rels,
                           "xl/workbook.xml": workbook, "xl/_rels/workbook.xml.rels": book_rels}.items():
            archive.writestr(name, data)
        for i, sheet in enumerate(sheets, 1):
            archive.writestr(f"xl/worksheets/sheet{i}.xml", _worksheet(sheet))


def _docx(path, title, source, columns, rows, sections):
    def paragraph(value, *, size=22, bold=False, before=0, after=120):
        format_xml = f'<w:pPr><w:spacing w:before="{before}" w:after="{after}"/></w:pPr>'
        run_xml = (f'<w:rPr><w:rFonts w:eastAsia="等线"/>'
                   f'<w:b w:val="{1 if bold else 0}"/><w:sz w:val="{size}"/></w:rPr>')
        return f'<w:p>{format_xml}<w:r>{run_xml}<w:t xml:space="preserve">{_xml_text(value)}</w:t></w:r></w:p>'

    def table(headers, records):
        width = 9000 // len(headers)
        grid = "".join(f'<w:gridCol w:w="{width}"/>' for _ in headers)
        body = []
        for index, record in enumerate([headers, *records]):
            cells = []
            for value in record:
                shade = '<w:shd w:fill="EAF2FF"/>' if index == 0 else ''
                cells.append(f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{shade}</w:tcPr>'
                             + paragraph(value, size=20, bold=index == 0, after=40) + '</w:tc>')
            body.append('<w:tr>' + ''.join(cells) + '</w:tr>')
        borders = ''.join(f'<w:{side} w:val="single" w:sz="4" w:color="D8E2F0"/>'
                          for side in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'))
        return ('<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>'
                f'<w:tblBorders>{borders}</w:tblBorders></w:tblPr>'
                f'<w:tblGrid>{grid}</w:tblGrid>{"".join(body)}</w:tbl>')

    parts = [paragraph(f"{title}报告", size=36, bold=True, after=240),
             paragraph("一、项目与数据概况", size=28, bold=True, before=180),
             paragraph(f"输入数据：{source['path']}"),
             paragraph(f"数据类型：{source['kind']}；面要素数量：{source['count']}"),
             paragraph(f"坐标系：{_crs_name(source)}"),
             paragraph("二、核心分析结论", size=28, bold=True, before=300, after=160),
             table(columns, rows)]
    for number, section in enumerate(sections, 2):
        if number != 2:
            parts.append(paragraph(f"{['一', '二', '三', '四', '五'][number - 1]}、{section['title']}",
                                   size=28, bold=True, before=300, after=160))
        parts.extend(paragraph("• " + item) for item in section["items"])
    paragraphs = "".join(parts)
    document = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                '<w:body>' + paragraphs + '<w:sectPr/></w:body></w:document>')
    types = ('<?xml version="1.0" encoding="UTF-8"?>'
             '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
             '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
             '<Default Extension="xml" ContentType="application/xml"/>'
             '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
             '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in {"[Content_Types].xml": types, "_rels/.rels": rels,
                           "word/document.xml": document}.items():
            archive.writestr(name, data)


def execute(options):
    if KIND not in NAMES:
        raise ValueError("不支持的 GIS 技能")
    if not options.get("-InputPath") or not options.get("-OutputDirectory"):
        raise ValueError("必须提供 -InputPath 和 -OutputDirectory")
    with tempfile.TemporaryDirectory(prefix="wanwei-gis-") as temporary:
        source = _resolve(Path(options["-InputPath"]), Path(temporary))
        raw, response = _request(source, options)
    directory = Path(options["-OutputDirectory"]).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now()
    stamp, short = now.strftime("%Y%m%d_%H%M%S_%f")[:19], now.strftime("%m%d-%H%M%S")
    name = re.sub(r'[\\/:*?"<>|]', "_", Path(source["path"]).stem).strip() or "空间范围"
    title, short_name, report_name, _ = NAMES[KIND]
    raw_path = directory / f"{name}_{title}原始数据_{stamp}.json"
    markdown = directory / f"{name}_{title}底稿_{stamp}.md"
    view = directory / f"{name}_{title}视图_{stamp}.json"
    word = directory / f"{name}_{report_name}_{short}.docx"
    excel = directory / f"{name}_{short_name}_{short}.xlsx"
    for path in (raw_path, markdown, view, word, excel):
        if path.exists():
            raise ValueError(f"成果文件已存在，不会覆盖：{path}")
    columns, rows = _result_rows(response)
    sections = _sections(source, response, columns, rows)
    details = _detail_rows(response)
    markdown_lines = [f"# {title}报告", "", "## 输入数据核验",
                      f"- 数据类型：{source['kind']}", f"- 数据路径：{source['path']}",
                      f"- 面要素数量：{source['count']}", f"- 坐标系：{_crs_name(source)}", ""]
    for section in sections:
        markdown_lines += ["## " + section["title"], *["- " + item for item in section["items"]], ""]
    raw_path.write_text(raw, encoding="utf-8")
    markdown.write_text("\n".join(markdown_lines) + "\n", encoding="utf-8")
    view.write_text(json.dumps({
        "schema_version": 1, "title": title, "generated_at": now.isoformat(),
        "metrics": [{"label": "成果表格", "value": "3 个"},
                    {"label": "接口明细", "value": f"{len(details)} 条"}],
        "sections": sections,
        "tables": [
            {"id": "summary", "title": "结果汇总",
             "columns": columns, "rows": rows},
            {"id": "analysis", "title": "专业分析", "columns": ["章节", "内容"],
             "rows": [[s["title"], item] for s in sections for item in s["items"]]},
            {"id": "details", "title": "接口明细", "columns": ["数据集", "序号", "字段", "值"],
             "rows": details},
        ],
    }, ensure_ascii=False), encoding="utf-8")
    _xlsx(excel, columns, rows, sections, details)
    _docx(word, title, source, columns, rows, sections)
    return {"success": True, "status": "completed",
            "artifacts": [{"path": str(word), "kind": "docx", "description": "Word 分析报告"},
                          {"path": str(excel), "kind": "xlsx", "description": "Excel 分析明细"}],
            "internalFiles": [str(raw_path), str(markdown), str(view)],
            "metadata": {"inputPath": source["path"], "featureCount": source["count"],
                         "coordinateSystem": source["crs"], "analysisViewPath": str(view)}}
