#!/usr/bin/env python3
"""Reject incompatible ELF artifacts before uploading installers."""
import argparse
import json
import os
import pathlib
import re
import subprocess

LIMITS = {"GLIBC": (2, 31), "GLIBCXX": (3, 4, 28), "CXXABI": (1, 3, 12)}


def requirements(output):
    needs = output.split("Version needs section", 1)[-1] if "Version needs section" in output else ""
    return [(family, tuple(map(int, version.split("."))))
            for family, version in re.findall(r"Name:\s+(GLIBC|GLIBCXX|CXXABI)_(\d+(?:\.\d+)+)", needs)]


def inspect(path, arch, library_dirs=()):
    header = subprocess.check_output(["readelf", "-h", str(path)], text=True)
    machine = "AArch64" if arch == "arm64" else "Advanced Micro Devices X86-64"
    if machine not in header:
        raise RuntimeError("Unexpected ELF architecture: " + str(path))
    output = subprocess.check_output(["readelf", "--version-info", str(path)], text=True)
    found = requirements(output)
    for family, version in found:
        if version > LIMITS[family]:
            raise RuntimeError(str(path) + " requires " + family + "_" + '.'.join(map(str, version)))
    env = dict(os.environ)
    env["LD_LIBRARY_PATH"] = os.pathsep.join(map(str, [path.parent, *library_dirs]))
    linked = subprocess.run(["ldd", str(path)], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env)
    if "not found" in linked.stdout:
        raise RuntimeError("Missing dependency for " + str(path) + ": " + linked.stdout)
    if re.search(r"libwebkit2gtk-4\.1|libsoup-3\.0", linked.stdout):
        raise RuntimeError("WebKit 4.1 / soup3 dependency in " + str(path))
    if linked.returncode and not re.search(r"not a dynamic executable|statically linked", linked.stdout):
        raise RuntimeError("Dependency inspection failed for " + str(path) + ": " + linked.stdout)
    return {family: '.'.join(map(str, max([v for f, v in found if f == family], default=(0,))))
            for family in LIMITS}


def audit(roots, arch):
    checked = {}
    binaries = []
    for root in roots:
        root = pathlib.Path(root)
        if not root.exists():
            raise RuntimeError("Audit root missing: " + str(root))
        candidates = root.rglob("*") if root.is_dir() else [root]
        for path in candidates:
            if not path.is_file() or path.is_symlink():
                continue
            with path.open("rb") as stream:
                if stream.read(4) != b"\x7fELF":
                    continue
            binaries.append(path.resolve())
    library_dirs = sorted({path.parent for path in binaries if ".so" in path.name})
    for path in binaries:
        checked[str(path)] = inspect(path, arch, library_dirs)
    if not checked:
        raise RuntimeError("No ELF artifacts were checked")
    return {"architecture": arch, "limits": {f: '.'.join(map(str, v)) for f, v in LIMITS.items()},
            "files": checked}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--arch", choices=["x64", "arm64"], required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("roots", nargs="+")
    args = parser.parse_args()
    report = audit(args.roots, args.arch)
    pathlib.Path(args.report).write_text(json.dumps(report, indent=2) + "\n")
    print("Kylin baseline: checked " + str(len(report['files'])) + " ELF artifacts (" + args.arch + ")")
