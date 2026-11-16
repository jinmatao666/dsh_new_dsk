#!/usr/bin/env python3
"""Extract both installer formats and audit the files the user receives."""
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


def check_installers(arch):
    bundle = pathlib.Path(os.environ.get("CARGO_TARGET_DIR", HERE / "target")) / "release/bundle"
    debs = list((bundle / "deb").glob("*.deb"))
    images = list((bundle / "appimage").glob("*.AppImage"))
    if len(debs) != 1 or len(images) != 1:
        raise RuntimeError("Expected exactly one DEB and one AppImage")
    with tempfile.TemporaryDirectory(prefix="wanwei-kylin-installers-") as directory:
        root = pathlib.Path(directory)
        deb = root / "deb"
        subprocess.run(["dpkg-deb", "-x", str(debs[0]), str(deb)], check=True)
        depends = subprocess.check_output(["dpkg-deb", "-f", str(debs[0]), "Depends"], text=True)
        check_depends(depends)
        deb_report = baseline.audit([deb], arch)
        image = images[0].resolve()
        image.chmod(image.stat().st_mode | 0o111)
        extraction_env = {key: val for key, val in os.environ.items() if key != "APPIMAGE_EXTRACT_AND_RUN"}
        subprocess.run([str(image), "--appimage-extract"], cwd=root, check=True,
                       stdout=subprocess.DEVNULL, env=extraction_env)
        image_report = baseline.audit([root / "squashfs-root"], arch)
        # The AppImage runtime executes before any bundled library is available.
        runtime_report = baseline.audit([image], arch)
        (HERE / "baseline-installers.json").write_text(json.dumps({
            "depends": depends.strip(), "deb": deb_report, "appimage": image_report,
            "appimageRuntime": runtime_report,
        }, indent=2) + "\n")
        print("Verified DEB metadata, extracted payloads and AppImage runtime")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--arch", choices=["x64", "arm64"], required=True)
    check_installers(parser.parse_args().arch)
