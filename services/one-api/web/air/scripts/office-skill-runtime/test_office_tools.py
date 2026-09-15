"""End-to-end smoke tests for the deterministic office skill runtime."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


RUNTIME = Path(__file__).with_name("office_tools.py")


class OfficeToolsSmokeTest(unittest.TestCase):
    """Exercise each local processing path with real office artifacts."""

    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="wanwei-office-skills-")
        self.root = Path(self.temporary.name)
        self.inputs = self.root / "inputs"
        self.outputs = self.root / "outputs"
        self.inputs.mkdir()
        self.outputs.mkdir()
        self._create_fixtures()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_tool(self, *arguments: str, expected_code: int = 0) -> dict:
        environment = os.environ.copy()
        environment["PYTHONIOENCODING"] = "utf-8"
        completed = subprocess.run(
            [sys.executable, str(RUNTIME), *arguments],
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=environment,
            check=False,
        )
        self.assertEqual(expected_code, completed.returncode, completed.stderr)
        if expected_code != 0:
            return {"stderr": completed.stderr}
        marker = next(line for line in completed.stdout.splitlines() if line.startswith("WANWEI_RESULT="))
        result = json.loads(marker.removeprefix("WANWEI_RESULT="))
        for artifact in result.get("artifacts", []):
            self.assertTrue(Path(artifact["path"]).is_file(), artifact)
        return result

    def test_pdf_image_and_document_workflows(self) -> None:
        image_pdf = self.run_tool(
            "images-to-pdf", "--inputs", str(self.inputs / "red.png"), str(self.inputs / "blue.jpg"),
            "--page-size", "A4", "--orientation", "auto", "--output-dir", str(self.outputs / "image-pdf"),
        )
        pdf = Path(image_pdf["artifacts"][0]["path"])
        merged = self.run_tool(
            "pdf-merge", "--inputs", str(pdf), str(pdf), "--output-dir", str(self.outputs / "merge"),
        )
        merged_pdf = Path(merged["artifacts"][0]["path"])
        self.run_tool(
            "pdf-split", "--input", str(merged_pdf), "--ranges", "1-2,4", "--separate-pages",
            "--output-dir", str(self.outputs / "split"),
        )
        converted = self.run_tool(
            "pdf-to-images", "--input", str(merged_pdf), "--pages", "2-3", "--format", "jpg",
            "--dpi", "96", "--output-dir", str(self.outputs / "pdf-images"),
        )
        self.assertEqual(3, len(converted["artifacts"]))  # two images and one report

        cleaned = self.run_tool(
            "excel-process", "--input", str(self.inputs / "ledger.xlsx"), "--dedupe-columns", "编号",
            "--filter", "状态=有效", "--output-dir", str(self.outputs / "excel"),
        )
        self.assertEqual(3, cleaned["rows_before"])
        self.assertEqual(1, cleaned["rows_after"])

        compared = self.run_tool(
            "document-compare", "--original", str(self.inputs / "old.docx"),
            "--revised", str(self.inputs / "new.docx"), "--output-dir", str(self.outputs / "compare"),
        )
        self.assertEqual(1, compared["counts"]["modified"])
        self.assertEqual(1, compared["counts"]["added"])
        self.assertEqual(0, compared["counts"]["deleted"])
        self.run_tool(
            "document-extract", "--inputs", str(self.inputs / "new.docx"), str(self.inputs / "ledger.xlsx"),
            "--output-dir", str(self.outputs / "extract"),
        )
        self.run_tool(
            "render-markdown-docx", "--input", str(self.inputs / "summary.md"),
            "--title", "测试摘要", "--output-dir", str(self.outputs / "render"),
        )

    def test_safe_rename_image_optimization_and_meeting(self) -> None:
        rename_a = self.inputs / "rename-a.txt"
        rename_b = self.inputs / "rename-b.txt"
        rename_a.write_text("a", encoding="utf-8")
        rename_b.write_text("b", encoding="utf-8")
        preview = self.run_tool(
            "batch-rename", "--inputs", str(rename_a), str(rename_b), "--project", "演示",
            "--template", "{project}_{index}_{name}{ext}", "--preview", "--output-dir", str(self.inputs),
        )
        self.assertFalse(preview["applied"])
        self.assertTrue(rename_a.exists())
        applied = self.run_tool(
            "batch-rename", "--inputs", str(rename_a), str(rename_b), "--project", "演示",
            "--template", "{project}_{index}_{name}{ext}", "--apply", "--output-dir", str(self.inputs),
        )
        self.assertTrue(applied["applied"])
        self.assertFalse(rename_a.exists())

        optimized = self.run_tool(
            "image-process", "--inputs", str(self.inputs / "red.png"), "--format", "webp",
            "--quality", "80", "--max-width", "320", "--output-dir", str(self.outputs / "images"),
        )
        self.assertEqual("image", optimized["artifacts"][0]["kind"])
        self.assertIn("size_reduction_percent", optimized)
        self.assertEqual(1, len(optimized["files"]))

        meeting = self.run_tool(
            "meeting-prepare", "--transcript", str(self.inputs / "transcript.txt"),
            "--materials", str(self.inputs / "new.docx"), "--skip-synthesis",
            "--output-dir", str(self.outputs / "meeting"),
        )
        self.assertGreaterEqual(len(meeting["artifacts"]), 4)

    def _create_fixtures(self) -> None:
        from PIL import Image
        from docx import Document
        from openpyxl import Workbook

        Image.new("RGB", (640, 480), "#ef4444").save(self.inputs / "red.png")
        Image.new("RGB", (480, 640), "#2563eb").save(self.inputs / "blue.jpg", quality=90)

        old = Document()
        old.add_heading("项目周报", level=1)
        old.add_paragraph("计划于周一完成初稿。")
        old.save(self.inputs / "old.docx")
        new = Document()
        new.add_heading("项目周报", level=1)
        new.add_paragraph("计划于周三完成终稿。")
        new.add_paragraph("风险：接口仍待确认。")
        new.save(self.inputs / "new.docx")

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "台账"
        sheet.append(["编号", "名称", "状态"])
        sheet.append([1, " 甲项目 ", "有效"])
        sheet.append([1, "甲项目", "有效"])
        sheet.append([2, "乙项目", "停用"])
        workbook.save(self.inputs / "ledger.xlsx")

        (self.inputs / "summary.md").write_text(
            "# 执行摘要\n\n## 关键结论\n\n- 已完成测试。\n\n"
            "| 事项 | 责任人 | 截止时间 |\n| --- | --- | --- |\n| 联调 | 张三 | 9月20日 |\n",
            encoding="utf-8",
        )
        (self.inputs / "transcript.txt").write_text(
            "会议决定周三完成终稿。张三负责接口联调，截止 9 月 20 日。",
            encoding="utf-8",
        )
        (self.inputs / "audio.wav").write_bytes(b"RIFF0000WAVE")


if __name__ == "__main__":
    unittest.main()
