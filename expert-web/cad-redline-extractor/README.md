# Redline extraction

Standalone expert website: extract closed polylines from DWG/DXF and export GeoJSON and/or a Shapefile ZIP. Specify a layer, or auto-match layers whose names contain keywords such as “红线” or “REDLINE”. After a successful task, the result page supports local SHP/GeoJSON overlay, an optional online XYZ basemap, and solo display of a single geometry.

English | [中文](README.zh.md)

## Identity and ports

- Expert id: `cad-redline-extractor`
- Local port: `3309`
- Public entry: `http://ac.zjugis.com:3300/experts/cad-redline-extractor/`
- Session cookie: `expert_cad_redline_extractor_session`

## Local verification

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m unittest -v
node --test test_frontend.mjs test_prefix_paths.mjs
```

## Container deployment (4090)

```bash
cd /root/dsh-experts/cad-redline-extractor
if [ ! -f .env ]; then cp .env.example .env; fi
# Edit EXPERT_PROVIDER_CREDENTIAL (issued by the admin console for this expert)
docker compose -p wanwei-cad-redline-extractor build \
  --build-arg PYTHON_IMAGE=m.daocloud.io/docker.io/library/python:3.13-slim-bookworm \
  --build-arg PIP_INDEX_URL=https://repo.huaweicloud.com/repository/pypi/simple/ &&
docker compose -p wanwei-cad-redline-extractor up -d
```

When Nginx already routes by expert id, leave the gateway unchanged; see `nginx.location.conf.example`. Keep `.env` and data volumes on updates; do not run `down -v`.

## Result overlay visualization

On the result page you can upload a local Shape ZIP (or matching `.shp/.shx/.dbf`) / GeoJSON to overlay against the extraction result; the feature list supports selecting one geometry for solo display. Online services are configured in a dialog with **service URL** and **layer name** (optional CRS, default `EPSG:4326`). The server proxies a WMS GetMap or ArcGIS MapServer/export image and overlays it on the current map extent. The map’s top-right layer control toggles result / reference / online layers. Loopback and private network targets are rejected.

## Desktop expert catalog

- Stable id: `cad-redline-extractor`
- Workbench entry: `http://ac.zjugis.com:3300/experts/cad-redline-extractor/`
- Write the provider credential into this site's `.env` as `EXPERT_PROVIDER_CREDENTIAL`
