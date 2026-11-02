"""Parse uploaded Shapefile / GeoJSON into FeatureCollection for result overlay."""
from __future__ import annotations

import base64
import binascii
import io
import json
import math
import zipfile
from pathlib import Path

import shapefile


class OverlayError(ValueError):
    """User-facing overlay parse failure."""


MAX_OVERLAY_BYTES = 32 * 1024 * 1024
MAX_FEATURES = 5000
MAX_POINTS = 200_000


def _finite_xy(x, y):
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in (x, y)):
        raise OverlayError("坐标必须为有限数值")
    return [float(x), float(y)]


def _count_points(geometry, total=0):
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if kind == "Point":
        return total + 1
    if kind == "MultiPoint" or kind == "LineString":
        return total + len(coordinates or [])
    if kind == "MultiLineString" or kind == "Polygon":
        return total + sum(len(part or []) for part in (coordinates or []))
    if kind == "MultiPolygon":
        return total + sum(len(ring or []) for polygon in (coordinates or []) for ring in polygon)
    return total


def _shape_to_geometry(shape):
    points = [_finite_xy(x, y) for x, y, *_ in shape.points]
    parts = list(shape.parts) + [len(points)]
    rings = [points[start:stop] for start, stop in zip(parts, parts[1:])]
    kind = int(shape.shapeType)
    if kind in (shapefile.POINT, shapefile.POINTZ, shapefile.POINTM):
        if not points:
            raise OverlayError("点要素缺少坐标")
        return {"type": "Point", "coordinates": points[0]}
    if kind in (shapefile.MULTIPOINT, shapefile.MULTIPOINTZ, shapefile.MULTIPOINTM):
        return {"type": "MultiPoint", "coordinates": points}
    if kind in (shapefile.POLYLINE, shapefile.POLYLINEZ, shapefile.POLYLINEM):
        if len(rings) == 1:
            return {"type": "LineString", "coordinates": rings[0]}
        return {"type": "MultiLineString", "coordinates": rings}
    if kind in (shapefile.POLYGON, shapefile.POLYGONZ, shapefile.POLYGONM):
        if not rings:
            raise OverlayError("面要素缺少环")
        return {"type": "Polygon", "coordinates": rings} if len(rings) == 1 else {"type": "MultiPolygon", "coordinates": [rings]}
    if kind == shapefile.NULL:
        raise OverlayError("Shape 含空几何，无法套合")
    raise OverlayError("不支持的 Shape 几何类型")


def _reader_features(reader: shapefile.Reader) -> list[dict]:
    fields = [field[0] for field in reader.fields[1:]]
    features = []
    point_total = 0
    for index, shape_record in enumerate(reader.iterShapeRecords(), start=1):
        if index > MAX_FEATURES:
            raise OverlayError(f"要素超过 {MAX_FEATURES} 个上限")
        geometry = _shape_to_geometry(shape_record.shape)
        point_total = _count_points(geometry, point_total)
        if point_total > MAX_POINTS:
            raise OverlayError(f"坐标点超过 {MAX_POINTS} 上限")
        properties = {}
        for name, value in zip(fields, shape_record.record):
            if isinstance(value, bytes):
                value = value.decode("utf-8", errors="replace")
            elif hasattr(value, "isoformat"):
                value = value.isoformat()
            properties[str(name)] = value
        properties.setdefault("id", index)
        features.append({"type": "Feature", "properties": properties, "geometry": geometry})
    if not features:
        raise OverlayError("Shape 中没有可显示的几何")
    return features


def _decode_upload(files: list[dict]) -> dict[str, bytes]:
    if not isinstance(files, list) or not 1 <= len(files) <= 12:
        raise OverlayError("请上传 Shape ZIP，或同名的 .shp/.shx/.dbf（可附 .prj/.cpg）")
    decoded: dict[str, bytes] = {}
    total = 0
    for file in files:
        if not isinstance(file, dict) or not isinstance(file.get("name"), str) or not isinstance(file.get("content"), str):
            raise OverlayError("上传文件格式无效")
        name = file["name"]
        if not 1 <= len(name) <= 255 or "/" in name or "\\" in name or any(ord(char) < 32 for char in name):
            raise OverlayError("上传文件名无效")
        try:
            data = base64.b64decode(file["content"], validate=True)
        except binascii.Error as error:
            raise OverlayError("文件内容无效") from error
        total += len(data)
        if not data or total > MAX_OVERLAY_BYTES:
            raise OverlayError("套合文件为空或总大小超过 32 MB")
        decoded[name] = data
    return decoded


def _from_zip(payload: bytes) -> list[dict]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile as error:
        raise OverlayError("Shape ZIP 无效") from error
    with archive:
        entries = archive.infolist()
        if len(entries) > 80 or sum(entry.file_size for entry in entries) > MAX_OVERLAY_BYTES:
            raise OverlayError("Shape ZIP 内容过多或解压大小超过 32 MB")
        shapes = [entry for entry in entries if entry.filename.lower().endswith(".shp") and not entry.is_dir()]
        if len(shapes) != 1:
            raise OverlayError("Shape ZIP 中须有且只有一个 .shp")
        shape = shapes[0]
        stem = shape.filename[:-4]
        names = {entry.filename.lower(): entry for entry in entries if not entry.is_dir()}
        required = {}
        for suffix in (".shp", ".shx", ".dbf"):
            key = (stem + suffix).lower()
            if key not in names:
                raise OverlayError(f"Shape ZIP 缺少同名 {suffix}")
            required[suffix] = archive.read(names[key])
        reader = shapefile.Reader(
            shp=io.BytesIO(required[".shp"]),
            shx=io.BytesIO(required[".shx"]),
            dbf=io.BytesIO(required[".dbf"]),
        )
        try:
            return _reader_features(reader)
        finally:
            reader.close()


def _from_parts(parts: dict[str, bytes]) -> list[dict]:
    by_suffix = {Path(name).suffix.lower(): data for name, data in parts.items()}
    if len(by_suffix) != len(parts):
        raise OverlayError("检测到重复的 Shape 附属文件")
    if ".shp" not in by_suffix or ".shx" not in by_suffix or ".dbf" not in by_suffix:
        raise OverlayError("Shape 文件组须包含 .shp、.shx 和 .dbf")
    reader = shapefile.Reader(
        shp=io.BytesIO(by_suffix[".shp"]),
        shx=io.BytesIO(by_suffix[".shx"]),
        dbf=io.BytesIO(by_suffix[".dbf"]),
    )
    try:
        return _reader_features(reader)
    finally:
        reader.close()


def _from_geojson(payload: bytes) -> list[dict]:
    try:
        text = payload.decode("utf-8-sig")
        data = json.loads(text)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise OverlayError("GeoJSON 解析失败") from error
    if not isinstance(data, dict):
        raise OverlayError("GeoJSON 结构无效")
    if data.get("type") == "FeatureCollection":
        features = data.get("features")
        if not isinstance(features, list) or not features:
            raise OverlayError("GeoJSON 没有要素")
        if len(features) > MAX_FEATURES:
            raise OverlayError(f"要素超过 {MAX_FEATURES} 个上限")
        point_total = 0
        normalized = []
        for index, feature in enumerate(features, start=1):
            if not isinstance(feature, dict) or feature.get("type") != "Feature":
                raise OverlayError("GeoJSON 要素无效")
            geometry = feature.get("geometry")
            if not isinstance(geometry, dict) or not geometry.get("type"):
                raise OverlayError("GeoJSON 缺少几何")
            point_total = _count_points(geometry, point_total)
            if point_total > MAX_POINTS:
                raise OverlayError(f"坐标点超过 {MAX_POINTS} 上限")
            properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            properties = {**properties}
            properties.setdefault("id", index)
            normalized.append({"type": "Feature", "properties": properties, "geometry": geometry})
        return normalized
    if data.get("type") == "Feature":
        geometry = data.get("geometry")
        if not isinstance(geometry, dict) or not geometry.get("type"):
            raise OverlayError("GeoJSON 缺少几何")
        if _count_points(geometry) > MAX_POINTS:
            raise OverlayError(f"坐标点超过 {MAX_POINTS} 上限")
        properties = data.get("properties") if isinstance(data.get("properties"), dict) else {}
        properties = {**properties}
        properties.setdefault("id", 1)
        return [{"type": "Feature", "properties": properties, "geometry": geometry}]
    raise OverlayError("仅支持 FeatureCollection 或 Feature")


def parse_overlay_files(files: list[dict]) -> dict:
    """Return a GeoJSON FeatureCollection from uploaded overlay files.

    @param files: list of `{name, content}` where content is base64.
    @returns: FeatureCollection dict ready for the visualization client.
    """
    decoded = _decode_upload(files)
    if len(decoded) == 1:
        name, payload = next(iter(decoded.items()))
        lower = name.lower()
        if lower.endswith(".zip"):
            features = _from_zip(payload)
        elif lower.endswith((".geojson", ".json")):
            features = _from_geojson(payload)
        else:
            raise OverlayError("单个文件请上传 Shape ZIP 或 GeoJSON")
    else:
        features = _from_parts(decoded)
    return {"type": "FeatureCollection", "features": features, "count": len(features)}
