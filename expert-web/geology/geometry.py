"""Read uploaded polygon datasets without extraction or coordinate reprojection."""
import json
import math
from pathlib import Path
import struct
import zipfile


class SpatialError(ValueError):
    pass


def validate_rings(rings):
    if not isinstance(rings, list) or not rings or len(rings) > 10000:
        raise SpatialError("范围文件没有有效面环或面环数量超限")
    result, points = [], 0
    for ring in rings:
        if not isinstance(ring, list) or len(ring) < 4:
            raise SpatialError("每个面环至少需要四个坐标点")
        normalized = []
        for point in ring:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                raise SpatialError("面坐标格式无效")
            x, y = point[:2]
            if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in (x, y)):
                raise SpatialError("坐标必须为有限数值")
            normalized.append([x, y])
        points += len(normalized)
        if points > 100000:
            raise SpatialError("范围文件超过 10 万坐标点")
        if normalized[0] != normalized[-1]:
            raise SpatialError("面环没有闭合，请修复数据后提交")
        result.append(normalized)
    return result


def geojson_rings(node, depth=0):
    if depth > 4 or not isinstance(node, dict):
        raise SpatialError("GeoJSON 结构无效")
    kind = node.get("type")
    if kind == "FeatureCollection":
        features = node.get("features")
        if not isinstance(features, list) or len(features) > 10000:
            raise SpatialError("GeoJSON 要素数量超限")
        return [ring for feature in features for ring in geojson_rings(feature, depth + 1)]
    if kind == "Feature":
        return geojson_rings(node.get("geometry"), depth + 1)
    if kind == "Polygon":
        return node.get("coordinates")
    if kind == "MultiPolygon":
        coordinates = node.get("coordinates")
        if not isinstance(coordinates, list):
            raise SpatialError("多面坐标格式无效")
        return [ring for polygon in coordinates for ring in polygon]
    if "rings" in node:
        return node["rings"]
    raise SpatialError("仅支持 Polygon 和 MultiPolygon 范围")


def shape_rings(data):
    if len(data) < 100 or struct.unpack_from(">i", data)[0] != 9994:
        raise SpatialError("Shape 文件头无效")
    if struct.unpack_from(">i", data, 24)[0] * 2 != len(data):
        raise SpatialError("Shape 文件长度与文件头不一致")
    rings, offset = [], 100
    while offset < len(data):
        if offset + 8 > len(data):
            raise SpatialError("Shape 记录头不完整")
        length = struct.unpack_from(">i", data, offset + 4)[0] * 2
        offset += 8
        end = offset + length
        if length < 4 or end > len(data):
            raise SpatialError("Shape 记录长度无效")
        kind = struct.unpack_from("<i", data, offset)[0]
        if kind == 0:
            offset = end
            continue
        if kind not in (5, 15, 25) or length < 44:
            raise SpatialError("Shape 仅支持面、带 Z 面及带 M 面")
        count, points = struct.unpack_from("<ii", data, offset + 36)
        if not 1 <= count <= 10000 or not 4 <= points <= 100000:
            raise SpatialError("Shape 坐标或面环数量无效")
        point_offset = offset + 44 + count * 4
        if point_offset + points * 16 > end:
            raise SpatialError("Shape 坐标数据不完整")
        starts = list(struct.unpack_from(f"<{count}i", data, offset + 44)) + [points]
        if starts[0] != 0:
            raise SpatialError("Shape 面环索引无效")
        for start, stop in zip(starts, starts[1:]):
            if start < 0 or stop > points or stop - start < 4:
                raise SpatialError("Shape 面环索引无效")
            rings.append([list(struct.unpack_from("<dd", data, point_offset + index * 16)) for index in range(start, stop)])
        offset = end
    return validate_rings(rings)


def read_dataset(inputs):
    paths = [Path(path) for path in inputs]
    if not paths:
        raise SpatialError("请选择范围文件")
    if len(paths) == 1 and paths[0].suffix.lower() in (".json", ".geojson"):
        return validate_rings(geojson_rings(json.loads(paths[0].read_text(encoding="utf-8-sig")))), "GeoJSON（坐标未转换）"
    if len(paths) == 1 and paths[0].suffix.lower() == ".zip":
        with zipfile.ZipFile(paths[0]) as archive:
            entries = archive.infolist()
            if len(entries) > 100 or sum(entry.file_size for entry in entries) > 64 * 1024 * 1024:
                raise SpatialError("Shape ZIP 内容过多或解压大小超过 64 MB")
            shapes = [entry for entry in entries if entry.filename.lower().endswith(".shp")]
            if len(shapes) != 1:
                raise SpatialError("Shape ZIP 中须有且只有一个 Shape 数据集")
            shape = shapes[0]
            stem = shape.filename[:-4].lower()
            names = {entry.filename.lower(): entry for entry in entries}
            for suffix in (".shx", ".dbf"):
                if stem + suffix not in names:
                    raise SpatialError(f"Shape ZIP 缺少同名 {suffix} 文件")
            prj = names.get(stem + ".prj")
            crs = archive.read(prj).decode("utf-8-sig") if prj else "未提供坐标系"
            return shape_rings(archive.read(shape)), crs
    shapes = [path for path in paths if path.suffix.lower() == ".shp"]
    if len(shapes) != 1:
        raise SpatialError("请选择一个 GeoJSON、Shape ZIP 或完整 Shape 文件组")
    shape = shapes[0]
    by_suffix = {path.suffix.lower(): path for path in paths}
    if ".shx" not in by_suffix or ".dbf" not in by_suffix:
        raise SpatialError("Shape 文件组须包含 .shp、.shx 和 .dbf")
    # The upload layer may rename files; all supplied companions belong to the
    # one selected dataset. Multiple companions of the same type are rejected.
    if len(by_suffix) != len(paths):
        raise SpatialError("检测到重复的 Shape 附属文件")
    prj = by_suffix.get(".prj")
    return shape_rings(shape.read_bytes()), prj.read_text(encoding="utf-8-sig") if prj else "未提供坐标系"
