"""Local visual fixture only: never publish this server or use production credentials."""
from pathlib import Path
import secrets
import shutil

from processors import configure_dwg_tools, configure_gdal_environment, configure_oda_converter
from server import create_server

# Prefer a drive with free space: E: (local GIS data), then D: repo, never rely on tiny C: TEMP.
_PREFERRED = Path(r"E:\gis-format-converter-preview")
_FALLBACK = Path(__file__).resolve().parent / "data-preview"
try:
    _PREFERRED.mkdir(parents=True, exist_ok=True)
    DATA_ROOT = _PREFERRED
except OSError:
    DATA_ROOT = _FALLBACK


def main():
    gdal = configure_gdal_environment()
    dwg = configure_dwg_tools()
    oda = configure_oda_converter()
    if DATA_ROOT.exists():
        shutil.rmtree(DATA_ROOT, ignore_errors=True)
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    ticket = secrets.token_hex(32)
    # Local fixture only: allow the same ticket to be redeemed again after refresh.
    def identity(value):
        if value != ticket:
            raise ValueError("Invalid local fixture ticket")
        return {"user_id": "local-visual-fixture"}
    app = create_server(DATA_ROOT, ("127.0.0.1", 3308), redeem_ticket=identity,
                        public_url="http://127.0.0.1:3308")
    print(f"LOCAL FIXTURE ONLY: http://127.0.0.1:3308/#ticket={ticket}", flush=True)
    print(f"data: {DATA_ROOT}", flush=True)
    print(f"ogr2ogr: {gdal or 'NOT FOUND'}", flush=True)
    print(f"dwg2dxf: {dwg or 'NOT FOUND'}", flush=True)
    print(f"ODA: {oda or 'NOT FOUND — DWG may fail without ODA/LibreDWG'}", flush=True)
    try:
        app.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.server_close()
        app.worker.close()


if __name__ == "__main__":
    main()
