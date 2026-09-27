import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from pypdf import PdfReader
from processors import convert, ConversionError


class OfficeTests(unittest.TestCase):
    def test_missing_converter_fails_loud(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.docx"
            source.write_bytes(b"not a document")
            with patch.dict(os.environ, {"LIBREOFFICE_BIN": ""}), patch("office.shutil.which", return_value=None):
                with self.assertRaisesRegex(ConversionError, "未安装 LibreOffice"):
                    convert("word-pdf", [source], root / "output")

    @unittest.skipUnless(os.environ.get("LIBREOFFICE_BIN") or shutil.which("soffice"), "requires real LibreOffice")
    def test_real_docx_to_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.docx"
            with zipfile.ZipFile(source, "w") as document:
                document.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
                document.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
                document.writestr("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Independent conversion verification</w:t></w:r></w:p></w:body></w:document>')
            result = convert("word-pdf", [source], root / "output")
            self.assertIn("Independent conversion verification", PdfReader(result[0]).pages[0].extract_text())


if __name__ == "__main__":
    unittest.main()
