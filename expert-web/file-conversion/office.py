"""LibreOffice document conversion with a private profile and no user installation reuse."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from pypdf import PdfReader


class OfficeError(ValueError):
    pass


def word_to_pdf(inputs, output):
    executable = os.environ.get("LIBREOFFICE_BIN") or shutil.which("soffice")
    if not executable:
        raise OfficeError("服务端未安装 LibreOffice，无法执行 Word 转 PDF")
    results = []
    with tempfile.TemporaryDirectory(prefix="office-", dir=output.parent) as profile:
        profile = Path(profile)
        user = profile / "user"
        user.mkdir(mode=0o700)
        (user / "registrymodifications.xcu").write_text(
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<oor:items xmlns:oor="http://openoffice.org/2001/registry">'
            '<item oor:path="/org.openoffice.Office.Common/Security/Scripting">'
            '<prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>'
            '</item></oor:items>', encoding="utf-8")
        for source in inputs:
            if source.suffix.lower() not in (".doc", ".docx", ".docm"):
                raise OfficeError("请选择 DOC、DOCX 或 DOCM 文件")
            # The outer worker owns the process group and the deadline for this
            # command and all LibreOffice children; do not detach them here.
            result = subprocess.run([executable, f"-env:UserInstallation={profile.as_uri()}",
                                     "--headless", "--nologo", "--nodefault", "--norestore",
                                     "--convert-to", "pdf:writer_pdf_Export", "--outdir", str(output), str(source)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            target = output / (source.stem + ".pdf")
            if result.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
                raise OfficeError("Word 转换失败，文件可能损坏、加密或格式不受支持")
            try:
                reader = PdfReader(target)
                if reader.is_encrypted or len(reader.pages) == 0:
                    raise ValueError("invalid result")
            except Exception as error:
                raise OfficeError("转换器未生成有效 PDF") from error
            results.append(target)
    return results
