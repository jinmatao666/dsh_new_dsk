"""Local deployment checks. No credentials, URL values, or user records are printed."""
import os
from pathlib import Path
import shutil
from urllib.parse import urlsplit


def valid_url(value, internal=False, origin=False):
    try:
        parsed = urlsplit(value)
        parsed.port
        if parsed.scheme not in (("http", "https") if internal else ("https",)):
            return False
        if not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.query:
            return False
        if parsed.hostname.endswith(".example.com") or parsed.hostname == "example.com":
            return False
        return not origin or parsed.path in ("", "/")
    except ValueError:
        return False


def configured(name):
    value = os.environ.get(name, "").strip()
    return bool(value) and not value.startswith("replace-with-")


def executable(variable, fallback):
    explicit = os.environ.get(variable)
    if explicit:
        path = Path(explicit)
        return path.is_file() and os.access(path, os.X_OK)
    return bool(shutil.which(fallback))


def checks():
    result = {
        "public_origin": valid_url(os.environ.get("EXPERT_PUBLIC_URL", ""), internal=True, origin=True),
        "identity_endpoint": valid_url(os.environ.get("EXPERT_PLATFORM_REDEEM_URL", ""), internal=True),
        "provider_credential": configured("EXPERT_PROVIDER_CREDENTIAL"),
        "gdal": bool(shutil.which("ogr2ogr")),
    }
    # GDAL is optional for DXF-only redline workflows; DWG conversion is recommended but not required for readyz.
    result["dwg_converter"] = executable("DWG2DXF_BIN", "dwg2dxf") or bool(shutil.which("ODAFileConverter"))
    return result


def ready():
    required = ("public_origin", "identity_endpoint", "provider_credential")
    return all(checks()[name] for name in required)


if __name__ == "__main__":
    results = checks()
    for name, passed in results.items():
        print(f"{name}: {'OK' if passed else 'NOT READY'}")
    print("These are local configuration checks, not proof of live remote service access.")
    raise SystemExit(0 if ready() else 1)
