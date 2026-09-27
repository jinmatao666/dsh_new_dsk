import tempfile
import unittest
from pathlib import Path
from PIL import Image
from pypdf import PdfReader, PdfWriter
from processors import ConversionError, convert, page_groups


class ProcessorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def pdf(self, name, count):
        path = self.root / name
        writer = PdfWriter()
        for _ in range(count):
            writer.add_blank_page(width=72, height=72)
        writer.write(path)
        writer.close()
        return path

    def test_range_validation(self):
        self.assertEqual(page_groups("1-2，4", 4), [[0, 1], [3]])
        for spec in ("0", "5", "3-1", "1-2,2", "1,", "abc"):
            with self.assertRaises(ConversionError):
                page_groups(spec, 4)

    def test_real_merge_and_split(self):
        a, b = self.pdf("a.pdf", 2), self.pdf("b.pdf", 1)
        merged = convert("pdf-organize", [a, b], self.root / "merge")
        self.assertEqual(len(PdfReader(merged[0]).pages), 3)
        split = convert("pdf-organize", merged, self.root / "split", {"mode": "ranges", "pages": "1-2,3"})
        self.assertEqual([len(PdfReader(p).pages) for p in split], [2, 1])

    def test_real_pdf_render(self):
        source = self.pdf("source.pdf", 2)
        rendered = convert("pdf-images", [source], self.root / "render", {"pages": "2", "dpi": 144})
        with Image.open(rendered[0]) as image:
            self.assertEqual(image.size, (144, 144))
        self.assertEqual(len(rendered), 1)

    def test_transparency_and_image_pdf(self):
        source = self.root / "transparent.png"
        Image.new("RGBA", (100, 50), (0, 0, 0, 0)).save(source)
        result = convert("image-optimize", [source], self.root / "opt", {"format": "png", "maxWidth": 40})
        with Image.open(result[0]) as image:
            self.assertEqual(image.size, (40, 20))
            self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))
        pdf = convert("images-pdf", [source, source], self.root / "imagepdf")
        self.assertEqual(len(PdfReader(pdf[0]).pages), 2)

    def test_reject_invalid_options_and_overwrite(self):
        source = self.pdf("source.pdf", 1)
        with self.assertRaises(ConversionError):
            convert("pdf-images", [source], self.root / "bad", {"dpi": True})
        with self.assertRaises(FileExistsError):
            convert("pdf-images", [source], self.root / "bad")


if __name__ == "__main__":
    unittest.main()
