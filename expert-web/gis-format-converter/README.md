# GIS format conversion

Standalone expert website: convert among `.gdb` / `.shp` / `.mdb` (`.mdb` is input-only) and DWG→DXF. Package Shapefile and FileGDB as ZIP before upload.

English | [中文](README.zh.md)

## Identity and ports

- Expert id: `gis-format-converter`
- Local port: `3308`
- Public entry: `http://ac.zjugis.com:3300/experts/gis-format-converter/`
- Session cookie: `expert_gis_format_converter_session`

## Local verification

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m unittest -v
node --test test_frontend.mjs test_prefix_paths.mjs
```

## Container deployment (4090)

```bash
cd /root/dsh-experts/gis-format-converter
if [ ! -f .env ]; then cp .env.example .env; fi
# Edit EXPERT_PROVIDER_CREDENTIAL (issued by the admin console for this expert)
docker compose -p wanwei-gis-format-converter build \
  --build-arg PYTHON_IMAGE=m.daocloud.io/docker.io/library/python:3.13-slim-bookworm \
  --build-arg PIP_INDEX_URL=https://repo.huaweicloud.com/repository/pypi/simple/ &&
docker compose -p wanwei-gis-format-converter up -d
```

When Nginx already routes by expert id, leave the gateway unchanged; see `nginx.location.conf.example`. Keep `.env` and data volumes on updates; do not run `down -v`.

## Desktop expert catalog

- Stable id: `gis-format-converter`
- Workbench entry: `http://ac.zjugis.com:3300/experts/gis-format-converter/`
- Write the provider credential into this site's `.env` as `EXPERT_PROVIDER_CREDENTIAL`
