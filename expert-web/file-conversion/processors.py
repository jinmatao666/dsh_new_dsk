"""Standalone conversion engine. Call only with service-owned input/output paths."""
from pathlib import Path
import re
import warnings

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter
import pymupdf


class ConversionError(ValueError):
    pass


MAX_PAGES = 300
MAX_PIXELS = 24_000_000


def page_groups(spec, count):
    if not 1 <= count <= MAX_PAGES:
        raise ConversionError("PDF 页数须在 1–300 页之间")
    if not spec or not spec.strip():
        return [list(range(count))]
    groups, seen = [], set()
    for part in spec.replace("，", ",").split(","):
        match = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+))?\s*", part)
        if not match:
            raise ConversionError("页码格式应为 1-3,5,8-10")
        start, end = int(match[1]), int(match[2] or match[1])
        if not 1 <= start <= end <= count:
            raise ConversionError("页码超出范围或顺序错误")
        group = list(range(start - 1, end))
        if seen.intersection(group):
            raise ConversionError("页码范围不能重复或重叠")
        seen.update(group)
        groups.append(group)
    return groups


def pdf_reader(path):
    reader = PdfReader(path)
    if reader.is_encrypted:
        raise ConversionError("暂不支持加密 PDF，请先解除密码")
    page_groups("", len(reader.pages))
    return reader


def integer(options, key, default, low, high):
    value = options.get(key, default)
    if isinstance(value, bool):
        raise ConversionError(f"{key} 参数无效")
    try:
        parsed = int(value)
    except (ValueError, TypeError):
        raise ConversionError(f"{key} 参数无效") from None
    if str(parsed) != str(value) or not low <= parsed <= high:
        raise ConversionError(f"{key} 须在 {low}–{high} 之间")
    return parsed


def rgb_image(path):
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(path) as source:
            if source.width * source.height > MAX_PIXELS:
                raise ConversionError("图片超过 2400 万像素，请先缩小")
            oriented = ImageOps.exif_transpose(source)
            rgba = oriented.convert("RGBA")
            result = Image.new("RGB", rgba.size, "white")
            result.paste(rgba, mask=rgba.getchannel("A"))
            rgba.close()
            if oriented is not source:
                oriented.close()
            return result


def convert(tool, inputs, output, options=None):
    """Return generated paths; errors propagate, never substitute demo outputs.

    `output` must be a new private task directory. Inputs must be validated uploads,
    not client-supplied filesystem paths. The HTTP layer owns authentication.
    """
    options = options or {}
    inputs = [Path(path) for path in inputs]
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    if not 1 <= len(inputs) <= 30:
        raise ConversionError("每次请选择 1–30 个文件")
    results = []
    if tool == "word-pdf":
        from office import OfficeError, word_to_pdf
        try:
            results = word_to_pdf(inputs, output)
        except OfficeError as error:
            raise ConversionError(str(error)) from error
    elif tool == "pdf-organize":
        mode = options.get("mode", "merge")
        if mode not in ("merge", "ranges", "pages"):
            raise ConversionError("未知 PDF 整理模式")
        readers = [pdf_reader(path) for path in inputs]
        if mode == "merge":
            if len(inputs) < 2:
                raise ConversionError("合并至少需要两个 PDF")
            if sum(len(reader.pages) for reader in readers) > MAX_PAGES:
                raise ConversionError("合并后不能超过 300 页")
            writer = PdfWriter()
            for reader in readers:
                for page in reader.pages:
                    writer.add_page(page)
            target = output / "合并结果.pdf"
            writer.write(target)
            writer.close()
            results.append(target)
        else:
            if len(readers) != 1:
                raise ConversionError("拆分请选择一个 PDF")
            reader = readers[0]
            groups = ([[i] for i in range(len(reader.pages))] if mode == "pages"
                      else page_groups(options.get("pages", ""), len(reader.pages)))
            for number, group in enumerate(groups, 1):
                writer = PdfWriter()
                for index in group:
                    writer.add_page(reader.pages[index])
                target = output / f"拆分-{number:03d}.pdf"
                writer.write(target)
                writer.close()
                results.append(target)
    elif tool == "pdf-images":
        if len(inputs) != 1:
            raise ConversionError("请选择一个 PDF")
        dpi = integer(options, "dpi", 144, 72, 300)
        fmt = options.get("format", "png")
        if fmt not in ("png", "jpg"):
            raise ConversionError("仅支持 PNG 或 JPG")
        with pymupdf.open(inputs[0]) as document:
            if document.needs_pass:
                raise ConversionError("暂不支持加密 PDF")
            groups = page_groups(options.get("pages", ""), len(document))
            for index in [i for group in groups for i in group]:
                page = document[index]
                if page.rect.width * page.rect.height * (dpi / 72) ** 2 > MAX_PIXELS:
                    raise ConversionError("页面渲染超过像素限制，请降低 DPI")
                target = output / f"第{index + 1:03d}页.{fmt}"
                page.get_pixmap(dpi=dpi, alpha=False).save(target)
                results.append(target)
    elif tool == "image-optimize":
        fmt = options.get("format", "webp")
        if fmt not in ("jpg", "png", "webp", "original"):
            raise ConversionError("图片格式无效")
        quality = integer(options, "quality", 85, 1, 100)
        width = integer(options, "maxWidth", 1920, 1, 10000)
        height = integer(options, "maxHeight", 1080, 1, 10000)
        for number, path in enumerate(inputs, 1):
            extension = path.suffix.lower().lstrip(".") if fmt == "original" else fmt
            extension = "jpg" if extension == "jpeg" else extension
            if extension not in ("jpg", "png", "webp"):
                raise ConversionError("原文件格式不受支持")
            with rgb_image(path) as image:
                image.thumbnail((width, height), Image.Resampling.LANCZOS)
                target = output / f"图片-{number:03d}.{extension}"
                image.save(target, quality=quality, optimize=True)
                results.append(target)
    elif tool == "images-pdf":
        size = options.get("pageSize", "A4")
        orientation = options.get("orientation", "auto")
        if size not in ("original", "A4", "A3", "Letter") or orientation not in ("auto", "portrait", "landscape"):
            raise ConversionError("纸张或方向参数无效")
        margin = integer(options, "margin", 10, 0, 50)
        pages = []
        try:
            for path in inputs:
                with rgb_image(path) as image:
                    if size == "original":
                        pages.append(image.copy())
                        continue
                    mm = {"A4": (210, 297), "A3": (297, 420), "Letter": (216, 279)}[size]
                    if orientation == "landscape" or (orientation == "auto" and image.width > image.height):
                        mm = mm[::-1]
                    pixels = tuple(round(value * 144 / 25.4) for value in mm)
                    inset = round(margin * 144 / 25.4)
                    image.thumbnail((pixels[0] - 2 * inset, pixels[1] - 2 * inset), Image.Resampling.LANCZOS)
                    canvas = Image.new("RGB", pixels, "white")
                    canvas.paste(image, ((pixels[0] - image.width) // 2, (pixels[1] - image.height) // 2))
                    pages.append(canvas)
            target = output / "图片合成.pdf"
            pages[0].save(target, save_all=True, append_images=pages[1:], resolution=144)
            results.append(target)
        finally:
            for page in pages:
                page.close()
    else:
        raise ConversionError("该转换工具尚未接入")
    return results
