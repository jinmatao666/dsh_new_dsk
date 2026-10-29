"""Native PDF text must remain verbatim; image-bearing pages still use OCR."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pymupdf
from PIL import Image
from documents import inspect_document, pdf_text_layer, render_preview
from ocr import extract


class DocumentTests(unittest.TestCase):
    def test_native_pdf_preserves_text_and_original_source_without_engine(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / '000.pdf'
            with pymupdf.open() as pdf:
                for number in (1, 2):
                    pdf.new_page().insert_text((50, 50), f'Invoice 00{number}: 123.45')
                pdf.save(path)
            with patch('ocr.paddle_recognize', side_effect=AssertionError('native text needs no inference')):
                outputs = extract([path], Path(tmp)/'out', {'format': 'json'}, ['invoice.pdf'])
            result = json.loads(outputs[0].read_text(encoding='utf-8'))
            self.assertEqual([p['engine'] for p in result['pages']], ['PDF text layer'] * 2)
            self.assertEqual(result['pages'][1]['text'], 'Invoice 002: 123.45')
            self.assertEqual(result['lines'][1]['source_file'], 'invoice.pdf')
            self.assertEqual(result['lines'][1]['page_number'], 2)
            self.assertIsNone(result['lines'][1]['confidence'])

    def test_mixed_page_does_not_skip_image_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'scan.pdf'
            import io
            stream = io.BytesIO()
            Image.new('RGB', (60, 60), 'white').save(stream, 'PNG')
            with pymupdf.open() as pdf:
                page = pdf.new_page()
                page.insert_text((50, 50), 'Page header')
                page.insert_image(pymupdf.Rect(50, 100, 400, 450), stream=stream.getvalue())
                pdf.save(path)
            self.assertIsNone(pdf_text_layer(path, 1))
            with patch('ocr.paddle_recognize', return_value={
                    'engine': 'fixture', 'text': 'image text', 'lines': []}) as recognize:
                extract([path], Path(tmp)/'out', {})
            recognize.assert_called_once()

    def test_tiff_page_count_is_validated_before_queueing(self):
        import io
        stream = io.BytesIO()
        Image.new('RGB', (20, 20)).save(stream, 'TIFF', save_all=True,
                                     append_images=[Image.new('RGB', (20, 20), 'white')])
        self.assertEqual(inspect_document(stream.getvalue(), '.tiff')['pages'], 2)

    def test_tiff_preview_renders_the_selected_frame(self):
        import io
        stream = io.BytesIO()
        Image.new('RGB', (20, 20), 'red').save(stream, 'TIFF', save_all=True,
                                           append_images=[Image.new('RGB', (20, 20), 'blue')])
        data, count = render_preview(stream.getvalue(), '.tiff', 1)
        self.assertEqual(count, 2)
        with Image.open(io.BytesIO(data)) as image:
            self.assertEqual(image.getpixel((10, 10)), (0, 0, 255))


if __name__ == '__main__':
    unittest.main()
