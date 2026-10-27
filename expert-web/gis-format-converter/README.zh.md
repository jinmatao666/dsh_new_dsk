# GIS 格式转换

独立专家网站：支持 .gdb / .shp / .mdb（mdb 仅作输入）互转，以及 DWG→DXF。Shapefile 与 FileGDB 请打成 ZIP 上传。

[English](README.md) | 中文

## 编号与端口

- 专家编号：`gis-format-converter`
- 本机端口：`3308`
- 公网入口：`http://ac.zjugis.com:3300/experts/gis-format-converter/`
- 会话 Cookie：`expert_gis_format_converter_session`

## 本地验证

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m unittest -v
node --test test_frontend.mjs test_prefix_paths.mjs
```

## 容器部署（4090）

```bash
cd /root/dsh-experts/gis-format-converter
if [ ! -f .env ]; then cp .env.example .env; fi
# Edit EXPERT_PROVIDER_CREDENTIAL (issued by the admin console for this expert)
docker compose -p wanwei-gis-format-converter build \
  --build-arg PYTHON_IMAGE=m.daocloud.io/docker.io/library/python:3.13-slim-bookworm \
  --build-arg PIP_INDEX_URL=https://repo.huaweicloud.com/repository/pypi/simple/ &&
docker compose -p wanwei-gis-format-converter up -d
```

Nginx 已按编号转发时无需改网关；参考 `nginx.location.conf.example`。更新时保留 `.env` 与数据卷，不要 `down -v`。

## 上架桌面专家库

- 稳定 ID：`gis-format-converter`
- 工作台入口：`http://ac.zjugis.com:3300/experts/gis-format-converter/`
- 提供方凭据写入本站 `.env` 的 `EXPERT_PROVIDER_CREDENTIAL`
