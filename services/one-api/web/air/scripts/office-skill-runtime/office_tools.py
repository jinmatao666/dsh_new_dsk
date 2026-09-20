#!/usr/bin/env python3
"""Deterministic file-processing runtime embedded in Wanwei office skills."""

from __future__ import annotations

import argparse
import base64
import csv
import difflib
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
import wave
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterable, Sequence


RUNTIME_VERSION = "1.0.6"
DEFAULT_FONT = "Microsoft YaHei"
INVALID_FILENAME = re.compile(r'[\\/:*?"<>|]+')
DEFAULT_MEETING_BASE_URL = "http://ac.zjugis.com:20330/v1"
DEFAULT_MEETING_MODEL = "qwen3.8-27b-fp8"
DEFAULT_TRANSCRIPTION_MODEL = "Qwen3-ASR-1.7B"
DEFAULT_AUDIO_SEGMENT_SECONDS = 120


class UserError(RuntimeError):
    """An actionable input or environment error safe to show to users."""


@dataclass
class Artifact:
    path: str
    kind: str
    description: str


def require(module_name: str, package_name: str | None = None):
    try:
        return __import__(module_name)
    except ImportError as exc:
        package = package_name or module_name
        requirements = Path(__file__).resolve().parent.parent / "requirements.txt"
        raise UserError(
            f"缺少运行依赖 {package}。请通过桌面端依赖安装审批运行："
            f'python -m pip install --user -r "{requirements}"'
        ) from exc


def full_path(value: str | Path) -> Path:
    return Path(value).expanduser().resolve()


def existing_file(value: str | Path, extensions: set[str] | None = None) -> Path:
    path = full_path(value)
    if not path.is_file():
        raise UserError(f"找不到输入文件：{path}")
    if extensions and path.suffix.lower() not in extensions:
        allowed = "、".join(sorted(extensions))
        raise UserError(f"不支持文件格式 {path.suffix or '无扩展名'}；支持：{allowed}")
    return path


def output_directory(value: str | Path) -> Path:
    path = full_path(value)
    path.mkdir(parents=True, exist_ok=True)
    if not path.is_dir():
        raise UserError(f"输出路径不是目录：{path}")
    return path


def safe_name(value: str, fallback: str = "输出") -> str:
    cleaned = INVALID_FILENAME.sub("_", value).strip(" ._")
    return cleaned or fallback


def unique_path(directory: Path, filename: str, overwrite: bool = False) -> Path:
    target = directory / safe_name(Path(filename).stem)
    target = target.with_suffix(Path(filename).suffix)
    if overwrite or not target.exists():
        return target
    for index in range(2, 10_000):
        candidate = target.with_name(f"{target.stem}_{index}{target.suffix}")
        if not candidate.exists():
            return candidate
    raise UserError(f"无法生成不冲突的输出文件名：{target.name}")


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def markdown_table(headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> list[str]:
    def cell(value: Any) -> str:
        return str(value if value is not None else "").replace("|", "\\|").replace("\n", " ")

    lines = ["| " + " | ".join(map(cell, headers)) + " |", "| " + " | ".join("---" for _ in headers) + " |"]
    lines.extend("| " + " | ".join(cell(value) for value in row) + " |" for row in rows)
    return lines


def write_report(
    directory: Path,
    basename: str,
    title: str,
    summary: str,
    details: list[str],
    artifacts: list[Artifact],
) -> Path:
    path = unique_path(directory, f"{basename}_处理报告.md")
    lines = [
        f"# {title}",
        "",
        f"> {summary}",
        "",
        "## 处理信息",
        "",
        f"- 完成时间：{datetime.now().astimezone().strftime('%Y-%m-%d %H:%M:%S %z')}",
        f"- 执行组件：万维办公工具 {RUNTIME_VERSION}",
        *details,
        "",
        "## 输出文件",
        "",
    ]
    if artifacts:
        lines.extend(f"- [{item.description}]({Path(item.path).name})" for item in artifacts)
    else:
        lines.append("- 本次操作未生成文件。")
    lines.extend(["", "## 说明", "", "- 原始文件未被覆盖；除非用户明确启用覆盖选项。", ""])
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def parse_ranges(specification: str, page_count: int) -> list[list[int]]:
    if not specification.strip():
        raise UserError("页码范围不能为空，例如：1-3,5,8-10")
    groups: list[list[int]] = []
    for raw_group in specification.split(","):
        token = raw_group.strip()
        match = re.fullmatch(r"(\d+)(?:-(\d+))?", token)
        if not match:
            raise UserError(f"页码范围格式错误：{token}")
        start = int(match.group(1))
        end = int(match.group(2) or start)
        if start < 1 or end < start or end > page_count:
            raise UserError(f"页码 {token} 超出 1-{page_count}，或起止顺序错误")
        groups.append(list(range(start - 1, end)))
    return groups


def pdf_merge(args: argparse.Namespace) -> dict[str, Any]:
    pypdf = require("pypdf")
    inputs = [existing_file(item, {".pdf"}) for item in args.inputs]
    if len(inputs) < 2:
        raise UserError("PDF 合并至少需要两个输入文件")
    directory = output_directory(args.output_dir)
    target = unique_path(directory, args.output_name or "合并文档.pdf", args.overwrite)
    writer = pypdf.PdfWriter()
    pages = 0
    for path in inputs:
        reader = pypdf.PdfReader(str(path))
        if reader.is_encrypted:
            raise UserError(f"暂不支持加密 PDF：{path.name}")
        for page in reader.pages:
            writer.add_page(page)
            pages += 1
    with target.open("wb") as stream:
        writer.write(stream)
    artifacts = [Artifact(str(target), "pdf", "合并后的 PDF")]
    report = write_report(directory, target.stem, "PDF 合并处理报告", f"已将 {len(inputs)} 个 PDF 合并为 {pages} 页。", [f"- 输入文件数：{len(inputs)}", f"- 总页数：{pages}"], artifacts)
    return {"success": True, "operation": "merge", "internalFiles": [str(report)], "artifacts": [asdict(item) for item in artifacts]}


def pdf_split(args: argparse.Namespace) -> dict[str, Any]:
    pypdf = require("pypdf")
    source = existing_file(args.input, {".pdf"})
    reader = pypdf.PdfReader(str(source))
    if reader.is_encrypted:
        raise UserError(f"暂不支持加密 PDF：{source.name}")
    groups = parse_ranges(args.ranges, len(reader.pages))
    directory = output_directory(args.output_dir)
    artifacts: list[Artifact] = []
    if args.separate_pages:
        groups = [[page] for group in groups for page in group]
    for group in groups:
        writer = pypdf.PdfWriter()
        for page_index in group:
            writer.add_page(reader.pages[page_index])
        label = str(group[0] + 1) if len(group) == 1 else f"{group[0] + 1}-{group[-1] + 1}"
        target = unique_path(directory, f"{source.stem}_第{label}页.pdf", args.overwrite)
        with target.open("wb") as stream:
            writer.write(stream)
        artifacts.append(Artifact(str(target), "pdf", f"第 {label} 页"))
    report = write_report(directory, source.stem, "PDF 拆分处理报告", f"已按 {args.ranges} 生成 {len(artifacts)} 个 PDF。", [f"- 原始页数：{len(reader.pages)}", f"- 页码范围：{args.ranges}"], artifacts)
    return {"success": True, "operation": "split", "internalFiles": [str(report)], "artifacts": [asdict(item) for item in artifacts]}


def pdf_to_images(args: argparse.Namespace) -> dict[str, Any]:
    fitz = require("fitz", "PyMuPDF")
    source = existing_file(args.input, {".pdf"})
    directory = output_directory(args.output_dir) / safe_name(f"{source.stem}_图片")
    directory.mkdir(parents=True, exist_ok=True)
    document = fitz.open(str(source))
    if document.needs_pass:
        document.close()
        raise UserError(f"暂不支持加密 PDF：{source.name}")
    scale = args.dpi / 72.0
    extension = "jpg" if args.format in {"jpg", "jpeg"} else "png"
    selected_pages = None
    if args.pages:
        selected_pages = {page for group in parse_ranges(args.pages, len(document)) for page in group}
    artifacts: list[Artifact] = []
    try:
        for page_number, page in enumerate(document, start=1):
            if selected_pages is not None and page_number - 1 not in selected_pages:
                continue
            target = unique_path(directory, f"{source.stem}_第{page_number:03d}页.{extension}", args.overwrite)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=args.format == "png")
            pixmap.save(str(target))
            artifacts.append(Artifact(str(target), "image", f"第 {page_number} 页图片"))
    finally:
        document.close()
    report = write_report(directory, source.stem, "PDF 转图片处理报告", f"已将 PDF 的 {len(artifacts)} 页转换为 {extension.upper()}。", [f"- 输出分辨率：{args.dpi} DPI", f"- 输出格式：{extension.upper()}"], artifacts)
    return {"success": True, "internalFiles": [str(report)], "artifacts": [asdict(item) for item in artifacts]}


def _page_pixels(page_size: str, orientation: str, dpi: int) -> tuple[int, int] | None:
    sizes = {"a4": (210, 297), "a3": (297, 420), "letter": (216, 279)}
    if page_size == "original":
        return None
    width_mm, height_mm = sizes[page_size]
    if orientation == "landscape":
        width_mm, height_mm = height_mm, width_mm
    return round(width_mm / 25.4 * dpi), round(height_mm / 25.4 * dpi)


def images_to_pdf(args: argparse.Namespace) -> dict[str, Any]:
    require("PIL", "Pillow")
    from PIL import Image, ImageOps

    inputs = [existing_file(item, {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}) for item in args.inputs]
    if not inputs:
        raise UserError("至少需要一张图片")
    directory = output_directory(args.output_dir)
    target = unique_path(directory, args.output_name or "图片合集.pdf", args.overwrite)
    margin = round(args.margin_mm / 25.4 * args.dpi)
    pages = []
    for source in inputs:
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            orientation = args.orientation
            if orientation == "auto":
                orientation = "landscape" if image.width > image.height else "portrait"
            page_size = _page_pixels(args.page_size, orientation, args.dpi)
            if page_size is None:
                page = image.copy()
            else:
                canvas_width, canvas_height = page_size
                available = (max(1, canvas_width - margin * 2), max(1, canvas_height - margin * 2))
                image.thumbnail(available, Image.Resampling.LANCZOS)
                page = Image.new("RGB", page_size, "white")
                page.paste(image, ((canvas_width - image.width) // 2, (canvas_height - image.height) // 2))
            pages.append(page)
    pages[0].save(target, "PDF", resolution=args.dpi, save_all=True, append_images=pages[1:])
    for page in pages:
        page.close()
    artifacts = [Artifact(str(target), "pdf", "图片合成 PDF")]
    report = write_report(directory, target.stem, "图片转 PDF 处理报告", f"已按输入顺序将 {len(inputs)} 张图片合成为 PDF。", [f"- 页面尺寸：{args.page_size.upper()}", f"- 页边距：{args.margin_mm:g} mm"], artifacts)
    return {"success": True, "internalFiles": [str(report)], "artifacts": [asdict(item) for item in artifacts]}


def _normalize_cell(value: Any, trim_text: bool) -> Any:
    if isinstance(value, str) and trim_text:
        return re.sub(r"[ \t]+", " ", value.strip())
    return value


def excel_process(args: argparse.Namespace) -> dict[str, Any]:
    openpyxl = require("openpyxl")
    from openpyxl.styles import Alignment, Font, PatternFill

    source = existing_file(args.input, {".xlsx", ".xlsm"})
    workbook = openpyxl.load_workbook(source, keep_vba=source.suffix.lower() == ".xlsm")
    if args.sheet and args.sheet not in workbook.sheetnames:
        raise UserError(f"找不到工作表“{args.sheet}”；现有工作表：{'、'.join(workbook.sheetnames)}")
    sheet = workbook[args.sheet] if args.sheet else workbook.active
    rows = list(sheet.iter_rows(values_only=True))
    if not rows:
        raise UserError("工作表为空")
    headers = [str(value).strip() if value is not None else f"列{index}" for index, value in enumerate(rows[0], start=1)]
    if len(set(headers)) != len(headers):
        raise UserError("首行包含重复列名，请先调整表头")
    data = [[_normalize_cell(value, args.trim_text) for value in row] for row in rows[1:]]
    data = [row for row in data if any(value not in (None, "") for value in row)]
    original_count = len(data)
    filters: dict[str, str] = {}
    for expression in args.filter:
        if "=" not in expression:
            raise UserError(f"筛选条件格式错误：{expression}，应为 列名=值")
        column, value = expression.split("=", 1)
        filters[column.strip()] = value.strip()
    for column, value in filters.items():
        if column not in headers:
            raise UserError(f"筛选列不存在：{column}")
        index = headers.index(column)
        data = [row for row in data if str(row[index] if index < len(row) else "").strip() == value]
    deduplicate = [item.strip() for item in args.deduplicate_columns.split(",") if item.strip()]
    if deduplicate:
        missing = [item for item in deduplicate if item not in headers]
        if missing:
            raise UserError(f"去重列不存在：{'、'.join(missing)}")
        indexes = [headers.index(item) for item in deduplicate]
        seen = set()
        unique_rows = []
        for row in data:
            key = tuple(row[index] if index < len(row) else None for index in indexes)
            if key in seen:
                continue
            seen.add(key)
            unique_rows.append(row)
        data = unique_rows
    directory = output_directory(args.output_dir)
    target = unique_path(directory, f"{source.stem}_已整理.xlsx", args.overwrite)
    output = openpyxl.Workbook()
    output.remove(output.active)
    cleaned = output.create_sheet("整理结果")
    cleaned.append(headers)
    for row in data:
        cleaned.append(row)
    header_fill = PatternFill("solid", fgColor="2563EB")
    for cell in cleaned[1]:
        cell.fill = header_fill
        cell.font = Font(name=DEFAULT_FONT, color="FFFFFF", bold=True)
        cell.alignment = Alignment(horizontal="center", vertical="center")
    cleaned.freeze_panes = "A2"
    cleaned.auto_filter.ref = cleaned.dimensions
    for column_cells in cleaned.columns:
        values = [str(cell.value or "") for cell in column_cells[: min(len(column_cells), 300)]]
        cleaned.column_dimensions[column_cells[0].column_letter].width = min(40, max(10, max(map(len, values), default=10) + 2))
    summary = output.create_sheet("处理报告", 0)
    summary.append(["Excel 数据处理报告"])
    summary["A1"].font = Font(name=DEFAULT_FONT, size=18, bold=True, color="1F3A5F")
    summary.append(["指标", "结果"])
    summary.append(["源文件", source.name])
    summary.append(["源工作表", sheet.title])
    summary.append(["原始数据行", original_count])
    summary.append(["输出数据行", len(data)])
    summary.append(["移除行数", original_count - len(data)])
    summary.append(["去重列", "、".join(deduplicate) or "未启用"])
    summary.append(["筛选条件", "；".join(f"{key}={value}" for key, value in filters.items()) or "未启用"])
    for cell in summary[2]:
        cell.fill = PatternFill("solid", fgColor="DCEAFF")
        cell.font = Font(name=DEFAULT_FONT, bold=True, color="1F3A5F")
    summary.column_dimensions["A"].width = 22
    summary.column_dimensions["B"].width = 52
    output.save(target)
    artifacts = [Artifact(str(target), "xlsx", "整理后的 Excel")]
    report = write_report(directory, source.stem, "Excel 数据处理报告", f"已处理 {original_count} 行，输出 {len(data)} 行。", [f"- 工作表：{sheet.title}", f"- 去重列：{'、'.join(deduplicate) or '未启用'}", f"- 筛选条件：{len(filters)} 个"], artifacts)
    return {"success": True, "rows_before": original_count, "rows_after": len(data), "internalFiles": [str(report)], "artifacts": [asdict(item) for item in artifacts]}


def extract_text(path_value: str | Path) -> str:
    path = existing_file(path_value)
    extension = path.suffix.lower()
    if extension in {".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml"}:
        return path.read_text(encoding="utf-8-sig", errors="replace")
    if extension == ".docx":
        require("docx", "python-docx")
        from docx import Document

        document = Document(path)
        blocks = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
        for table in document.tables:
            for row in table.rows:
                blocks.append(" | ".join(cell.text.strip() for cell in row.cells))
        return "\n".join(blocks)
    if extension == ".pdf":
        pypdf = require("pypdf")
        reader = pypdf.PdfReader(str(path))
        if reader.is_encrypted:
            raise UserError(f"暂不支持加密 PDF：{path.name}")
        return "\n\n".join((page.extract_text() or "").strip() for page in reader.pages).strip()
    if extension in {".xlsx", ".xlsm"}:
        openpyxl = require("openpyxl")
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        blocks: list[str] = []
        for sheet in workbook.worksheets:
            blocks.append(f"## 工作表：{sheet.title}")
            for row in sheet.iter_rows(values_only=True):
                values = [str(value) if value is not None else "" for value in row]
                if any(values):
                    blocks.append(" | ".join(values))
        workbook.close()
        return "\n".join(blocks)
    raise UserError(f"不支持提取 {extension or '无扩展名'} 文件：{path.name}")


def document_extract(args: argparse.Namespace) -> dict[str, Any]:
    inputs = [existing_file(item) for item in args.inputs]
    directory = output_directory(args.output_dir)
    sections: list[str] = [f"# {args.title or '材料提取结果'}", ""]
    metadata = []
    for source in inputs:
        content = extract_text(source)
        if not content.strip():
            content = "（未提取到可读文字；扫描 PDF 需要先进行 OCR。）"
        sections.extend([f"## {source.name}", "", content, ""])
        metadata.append({"path": str(source), "characters": len(content), "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
    extracted = unique_path(directory, f"{safe_name(args.basename or '材料')}_提取内容.md", args.overwrite)
    extracted.write_text("\n".join(sections), encoding="utf-8")
    index = unique_path(directory, f"{safe_name(args.basename or '材料')}_提取索引.json", args.overwrite)
    write_json(index, {"schemaVersion": 1, "purpose": args.purpose, "files": metadata})
    return {"success": True, "workingFiles": [str(extracted), str(index)], "artifacts": []}


def document_compare(args: argparse.Namespace) -> dict[str, Any]:
    old_path = existing_file(args.old)
    new_path = existing_file(args.new)
    old_text = extract_text(old_path)
    new_text = extract_text(new_path)
    if not old_text.strip():
        raise UserError(f"未从旧版本提取到文字：{old_path.name}。扫描 PDF 需要先进行 OCR。")
    if not new_text.strip():
        raise UserError(f"未从新版本提取到文字：{new_path.name}。扫描 PDF 需要先进行 OCR。")
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()
    matcher = difflib.SequenceMatcher(a=old_lines, b=new_lines, autojunk=False)
    changes = []
    counts = {"added": 0, "deleted": 0, "modified": 0, "unchanged": 0}
    for tag, old_start, old_end, new_start, new_end in matcher.get_opcodes():
        if tag == "equal":
            counts["unchanged"] += old_end - old_start
            continue
        old_block = old_lines[old_start:old_end]
        new_block = new_lines[new_start:new_end]
        if tag == "replace":
            paired = min(len(old_block), len(new_block))
            if paired:
                counts["modified"] += paired
                changes.append({"type": "modified", "old": old_block[:paired], "new": new_block[:paired]})
            if len(old_block) > paired:
                counts["deleted"] += len(old_block) - paired
                changes.append({"type": "deleted", "old": old_block[paired:], "new": []})
            if len(new_block) > paired:
                counts["added"] += len(new_block) - paired
                changes.append({"type": "added", "old": [], "new": new_block[paired:]})
            continue
        kind = {"insert": "added", "delete": "deleted"}[tag]
        counts[kind] += len(new_block) if tag == "insert" else len(old_block)
        changes.append({"type": kind, "old": old_block, "new": new_block})
    directory = output_directory(args.output_dir)
    html_path = unique_path(directory, "文档逐行对比.html", args.overwrite)
    table = difflib.HtmlDiff(wrapcolumn=90).make_table(old_lines, new_lines, fromdesc=html.escape(old_path.name), todesc=html.escape(new_path.name), context=True, numlines=3)
    html_path.write_text(_comparison_html(table, counts), encoding="utf-8")
    rows = [["新增", counts["added"]], ["删除", counts["deleted"]], ["修改", counts["modified"]], ["未变化", counts["unchanged"]]]
    lines = ["# 文档差异对比报告", "", f"- 原始版本：`{old_path.name}`", f"- 新版本：`{new_path.name}`", "", "## 差异统计", "", *markdown_table(["类型", "行数"], rows), "", "## 重点差异", ""]
    if changes:
        for index, change in enumerate(changes[:100], start=1):
            label = {"added": "新增", "deleted": "删除", "modified": "修改"}[change["type"]]
            lines.extend([f"### 差异 {index} · {label}", "", f"- 原内容：{' / '.join(change['old']) or '（无）'}", f"- 新内容：{' / '.join(change['new']) or '（无）'}", ""])
    else:
        lines.append("两份文档提取后的文本内容一致。")
    lines.extend([
        "", "## 风险与建议", "",
        "- 本报告用于快速定位文本变化，重要条款、数字、日期和责任分工应由经办人员复核。",
        "- 对比范围不包括版式、图片、批注、修订痕迹等视觉差异。",
    ])
    with tempfile.TemporaryDirectory(prefix="wanwei-document-compare-") as temporary:
        summary = Path(temporary) / "文档差异对比报告.md"
        summary.write_text("\n".join(lines), encoding="utf-8")
        rendered = render_markdown_docx(argparse.Namespace(
            input=str(summary),
            output_name="文档差异对比报告.docx",
            title="文档差异对比报告",
            output_dir=str(directory),
            overwrite=args.overwrite,
        ))
    docx_path = rendered["artifacts"][0]["path"]
    artifacts = [Artifact(docx_path, "docx", "文档差异对比报告"), Artifact(str(html_path), "html", "可视化逐行对比")]
    return {"success": True, "counts": counts, "artifacts": [asdict(item) for item in artifacts]}


def _comparison_html(table: str, counts: dict[str, int]) -> str:
    return f"""<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>文档逐行对比</title><style>
*{{box-sizing:border-box}}body{{margin:0;padding:32px;background:#f4f7fb;color:#1f3657;font-family:{DEFAULT_FONT},sans-serif}}main{{max-width:1600px;margin:auto;background:#fff;padding:28px;border-radius:18px;box-shadow:0 16px 45px #1f36571c;overflow:hidden}}h1{{margin-top:0}}.stats{{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}}.stat{{padding:10px 14px;border-radius:10px;background:#edf4ff}}.comparison{{width:100%;overflow:auto}}table.diff{{width:100%;min-width:900px;border-collapse:collapse;table-layout:fixed;font-family:Consolas,{DEFAULT_FONT},monospace;font-size:13px}}.diff td,.diff th{{padding:7px;border:1px solid #dce6f3;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}}.diff td.diff_header{{width:48px;text-align:right;background:#eaf1fb}}.diff_next{{display:none}}.diff_add{{background:#dff7e8}}.diff_sub{{background:#ffe5e8}}.diff_chg{{background:#fff3c7}}@media(max-width:800px){{body{{padding:12px}}main{{padding:16px}}}}</style></head><body><main><h1>文档逐行对比</h1><div class=\"stats\"><span class=\"stat\">新增 {counts['added']}</span><span class=\"stat\">删除 {counts['deleted']}</span><span class=\"stat\">修改 {counts['modified']}</span></div><div class=\"comparison\">{table}</div></main></body></html>"""


def batch_rename(args: argparse.Namespace) -> dict[str, Any]:
    inputs = [existing_file(item) for item in args.inputs]
    if not inputs:
        raise UserError("没有可重命名的文件")
    directory = full_path(args.output_dir) if args.output_dir else inputs[0].parent
    directory.mkdir(parents=True, exist_ok=True)
    date_value = args.date or date.today().strftime("%Y%m%d")
    proposals = []
    targets: set[str] = set()
    for offset, source in enumerate(inputs):
        values = {
            "prefix": safe_name(args.prefix, "文件"),
            "project": safe_name(args.prefix, "文件"),
            "date": date_value,
            "index": str(args.start + offset).zfill(args.digits),
            "stem": source.stem,
            "name": source.stem,
            "ext": source.suffix.lower(),
        }
        try:
            filename = args.template.format(**values)
        except KeyError as exc:
            raise UserError(f"重命名模板包含未知字段：{exc.args[0]}") from exc
        target = directory / safe_name(Path(filename).stem)
        target = target.with_suffix(Path(filename).suffix or source.suffix)
        normalized = os.path.normcase(str(target))
        if normalized in targets:
            raise UserError(f"重命名结果发生重复：{target.name}")
        targets.add(normalized)
        if target.exists() and target.resolve() != source.resolve():
            raise UserError(f"目标文件已存在：{target}")
        proposals.append({"source": str(source), "target": str(target), "old_name": source.name, "new_name": target.name})
    preview = unique_path(directory, "批量重命名预览.csv", args.overwrite)
    with preview.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["old_name", "new_name", "source", "target"])
        writer.writeheader()
        writer.writerows(proposals)
    artifacts = [Artifact(str(preview), "csv", "重命名预览表")]
    internal_files: list[str] = []
    if args.apply:
        staged = []
        try:
            for item in proposals:
                source = Path(item["source"])
                temporary = source.with_name(f".{source.name}.{uuid.uuid4().hex}.renaming")
                source.rename(temporary)
                staged.append((source, temporary, Path(item["target"])))
            for source, temporary, target in staged:
                temporary.rename(target)
            rollback = unique_path(directory, "批量重命名回滚表.json", args.overwrite)
            write_json(rollback, {"schemaVersion": 1, "renamed": proposals})
            internal_files = [str(preview), str(rollback)]
            artifacts = [Artifact(item["target"], "file", f"重命名后的文件：{item['new_name']}") for item in proposals]
        except Exception:
            for source, temporary, target in reversed(staged):
                if temporary.exists():
                    temporary.rename(source)
                elif target.exists() and not source.exists():
                    target.rename(source)
            raise
    return {"success": True, "applied": args.apply, "proposals": proposals, "internalFiles": internal_files, "artifacts": [asdict(item) for item in artifacts]}


def image_process(args: argparse.Namespace) -> dict[str, Any]:
    require("PIL", "Pillow")
    from PIL import Image, ImageOps

    inputs = [existing_file(item, {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}) for item in args.inputs]
    directory = output_directory(args.output_dir)
    artifacts: list[Artifact] = []
    file_results: list[dict[str, Any]] = []
    saved_bytes = 0
    original_bytes = 0
    for source in inputs:
        with Image.open(source) as opened:
            image = ImageOps.exif_transpose(opened)
            if args.max_width or args.max_height:
                maximum = (args.max_width or image.width, args.max_height or image.height)
                image.thumbnail(maximum, Image.Resampling.LANCZOS)
            extension = source.suffix.lower().lstrip(".") if args.format == "preserve" else args.format
            if extension == "jpeg":
                extension = "jpg"
            target = unique_path(directory, f"{source.stem}_已处理.{extension}", args.overwrite)
            save_format = {"jpg": "JPEG", "png": "PNG", "webp": "WEBP"}.get(extension, extension.upper())
            if save_format == "JPEG" and image.mode not in {"RGB", "L"}:
                background = Image.new("RGB", image.size, "white")
                if "A" in image.getbands():
                    background.paste(image, mask=image.getchannel("A"))
                else:
                    background.paste(image)
                image = background
            options: dict[str, Any] = {"optimize": True}
            if save_format in {"JPEG", "WEBP"}:
                options["quality"] = args.quality
            image.save(target, save_format, **options)
        original_bytes += source.stat().st_size
        saved_bytes += target.stat().st_size
        source_bytes = source.stat().st_size
        target_bytes = target.stat().st_size
        file_results.append({
            "input": str(source),
            "output": str(target),
            "input_bytes": source_bytes,
            "output_bytes": target_bytes,
            "saved_bytes": source_bytes - target_bytes,
        })
        artifacts.append(Artifact(str(target), "image", f"处理后的图片：{source.name}"))
    percent = 0 if original_bytes == 0 else round((1 - saved_bytes / original_bytes) * 100, 1)
    size_summary = f"总体体积减少 {percent:g}%" if percent >= 0 else f"总体体积增加 {-percent:g}%"
    larger = [item for item in file_results if item["saved_bytes"] < 0]
    details = [
        f"- 输出格式：{args.format}",
        f"- 图片质量：{args.quality}",
        f"- 原始总大小：{original_bytes} 字节",
        f"- 输出总大小：{saved_bytes} 字节",
        f"- 转换后体积增大的文件：{len(larger)} 个",
    ]
    details.extend(
        f"- {Path(item['input']).name}：{item['input_bytes']} → {item['output_bytes']} 字节（转换后增大）"
        for item in larger
    )
    return {
        "success": True,
        "size_reduction_percent": percent,
        "summary": size_summary,
        "details": details,
        "files": file_results,
        "artifacts": [asdict(item) for item in artifacts],
    }


def render_markdown_docx(args: argparse.Namespace) -> dict[str, Any]:
    require("docx", "python-docx")
    from docx import Document
    from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor

    source = existing_file(args.input, {".md", ".txt"})
    directory = output_directory(args.output_dir)
    target = unique_path(directory, args.output_name or f"{source.stem}.docx", args.overwrite)
    document = Document()
    section = document.sections[0]
    section.page_width = Cm(21.59)
    section.page_height = Cm(27.94)
    section.top_margin = Cm(2.0)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.5)
    section.right_margin = Cm(2.5)
    styles = document.styles
    styles["Normal"].font.name = DEFAULT_FONT
    styles["Normal"]._element.rPr.rFonts.set(qn("w:eastAsia"), DEFAULT_FONT)
    styles["Normal"].font.size = Pt(11)
    styles["Normal"].font.color.rgb = RGBColor(0, 0, 0)
    styles["Normal"].paragraph_format.space_after = Pt(6)
    styles["Normal"].paragraph_format.line_spacing = 1.3
    title_style = styles["Title"]
    title_style.font.name = DEFAULT_FONT
    title_style._element.rPr.rFonts.set(qn("w:eastAsia"), DEFAULT_FONT)
    title_style.font.size = Pt(22)
    title_style.font.bold = True
    title_style.font.color.rgb = RGBColor(0, 0, 0)
    title_style.paragraph_format.space_after = Pt(18)
    for level in range(1, 4):
        style = styles[f"Heading {level}"]
        style.font.name = DEFAULT_FONT
        style._element.rPr.rFonts.set(qn("w:eastAsia"), DEFAULT_FONT)
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.font.bold = True
        style.font.size = Pt({1: 16, 2: 14, 3: 12}[level])
        style.paragraph_format.space_before = Pt({1: 14, 2: 12, 3: 9}[level])
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.keep_with_next = True
    lines = source.read_text(encoding="utf-8-sig").splitlines()
    index = 0
    while index < len(lines):
        line = lines[index].rstrip()
        if line.startswith("### "):
            document.add_heading(line[4:], level=3)
        elif line.startswith("## "):
            document.add_heading(line[3:], level=2)
        elif line.startswith("# "):
            paragraph = document.add_paragraph()
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
            paragraph.paragraph_format.space_after = Pt(18)
            run = paragraph.add_run(line[2:])
            run.font.name = DEFAULT_FONT
            run._element.rPr.rFonts.set(qn("w:eastAsia"), DEFAULT_FONT)
            run.font.size = Pt(22)
            run.font.bold = True
            run.font.color.rgb = RGBColor(0, 0, 0)
        elif bullet := re.match(r"^(\s*)[-*+]\s+(.+)", line):
            depth = min(3, len(bullet.group(1)) // 2)
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.left_indent = Cm(0.65 + depth * 0.5)
            paragraph.paragraph_format.first_line_indent = Cm(-0.35)
            paragraph.add_run("•  ")
            paragraph.add_run(_strip_markdown(bullet.group(2)))
        elif numbered := re.match(r"^(\s*)(\d+)[.)]\s+(.+)", line):
            depth = min(3, len(numbered.group(1)) // 2)
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.left_indent = Cm(0.65 + depth * 0.5)
            paragraph.paragraph_format.first_line_indent = Cm(-0.5)
            paragraph.add_run(f"{numbered.group(2)}. ")
            paragraph.add_run(_strip_markdown(numbered.group(3)))
        elif line.startswith("> "):
            paragraph = document.add_paragraph(_strip_markdown(line[2:]))
            paragraph.style = styles["Quote"]
        elif line.startswith("|") and index + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|$", lines[index + 1]):
            headers = [cell.strip() for cell in line.strip("|").split("|")]
            table_rows = []
            index += 2
            while index < len(lines) and lines[index].startswith("|"):
                table_rows.append([cell.strip() for cell in lines[index].strip("|").split("|")])
                index += 1
            table = document.add_table(rows=1, cols=len(headers))
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True
            table_properties = table._tbl.tblPr
            borders = OxmlElement("w:tblBorders")
            for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
                border = OxmlElement(f"w:{edge}")
                border.set(qn("w:val"), "single")
                border.set(qn("w:sz"), "6")
                border.set(qn("w:color"), "D9D9D9")
                borders.append(border)
            table_properties.append(borders)
            for column, value in enumerate(headers):
                cell = table.rows[0].cells[column]
                cell.text = _strip_markdown(value)
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                shading = OxmlElement("w:shd")
                shading.set(qn("w:fill"), "1F4E78")
                cell._tc.get_or_add_tcPr().append(shading)
                for run in cell.paragraphs[0].runs:
                    run.font.bold = True
                    run.font.color.rgb = RGBColor(255, 255, 255)
                    run.font.name = DEFAULT_FONT
                cell.paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
                cell.paragraphs[0].paragraph_format.space_after = Pt(0)
                cell.paragraphs[0].paragraph_format.line_spacing = 1.0
                margins = OxmlElement("w:tcMar")
                for side in ("top", "start", "bottom", "end"):
                    margin = OxmlElement(f"w:{side}")
                    margin.set(qn("w:w"), "90")
                    margin.set(qn("w:type"), "dxa")
                    margins.append(margin)
                cell._tc.get_or_add_tcPr().append(margins)
            for row_index, values in enumerate(table_rows, start=1):
                cells = table.add_row().cells
                for column, value in enumerate(values[: len(cells)]):
                    cells[column].text = _strip_markdown(value)
                    cells[column].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                    if row_index % 2 == 0:
                        shading = OxmlElement("w:shd")
                        shading.set(qn("w:fill"), "F3F6FA")
                        cells[column]._tc.get_or_add_tcPr().append(shading)
                    cells[column].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER if column == 0 else WD_ALIGN_PARAGRAPH.LEFT
                    cells[column].paragraphs[0].paragraph_format.space_after = Pt(0)
                    cells[column].paragraphs[0].paragraph_format.line_spacing = 1.0
                for cell in cells:
                    margins = OxmlElement("w:tcMar")
                    for side in ("top", "start", "bottom", "end"):
                        margin = OxmlElement(f"w:{side}")
                        margin.set(qn("w:w"), "90")
                        margin.set(qn("w:type"), "dxa")
                        margins.append(margin)
                    cell._tc.get_or_add_tcPr().append(margins)
            document.add_paragraph().paragraph_format.space_after = Pt(0)
            continue
        elif line:
            document.add_paragraph(_strip_markdown(line))
        index += 1
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = footer.add_run("第 ")
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), "PAGE")
    run._r.addnext(field)
    footer.add_run(" 页")
    document.core_properties.title = args.title or source.stem
    document.core_properties.author = "万维Buddy"
    document.save(target)
    return {"success": True, "artifacts": [asdict(Artifact(str(target), "docx", "Word 报告"))]}


def _strip_markdown(value: str) -> str:
    value = re.sub(r"\[([^]]+)]\([^)]+\)", r"\1", value)
    return value.replace("**", "").replace("`", "")


def polish_meeting_minutes_docx(path: str | Path, meeting_title: str = "") -> None:
    """Apply a restrained, meeting-specific Word layout without changing content."""
    require("docx", "python-docx")
    from docx import Document
    from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_ROW_HEIGHT_RULE, WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor

    document = Document(path)
    section = document.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.4)
    section.bottom_margin = Cm(2.2)
    section.left_margin = Cm(2.6)
    section.right_margin = Cm(2.4)
    section.header_distance = Cm(1.2)
    section.footer_distance = Cm(1.2)

    styles = document.styles
    normal = styles["Normal"]
    normal.font.name = DEFAULT_FONT
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), DEFAULT_FONT)
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor(31, 41, 55)
    normal.paragraph_format.line_spacing = 1.45
    normal.paragraph_format.space_after = Pt(5)

    for level, size in ((1, 16), (2, 14), (3, 11.5)):
        style = styles[f"Heading {level}"]
        style.font.name = DEFAULT_FONT
        style._element.rPr.rFonts.set(qn("w:eastAsia"), DEFAULT_FONT)
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.paragraph_format.space_before = Pt(14 if level < 3 else 9)
        style.paragraph_format.space_after = Pt(6)
        style.paragraph_format.keep_with_next = True

    if document.paragraphs:
        title = document.paragraphs[0]
        title.style = styles["Title"]
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        title.paragraph_format.space_before = Pt(0)
        title.paragraph_format.space_after = Pt(6 if meeting_title.strip() else 18)
        title.paragraph_format.keep_with_next = True
        for run in title.runs:
            run.font.name = DEFAULT_FONT
            run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), DEFAULT_FONT)
            run.font.size = Pt(22)
            run.font.bold = True
            run.font.color.rgb = RGBColor(0, 0, 0)
        existing_subtitle = document.paragraphs[1].text.strip() if len(document.paragraphs) > 1 else ""
        if (meeting_title.strip() and meeting_title.strip() not in {"会议纪要", title.text.strip()}
                and existing_subtitle != meeting_title.strip()):
            subtitle = OxmlElement("w:p")
            title._p.addnext(subtitle)
            paragraph = title._parent.add_paragraph()
            paragraph._p.getparent().remove(paragraph._p)
            subtitle.append(paragraph._p.get_or_add_pPr())
            run = OxmlElement("w:r")
            run_properties = OxmlElement("w:rPr")
            fonts = OxmlElement("w:rFonts")
            fonts.set(qn("w:eastAsia"), DEFAULT_FONT)
            run_properties.append(fonts)
            size = OxmlElement("w:sz")
            size.set(qn("w:val"), "22")
            run_properties.append(size)
            color = OxmlElement("w:color")
            color.set(qn("w:val"), "4B5563")
            run_properties.append(color)
            run.append(run_properties)
            text = OxmlElement("w:t")
            text.text = meeting_title.strip()
            run.append(text)
            subtitle.append(run)
            paragraph_properties = subtitle.find(qn("w:pPr"))
            alignment = OxmlElement("w:jc")
            alignment.set(qn("w:val"), "center")
            paragraph_properties.append(alignment)
            spacing = OxmlElement("w:spacing")
            spacing.set(qn("w:after"), "300")
            paragraph_properties.append(spacing)

    for paragraph in document.paragraphs[1:]:
        text = paragraph.text.strip()
        if text.startswith("•"):
            clean = text[1:].lstrip()
            paragraph.clear()
            paragraph.style = styles["List Bullet"]
            paragraph.add_run(clean)
            paragraph.paragraph_format.left_indent = Cm(0.74)
            paragraph.paragraph_format.first_line_indent = Cm(-0.42)
            paragraph.paragraph_format.space_after = Pt(3)
            paragraph.paragraph_format.line_spacing = 1.35
        elif re.match(r"^\d+[.)]\s+", text) and paragraph.style.name == "Normal":
            paragraph.paragraph_format.left_indent = Cm(0.74)
            paragraph.paragraph_format.first_line_indent = Cm(-0.58)
            paragraph.paragraph_format.space_after = Pt(4)
            paragraph.paragraph_format.line_spacing = 1.4

    def shade(cell, color: str) -> None:
        properties = cell._tc.get_or_add_tcPr()
        existing = properties.find(qn("w:shd"))
        if existing is not None:
            properties.remove(existing)
        shading = OxmlElement("w:shd")
        shading.set(qn("w:fill"), color)
        properties.append(shading)

    def cell_margin(cell, vertical: int = 100, horizontal: int = 110) -> None:
        properties = cell._tc.get_or_add_tcPr()
        existing = properties.find(qn("w:tcMar"))
        if existing is not None:
            properties.remove(existing)
        margins = OxmlElement("w:tcMar")
        for side, width in (("top", vertical), ("start", horizontal), ("bottom", vertical), ("end", horizontal)):
            margin = OxmlElement(f"w:{side}")
            margin.set(qn("w:w"), str(width))
            margin.set(qn("w:type"), "dxa")
            margins.append(margin)
        properties.append(margins)

    for table_index, table in enumerate(document.tables):
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = False
        layout = OxmlElement("w:tblLayout")
        layout.set(qn("w:type"), "fixed")
        table._tbl.tblPr.append(layout)
        table.rows[0]._tr.get_or_add_trPr().append(OxmlElement("w:tblHeader"))
        widths = ([Cm(3.0), Cm(12.0)] if table_index == 0
                  else [Cm(0.9), Cm(6.4), Cm(2.8), Cm(2.6), Cm(1.8)])
        for column_index, width in enumerate(widths):
            if column_index < len(table.columns):
                table.columns[column_index].width = width
        for row_index, row in enumerate(table.rows):
            row.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
            row.height = Cm(0.72 if row_index else 0.78)
            for column_index, cell in enumerate(row.cells):
                if column_index < len(widths):
                    cell.width = widths[column_index]
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                cell_margin(cell, 95 if table_index == 1 else 110)
                if row_index == 0:
                    shade(cell, "DCE6F1")
                elif table_index == 0 and column_index == 0:
                    shade(cell, "F2F5F8")
                elif row_index % 2 == 0:
                    shade(cell, "F8FAFC")
                else:
                    shade(cell, "FFFFFF")
                for paragraph in cell.paragraphs:
                    paragraph.paragraph_format.space_after = Pt(0)
                    paragraph.paragraph_format.line_spacing = 1.15
                    paragraph.alignment = (WD_ALIGN_PARAGRAPH.CENTER
                                           if row_index == 0 or column_index in ({0} if table_index == 0 else {0, 2, 3, 4})
                                           else WD_ALIGN_PARAGRAPH.LEFT)
                    for run in paragraph.runs:
                        run.font.name = DEFAULT_FONT
                        run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), DEFAULT_FONT)
                        run.font.size = Pt(9.5 if table_index == 1 else 10)
                        run.font.color.rgb = RGBColor(17, 24, 39)
                        run.font.bold = row_index == 0 or (table_index == 0 and column_index == 0)

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in footer.runs:
        run.font.name = DEFAULT_FONT
        run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), DEFAULT_FONT)
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor(107, 114, 128)
    document.core_properties.subject = "会议纪要"
    document.save(path)


def meeting_prepare(args: argparse.Namespace) -> dict[str, Any]:
    directory = output_directory(args.output_dir)
    materials = [existing_file(item) for item in args.materials]
    transcript_path = existing_file(args.transcript) if args.transcript else None
    audio_path = existing_file(args.audio) if args.audio else None
    artifacts: list[Artifact] = []
    if audio_path and not transcript_path:
        transcript_path = transcribe_audio(audio_path, directory, args)
        artifacts.append(Artifact(str(transcript_path), "transcript", "语音转写文本"))
    sections = ["# 会议材料汇总", ""]
    if transcript_path:
        sections.extend(["## 会议转写", "", extract_text(transcript_path), ""])
    for material in materials:
        content = extract_text(material)
        if not content.strip():
            content = "（未提取到可读文字；扫描 PDF 需要先进行 OCR。）"
        sections.extend([f"## 材料：{material.name}", "", content, ""])
    if not transcript_path and not materials:
        raise UserError("请至少提供会议文字材料、已有转写文本或音频文件")
    materials_text = "\n".join(sections)
    if args.skip_synthesis:
        minutes = meeting_template()
    else:
        minutes = generate_meeting_minutes(materials_text, args)
    minutes_path = directory / f"wanwei-meeting-temp-{uuid.uuid4().hex}.md"
    minutes_path.write_text(minutes.rstrip() + "\n", encoding="utf-8")
    try:
        rendered = render_markdown_docx(argparse.Namespace(
            input=str(minutes_path),
            output_name="会议纪要.docx",
            title=args.meeting_title or "会议纪要",
            output_dir=str(directory),
            overwrite=args.overwrite,
        ))
    finally:
        try:
            minutes_path.unlink(missing_ok=True)
        except OSError:
            # A locked transient file must not hide the primary Word result or its error.
            pass
    for artifact in rendered["artifacts"]:
        if artifact.get("kind") == "docx":
            polish_meeting_minutes_docx(artifact["path"], args.meeting_title or "")
    for artifact in rendered["artifacts"]:
        artifacts.append(Artifact(**artifact))
    return {"success": True, "artifacts": [asdict(item) for item in artifacts]}


def meeting_template() -> str:
    return (
        "# 会议纪要\n\n"
        "## 一、会议基本信息\n\n"
        "| 项目 | 内容 |\n| --- | --- |\n| 会议主题 | 未明确 |\n| 时间 | 未明确 |\n| 地点/方式 | 未明确 |\n| 主持人 | 未明确 |\n| 参会人员 | 未明确 |\n| 记录人 | 万维Buddy |\n\n"
        "## 二、核心结论\n\n- 未明确。\n\n"
        "## 三、议题与讨论\n\n1. 未明确。\n\n"
        "## 四、决策事项\n\n1. 未明确。\n\n"
        "## 五、待办事项\n\n| 序号 | 事项 | 责任人 | 截止时间 | 状态 |\n| --- | --- | --- | --- | --- |\n| 1 | 未明确 | 未明确 | 未明确 | 未开始 |\n\n"
        "## 六、风险与未决问题\n\n- 未明确。\n"
    )


def generate_meeting_minutes(materials: str, args: argparse.Namespace) -> str:
    base_url = (args.base_url or os.getenv("WANWEI_MEETING_BASE_URL", "") or DEFAULT_MEETING_BASE_URL).rstrip("/")
    endpoint = f"{base_url}/chat/completions"
    model = args.minutes_model or os.getenv("WANWEI_MEETING_MODEL", "") or DEFAULT_MEETING_MODEL
    api_key = args.api_key or os.getenv("WANWEI_MEETING_API_KEY", "")
    system_prompt = (
        "你是严谨的中文会议纪要助手。只能使用用户提供的材料，不得补造事实。"
        "输出纯 Markdown，不要代码围栏。结构必须依次包含：会议基本信息表、核心结论、"
        "议题与讨论、决策事项、待办事项表、风险与未决问题。待办表列为序号、事项、"
        "责任人、截止时间、状态。材料未明确的字段填写‘未明确’，不要写‘待确认’。"
        "相对日期和时间必须保留材料原文；‘今天下班前’、‘周三开始’等表达不得转换为材料中"
        "没有出现的具体日期或钟点。只有材料明确给出时，才能写精确日期和时间。"
    )
    payload = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"会议名称：{args.meeting_title or '未明确'}\n\n以下是会议材料：\n\n{materials}"},
        ],
        "temperature": 0.2,
        "max_tokens": 4096,
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(endpoint, data=payload, method="POST", headers={"Content-Type": "application/json"})
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")
    try:
        with urllib.request.urlopen(request, timeout=args.synthesis_timeout) as response:
            decoded = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:1000]
        raise UserError(f"会议纪要模型返回 HTTP {exc.code}：{body}") from exc
    except urllib.error.URLError as exc:
        raise UserError(f"无法访问会议纪要模型：{exc.reason}") from exc
    try:
        content = decoded["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError, AttributeError) as exc:
        raise UserError("会议纪要模型未返回 choices[0].message.content") from exc
    if not content:
        raise UserError("会议纪要模型返回了空内容")
    content = re.sub(r"^```(?:markdown)?\s*|\s*```$", "", content, flags=re.IGNORECASE).strip()
    return re.sub(r"\s+([，。；：！？）])", r"\1", content)


def _standard_wav(path: Path) -> bool:
    try:
        with wave.open(str(path), "rb") as audio:
            return audio.getnchannels() == 1 and audio.getsampwidth() == 2 and audio.getframerate() == 16000 and audio.getcomptype() == "NONE"
    except (wave.Error, EOFError):
        return False


def _ffmpeg_path() -> str:
    configured = os.getenv("WANWEI_FFMPEG_PATH", "").strip()
    if configured and Path(configured).is_file():
        return configured
    discovered = shutil.which("ffmpeg")
    if discovered:
        return discovered
    if os.name == "nt":
        local = Path(os.getenv("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
        matches = sorted(local.glob("Gyan.FFmpeg_*/*/bin/ffmpeg.exe"), reverse=True)
        if matches:
            return str(matches[0])
    raise UserError("当前音频需要先转换为标准 WAV，但未找到 ffmpeg。请安装 FFmpeg 后重试；Windows 可运行：winget install --id Gyan.FFmpeg -e")


def _normalize_audio(audio_path: Path, target: Path) -> Path:
    if _standard_wav(audio_path):
        return audio_path
    completed = subprocess.run(
        [_ffmpeg_path(), "-hide_banner", "-loglevel", "error", "-y", "-i", str(audio_path), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(target)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if completed.returncode != 0 or not target.is_file():
        message = completed.stderr.strip()[-1000:] or f"退出码 {completed.returncode}"
        raise UserError(f"音频转换为 WAV 失败：{message}")
    return target


def _split_wav(source: Path, directory: Path, segment_seconds: int) -> list[Path]:
    with wave.open(str(source), "rb") as audio:
        frames_per_segment = audio.getframerate() * segment_seconds
        if audio.getnframes() <= frames_per_segment:
            return [source]
        parameters = audio.getparams()
        chunks: list[Path] = []
        prefix = f"wanwei-meeting-temp-{uuid.uuid4().hex}"
        index = 1
        while frames := audio.readframes(frames_per_segment):
            target = directory / f"{prefix}-segment-{index:04d}.wav"
            with wave.open(str(target), "wb") as chunk:
                chunk.setparams(parameters)
                chunk.writeframes(frames)
            chunks.append(target)
            index += 1
    return chunks


def _is_dashscope_native_transcription_endpoint(endpoint: str) -> bool:
    return "/api/v1/services/aigc/multimodal-generation/generation" in endpoint.lower()


def _transcribe_audio_chunk(audio_path: Path, endpoint: str, model: str, api_key: str, timeout: int) -> str:
    if _is_dashscope_native_transcription_endpoint(endpoint):
        if not api_key:
            raise UserError("百炼原生语音转写接口需要 WANWEI_TRANSCRIPTION_API_KEY 或 DASHSCOPE_API_KEY")
        payload = {
            "model": model,
            "input": {
                "messages": [{
                    "role": "user",
                    "content": [{
                        "type": "input_audio",
                        "input_audio": {
                            "data": "data:audio/wav;base64," + base64.b64encode(audio_path.read_bytes()).decode("ascii"),
                        },
                    }],
                }],
            },
            "parameters": {"format": "wav", "sample_rate": "16000"},
        }
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-DashScope-SSE": "disable",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                decoded = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")[:1000]
            raise UserError(f"百炼语音转写接口返回 HTTP {exc.code}：{body}") from exc
        except urllib.error.URLError as exc:
            raise UserError(f"无法访问百炼语音转写接口：{exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise UserError("百炼语音转写接口返回了无效 JSON") from exc
        if decoded.get("code"):
            raise UserError(f"百炼语音转写失败：{decoded.get('code')}：{decoded.get('message', '')}")
        output = decoded.get("output", {})
        text = output.get("text") or output.get("sentence", {}).get("text")
        if not text:
            raise UserError("百炼语音转写接口未返回 output.text")
        return str(text).strip()

    boundary = f"----WanweiBoundary{uuid.uuid4().hex}"
    parts = []

    def field(name: str, value: str) -> None:
        parts.extend([f"--{boundary}\r\n".encode(), f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(), value.encode("utf-8"), b"\r\n"])

    field("model", model)
    parts.extend([f"--{boundary}\r\n".encode(), f'Content-Disposition: form-data; name="file"; filename="{audio_path.name}"\r\n'.encode("utf-8"), b"Content-Type: audio/wav\r\n\r\n", audio_path.read_bytes(), b"\r\n", f"--{boundary}--\r\n".encode()])
    request = urllib.request.Request(endpoint, data=b"".join(parts), method="POST", headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:1000]
        raise UserError(f"语音转写接口返回 HTTP {exc.code}：{body}") from exc
    except urllib.error.URLError as exc:
        raise UserError(f"无法访问语音转写接口：{exc.reason}") from exc
    try:
        decoded = json.loads(payload)
        text = decoded.get("text") or decoded.get("data", {}).get("text")
    except json.JSONDecodeError:
        text = payload.strip()
    if not text:
        raise UserError("语音转写接口未返回 text 字段")
    return str(text).strip()


def transcribe_audio(audio_path: Path, directory: Path, args: argparse.Namespace) -> Path:
    base_url = (args.base_url or os.getenv("WANWEI_MEETING_BASE_URL", "") or DEFAULT_MEETING_BASE_URL).rstrip("/")
    endpoint = (args.transcription_url or os.getenv("WANWEI_TRANSCRIPTION_URL", "") or f"{base_url}/audio/transcriptions").strip()
    model = (args.transcription_model or os.getenv("WANWEI_TRANSCRIPTION_MODEL", "") or DEFAULT_TRANSCRIPTION_MODEL).strip()
    api_key = (args.transcription_api_key or args.api_key or os.getenv("WANWEI_TRANSCRIPTION_API_KEY", "") or os.getenv("DASHSCOPE_API_KEY", "") or os.getenv("WANWEI_MEETING_API_KEY", "")).strip()
    try:
        configured_seconds = args.audio_segment_seconds or int(os.getenv("WANWEI_AUDIO_SEGMENT_SECONDS", DEFAULT_AUDIO_SEGMENT_SECONDS))
    except ValueError as exc:
        raise UserError("WANWEI_AUDIO_SEGMENT_SECONDS 必须是整数") from exc
    if not 30 <= configured_seconds <= 180:
        raise UserError("音频分段时长必须在 30–180 秒之间")
    normalized_target = directory / f"wanwei-meeting-temp-{uuid.uuid4().hex}-normalized.wav"
    temporary_files: list[Path] = []
    try:
        normalized = _normalize_audio(audio_path, normalized_target)
        if normalized == normalized_target:
            temporary_files.append(normalized)
        chunks = _split_wav(normalized, directory, configured_seconds)
        temporary_files.extend(chunk for chunk in chunks if chunk != audio_path and chunk != normalized)
        transcripts = []
        for index, chunk in enumerate(chunks, start=1):
            try:
                transcripts.append(_transcribe_audio_chunk(chunk, endpoint, model, api_key, args.transcription_timeout))
            except UserError as exc:
                raise UserError(f"语音第 {index}/{len(chunks)} 段转写失败：{exc}") from exc
    finally:
        for path in temporary_files:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                # A locked transient file must not replace the actionable transcription result.
                pass
    target = unique_path(directory, f"{audio_path.stem}_转写.txt", args.overwrite)
    target.write_text("\n\n".join(transcripts).strip() + "\n", encoding="utf-8")
    return target


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output-dir", "--output-directory", dest="output_dir", default="", help="输出目录；默认当前目录")
    parser.set_defaults(overwrite=False)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="万维办公技能执行组件")
    subparsers = parser.add_subparsers(dest="command", required=True)

    merge = subparsers.add_parser("pdf-merge")
    merge.add_argument("--inputs", nargs="+", required=True)
    merge.add_argument("--output-name", default="")
    add_common(merge)
    merge.set_defaults(handler=pdf_merge)

    split = subparsers.add_parser("pdf-split")
    split.add_argument("--input", required=True)
    split.add_argument("--ranges", required=True)
    split.add_argument("--separate-pages", action="store_true")
    add_common(split)
    split.set_defaults(handler=pdf_split)

    pdf_images = subparsers.add_parser("pdf-to-images")
    pdf_images.add_argument("--input", required=True)
    pdf_images.add_argument("--format", choices=["png", "jpg", "jpeg"], default="png")
    pdf_images.add_argument("--dpi", type=int, choices=range(72, 601), default=150)
    pdf_images.add_argument("--pages", default="")
    add_common(pdf_images)
    pdf_images.set_defaults(handler=pdf_to_images)

    image_pdf = subparsers.add_parser("images-to-pdf")
    image_pdf.add_argument("--inputs", nargs="+", required=True)
    image_pdf.add_argument("--page-size", type=str.lower, choices=["original", "a4", "a3", "letter"], default="a4")
    image_pdf.add_argument("--orientation", choices=["auto", "portrait", "landscape"], default="auto")
    image_pdf.add_argument("--margin-mm", type=float, default=10)
    image_pdf.add_argument("--dpi", type=int, default=150)
    image_pdf.add_argument("--output-name", default="")
    add_common(image_pdf)
    image_pdf.set_defaults(handler=images_to_pdf)

    excel = subparsers.add_parser("excel-process")
    excel.add_argument("--input", required=True)
    excel.add_argument("--sheet", default="")
    excel.add_argument("--deduplicate-columns", "--dedupe-columns", dest="deduplicate_columns", default="")
    excel.add_argument("--filter", action="append", default=[])
    excel.add_argument("--trim-text", action=argparse.BooleanOptionalAction, default=True)
    add_common(excel)
    excel.set_defaults(handler=excel_process)

    extract = subparsers.add_parser("document-extract")
    extract.add_argument("--inputs", nargs="+", required=True)
    extract.add_argument("--purpose", choices=["summary", "meeting", "analysis"], default="summary")
    extract.add_argument("--title", default="")
    extract.add_argument("--basename", default="")
    add_common(extract)
    extract.set_defaults(handler=document_extract)

    compare = subparsers.add_parser("document-compare")
    compare.add_argument("--old", "--original", dest="old", required=True)
    compare.add_argument("--new", "--revised", dest="new", required=True)
    add_common(compare)
    compare.set_defaults(handler=document_compare)

    rename = subparsers.add_parser("batch-rename")
    rename.add_argument("--inputs", nargs="+", required=True)
    rename.add_argument("--prefix", "--project", dest="prefix", default="文件")
    rename.add_argument("--date", default="")
    rename.add_argument("--start", "--start-index", dest="start", type=int, default=1)
    rename.add_argument("--digits", type=int, choices=range(1, 7), default=3)
    rename.add_argument("--template", default="{prefix}_{date}_{index}_{stem}{ext}")
    rename_mode = rename.add_mutually_exclusive_group()
    rename_mode.add_argument("--apply", action="store_true")
    rename_mode.add_argument("--preview", action="store_false", dest="apply")
    add_common(rename)
    rename.set_defaults(handler=batch_rename)

    image = subparsers.add_parser("image-process")
    image.add_argument("--inputs", nargs="+", required=True)
    image.add_argument("--format", choices=["preserve", "jpg", "png", "webp"], default="preserve")
    image.add_argument("--quality", type=int, choices=range(1, 101), default=82)
    image.add_argument("--max-width", type=int, default=0)
    image.add_argument("--max-height", type=int, default=0)
    add_common(image)
    image.set_defaults(handler=image_process)

    render = subparsers.add_parser("render-markdown-docx")
    render.add_argument("--input", required=True)
    render.add_argument("--output-name", default="")
    render.add_argument("--title", default="")
    add_common(render)
    render.set_defaults(handler=render_markdown_docx)

    meeting = subparsers.add_parser("meeting-prepare")
    meeting.add_argument("--materials", nargs="*", default=[])
    meeting.add_argument("--transcript", default="")
    meeting.add_argument("--audio", default="")
    meeting.add_argument("--meeting-title", default="")
    meeting.add_argument("--base-url", default="")
    meeting.add_argument("--minutes-model", default="")
    meeting.add_argument("--api-key", default="")
    meeting.add_argument("--transcription-url", default="")
    meeting.add_argument("--transcription-model", default="")
    meeting.add_argument("--transcription-api-key", default="")
    meeting.add_argument("--transcription-timeout", type=int, default=600)
    meeting.add_argument("--audio-segment-seconds", type=int, default=0)
    meeting.add_argument("--synthesis-timeout", type=int, default=600)
    meeting.add_argument("--skip-synthesis", action="store_true", help=argparse.SUPPRESS)
    add_common(meeting)
    meeting.set_defaults(handler=meeting_prepare)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        result = args.handler(args)
        print("WANWEI_RESULT=" + json.dumps(result, ensure_ascii=False))
        return 0
    except UserError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"处理失败：{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
