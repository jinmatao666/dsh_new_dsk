"""Bounded local page rendering and editable document exports."""
import io
from pathlib import Path
import pymupdf
from PIL import Image, ImageOps

MAX_PAGES = 20

def render_preview(data, suffix, page_number=0):
    """Render an input page locally without creating a task or invoking OCR."""
    if isinstance(page_number, bool) or not isinstance(page_number, int):
        raise ValueError('预览页码无效')
    info = inspect_document(data, suffix)
    if not 0 <= page_number < info['pages']:
        raise ValueError('预览页码超出范围')
    if suffix == '.pdf':
        with pymupdf.open(stream=data, filetype='pdf') as document:
            page = document[page_number]
            scale = min(2, 2000 / max(page.rect.width, page.rect.height))
            pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False, colorspace=pymupdf.csRGB)
            return pix.tobytes('png'), info['pages']
    with Image.open(io.BytesIO(data)) as original:
        original.seek(page_number)
        if original.width * original.height > 20_000_000:
            raise ValueError('图片超过2000万像素')
        image = ImageOps.exif_transpose(original).convert('RGB')
        image.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
        stream = io.BytesIO()
        image.save(stream, 'PNG')
        return stream.getvalue(), info['pages']

def pdf_text_layer(path, page_number):
    """Use native text only on text-only pages; mixed/scanned pages need OCR."""
    if Path(path).suffix.lower() != '.pdf':
        return None
    with pymupdf.open(path) as document:
        page = document[page_number - 1]
        if page.get_image_info() or page.get_drawings():
            return None
        text = page.get_text('text', sort=True).strip()
        if not text or '\ufffd' in text or '\x00' in text:
            return None
        return {'engine': 'PDF text layer', 'coordinate_system': None,
                'lines': [{'id': i + 1, 'text': line, 'confidence': None, 'polygon': None}
                          for i, line in enumerate(text.splitlines())], 'text': text}

def pages(paths):
    count = 0
    for path in paths:
        path = Path(path)
        if path.suffix.lower() == '.pdf':
            with pymupdf.open(path) as document:
                if document.needs_pass or not 1 <= len(document) <= MAX_PAGES:
                    raise ValueError('PDF须无密码且不超过20页')
                for page in document:
                    count += 1
                    if count > MAX_PAGES:
                        raise ValueError('每个任务最多20页，请拆分提交')
                    scale = min(2, 2000 / max(page.rect.width, page.rect.height))
                    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
                    yield Image.frombytes('RGB', [pix.width, pix.height], pix.samples), path.name, page.number + 1
        else:
            with Image.open(path) as original:
                for index in range(getattr(original, 'n_frames', 1)):
                    count += 1
                    if count > MAX_PAGES:
                        raise ValueError('每个任务最多20页，请拆分提交')
                    original.seek(index)
                    image = ImageOps.exif_transpose(original).convert('RGB')
                    if image.width * image.height > 20_000_000:
                        raise ValueError('图片超过2000万像素')
                    yield image, path.name, index + 1

def inspect_document(data, suffix):
    if suffix == '.pdf':
        with pymupdf.open(stream=data, filetype='pdf') as document:
            if document.needs_pass or not 1 <= len(document) <= MAX_PAGES:
                raise ValueError('PDF须无密码且为1至20页')
            return {'mime': 'application/pdf', 'pages': len(document)}
    with Image.open(io.BytesIO(data)) as image:
        allowed = {'.png':'PNG','.jpg':'JPEG','.jpeg':'JPEG','.webp':'WEBP','.bmp':'BMP','.tif':'TIFF','.tiff':'TIFF'}
        if image.format != allowed.get(suffix) or image.width * image.height > 20_000_000 or getattr(image,'n_frames',1) > MAX_PAGES:
            raise ValueError('图片格式或页数无效')
        frame_count = getattr(image, 'n_frames', 1)
        image.verify()
    return {'mime': 'image/' + allowed[suffix].lower(), 'pages': frame_count}

def export_document(text, output, kind):
    if kind != 'docx':
        raise ValueError('仅支持Word文档导出')
    from docx import Document
    from docx.shared import Pt, Cm, RGBColor
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    doc = Document()
    section = doc.sections[0]
    section.top_margin = section.bottom_margin = Cm(2)
    style = doc.styles['Normal']
    style.font.name = 'Arial'
    style.font.size = Pt(11)
    style.font.color.rgb = RGBColor(0, 0, 0)
    style.element.get_or_add_rPr().append(OxmlElement('w:rFonts'))
    style.element.rPr.rFonts.set(qn('w:eastAsia'), '宋体')
    for line in text.splitlines():
        doc.add_paragraph(line)
    doc.save(output)
