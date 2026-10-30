"""Standalone GIS processing. Call only with service-owned input/output paths."""
from __future__ import annotations

import csv
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile

import ezdxf
from pyproj import CRS, Transformer
import shapefile


class ConversionError(ValueError):
    pass


MAX_COORD_ROWS = 200_000
MAX_ZIP_ENTRIES = 2_000
MAX_UNCOMPRESSED = 256 * 1024 * 1024
REDLINE_LAYER_HINTS = (
    "红线", "红线范围", "道路红线", "用地红线", "范围线", "用地范围",
    "建设用地", "可建设", "地块范围", "HKX", "HX", "REDLINE", "RED_LINE", "RANGE",
)


def number(options, key, required=False, default=None):
    if key not in options or options[key] in ("", None):
        if required:
            raise ConversionError(f"请填写参数 {key}")
        return default
    value = options[key]
    if isinstance(value, bool):
        raise ConversionError(f"{key} 参数无效")
    try:
        return float(value)
    except (ValueError, TypeError):
        raise ConversionError(f"{key} 须为数字") from None


def ensure_output(output: Path) -> Path:
    output = Path(output).resolve()
    if output.exists():
        raise ConversionError("输出目录必须是新建的任务目录")
    output.mkdir(parents=True, mode=0o700)
    return output


def safe_stem(path: Path) -> str:
    stem = re.sub(r"[^\w\u4e00-\u9fff.-]+", "_", path.stem, flags=re.UNICODE).strip("._")
    return (stem or "result")[:80]


def zip_member_name(info: zipfile.ZipInfo) -> str:
    """Decode ZIP entry names; recover GBK names from Chinese Windows Explorer archives."""
    name = info.filename.replace("\\", "/")
    if info.flag_bits & 0x800:
        return name
    try:
        raw = name.encode("cp437")
    except UnicodeEncodeError:
        return name
    for encoding in ("utf-8", "gbk"):
        try:
            return raw.decode(encoding).replace("\\", "/")
        except UnicodeDecodeError:
            continue
    return name


def unzip_archive(archive: Path, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    total = 0
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if not members or len(members) > MAX_ZIP_ENTRIES:
            raise ConversionError("压缩包为空或条目过多")
        for info in members:
            name = zip_member_name(info)
            if name.startswith("/") or ".." in Path(name).parts:
                raise ConversionError("压缩包路径不安全")
            total += info.file_size
            if total > MAX_UNCOMPRESSED:
                raise ConversionError("解压后数据超过上限")
            target = destination / name
            if name.endswith("/"):
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
                continue
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with bundle.open(info) as source, target.open("wb") as handle:
                shutil.copyfileobj(source, handle)
    return destination


def find_filegdb(root: Path) -> Path | None:
    """Locate a FileGDB folder that actually contains .gdbtable files.

    Prefer directories named *.gdb, but never return an empty name-only folder —
    some ZIP tools emit a bare ``xxx.gdb/`` entry that GDAL cannot open.
    """
    parents = {table.parent for table in root.rglob("*.gdbtable") if table.is_file()}
    if not parents:
        return None
    ranked = sorted(
        parents,
        key=lambda path: (
            0 if path.suffix.lower() == ".gdb" else 1,
            0 if (path / "gdb").is_file() else 1,
            len(path.parts),
            str(path).lower(),
        ),
    )
    return ranked[0]


def stage_for_ogr(source: Path, work: Path, source_format: str) -> Path:
    """Copy FileGDB onto a short ASCII path so Windows GDAL opens it reliably."""
    if source_format != "gdb":
        return source
    staged = work / "staged_src.gdb"
    if staged.exists():
        shutil.rmtree(staged)
    shutil.copytree(source, staged)
    return staged


def decode_esri_shape(data: bytes | None) -> dict | None:
    """Decode an ESRI shapefile-style geometry buffer from a Personal GDB Shape column."""
    if not data or len(data) < 4:
        return None
    shape_type = int(struct.unpack_from("<i", data, 0)[0])
    if shape_type == 0:
        return None
    if shape_type == 1:
        x, y = struct.unpack_from("<2d", data, 4)
        return {"kind": "point", "points": [(x, y)], "parts": [0]}
    if shape_type in (3, 5):
        nparts, npoints = struct.unpack_from("<2i", data, 36)
        if nparts < 1 or npoints < 1 or nparts > 100_000 or npoints > 2_000_000:
            raise ConversionError("Personal GDB 几何数据异常")
        parts = list(struct.unpack_from(f"<{nparts}i", data, 44))
        base = 44 + 4 * nparts
        points = [struct.unpack_from("<2d", data, base + 16 * index) for index in range(npoints)]
        return {"kind": "polyline" if shape_type == 3 else "polygon", "points": points, "parts": parts}
    if shape_type == 8:
        npoints = struct.unpack_from("<i", data, 36)[0]
        points = [struct.unpack_from("<2d", data, 40 + 16 * index) for index in range(npoints)]
        return {"kind": "multipoint", "points": points, "parts": [0]}
    raise ConversionError(f"暂不支持 Personal GDB 几何类型 {shape_type}（含 Z/M 的图层请先在桌面 GIS 中转出）")


def _dbf_field_name(name: str, used: set[str]) -> str:
    cleaned = re.sub(r"[^\w]", "", name, flags=re.UNICODE) or "FIELD"
    base = cleaned[:10]
    candidate = base
    index = 2
    while candidate.upper() in used:
        suffix = f"_{index}"
        candidate = (base[: max(1, 10 - len(suffix))] + suffix)[:10]
        index += 1
    used.add(candidate.upper())
    return candidate


def _as_dbf_value(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return value
    if isinstance(value, (bytes, bytearray)):
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    if isinstance(value, (int, float)):
        return value
    text = str(value)
    return text[:254]


def export_personal_geodatabase(mdb_path: Path, destination: Path) -> Path:
    """Export ESRI Personal Geodatabase (.mdb) feature classes to a Shapefile folder.

    GDAL's PGeo driver needs a matching-bitness Access ODBC driver (often missing on
    64-bit Windows). Reading the Jet tables directly avoids that dependency.
    """
    try:
        from access_parser import AccessParser
    except ImportError as error:
        raise ConversionError("服务器缺少 access-parser，无法读取 Personal Geodatabase（.mdb）") from error

    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        database = AccessParser(str(mdb_path))
    except Exception as error:
        raise ConversionError("无法解析 .mdb，请确认文件是未损坏的 ESRI Personal Geodatabase") from error

    table_names = list(getattr(database, "catalog", {}) or {})
    if not table_names:
        raise ConversionError("未能读取 .mdb 内的表，请确认文件格式为 Access/Personal GDB")

    spatial_refs: dict[int, str] = {}
    geom_meta: dict[str, dict] = {}
    if "GDB_SpatialRefs" in database.catalog:
        refs = database.parse_table("GDB_SpatialRefs")
        for index, srid in enumerate(refs.get("SRID", [])):
            text = refs.get("SRTEXT", [None])[index]
            if srid is not None and isinstance(text, str) and text.strip():
                spatial_refs[int(srid)] = text.strip()
    if "GDB_GeomColumns" in database.catalog:
        columns = database.parse_table("GDB_GeomColumns")
        for index, table_name in enumerate(columns.get("TableName", [])):
            if not isinstance(table_name, str):
                continue
            geom_meta[table_name] = {
                "field": columns.get("FieldName", [None])[index] or "Shape",
                "srid": columns.get("SRID", [None])[index],
            }

    feature_tables = []
    for name in table_names:
        if not isinstance(name, str):
            continue
        upper = name.upper()
        if upper.startswith("MSYS") or upper.startswith("GDB_") or upper.endswith("_SHAPE_INDEX"):
            continue
        if upper in {"SELECTIONS", "SELECTEDOBJECTS"}:
            continue
        feature_tables.append(name)

    written = 0
    for table_name in feature_tables:
        try:
            table = database.parse_table(table_name)
        except Exception:
            continue
        if not table:
            continue
        meta = geom_meta.get(table_name) or {}
        shape_field = meta.get("field") or next((key for key in table if key.lower() == "shape"), None)
        if not shape_field or shape_field not in table:
            continue
        rows = len(table[shape_field])
        if rows < 1:
            continue
        geometries = []
        kind = None
        for index in range(rows):
            try:
                decoded = decode_esri_shape(table[shape_field][index])
            except ConversionError:
                raise
            except Exception as error:
                raise ConversionError(f"图层 {table_name} 第 {index + 1} 个要素几何无法解析") from error
            geometries.append(decoded)
            if decoded and kind is None:
                kind = decoded["kind"]
        if kind is None:
            continue
        attribute_fields = [key for key in table if key != shape_field]
        used_names: set[str] = set()
        field_map = [(key, _dbf_field_name(key, used_names)) for key in attribute_fields]
        shape_type = {
            "point": shapefile.POINT,
            "polyline": shapefile.POLYLINE,
            "polygon": shapefile.POLYGON,
            "multipoint": shapefile.MULTIPOINT,
        }[kind]
        layer_stem = safe_stem(Path(table_name)) or f"layer_{written + 1}"
        target = destination / layer_stem
        writer = shapefile.Writer(str(target), shapeType=shape_type, encoding="utf-8")
        for original, short in field_map:
            sample = next((table[original][i] for i in range(rows) if table[original][i] is not None), "")
            if isinstance(sample, bool):
                writer.field(short, "L")
            elif isinstance(sample, int) and not isinstance(sample, bool):
                writer.field(short, "N", decimal=0)
            elif isinstance(sample, float):
                writer.field(short, "F", decimal=8)
            else:
                writer.field(short, "C", size=254)
        kept = 0
        for index, geometry in enumerate(geometries):
            if geometry is None or geometry["kind"] != kind:
                continue
            if kind == "point":
                writer.point(*geometry["points"][0])
            elif kind == "multipoint":
                writer.multipoint(list(geometry["points"]))
            else:
                rings = []
                parts = geometry["parts"] + [len(geometry["points"])]
                for part_index in range(len(parts) - 1):
                    rings.append(list(geometry["points"][parts[part_index]:parts[part_index + 1]]))
                if kind == "polygon":
                    writer.poly(rings)
                else:
                    writer.line(rings)
            writer.record(*[_as_dbf_value(table[original][index]) for original, _ in field_map])
            kept += 1
        writer.close()
        if kept < 1:
            for suffix in (".shp", ".shx", ".dbf", ".cpg"):
                path = target.with_suffix(suffix)
                if path.exists():
                    path.unlink()
            continue
        srid = meta.get("srid")
        wkt = spatial_refs.get(int(srid)) if srid is not None else None
        if wkt:
            target.with_suffix(".prj").write_text(wkt, encoding="utf-8")
        written += 1

    if written < 1:
        raise ConversionError(
            "未从 .mdb 中解析到要素图层。请确认上传的是 ESRI Personal Geodatabase（含 Shape 字段），"
            "而不是普通 Access 业务库。"
        )
    return destination


def collect_shapefiles(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.shp") if path.is_file())


def bundle_shapefiles(shps: list[Path], destination: Path) -> Path:
    """Copy one or more shapefile sets into a single folder for GDAL directory open."""
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    used = set()
    for shp in shps:
        stem = safe_stem(shp) or "layer"
        base = stem
        index = 2
        while stem.lower() in used:
            stem = f"{base}_{index}"
            index += 1
        used.add(stem.lower())
        for companion in shp.parent.glob(shp.stem + ".*"):
            if not companion.is_file():
                continue
            target = destination / f"{stem}{companion.suffix.lower()}"
            shutil.copy2(companion, target)
    if not any(destination.glob("*.shp")):
        raise ConversionError("未找到可转换的 Shapefile")
    return destination


def find_dataset(root: Path, stage_dir: Path | None = None) -> tuple[str, Path]:
    """Detect shapefile, FileGDB, MDB, DWG or DXF under an extracted or flat upload tree.

    Multiple .shp files are exposed as a directory so ogr2ogr converts every layer,
    not only the first file name in the ZIP.
    """
    gdb = find_filegdb(root)
    if gdb is not None:
        return "gdb", gdb
    mdbs = [path for path in root.rglob("*.mdb") if path.is_file()]
    if mdbs:
        return "mdb", mdbs[0]
    shps = collect_shapefiles(root)
    if shps:
        parents = {path.parent.resolve() for path in shps}
        if len(shps) == 1 and len(parents) == 1:
            return "shp", shps[0]
        if len(parents) == 1:
            return "shp", next(iter(parents))
        if stage_dir is None:
            raise ConversionError("多个 Shapefile 位于不同目录，请打成同一 ZIP 后重试")
        return "shp", bundle_shapefiles(shps, stage_dir / "shp_layers")
    dwgs = [path for path in root.rglob("*.dwg") if path.is_file()]
    if dwgs:
        return "dwg", dwgs[0]
    dxfs = [path for path in root.rglob("*.dxf") if path.is_file()]
    if dxfs:
        return "dxf", dxfs[0]
    raise ConversionError(
        "未识别到 .gdb / .shp / .mdb / .dwg / .dxf 数据。"
        "FileGDB 请压缩整个 xxx.gdb 文件夹，或压缩其中含 .gdbtable 的文件；"
        "Shapefile 须包含同名 .shp/.shx/.dbf，多个图层可放在同一个 ZIP 中一并转换。"
    )


def _prepend_path(directory: Path):
    value = str(directory)
    current = os.environ.get("PATH", "")
    if value and value not in current.split(os.pathsep):
        os.environ["PATH"] = value + os.pathsep + current


def configure_dwg_tools() -> str | None:
    """Locate LibreDWG dwg2dxf from PATH or the project-local tools/ folder."""
    found = shutil.which("dwg2dxf")
    if found:
        return found
    roots = [
        Path(__file__).resolve().parent / "tools" / "libredwg",
        Path(os.environ.get("LIBREDWG_BIN", "")),
        Path(r"D:\conda\envs\gis-expert\Library\bin"),
        Path("/usr/bin"),
        Path("/usr/local/bin"),
    ]
    for directory in roots:
        if not directory:
            continue
        candidate = directory / ("dwg2dxf.exe" if os.name == "nt" else "dwg2dxf")
        if candidate.is_file():
            _prepend_path(directory)
            return str(candidate)
    return None


def configure_oda_converter() -> str | None:
    """Locate ODA File Converter (handles newer DWG versions LibreDWG may hang on)."""
    found = shutil.which("ODAFileConverter")
    if found:
        return found
    roots = [
        Path(os.environ.get("ODA_FILE_CONVERTER", "")),
        Path(r"E:\ODATrial\ODAToolkit\exe\vc16_amd64dll\ODAFileConverter.exe"),
        Path(r"C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe"),
        Path(r"C:\Program Files (x86)\ODA\ODAFileConverter\ODAFileConverter.exe"),
        Path(r"D:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe"),
    ]
    for candidate in roots:
        if candidate and candidate.is_file():
            _prepend_path(candidate.parent)
            return str(candidate)
    # Last resort: shallow search under common ODA install roots.
    for base in (
        Path(r"E:\ODATrial"),
        Path(r"C:\Program Files\ODA"),
        Path(r"C:\Program Files (x86)\ODA"),
    ):
        if not base.is_dir():
            continue
        try:
            match = next(base.rglob("ODAFileConverter.exe"), None)
        except OSError:
            match = None
        if match and match.is_file():
            _prepend_path(match.parent)
            return str(match)
    return None


def configure_gdal_environment() -> str | None:
    """Ensure ogr2ogr is on PATH and GDAL/PROJ data dirs are set for subprocesses."""
    configure_dwg_tools()
    found = shutil.which("ogr2ogr")
    explicit = os.environ.get("GDAL_BIN") or os.environ.get("GIS_EXPERT_GDAL_BIN")
    roots = []
    if explicit:
        roots.append(Path(explicit))
    roots.extend([
        Path(r"D:\conda\envs\gis-expert\Library\bin"),
        Path(r"D:\conda\envs\gdal\Library\bin"),
        Path(os.environ.get("CONDA_PREFIX", "")) / "Library" / "bin",
        Path(os.environ.get("USERPROFILE", "")) / "miniconda3" / "envs" / "gis-expert" / "Library" / "bin",
        Path(r"D:\ProgramData\miniconda3\envs\gis-expert\Library\bin"),
        Path("/usr/bin"),
        Path("/usr/local/bin"),
    ])
    binary = Path(found) if found else None
    if binary is None:
        for directory in roots:
            candidate = directory / ("ogr2ogr.exe" if os.name == "nt" else "ogr2ogr")
            if candidate.is_file():
                _prepend_path(directory)
                binary = candidate
                break
    if binary is None:
        return None
    # Conda layouts keep share/gdal next to Library/bin; Debian uses /usr/share/gdal.
    for share_root in (binary.parent.parent / "share", Path("/usr/share")):
        gdal_data = share_root / "gdal"
        proj_data = share_root / "proj"
        if gdal_data.is_dir():
            os.environ.setdefault("GDAL_DATA", str(gdal_data))
        if proj_data.is_dir():
            os.environ.setdefault("PROJ_DATA", str(proj_data))
            os.environ.setdefault("PROJ_LIB", str(proj_data))
    return str(binary)


def which_tool(*names: str) -> str | None:
    if "ogr2ogr" in names:
        configure_gdal_environment()
    for name in names:
        path = shutil.which(name)
        if path:
            return path
    return None


def run_checked(command: list[str], timeout=120, open_hint: str | None = None):
    try:
        completed = subprocess.run(
            command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
            errors="replace", timeout=timeout, check=False)
    except subprocess.TimeoutExpired as error:
        raise ConversionError(f"外部转换工具超时（>{timeout} 秒），请改用更小的图纸或先另存为 DXF 后再试") from error
    if completed.returncode != 0:
        detail = " ".join((completed.stderr or completed.stdout or "").split())
        clipped = detail[:240]
        if "Unsupported geometry" in detail:
            raise ConversionError("源数据含目标格式不支持的几何类型，请先转为 Shapefile 或去掉复杂 CAD 实体后再试")
        if (
            "Unable to open" in detail
            or "Unable to initialize ODBC" in detail
            or "not recognized" in detail.lower()
        ):
            raise ConversionError(
                (open_hint or "无法打开输入数据，请确认文件完整且格式受支持。")
                + (f" 详情：{clipped}" if clipped else "")
            )
        raise ConversionError(
            "外部转换工具执行失败，请检查文件是否损坏或格式不受支持"
            + (f"。详情：{clipped}" if clipped else "")
        )
    return completed


def convert_dwg_to_dxf(source: Path, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    failures: list[str] = []

    def _clear_destination():
        if destination.exists():
            destination.unlink()

    def _note(error: ConversionError):
        text = str(error).strip()
        if text and text not in failures:
            failures.append(text)

    # Stage onto a short ASCII name: LibreDWG/ODA are more reliable than Unicode paths.
    staged_source = source
    staging_dir = None
    oda = None
    try:
        if any(ord(char) > 127 for char in str(source)) or source.suffix.lower() != ".dwg":
            staging_dir = Path(tempfile.mkdtemp(prefix="dwg-"))
            staged_source = staging_dir / "input.dwg"
            shutil.copy2(source, staged_source)

        # Order: LibreDWG → GDAL → ODA (auto-use ODA only when installed locally).
        converter = configure_dwg_tools() or which_tool("dwg2dxf")
        if converter:
            try:
                # Keep LibreDWG short: it can hang indefinitely on some DWG versions.
                run_checked(
                    [converter, "-y", "-o", str(destination), str(staged_source)],
                    timeout=60,
                )
                if destination.is_file() and destination.stat().st_size > 0:
                    return destination
                raise ConversionError("LibreDWG 转换结果为空")
            except ConversionError as error:
                _clear_destination()
                _note(error)

        ogr2ogr = which_tool("ogr2ogr")
        if ogr2ogr:
            try:
                run_checked([
                    ogr2ogr, "-overwrite", "-skipfailures",
                    "-f", "DXF", str(destination), str(staged_source),
                ], timeout=45, open_hint="GDAL 无法打开该 DWG（仅支持部分旧版 CAD）。")
                if destination.is_file() and destination.stat().st_size > 0:
                    return destination
            except ConversionError as error:
                _clear_destination()
                _note(error)

        # Last resort when ODA is installed on this machine.
        oda = configure_oda_converter()
        if oda:
            try:
                with tempfile.TemporaryDirectory(prefix="oda-") as temporary:
                    work = Path(temporary)
                    input_dir = work / "in"
                    output_dir = work / "out"
                    input_dir.mkdir()
                    output_dir.mkdir()
                    shutil.copy2(staged_source, input_dir / "input.dwg")
                    # Audit off (last flag 0): audit=1 rewrites entities onto
                    # $TD_AUDIT_GENERATED_* layers and breaks redline name matching.
                    run_checked(
                        [oda, str(input_dir), str(output_dir), "ACAD2018", "DXF", "0", "0"],
                        timeout=180,
                    )
                    produced = next(output_dir.rglob("*.dxf"), None)
                    if produced is None:
                        raise ConversionError("ODA 转换未生成 DXF")
                    shutil.copy2(produced, destination)
                    if destination.is_file() and destination.stat().st_size > 0:
                        return destination
                    raise ConversionError("ODA 转换结果为空")
            except ConversionError as error:
                _clear_destination()
                _note(error)
    finally:
        if staging_dir and staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)

    if not oda:
        raise ConversionError(
            "无法转换该 DWG（需先转为 DXF）。"
            "LibreDWG 与 GDAL 均未能转换，且当前环境没有 ODA（ODA File Converter）。"
            "请在服务器安装 ODA，或在 CAD 中另存为 DXF 后再上传。"
        )
    detail = ("；".join(failures[:3]) if failures else "未找到可用的 DWG 转换工具")
    raise ConversionError(
        "无法转换该 DWG（需先转为 DXF）。"
        f"{detail}。"
        "也可在 CAD 中另存为 DXF 后再上传。"
    )


def read_coordinate_rows(path: Path, x_field: str, y_field: str, z_field: str | None):
    text = path.read_text(encoding="utf-8-sig")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t ")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(text.splitlines(), dialect=dialect)
    if not reader.fieldnames:
        raise ConversionError("坐标文件缺少表头")
    fields = {name.strip(): name for name in reader.fieldnames if name}
    for required in (x_field, y_field):
        if required not in fields:
            raise ConversionError(f"坐标文件缺少字段：{required}")
    if z_field and z_field not in fields:
        raise ConversionError(f"坐标文件缺少字段：{z_field}")
    rows = []
    for index, row in enumerate(reader, start=2):
        if len(rows) >= MAX_COORD_ROWS:
            raise ConversionError(f"坐标行数不能超过 {MAX_COORD_ROWS}")
        try:
            x = float(str(row[fields[x_field]]).strip())
            y = float(str(row[fields[y_field]]).strip())
            z = float(str(row[fields[z_field]]).strip()) if z_field else None
        except (TypeError, ValueError):
            raise ConversionError(f"第 {index} 行坐标无法解析为数字") from None
        skip = {fields[x_field], fields[y_field]}
        if z_field:
            skip.add(fields[z_field])
        extra = {key: row[key] for key in reader.fieldnames if key and key not in skip}
        rows.append((x, y, z, extra))
    if not rows:
        raise ConversionError("坐标文件没有有效数据行")
    return rows, fields


def four_param_transform(x, y, dx, dy, rotation_seconds, scale_ppm):
    radians = math.radians(rotation_seconds / 3600.0)
    scale = 1.0 + scale_ppm * 1e-6
    cos_a, sin_a = math.cos(radians), math.sin(radians)
    return dx + scale * (x * cos_a - y * sin_a), dy + scale * (x * sin_a + y * cos_a)


def seven_param_transform(x, y, z, dx, dy, dz, rx_sec, ry_sec, rz_sec, scale_ppm):
    # Bursa-Wolf with rotation in arc-seconds and scale in ppm; XYZ in metres.
    rx, ry, rz = (math.radians(value / 3600.0) for value in (rx_sec, ry_sec, rz_sec))
    scale = 1.0 + scale_ppm * 1e-6
    x2 = dx + scale * (x - rz * y + ry * z)
    y2 = dy + scale * (rz * x + y - rx * z)
    z2 = dz + scale * (-ry * x + rx * y + z)
    return x2, y2, z2


def convert_coordinates(inputs: list[Path], output: Path, options: dict) -> list[Path]:
    if len(inputs) != 1:
        raise ConversionError("坐标转换一次只处理一个坐标表")
    source = inputs[0]
    if source.suffix.lower() not in {".csv", ".txt", ".tsv"}:
        raise ConversionError("坐标文件须为 CSV/TXT/TSV")
    method = str(options.get("method", "epsg"))
    x_field = str(options.get("xField") or "x").strip() or "x"
    y_field = str(options.get("yField") or "y").strip() or "y"
    z_field = str(options.get("zField") or "").strip() or None
    rows, fields = read_coordinate_rows(source, x_field, y_field, z_field)
    out_x, out_y, out_z = f"{x_field}_out", f"{y_field}_out", (f"{z_field}_out" if z_field else None)
    converted = []
    if method == "epsg":
        source_crs = str(options.get("sourceEpsg") or "").strip()
        target_crs = str(options.get("targetEpsg") or "").strip()
        if not re.fullmatch(r"\d{4,6}", source_crs) or not re.fullmatch(r"\d{4,6}", target_crs):
            raise ConversionError("请填写有效的源/目标 EPSG 编号")
        transformer = Transformer.from_crs(CRS.from_epsg(int(source_crs)), CRS.from_epsg(int(target_crs)), always_xy=True)
        for x, y, z, extra in rows:
            if z is None:
                nx, ny = transformer.transform(x, y)
                converted.append({**extra, out_x: nx, out_y: ny, x_field: x, y_field: y})
            else:
                nx, ny, nz = transformer.transform(x, y, z)
                converted.append({**extra, out_x: nx, out_y: ny, out_z: nz, x_field: x, y_field: y, z_field: z})
    elif method == "four-param":
        dx, dy = number(options, "dx", required=True), number(options, "dy", required=True)
        rotation = number(options, "rotation", required=True)
        scale = number(options, "scale", required=True)
        for x, y, z, extra in rows:
            nx, ny = four_param_transform(x, y, dx, dy, rotation, scale)
            item = {**extra, out_x: nx, out_y: ny, x_field: x, y_field: y}
            if z is not None:
                item[z_field] = z
                item[out_z] = z
            converted.append(item)
    elif method == "seven-param":
        if not z_field:
            raise ConversionError("七参数转换需要指定高程字段 zField")
        params = [number(options, key, required=True) for key in ("dx", "dy", "dz", "rx", "ry", "rz", "scale")]
        for x, y, z, extra in rows:
            if z is None:
                raise ConversionError("七参数转换的每一行都需要高程值")
            nx, ny, nz = seven_param_transform(x, y, z, *params)
            converted.append({**extra, out_x: nx, out_y: ny, out_z: nz, x_field: x, y_field: y, z_field: z})
    else:
        raise ConversionError("不支持的转换方式")

    ensure_output(output)
    result = output / f"{safe_stem(source)}_converted.csv"
    fieldnames = []
    for row in converted:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with result.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(converted)
    return [result]


def ogr_convert(source: Path, target: Path, source_format: str, target_format: str, timeout=600):
    ogr2ogr = which_tool("ogr2ogr")
    if not ogr2ogr:
        raise ConversionError("服务器未安装 GDAL/OGR（ogr2ogr），无法进行 GIS 格式转换")
    drivers = {"shp": "ESRI Shapefile", "gdb": "OpenFileGDB", "mdb": "PGeo", "dxf": "DXF"}
    input_drivers = {"gdb": "OpenFileGDB", "shp": "ESRI Shapefile", "dxf": "DXF", "dwg": "DWG"}
    open_hints = {
        "gdb": "无法打开 FileGDB：请确认 ZIP 内是完整库（含 .gdbtable，不要只压空的 .gdb 目录名）。",
        "shp": "无法打开 Shapefile：请确认 ZIP 内含同名的 .shp/.shx/.dbf。",
        "dxf": "无法打开 DXF，请确认文件未损坏。",
        "dwg": "无法打开 DWG，请确认文件未损坏或先转为 DXF。",
        "mdb": "无法通过 ODBC 打开 Personal GDB；将改用内置解析。若仍失败请改导出为 .gdb/.shp 后再传。",
    }
    if target_format not in drivers:
        raise ConversionError("不支持的目标格式")
    if source_format == target_format:
        raise ConversionError("源格式与目标格式相同")
    # Shapefile destination is a folder so multi-layer CAD/GDB sources can expand safely.
    # -skipfailures keeps mixed CAD entity types from aborting the whole job.
    command = [
        ogr2ogr, "-overwrite", "-skipfailures",
        "-f", drivers[target_format], str(target), str(source),
    ]
    if source_format in input_drivers:
        command[1:1] = ["-if", input_drivers[source_format]]
    hint = open_hints.get(source_format)
    try:
        run_checked(command, timeout=timeout, open_hint=hint)
    except ConversionError:
        if source_format == "dxf" and target_format == "gdb":
            # FileGDB rejects some DXF entity types; go via Shapefile first.
            bridge = target.parent / "_bridge_shp"
            bridge.mkdir(exist_ok=True)
            run_checked([
                ogr2ogr, "-overwrite", "-skipfailures",
                "-f", "ESRI Shapefile", str(bridge), str(source),
            ], timeout=timeout, open_hint=hint)
            run_checked([
                ogr2ogr, "-overwrite", "-skipfailures",
                "-f", "OpenFileGDB", str(target), str(bridge),
            ], timeout=timeout)
        else:
            raise
    if target_format == "shp":
        if not any(target.rglob("*.shp")):
            raise ConversionError("格式转换未生成 Shapefile 成果")
    elif not target.exists():
        raise ConversionError("格式转换未生成成果")


def package_directory(directory: Path, archive: Path) -> Path:
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                bundle.write(path, path.relative_to(directory).as_posix())
    return archive


def convert_formats(inputs: list[Path], output: Path, options: dict) -> list[Path]:
    if len(inputs) != 1:
        raise ConversionError("格式转换一次只处理一个数据包")
    configure_gdal_environment()
    source_upload = inputs[0]
    target_format = str(options.get("targetFormat") or "").lower()
    if target_format not in {"shp", "gdb", "mdb", "dxf"}:
        raise ConversionError("目标格式须为 shp / gdb / mdb / dxf")
    ensure_output(output)
    work = output / "work"
    work.mkdir(mode=0o700)
    layer_count = 1
    if source_upload.suffix.lower() == ".zip":
        extracted = unzip_archive(source_upload, work / "input")
        source_format, source_path = find_dataset(extracted, stage_dir=work)
        if source_format == "shp":
            layer_count = len(collect_shapefiles(source_path if source_path.is_dir() else source_path.parent))
    else:
        suffix = source_upload.suffix.lower()
        mapping = {".shp": "shp", ".mdb": "mdb", ".dwg": "dwg", ".dxf": "dxf"}
        if suffix not in mapping:
            raise ConversionError("请上传 .zip（含 shp/gdb）、.mdb、.dwg 或 .dxf")
        source_format, source_path = mapping[suffix], source_upload
        if source_format == "shp":
            raise ConversionError("Shapefile 请打包为包含 .shp/.shx/.dbf 的 ZIP 后上传；多个图层放在同一 ZIP 可一次转出")

    if source_format == "dwg" and target_format == "dxf":
        dxf = output / f"{safe_stem(source_path)}.dxf"
        convert_dwg_to_dxf(source_path, dxf)
        return [dxf]
    if target_format == "mdb":
        raise ConversionError("当前环境不支持写出 Personal Geodatabase（.mdb）；请改用 .gdb 或 .shp")
    if source_format == "mdb" and target_format == "mdb":
        raise ConversionError("源格式与目标格式相同")

    target_dir = work / "target"
    target_dir.mkdir()
    # Prefer the upload ZIP name for multi-layer shapefile packs so results are not
    # named after whichever .shp sorts first (e.g. KFPQGYXYD_to_gdb.zip).
    if source_format == "shp" and layer_count > 1:
        stem = safe_stem(source_upload) or "layers"
    elif source_format in {"gdb", "mdb"}:
        stem = safe_stem(source_upload)
    else:
        stem = safe_stem(source_path)
    if stem.lower().endswith(".gdb"):
        stem = safe_stem(Path(stem).with_suffix("")) or "result"

    # Personal GDB: do not use GDAL PGeo/ODBC (needs matching Access driver). Export via Jet parser.
    if source_format == "mdb":
        mdb_layers = export_personal_geodatabase(source_path, work / "mdb_layers")
        if target_format == "shp":
            package_directory(mdb_layers, output / f"{stem}_to_shp.zip")
            return [output / f"{stem}_to_shp.zip"]
        convert_source = mdb_layers
        convert_format = "shp"
    else:
        convert_source = stage_for_ogr(source_path, work, source_format)
        convert_format = source_format
        # DWG → shp/gdb: convert via DXF first for more reliable CAD entity handling.
        if source_format == "dwg" and target_format in {"shp", "gdb"}:
            bridge = work / f"{stem}_bridge.dxf"
            convert_dwg_to_dxf(source_path, bridge)
            convert_source = bridge
            convert_format = "dxf"

    if target_format == "shp":
        target_path = target_dir / "layers"
        target_path.mkdir()
    elif target_format == "gdb":
        target_path = target_dir / f"{stem}.gdb"
    else:
        target_path = target_dir / f"{stem}.dxf"
    ogr_convert(convert_source, target_path, convert_format, target_format)
    archive = output / f"{stem}_to_{target_format}.zip"
    package_directory(target_dir, archive)
    return [archive]

_MIF_CHAR = re.compile(r"\\[Mm]\+([0-9A-Fa-f])([0-9A-Fa-f]{4})")
_UPLUS_CHAR = re.compile(r"\\[Uu]\+([0-9A-Fa-f]{4,6})")


def decode_cad_layer_name(name: str) -> str:
    """Decode ODA/AutoCAD DXF layer escapes such as \\M+5BFC9 (GBK) and \\U+53EF."""
    if not name or ("\\M+" not in name.upper() and "\\U+" not in name.upper()):
        return name

    def mif(match: re.Match[str]) -> str:
        raw = bytes.fromhex(match.group(2))
        for encoding in ("gbk", "gb2312", "big5"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return match.group(0)

    def uplus(match: re.Match[str]) -> str:
        try:
            return chr(int(match.group(1), 16))
        except ValueError:
            return match.group(0)

    decoded = _MIF_CHAR.sub(mif, name)
    return _UPLUS_CHAR.sub(uplus, decoded)


def _chars_in_order(needle: str, haystack: str) -> bool:
    """True when needle characters appear in order inside haystack (not necessarily contiguous)."""
    if not needle:
        return False
    cursor = 0
    for char in needle:
        cursor = haystack.find(char, cursor)
        if cursor < 0:
            return False
        cursor += 1
    return True


def layer_matches(name: str, requested: str) -> bool:
    display = decode_cad_layer_name(name).strip()
    normalized = display.upper()
    if requested:
        want = requested.strip()
        want_upper = want.upper()
        if normalized == want_upper or want in display or want_upper in normalized:
            return True
        return len(want) >= 4 and _chars_in_order(want_upper, normalized)
    return any(hint.upper() in normalized or hint in display for hint in REDLINE_LAYER_HINTS)


def polyline_points(entity):
    if entity.dxftype() == "LWPOLYLINE":
        points = [(float(x), float(y)) for x, y, *_ in entity.get_points("xy")]
        closed = bool(entity.closed)
    elif entity.dxftype() == "POLYLINE":
        points = [(float(vertex.dxf.location.x), float(vertex.dxf.location.y)) for vertex in entity.vertices]
        closed = bool(entity.is_closed)
    else:
        return None
    if len(points) < 3:
        return None
    # Treat nearly-closed rings as closed (CAD often leaves a tiny endpoint gap).
    if not closed:
        dx = points[0][0] - points[-1][0]
        dy = points[0][1] - points[-1][1]
        gap = (dx * dx + dy * dy) ** 0.5
        # Projected drawings use meters; geographic drawings use degrees.
        span = max(abs(points[0][0]), abs(points[0][1]), 1.0)
        tolerance = 0.05 if span > 1000 else 1e-6
        if gap > tolerance:
            return None
        closed = True
    if closed and points and points[0] != points[-1]:
        points.append(points[0])
    if not closed or len(points) < 4:
        return None
    return points


def write_geojson(path: Path, features: list[dict]):
    payload = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def write_shapefile(directory: Path, stem: str, rings: list[list[tuple[float, float]]]):
    target = directory / stem
    with shapefile.Writer(str(target), shapeType=shapefile.POLYGON) as writer:
        writer.field("ID", "N", 10, 0)
        writer.field("NAME", "C", 64)
        for index, ring in enumerate(rings, start=1):
            writer.poly([ring])
            writer.record(index, f"redline-{index}")
    prj = directory / f"{stem}.prj"
    # WGS84 placeholder; CAD drawings often lack CRS metadata.
    prj.write_text(
        'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
        'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]',
        encoding="utf-8")
    return target.with_suffix(".shp")


def extract_redline(inputs: list[Path], output: Path, options: dict) -> list[Path]:
    if len(inputs) != 1:
        raise ConversionError("红线提取一次只处理一个图纸文件")
    source = inputs[0]
    suffix = source.suffix.lower()
    if suffix not in {".dwg", ".dxf"}:
        raise ConversionError("红线提取仅支持 DWG/DXF")
    if source.stat().st_size > 80 * 1024 * 1024:
        raise ConversionError("图纸超过 80 MB，请先在 CAD 中清理或另存为较小的 DXF 后再试")
    ensure_output(output)
    dxf_path = source
    if suffix == ".dwg":
        dxf_path = output / f"{safe_stem(source)}.dxf"
        convert_dwg_to_dxf(source, dxf_path)
    if dxf_path.stat().st_size > 120 * 1024 * 1024:
        raise ConversionError("转换后的 DXF 过大，请精简图层后重试，或只保留红线相关图层再导出")
    try:
        document = ezdxf.readfile(dxf_path)
    except Exception as error:
        raise ConversionError("无法读取 DXF，请确认文件未损坏；DWG 可先在 CAD 中另存为 DXF 再上传") from error

    model = document.modelspace()
    requested = str(options.get("layer") or "").strip()
    rings = []
    features = []
    for entity in model:
        if entity.dxftype() not in {"LWPOLYLINE", "POLYLINE"}:
            continue
        layer = entity.dxf.layer if entity.dxf.hasattr("layer") else ""
        if not layer_matches(layer, requested):
            continue
        points = polyline_points(entity)
        if not points:
            continue
        rings.append(points)
        features.append({
            "type": "Feature",
            "properties": {"layer": decode_cad_layer_name(layer) or layer, "id": len(features) + 1},
            "geometry": {"type": "Polygon", "coordinates": [points]},
        })
    if not features:
        closed_layers = sorted({
            decode_cad_layer_name(entity.dxf.layer if entity.dxf.hasattr("layer") else "")
            for entity in model
            if entity.dxftype() in {"LWPOLYLINE", "POLYLINE"} and polyline_points(entity)
        })
        closed_layers = [name for name in closed_layers if name][:12]
        hint = f"图层“{requested}”" if requested else "名称含红线/范围线/REDLINE 等关键字的图层"
        extra = f"；图中含闭合线的图层示例：{'、'.join(closed_layers)}" if closed_layers else ""
        raise ConversionError(f"未找到可闭合的红线范围（查找 {hint}）{extra}。请在参数中填写准确图层名后重试")
    export_format = str(options.get("exportFormat") or "geojson").lower()
    stem = f"{safe_stem(source)}_redline"
    outputs = []
    if export_format in {"geojson", "both"}:
        geojson = output / f"{stem}.geojson"
        write_geojson(geojson, features)
        outputs.append(geojson)
    if export_format in {"shp", "both"}:
        shape_dir = output / "shp"
        shape_dir.mkdir(mode=0o700)
        write_shapefile(shape_dir, stem, rings)
        archive = output / f"{stem}_shp.zip"
        package_directory(shape_dir, archive)
        outputs.append(archive)
    if not outputs:
        raise ConversionError("导出格式无效")
    return outputs


def convert(tool, inputs, output, options=None):
    """Return generated paths; never invent demo outputs."""
    options = options or {}
    inputs = [Path(path) for path in inputs]
    output = Path(output)
    if tool == "coordinate-transform":
        return convert_coordinates(inputs, output, options)
    if tool == "format-convert":
        return convert_formats(inputs, output, options)
    if tool == "redline-extract":
        return extract_redline(inputs, output, options)
    raise ConversionError("未知工具")
