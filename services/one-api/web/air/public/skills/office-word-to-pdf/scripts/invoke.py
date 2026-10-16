#!/usr/bin/env python3
"""平台入口：复用随技能发布的业务实现，不生成临时业务脚本。"""
import importlib.util
import importlib.metadata
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid
_mac_spec = importlib.util.spec_from_file_location("wanwei_mac_pdf", Path(__file__).with_name("mac_pdf.py"))
_mac_runtime = importlib.util.module_from_spec(_mac_spec)
_mac_spec.loader.exec_module(_mac_runtime)
converters, validate_pdf = _mac_runtime.converters, _mac_runtime.validate_pdf

ROOT = Path(__file__).resolve().parent
SKILL = ROOT.parent.name
OPERATIONS = {
    "office-pdf-organizer": {"merge": "pdf-merge", "split": "pdf-split"},
    "office-document-summary": {"extract": "document-extract", "render": "render-markdown-docx"},
    "office-meeting-minutes": {"prepare": "meeting-prepare", "render": "render-markdown-docx"},
}
SINGLE = {
    "office-pdf-to-images": "pdf-to-images", "office-images-to-pdf": "images-to-pdf",
    "office-excel-data-cleaner": "excel-process", "office-document-compare": "document-compare",
    "office-batch-rename": "batch-rename", "office-image-optimizer": "image-process",
}
MODULES = {"python-docx": "docx", "pypdf": "pypdf", "openpyxl": "openpyxl", "Pillow": "PIL", "PyMuPDF": "fitz"}


def publish(result):
    print("WANWEI_RESULT=" + json.dumps(result, ensure_ascii=False), flush=True)


def environment():
    info = {"pythonVersion": sys.version.split()[0], "platform": sys.platform, "skill": SKILL}
    if SKILL.startswith("market-gis-"):
        executable = shutil.which("pwsh")
        if not executable:
            raise RuntimeError("Mac GIS 入口需要 PowerShell 7（pwsh）；当前工具路径不可用，请安装或由桌面端配置路径，不要改写业务脚本。")
        checked = subprocess.run([executable, "-NoProfile", "-NonInteractive", "-Command",
                                  "$PSVersionTable.PSVersion.Major"], capture_output=True, text=True, encoding="utf-8")
        if checked.returncode or checked.stdout.strip() != "7":
            raise RuntimeError("需要可执行的 PowerShell 7；请检查工具路径和执行权限。")
        info["powershell"] = executable
    elif SKILL == "office-word-to-pdf":
        if sys.platform == "darwin":
            info["converters"] = converters()
            if not info["converters"]:
                raise RuntimeError("后台 Word 转 PDF 不可用：未检测到 WPS 官方 CLI 或无界面转换器 soffice。"
                                   "可由桌面端配置已有转换器路径 WANWEI_SOFFICE_PATH。"
                                   "仅安装 Mac WPS/Word 不代表具备已验证的后台导出接口；"
                                   "不会打开软件、控制桌面、要求辅助功能授权或重排文档。")
            info["validation"] = "detected-not-export-tested"
            info["executionMode"] = "local-cli-or-headless"
            info["desktopAutomation"] = False
            return info
        executable = shutil.which("soffice")
        if not executable and sys.platform == "darwin":
            candidate = Path("/Applications/LibreOffice.app/Contents/MacOS/soffice")
            if candidate.is_file():
                executable = str(candidate)
        if not executable:
            raise RuntimeError("Mac Word 转 PDF 需要 LibreOffice（soffice）；请安装或由桌面端配置工具路径。")
        info["libreoffice"] = executable
    else:
        requirements = ROOT.parent / "requirements.txt"
        missing = []
        lines = requirements.read_text(encoding="utf-8-sig").splitlines() if requirements.is_file() else []
        for line in lines:
            package = line.split(">")[0].split("<")[0].split("=")[0].strip()
            if package and not package.startswith("#"):
                module = MODULES.get(package)
                if module and importlib.util.find_spec(module) is None:
                    missing.append(package)
                elif module:
                    try:
                        installed = tuple(int(part) for part in importlib.metadata.version(package).split(".")[:2])
                        for operator, declared in re.findall(r"(>=|<)([0-9.]+)", line):
                            bound = tuple(int(part) for part in declared.split("."))
                            size = max(len(installed), len(bound))
                            actual = installed + (0,) * (size - len(installed))
                            expected = bound + (0,) * (size - len(bound))
                            if (operator == ">=" and actual < expected) or (operator == "<" and actual >= expected):
                                missing.append(line.strip())
                                break
                    except (importlib.metadata.PackageNotFoundError, ValueError):
                        missing.append(line.strip())
        if missing:
            raise RuntimeError("缺少依赖：" + "、".join(missing) +
                               "。请在当前 Python 环境按 requirements.txt 安装；权限被拒绝时停止并由桌面端处理。")
        if SKILL == "office-meeting-minutes":
            info["audioConverter"] = shutil.which("ffmpeg") or (shutil.which("afconvert") if sys.platform == "darwin" else None)
    return info


def run_gis(arguments, info):
    allowed = {"-InputPath", "-GeoJsonFile", "-OutputDirectory", "-YfxFieldName", "-Blxsw", "-Xznf", "-BaseUrl"}
    if len(arguments) % 2 or any(arguments[i] not in allowed for i in range(0, len(arguments), 2)):
        raise RuntimeError("GIS 参数必须使用说明中的参数名称，并分别提供参数值。")
    completed = subprocess.run([info["powershell"], "-NoProfile", "-NonInteractive", "-File",
                                str(ROOT / "invoke.ps1"), *arguments], capture_output=True, text=True,
                               encoding="utf-8", errors="replace",
                               env={**os.environ, "DSH_SKILL_NO_AUTO_OPEN": "1"})
    results = [line[len("WANWEI_RESULT="):] for line in completed.stdout.splitlines() if line.startswith("WANWEI_RESULT=")]
    if not results:
        raise RuntimeError("GIS 执行失败，未返回结构化结果：" + completed.stderr.strip()[-1500:])
    result = json.loads(results[-1])
    if completed.returncode and result.get("success"):
        result.update(success=False, status="partial", error="GIS 进程非正常结束：" + completed.stderr.strip()[-1000:])
    for artifact in result.get("artifacts", []):
        if not Path(artifact["path"]).is_file():
            raise RuntimeError("GIS 返回的成果文件不存在：" + artifact["path"])
    view = result.get("metadata", {}).get("analysisViewPath")
    if view and Path(view).is_file():
        print("DSH_ANALYSIS_VIEW=" + view, flush=True)
    publish(result)
    return completed.returncode


def word_to_pdf(arguments, info):
    import argparse
    parser = argparse.ArgumentParser(description="Word 转 PDF")
    parser.add_argument("--inputs", nargs="+", required=True)
    parser.add_argument("--output-directory", required=True)
    parser.add_argument("--converter", choices=("auto", "libreoffice", "wps-cli"), default="auto")
    args = parser.parse_args(arguments)
    directory = Path(args.output_directory).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    files, artifacts = [], []
    available = info.get("converters", [{"kind": "libreoffice", "path": info.get("libreoffice")}])
    if args.converter != "auto":
        available = [item for item in available if item["kind"] == args.converter]
    if not available:
        raise RuntimeError("指定的转换器未安装或路径不可用：" + args.converter)
    if any(item["kind"] not in {"libreoffice", "wps-cli"} or not item.get("path") for item in available):
        raise RuntimeError("只允许 WPS 官方 CLI 或无界面 LibreOffice 转换器；禁止桌面自动化回退。")
    # Do not silently disguise a WPS failure with another converter.
    available = available[:1]
    if available[0]["kind"] == "wps-cli":
        _mac_runtime.check_wps(available[0]["path"])
    for value in args.inputs:
        source = Path(value).expanduser().resolve()
        try:
            if not source.is_file() or source.suffix.lower() not in {".doc", ".docx", ".docm"}:
                raise RuntimeError("输入必须是存在的 Word 文件")
            # Keep intermediates inside the granted output directory, not sandbox-blocked /tmp.
            with tempfile.TemporaryDirectory(prefix=".wanwei-word-", dir=str(directory)) as temporary:
                temporary_path = Path(temporary)
                local_source = temporary_path / ("wanwei-" + uuid.uuid4().hex + source.suffix)
                shutil.copyfile(source, local_source)
                attempts, selected, validation = [], None, None
                for converter in available:
                    attempt_directory = temporary_path / converter["kind"]
                    attempt_directory.mkdir(exist_ok=True)
                    pdf = attempt_directory / (local_source.stem + ".pdf")
                    try:
                        if converter["kind"] == "wps-cli":
                            converted = _mac_runtime.run_wps([converter["path"], "word2pdf",
                                str(local_source), "--output", str(pdf), "--json"], 180)
                        else:
                            converted = subprocess.run([converter["path"], "-env:UserInstallation=" +
                                            (temporary_path / "profile").as_uri(), "--headless", "--convert-to", "pdf",
                                            "--outdir", str(attempt_directory), str(local_source)],
                                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
                        if converted.returncode:
                            raise RuntimeError("后台转换失败：" + converted.stderr.strip()[-600:])
                        validation = validate_pdf(pdf)
                        selected = converter["kind"]
                        break
                    except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                        attempts.append({"converter": converter["kind"], "error": str(exc)})
                if not selected:
                    files.append({"input": str(source), "success": False, "attempts": attempts,
                                  "error": "；".join(item["error"] for item in attempts)})
                    continue
                target = directory / (source.stem + ".pdf")
                index = 2
                while target.exists():
                    target = directory / (source.stem + "-" + str(index) + ".pdf")
                    index += 1
                with target.open("xb") as output, pdf.open("rb") as content:
                    shutil.copyfileobj(content, output)
                artifacts.append({"path": str(target), "kind": "pdf", "description": "转换后的 PDF"})
                files.append({"input": str(source), "output": str(target), "success": True,
                              "converter": selected, "attempts": attempts, **validation})
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
            files.append({"input": str(source), "success": False, "error": str(exc)})
    success = all(item["success"] for item in files)
    publish({"success": success, "status": "completed" if success else "partial" if artifacts else "failed",
             "artifacts": artifacts, "files": files, "metadata": info})
    return 0 if success else 2


def main():
    try:
        info = environment()
        arguments = sys.argv[1:]
        if arguments == ["--check"]:
            publish({"success": True, "status": "ready", "artifacts": [], "metadata": info})
            return 0
        if SKILL.startswith("market-gis-"):
            return run_gis(arguments, info)
        if SKILL == "office-word-to-pdf":
            return word_to_pdf(arguments, info)
        if SKILL in OPERATIONS:
            if not arguments or arguments[0] not in OPERATIONS[SKILL]:
                raise RuntimeError("请按 SKILL.md 提供有效操作名称。")
            operation = OPERATIONS[SKILL][arguments.pop(0)]
        else:
            operation = SINGLE[SKILL]
        spec = importlib.util.spec_from_file_location("office_tools", ROOT / "office_tools.py")
        runtime = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = runtime
        spec.loader.exec_module(runtime)
        return runtime.main([operation, *arguments])
    except SystemExit as exc:
        if exc.code:
            publish({"success": False, "status": "failed", "artifacts": [], "error": "参数无效，请按 SKILL.md 的入口和参数重试。"})
        return int(exc.code or 0)
    except (OSError, RuntimeError, ValueError) as exc:
        publish({"success": False, "status": "failed", "artifacts": [],
                 "error": str(exc), "metadata": {"platform": sys.platform, "skill": SKILL}})
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
