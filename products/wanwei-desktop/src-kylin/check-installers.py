#!/usr/bin/env python3
"""Extract selected installer formats and audit the files the user receives."""
import argparse
import importlib.util
import json
import os
import pathlib
import re
import subprocess
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("baseline", HERE / "check-baseline.py")
baseline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baseline)


def check_depends(depends):
    required = ["libwebkit2gtk-4.0-37", "libgtk-3-0", "libappindicator3-1"]
    if any(name not in depends for name in required) or re.search(
        r"webkit2gtk-4\.1|libsoup-3\.0|libayatana-appindicator", depends
    ):
        raise RuntimeError("Incompatible DEB dependency metadata: " + depends)


def check_installers(arch, installer_format="both"):
    if installer_format not in ("both", "deb", "appimage"):
        raise ValueError("Unsupported installer format: " + installer_format)
    bundle = pathlib.Path(os.environ.get("CARGO_TARGET_DIR", HERE / "target")) / "release/bundle"
    formats = ("deb", "appimage") if installer_format == "both" else (installer_format,)
    paths = {}
    for selected in formats:
        extension = "deb" if selected == "deb" else "AppImage"
        matches = list((bundle / selected).glob("*." + extension))
        if len(matches) != 1:
            raise RuntimeError("Expected exactly one " + selected + " installer")
        paths[selected] = matches[0]
    report = {}
    with tempfile.TemporaryDirectory(prefix="wanwei-kylin-installers-") as directory:
        root = pathlib.Path(directory)
        if "deb" in paths:
            deb = root / "deb"
            subprocess.run(["dpkg-deb", "-x", str(paths["deb"]), str(deb)], check=True)
            depends = subprocess.check_output(["dpkg-deb", "-f", str(paths["deb"]), "Depends"], text=True)
            check_depends(depends)
            report.update({"depends": depends.strip(), "deb": baseline.audit([deb], arch)})
        if "appimage" in paths:
            image = paths["appimage"].resolve()
            image.chmod(image.stat().st_mode | 0o111)
            extraction_env = {key: val for key, val in os.environ.items() if key != "APPIMAGE_EXTRACT_AND_RUN"}
            subprocess.run([str(image), "--appimage-extract"], cwd=root, check=True,
                           stdout=subprocess.DEVNULL, env=extraction_env)
            report["appimage"] = baseline.audit([root / "squashfs-root"], arch)
            # The AppImage runtime executes before any bundled library is available.
            report["appimageRuntime"] = baseline.audit([image], arch)
        suffix = "" if installer_format == "both" else "-" + installer_format
        (HERE / ("baseline-installers" + suffix + ".json")).write_text(json.dumps(report, indent=2) + "\n")
        print("Verified installer formats: " + ", ".join(formats))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--arch", choices=["x64", "arm64"], required=True)
    parser.add_argument("--format", choices=["both", "deb", "appimage"], default="both")
    arguments = parser.parse_args()
    check_installers(arguments.arch, arguments.format)
