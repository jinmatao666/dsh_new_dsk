"""只检测无界面转换器并核验 PDF；不打开应用或控制桌面。"""
import os
from pathlib import Path
import shutil
import subprocess


def converters():
    configured = os.environ.get("WANWEI_SOFFICE_PATH")
    if configured:
        candidate = Path(configured).expanduser()
        if not candidate.is_file() or not os.access(str(candidate), os.X_OK):
            raise RuntimeError("配置的后台转换器路径不可执行：" + str(candidate))
        executable = str(candidate.resolve())
    else:
        executable = shutil.which("soffice")
        if not executable:
            for base in (Path("/Applications"), Path.home() / "Applications"):
                candidate = base / "LibreOffice.app/Contents/MacOS/soffice"
                if candidate.is_file() and os.access(str(candidate), os.X_OK):
                    executable = str(candidate)
                    break
    available = []
    configured_cli = os.environ.get("WANWEI_WPSCLI_PATH")
    cli = None
    if configured_cli:
        candidate = Path(configured_cli).expanduser()
        if not candidate.is_file() or not os.access(str(candidate), os.X_OK):
            raise RuntimeError("配置的 WPS CLI 路径不可执行：" + str(candidate))
        cli = str(candidate.resolve())
    else:
        cli = shutil.which("wpscli")
        if not cli:
            for base in (Path("/Applications"), Path.home() / "Applications"):
                for app in ("wpsoffice.app", "WPS Office.app"):
                    candidate = base / app / "Contents/MacOS/wpscli"
                    if candidate.is_file() and os.access(str(candidate), os.X_OK):
                        cli = str(candidate)
                        break
                if cli:
                    break
    if cli:
        available.append({"kind": "wps-cli", "path": cli, "mode": "cli",
                          "focusBehavior": "requires-mac-validation"})
    if executable:
        available.append({"kind": "libreoffice", "path": executable, "mode": "headless"})
    return available


def run_wps(command, timeout):
    try:
        result = subprocess.run(command, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError("WPS 官方 CLI 超时；停止执行，不切换桌面操作。")
    if result.returncode:
        reason = {100: "WPS 未登录，请先自行完成登录后重试",
                  101: "WPS 权限或会员资格不足"}.get(result.returncode, "WPS CLI 执行失败")
        raise RuntimeError(reason + "（退出码 " + str(result.returncode) + "）：" +
                           (result.stderr or result.stdout).strip()[-600:])
    return result


def check_wps(path):
    checked = run_wps([path, "--help"], 20)
    help_text = checked.stdout + checked.stderr
    if "word2pdf" not in help_text:
        raise RuntimeError("此 WPS CLI 未声明 word2pdf 能力（可能版本不支持或初始化未完成）；停止，不猜测参数。")
    checked = run_wps([path, "word2pdf", "--help"], 20)
    detail = checked.stdout + checked.stderr
    if "--output" not in detail:
        raise RuntimeError("此 WPS CLI 未声明 word2pdf --output 参数；停止，不猜测参数。")


def validate_pdf(path):
    if not path.is_file():
        raise RuntimeError("转换器没有生成 PDF")
    with path.open("rb") as content:
        header = content.read(8)
        content.seek(max(0, path.stat().st_size - 2048))
        trailer = content.read()
    if not header.startswith(b"%PDF-") or b"%%EOF" not in trailer:
        raise RuntimeError("转换器输出不是完整的 PDF")
    try:
        from pypdf import PdfReader
    except ImportError:
        return {"pdfValidation": "header-and-trailer"}
    try:
        pages = len(PdfReader(str(path)).pages)
    except Exception as exc:
        raise RuntimeError("PDF 解析失败：" + str(exc)) from exc
    if not pages:
        raise RuntimeError("转换器输出的 PDF 没有页面")
    return {"pdfValidation": "pypdf", "pageCount": pages}
