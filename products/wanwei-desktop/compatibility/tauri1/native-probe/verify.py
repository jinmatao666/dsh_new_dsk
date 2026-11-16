"""Build and run the isolated Linux probe, recording bounded native evidence."""
import hashlib
import json
import os
import pathlib
import platform
import re
import subprocess
import tempfile

root = pathlib.Path(__file__).resolve().parent
target = pathlib.Path(os.environ.get("CARGO_TARGET_DIR", str(root / "target"))).resolve()
cargo = pathlib.Path.home() / ".cargo/bin/cargo"
subprocess.run([str(cargo), "build", "--locked", "--jobs", "4", "--manifest-path", str(root / "Cargo.toml")], check=True)
binary = target / "debug/wanwei-tauri1-embedded-probe"
with tempfile.TemporaryDirectory(prefix="wanwei-probe-runtime-") as runtime:
    environment = dict(os.environ, LANG="C", LC_ALL="C", NO_AT_BRIDGE="1", XDG_RUNTIME_DIR=runtime,
                       GDK_BACKEND="x11", WEBKIT_DISABLE_COMPOSITING_MODE="1")
    result = subprocess.run(["xvfb-run", "-a", "dbus-run-session", "--", str(binary)],
                            env=environment, capture_output=True, text=True, timeout=40)
log = result.stdout + result.stderr
(root / "validation.log").write_text(log, encoding="utf-8")
print(log, end="")
if result.returncode != 0 or "PROBE_RESULT experts=2 passed=true" not in log:
    raise SystemExit("Native probe failed; see validation.log")
dependencies = subprocess.check_output(["ldd", str(binary)], text=True)
if "not found" in dependencies:
    raise SystemExit("Missing native dependency")
if "libwebkit2gtk-4.0.so.37" not in dependencies or "libsoup-2.4.so.1" not in dependencies:
    raise SystemExit("Unexpected native rendering dependencies")
if "libwebkit2gtk-4.1" in dependencies or "libsoup-3.0" in dependencies:
    raise SystemExit("Probe unexpectedly links modern WebKit/soup")
libraries = [binary] + [pathlib.Path(path) for path in re.findall(r"=> (/\S+)", dependencies)]
required = {"GLIBC": set(), "GLIBCXX": set()}
binary_required = None
for library in libraries:
    versions = subprocess.check_output(["readelf", "--version-info", str(library)], text=True)
    needs = versions.split("Version needs section", 1)[-1] if "Version needs section" in versions else ""
    found = re.findall(r"Name: (GLIBCXX|GLIBC)_([0-9.]+)", needs)
    for name, value in found:
        required[name].add(value)
    if library == binary:
        binary_required = sorted({value for name, value in found if name == "GLIBC"}, key=lambda v: tuple(map(int, v.split("."))))
maximum = {name: max(values, key=lambda v: tuple(map(int, v.split(".")))) if values else None for name, values in required.items()}
assert tuple(map(int, maximum["GLIBC"].split("."))) <= (2, 31), maximum
assert maximum["GLIBCXX"] is None or tuple(map(int, maximum["GLIBCXX"].split("."))) <= (3, 4, 28), maximum
source_files = ["Cargo.toml", "Cargo.lock", "build.rs", "tauri.conf.json", "src/main.rs", "web/index.html", "icons/icon.png", "verify.py"]
evidence = {
    "scope": "Isolated Tauri 1 GTK native probe; no production business runtime or ARM64 installation",
    "architecture": platform.machine(),
    "glibc": subprocess.check_output(["getconf", "GNU_LIBC_VERSION"], text=True).strip(),
    "pkgConfigVersions": dict(zip(["webkit2gtk-4.0", "gtk+-3.0", "glib-2.0"], subprocess.check_output(["pkg-config", "--modversion", "webkit2gtk-4.0", "gtk+-3.0", "glib-2.0"], text=True).splitlines())),
    "graphics": "Xvfb X11, software compositing, local test HTML",
    "passed": True,
    "mainPageIpc": "PROBE_MAIN_IPC passed=true" in log,
    "expertChecks": [line for line in log.splitlines() if line.startswith("PROBE_EXPERT ")],
    "maximumRequiredSymbolsIncludingResolvedLibraries": maximum,
    "binaryRequiredGlibc": binary_required,
    "sourceSha256": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in source_files},
    "notVerified": ["ARM64", "Kylin installation", "production Node sidecar", "real expert pages", "child-view native command authorization", "input and focus", "Wayland", "updates", "packaging"]
}
(root / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
print(json.dumps(evidence, indent=2))
