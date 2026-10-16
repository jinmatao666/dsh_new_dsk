"""后台转换回归：无桌面控制、原件保护及真实 PDF 核验。"""
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from skill_runtime_test import load


class WordPdfMacTests(unittest.TestCase):
    def setUp(self):
        self.entry = load("office-word-to-pdf", "invoke.py")
        self.mac = self.entry._mac_runtime
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.source = self.directory / "中文原文.docx"
        self.source.write_bytes(b"original document")
        self.output = self.directory / "成果"
        self.info = {"converters": [{"kind": "libreoffice", "path": "/tools/soffice", "mode": "headless"}]}

    def tearDown(self):
        self.temp.cleanup()

    def run_conversion(self, info=None):
        output = io.StringIO()
        with redirect_stdout(output):
            code = self.entry.word_to_pdf(["--inputs", str(self.source), "--output-directory",
                                           str(self.output)], self.info if info is None else info)
        return code, json.loads(output.getvalue().split("WANWEI_RESULT=")[-1])

    def fake_convert(self, command, **kwargs):
        from pypdf import PdfWriter
        self.assertEqual(command[0], "/tools/soffice")
        self.assertIn("--headless", command)
        source = Path(command[-1])
        self.assertNotEqual(source, self.source)
        self.assertEqual(source.read_bytes(), b"original document")
        self.assertTrue(source.is_relative_to(self.output))
        pdf = Path(command[command.index("--outdir") + 1]) / (source.stem + ".pdf")
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        with pdf.open("wb") as content:
            writer.write(content)
        return subprocess.CompletedProcess(command, 0, "", "")

    def test_environment_without_headless_converter_does_not_open_applications(self):
        with patch.object(self.entry.sys, "platform", "darwin"), \
             patch.object(self.entry, "converters", return_value=[]), \
             patch.object(self.entry.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "后台 Word 转 PDF 不可用"):
                self.entry.environment()
        run.assert_not_called()

    def test_discovery_ignores_gui_applications(self):
        with patch.dict(self.mac.os.environ, {"WANWEI_SOFFICE_PATH": "", "WANWEI_WPSCLI_PATH": ""}), \
             patch.object(self.mac.shutil, "which", return_value=None), \
             patch.object(self.mac.Path, "is_file", autospec=True,
                          side_effect=lambda path: str(path).endswith("Info.plist")):
            self.assertEqual(self.mac.converters(), [])

    def test_gui_converter_is_rejected_before_process_launch(self):
        with patch.object(self.entry.subprocess, "run") as run:
            with self.assertRaisesRegex(RuntimeError, "禁止桌面自动化"):
                self.run_conversion({"converters": [{"kind": "wps", "path": "/Applications/wpsoffice.app"}]})
        run.assert_not_called()

    def test_valid_pdf_preserves_source_and_existing_output(self):
        self.output.mkdir()
        existing = self.output / "中文原文.pdf"
        existing.write_bytes(b"existing output")
        with patch.object(self.entry.subprocess, "run", side_effect=self.fake_convert):
            code, result = self.run_conversion()
        self.assertEqual(code, 0)
        self.assertEqual(result["files"][0]["pageCount"], 1)
        self.assertEqual(Path(result["artifacts"][0]["path"]).name, "中文原文-2.pdf")
        self.assertEqual(self.source.read_bytes(), b"original document")
        self.assertEqual(existing.read_bytes(), b"existing output")

    def test_invalid_pdf_is_not_delivered(self):
        def convert(command, **kwargs):
            pdf = Path(command[command.index("--outdir") + 1]) / (Path(command[-1]).stem + ".pdf")
            pdf.write_bytes(b"not a PDF")
            return subprocess.CompletedProcess(command, 0, "", "")
        with patch.object(self.entry.subprocess, "run", side_effect=convert):
            code, result = self.run_conversion()
        self.assertEqual(code, 2)
        self.assertEqual(result["artifacts"], [])

    def test_timeout_never_falls_back_to_desktop(self):
        with patch.object(self.entry.subprocess, "run", side_effect=subprocess.TimeoutExpired("soffice", 180)) as run:
            code, result = self.run_conversion()
        self.assertEqual(code, 2)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(result["artifacts"], [])

    def test_bad_configured_path_is_reported_without_fallback(self):
        with patch.dict(self.mac.os.environ, {"WANWEI_SOFFICE_PATH": str(self.directory / "missing")}), \
             patch.object(self.mac.shutil, "which") as which:
            with self.assertRaisesRegex(RuntimeError, "路径不可执行"):
                self.mac.converters()
        which.assert_not_called()

    def test_wps_cli_uses_official_command_and_validates_pdf(self):
        def run(command, **kwargs):
            self.assertEqual(command[0], "/tools/wpscli")
            if command == ["/tools/wpscli", "--help"]:
                return subprocess.CompletedProcess(command, 0, "word2pdf", "")
            if command == ["/tools/wpscli", "word2pdf", "--help"]:
                return subprocess.CompletedProcess(command, 0, "--output --json", "")
            self.assertEqual(command[1], "word2pdf")
            self.assertIn("--json", command)
            self.assertNotIn("--convert-to", command)
            from pypdf import PdfWriter
            writer = PdfWriter()
            writer.add_blank_page(width=595, height=842)
            with Path(command[command.index("--output") + 1]).open("wb") as output:
                writer.write(output)
            return subprocess.CompletedProcess(command, 0, "{}", "")
        with patch.object(self.mac.subprocess, "run", side_effect=run) as process:
            code, result = self.run_conversion({"converters": [{"kind": "wps-cli", "path": "/tools/wpscli"}]})
        self.assertEqual(code, 0)
        self.assertEqual(process.call_count, 3)
        self.assertEqual(result["files"][0]["converter"], "wps-cli")

    def test_wps_login_failure_does_not_open_login(self):
        with patch.object(self.mac.subprocess, "run", return_value=subprocess.CompletedProcess([], 100, "", "login")) as process:
            with self.assertRaisesRegex(RuntimeError, "未登录"):
                self.mac.check_wps("/tools/wpscli")
        self.assertEqual(process.call_count, 1)

    def test_wps_empty_help_is_rejected(self):
        with patch.object(self.mac.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as process:
            with self.assertRaisesRegex(RuntimeError, "未声明 word2pdf"):
                self.mac.check_wps("/tools/wpscli")
        self.assertEqual(process.call_count, 1)


if __name__ == "__main__":
    unittest.main()
