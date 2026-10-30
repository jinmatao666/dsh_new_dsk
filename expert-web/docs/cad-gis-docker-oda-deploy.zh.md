# 红线提取 / GIS 格式转换 — Docker + ODA 部署说明

本文依据当前已验证流程整理，适用于 Linux 服务器 Docker 部署：

| 专家 | 目录名 | 端口 | Compose 项目名（示例） |
|------|--------|------|------------------------|
| 红线提取 | `cad-redline-extractor` | 3309 | `wanwei-cad-redline-extractor` |
| GIS 格式转换 | `gis-format-converter` | 3308 | `wanwei-gis-format-converter` |

公网入口示例：`http://ac.zjugis.com:3300/experts/<专家编号>/`

---

## 1. 背景说明

- 两专家均通过 **Docker** 运行；宿主机安装的 ODA **不会**自动进入容器。
- DWG 转换链路：LibreDWG → GDAL → **ODA File Converter**（新版 DWG 通常必须 ODA）。
- 容器内无桌面，ODA 需 **xvfb**；当前镜像用包装脚本：`xvfb-run -a /usr/bin/ODAFileConverter`。
- ODA 命令行 **audit 必须为 0**（关闭），否则图层会变成 `$TD_AUDIT_GENERATED_*`，红线自动匹配失败。
- ODA 导出的中文图层名可能是 `\M+5….` 编码；代码已解码，留空图层名可匹配「可建设用地范围线」等。

Windows Server 2016 及更旧环境上，宿主机直接跑官方 ODA（Qt6）常因系统/依赖失败；**推荐在 Linux Docker 镜像内安装 ODA**。

---

## 2. 准备文件

### 2.1 ODA 安装包（Linux deb）

从官网下载：

https://www.opendesign.com/guestfiles/oda_file_converter

选用：**DEB** — `ODAFileConverter_QT6_lnxX64_11dll_27.9.deb`（版本号以官网为准）

要求：x64，glibc ≥ 2.28。

### 2.2 开发机打包（Windows PowerShell）

在 `expert-web` 目录：

```powershell
cd D:\wbuddu\expert-web

tar -czf "$env:USERPROFILE\Desktop\wanwei-cad-redline-extractor-3309.tar.gz" `
  --exclude=.env --exclude=.git --exclude=.venv --exclude=__pycache__ `
  --exclude=node_modules --exclude=data --exclude=data-preview --exclude=*.deb `
  cad-redline-extractor

tar -czf "$env:USERPROFILE\Desktop\wanwei-gis-format-converter-3308.tar.gz" `
  --exclude=.env --exclude=.git --exclude=.venv --exclude=__pycache__ `
  --exclude=node_modules --exclude=data --exclude=data-preview --exclude=*.deb `
  gis-format-converter
```

说明：包内已含带 ODA 的 `Dockerfile`、`processors.py`（audit=0、图层解码）。`*.deb` 体积大，单独上传。

---

## 3. 服务器解压

将两个 tar.gz 与 deb 放到例如 `/root/dsh/packages/experts/`。

```bash
# 红线提取
mkdir -p /root/dsh-experts/cad-redline-extractor
tar -xzf /root/dsh/packages/experts/wanwei-cad-redline-extractor-3309.tar.gz \
  -C /root/dsh-experts/cad-redline-extractor \
  --strip-components=1

# GIS 格式转换
mkdir -p /root/dsh-experts/gis-format-converter
tar -xzf /root/dsh/packages/experts/wanwei-gis-format-converter-3308.tar.gz \
  -C /root/dsh-experts/gis-format-converter \
  --strip-components=1
```

覆盖解压一般可用；勿删服务器已有 `.env`。任务数据在 Docker volume，不在源码目录。

将 deb **分别**拷到两个专家目录（与 `Dockerfile` 同级）：

```bash
cp /root/dsh/packages/experts/ODAFileConverter_QT6_lnxX64_11dll_27.9.deb \
  /root/dsh-experts/cad-redline-extractor/

cp /root/dsh/packages/experts/ODAFileConverter_QT6_lnxX64_11dll_27.9.deb \
  /root/dsh-experts/gis-format-converter/

ls /root/dsh-experts/cad-redline-extractor/ODAFileConverter_QT6_lnxX64_11dll_27.9.deb
ls /root/dsh-experts/gis-format-converter/ODAFileConverter_QT6_lnxX64_11dll_27.9.deb
```

若 Dockerfile 中 deb 文件名与实际不一致，需改 `COPY` 文件名或重命名 deb。

---

## 4. 配置 .env

每个专家目录：

```bash
cd /root/dsh-experts/cad-redline-extractor
cp -n .env.example .env
# 编辑 .env

cd /root/dsh-experts/gis-format-converter
cp -n .env.example .env
# 编辑 .env
```

必填示例：

```env
EXPERT_PUBLIC_URL=http://ac.zjugis.com:3300
EXPERT_PLATFORM_REDEEM_URL=http://127.0.0.1:13300/api/expert-web/redeem
EXPERT_PROVIDER_CREDENTIAL=<管理员后台签发的凭据>
EXPERT_DATA_DIR=/data
EXPERT_RETENTION_DAYS=30
HOST=127.0.0.1
```

- 红线：`PORT=3309`
- GIS：`PORT=3308`

`ODA_FILE_CONVERTER` 已在镜像 `ENV` 中设为 `/usr/local/bin/ODAFileConverter`，一般无需再写。

---

## 5. 构建并启动（务必无缓存，避免前端不更新）

### 5.1 红线提取

```bash
cd /root/dsh-experts/cad-redline-extractor
docker compose -p wanwei-cad-redline-extractor build --no-cache
docker compose -p wanwei-cad-redline-extractor up -d --force-recreate
docker compose -p wanwei-cad-redline-extractor ps
docker compose -p wanwei-cad-redline-extractor exec expert grep -n "删除记录" web/app.js
```

### 5.2 GIS 格式转换

```bash
cd /root/dsh-experts/gis-format-converter
docker compose -p wanwei-gis-format-converter build --no-cache
docker compose -p wanwei-gis-format-converter up -d --force-recreate
docker compose -p wanwei-gis-format-converter ps
docker compose -p wanwei-gis-format-converter exec expert grep -n "删除记录" web/app.js
```

浏览器 **Ctrl+F5** 强刷。只解压不 `build`，容器仍是旧镜像（常见「本地有删除按钮、服务器没有」）。

---

## 6. Nginx 反代（若尚未配置）

红线（参考 `nginx.location.conf.example`）：

```nginx
location /experts/cad-redline-extractor/ {
    client_max_body_size 80m;
    proxy_pass http://127.0.0.1:3309/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 190s;
    proxy_cookie_path / /experts/cad-redline-extractor/;
}
```

GIS 格式转换：路径改为 `/experts/gis-format-converter/`，`proxy_pass` 改为 `http://127.0.0.1:3308/`，cookie path 同步修改。

---

## 7. 验证

1. 打开专家页，从桌面专家库带 ticket 进入（或按平台流程登录）。
2. 上传较小 **DWG**，红线提取时图层名可留空。
3. 成功时应得到 GeoJSON/SHP；图层显示中文名（如「可建设用地范围线」），而非 `\M+…`。
4. 「处理记录」中已完成任务可见 **删除**；详情页有 **删除记录**；处理中仅有 **取消**。

---

## 8. 日常更新

```bash
# 开发机重新打包 → 上传 tar.gz → 解压覆盖 → 确认 deb 仍在 → 无缓存 build + up
cd /root/dsh-experts/cad-redline-extractor
tar -xzf /root/dsh/packages/experts/wanwei-cad-redline-extractor-3309.tar.gz \
  -C . --strip-components=1
# 保留 .env；确认 deb 还在
docker compose -p wanwei-cad-redline-extractor build --no-cache
docker compose -p wanwei-cad-redline-extractor up -d --force-recreate
```

GIS 同理，替换目录与 `-p` 名称。

---

## 9. 故障排查

| 现象 | 处理 |
|------|------|
| GDAL `libopencad` 不支持版本 | 正常，会继续走 ODA；可忽略单独出现的该提示 |
| `xvfb-run: xauth command not found` | Dockerfile 需含 `xauth`，重建镜像 |
| `libOpenGL.so.0` 缺失 | Dockerfile 需含 `libopengl0` 等，重建 |
| Qt `libxcb-cursor0` / xcb plugin | Dockerfile 需含 `libxcb-cursor0` 等，重建 |
| `$TD_AUDIT_GENERATED_*`、匹配不到红线 | 确认 `processors.py` 中 ODA 最后参数为 `0`（关闭 audit） |
| `\M+5…` 图层、留空提不到 | 确认已部署含 `decode_cad_layer_name` 的 `processors.py` |
| 本地有「删除」、服务器没有 | 解压后必须 `build --no-cache` + `up -d --force-recreate`，再 Ctrl+F5 |
| 处理超过约 10 分钟仍 95% | 假进度；可取消；大图建议 CAD 另存 DXF；查容器内是否卡死 ODA |
| 宿主机装 ODA，Docker 专家仍无 ODA | 预期行为；ODA 必须打进镜像 |

查看日志：

```bash
docker compose -p wanwei-cad-redline-extractor logs --tail 100
docker compose -p wanwei-gis-format-converter logs --tail 100
```

---

## 10. 宿主机 ODA（可选）

Docker 方案下宿主机 deb **可不装 / 可卸载**，与容器互不影响。若曾在宿主机 `apt install ./xxx.deb`，卸载：

```bash
dpkg -l | grep -i oda
sudo apt remove -y <包名>
```

---

## 11. 清单速查

- [ ] 两个 tar.gz 已解压到 `/root/dsh-experts/...`
- [ ] 两个目录均有同名 ODA `.deb`
- [ ] `.env` 凭据与端口正确（3309 / 3308）
- [ ] `build --no-cache` + `up -d --force-recreate`
- [ ] 容器内 `grep 删除记录 web/app.js` 有结果
- [ ] Nginx 已反代
- [ ] 浏览器强刷后 DWG 试提成功

文档版本：与 2026-10-30 实测 Docker + ODA QT6 27.9 流程一致。
