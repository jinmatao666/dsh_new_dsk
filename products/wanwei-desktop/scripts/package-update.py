"""Stream the explicit signed release files into an exclusively created ZIP."""
import os
from pathlib import Path
import sys
import zipfile


def package(manifest, source, filename, output):
    if Path(filename).name != filename or "/" in filename or "\\" in filename:
        raise ValueError("unsafe artifact filename")
    created = False
    try:
        with open(output, "xb") as target:
            created = True
            with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                archive.write(manifest, "release.json")
                archive.write(str(manifest) + ".sig", "release.json.sig")
                archive.write(source, filename)
    except BaseException:
        if created:
            os.unlink(output)
        raise


if __name__ == "__main__":
    package(*sys.argv[1:])
