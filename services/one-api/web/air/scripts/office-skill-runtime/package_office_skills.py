"""Create standalone folders and ZIP archives for the ten office demo skills."""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import zipfile
from pathlib import Path


SLUGS = (
    "office-word-to-pdf",
    "office-pdf-organizer",
    "office-pdf-to-images",
    "office-images-to-pdf",
    "office-excel-data-cleaner",
    "office-document-compare",
    "office-document-summary",
    "office-batch-rename",
    "office-image-optimizer",
    "office-meeting-minutes",
)
MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_FILES = 200


def main() -> int:
    repository = Path(__file__).resolve().parents[6]
    skills_root = repository / "services" / "one-api" / "web" / "air" / "public" / "skills"
    output_root = repository / "outputs" / "office-demo-skills"
    folders_root = output_root / "folders"
    archives_root = output_root / "zips"
    if output_root.exists():
        shutil.rmtree(output_root)
    folders_root.mkdir(parents=True)
    archives_root.mkdir(parents=True)

    checksums = []
    for slug in SLUGS:
        source = skills_root / slug
        manifest = json.loads((source / "manifest.json").read_text(encoding="utf-8"))
        declared = set(manifest["files"])
        actual = {
            path.relative_to(source).as_posix()
            for path in source.rglob("*")
            if path.is_file()
        }
        if declared != actual:
            raise RuntimeError(f"{slug}: manifest 文件清单与实际文件不一致：{sorted(declared ^ actual)}")
        if len(actual) > MAX_FILES:
            raise RuntimeError(f"{slug}: 文件数量超过 {MAX_FILES}")
        for relative in actual:
            if (source / relative).stat().st_size > MAX_FILE_BYTES:
                raise RuntimeError(f"{slug}: 单文件超过 5MB：{relative}")

        destination = folders_root / slug
        shutil.copytree(source, destination)
        archive = archives_root / f"{slug}-{manifest['version']}.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for relative in sorted(actual):
                bundle.write(source / relative, arcname=f"{slug}/{relative}")
        if archive.stat().st_size > MAX_ARCHIVE_BYTES:
            raise RuntimeError(f"{slug}: ZIP 超过 10MB")
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        checksums.append(f"{digest}  {archive.name}")

    (output_root / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="utf-8")
    print(f"Created {len(SLUGS)} folders and {len(SLUGS)} ZIP archives in {output_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
