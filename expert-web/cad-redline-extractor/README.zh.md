# 红线提取

独立专家网站：从 DWG/DXF 提取闭合多段线，导出 GeoJSON 和/或 Shapefile ZIP。可指定图层，或自动匹配含“红线/REDLINE”等关键字的图层。任务成功后支持本地 SHP/GeoJSON 套合、可选在线 XYZ 底图，以及单要素单独展示。

[English](README.md) | 中文

## 编号与端口

- 专家编号：`cad-redline-extractor`
- 本机端口：`3309`
- 公网入口：`http://ac.zjugis.com:3300/experts/cad-redline-extractor/`
- 会话 Cookie：`expert_cad_redline_extractor_session`

## 本地验证

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m unittest -v
node --test test_frontend.mjs test_prefix_paths.mjs
```

## 容器部署（4090）

```bash
cd /root/dsh-experts/cad-redline-extractor
if [ ! -f .env ]; then cp .env.example .env; fi
# Edit EXPERT_PROVIDER_CREDENTIAL (issued by the admin console for this expert)
docker compose -p wanwei-cad-redline-extractor build \
  --build-arg PYTHON_IMAGE=m.daocloud.io/docker.io/library/python:3.13-slim-bookworm \
  --build-arg PIP_INDEX_URL=https://repo.huaweicloud.com/repository/pypi/simple/ &&
docker compose -p wanwei-cad-redline-extractor up -d
```

Nginx 已按编号转发时无需改网关；参考 `nginx.location.conf.example`。更新时保留 `.env` 与数据卷，不要 `down -v`。

## 成果展示

结果页可上传本地 Shape ZIP（或同名 `.shp/.shx/.dbf`）/ GeoJSON 与提取成果套合；几何列表支持选中后单独展示。在线服务通过弹框填写 **服务地址** 与 **图层名称**（可选坐标参考，默认 `EPSG:4326`）后保存；服务端代理拉取 WMS GetMap 或 ArcGIS MapServer/export 图像，再套合到当前图范围。地图右上角可开关「提取成果 / 套合参考 / 在线服务」图层。内网与回环地址不可作为在线服务目标。

## 上架桌面专家库

- 稳定 ID：`cad-redline-extractor`
- 工作台入口：`http://ac.zjugis.com:3300/experts/cad-redline-extractor/`
- 提供方凭据写入本站 `.env` 的 `EXPERT_PROVIDER_CREDENTIAL`
