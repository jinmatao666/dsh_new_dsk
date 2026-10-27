"""Prove this project can install and test outside the DSH checkout."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import venv


def run(command, directory):
    subprocess.run(command, cwd=directory, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--deployment", action="store_true", help="Also require Docker Compose validation")
    args = parser.parse_args()
    project = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix="expert-portability-") as temporary:
        copied = Path(temporary) / "standalone"
        shutil.copytree(project, copied, ignore=shutil.ignore_patterns(
            ".venv", "venv", "data", "__pycache__", ".git", ".env", "*.sqlite3", "*.sqlite3-*"))
        environment = Path(temporary) / "environment"
        venv.EnvBuilder(with_pip=True).create(environment)
        python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        run([str(python), "-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt"], copied)
        run([str(python), "-m", "unittest", "discover", "-p", "test_*.py"], copied)
        node = shutil.which("node")
        if not node:
            raise SystemExit("Node.js is required for the frontend regression checks")
        run([node, "--test", "test_frontend.mjs"], copied)
        if args.deployment:
            docker = shutil.which("docker")
            if not docker:
                raise SystemExit("Docker is unavailable; deployment verification has not passed")
            shutil.copyfile(copied / ".env.example", copied / ".env")
            run([docker, "compose", "config", "--quiet"], copied)
            run([docker, "compose", "build"], copied)
        print("Standalone clean-environment installation and tests completed.")
        if not args.deployment:
            print("Container execution, live service credentials, and desktop embedding are NOT verified.")


if __name__ == "__main__":
    main()
