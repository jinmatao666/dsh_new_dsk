# 坐标转换

独立专家网站：上传 CSV/TXT 坐标表，支持 EPSG 投影转换、平面四参数、空间七参数；输出带 *_out 字段的 CSV。

[English](README.md) | 中文

## 编号与端口

- 专家编号：`coordinate-transform`
- 本机端口：`3307`
- 公网入口：`http://ac.zjugis.com:3300/experts/coordinate-transform/`
- 会话 Cookie：`expert_coordinate_transform_session`

## 本地验证

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m unittest -v
node --test test_frontend.mjs test_prefix_paths.mjs
```

## 容器部署（4090）

```bash
cd /root/dsh-experts/coordinate-transform
if [ ! -f .env ]; then cp .env.example .env; fi
# Edit EXPERT_PROVIDER_CREDENTIAL (issued by the admin console for this expert)
docker compose -p wanwei-coordinate-transform build \
  --build-arg PYTHON_IMAGE=m.daocloud.io/docker.io/library/python:3.13-slim-bookworm \
  --build-arg PIP_INDEX_URL=https://repo.huaweicloud.com/repository/pypi/simple/ &&
docker compose -p wanwei-coordinate-transform up -d
```

Nginx 已按编号转发时无需改网关；参考 `nginx.location.conf.example`。更新时保留 `.env` 与数据卷，不要 `down -v`。

## 上架桌面专家库

- 稳定 ID：`coordinate-transform`
- 工作台入口：`http://ac.zjugis.com:3300/experts/coordinate-transform/`
- 提供方凭据写入本站 `.env` 的 `EXPERT_PROVIDER_CREDENTIAL`
