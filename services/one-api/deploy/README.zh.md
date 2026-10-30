# 后台通用交付

[English](README.md) | 中文

同一版本、同一 CPU 架构的镜像用于互联网和各单位内网。程序启动时校验公开路径，并在不可变的前端脚本加载前向 HTML 注入配置，Nginx 不修改 JavaScript。[配置模板](.env.example)逐项说明交付变量；已有数据库、集成和能力策略变量继续追加在现场同一份 `.env` 中。

## 运行配置

| 变量 | 含义和默认值 |
| --- | --- |
| `DSH_ADMIN_PREFIX` | 管理页面路径，空或 `/` 表示根路径，例如 `/dsh-admin`，末尾不带斜杠。 |
| `DSH_API_PREFIX` | 浏览器及接口对外路径，默认根路径，例如 `/dsh-api`；`/api`、`/v1`、`/dashboard/billing`、`/downloads`、`/desktop-updates` 都挂在它下面。 |
| `DSH_PUBLIC_URL` | 完整接口对外地址，包含上述路径；通用工具要求填写。桌面端直接配置此地址，不额外加 `/v1`。 |
| `DSH_ADMIN_URL` | 可选的管理页面完整地址，用于管理页面与接口域名不同的情况；默认采用接口域名加管理前缀，路径必须与 `DSH_ADMIN_PREFIX` 一致。 |
| `DSH_ORG_PREFIX` | 独立企业管理端路径，默认 `/business`，容器内端口 3001。 |
| `CORS_ALLOW_ORIGINS` | 逗号分隔的来源，包含协议、域名及可选端口，不能包含路径；应包含独立管理页面和桌面端来源。留空沿用后台策略：public 模式允许来源，private 模式只允许内置桌面来源。 |
| `DSH_TRUSTED_PROXIES` | 最后一层代理的 IP/CIDR；未设置默认信任回环地址，明确设为空则全部不信任。该项控制转发客户端 IP 的识别，对外链接由完整地址配置生成，不采用转发的域名或前缀头。 |

管理前缀与接口前缀不能互相包含。完整 URL 的路径必须与对应前缀相同，前缀需要包含外层网关的所有路径段。配置变化后重建容器即可，不需要编译前端。明确配置的完整 URL 优先于数据库中的旧 `ServerAddress`；未配置时，认证链接沿用旧设置，更新下载链接使用直接请求地址。第三方完整 URL 保持原样。

## 独立安装

需要 Python 3.10+、带 Compose v2 的 Docker，以及已经加载且符合 `DSH_PLATFORM` 的镜像。测试使用独立目录和不同的项目名、端口、数据目录；工具不会自动发现或替换其他项目的容器。

```sh
python deploy.py init --image registry.example/one-api:VERSION-amd64
# Edit .env: public URL, paths, origins, proxy networks, database and integrations.
python deploy.py check
python deploy.py up
```

`init` 只生成一次随机会话密钥和渠道加密密钥，发现已有 `.env` 就拒绝覆盖。迁移已有数据库时必须保留现场原密钥。`check` 校验 Compose、必填密钥、公开路径、加密密钥格式及镜像架构，使用镜像的 `--check-deployment` 在无网络、无持久化挂载的临时容器中检查，不连接数据库。该操作不能验证数据库连通性、账号权限、证书或模型服务健康。`up` 仅使用本地镜像，通过 `--no-build --pull never` 启动；镜像需要先明确拉取或导入。

[Compose](compose.yaml) 将现场整个数据目录挂载到 `/data`，包含 SQLite、日志、桌面资源、签名更新包和官网安装包。外部数据库沿用原 DSN；若已有存储使用其他路径，首次启动前补充持久化挂载和对应环境变量。仅升级镜像时不要变更存储路径。业务库、账号库及上传文件均需分别备份。专家、MCP、Redis、RAGFlow 都属于可选集成，部署后台不要求现场存在这些服务。

## 反向代理

按现场情况修改 [Nginx 模板](nginx.conf.example)。模板保留完整前缀，`proxy_pass http://dsh_backend;` 末尾没有斜杠。根路径部署改为 `location /` 转发至该后端；企业管理端使用独立上游。主后台前方不能去除前缀；企业管理端同时兼容已有网关去除前缀的请求。

每层代理都需要保留带端口的外部 Host、查询参数及完整路径。终止 TLS 的网关设置 HTTPS 转发信息，内层代理只从可信上游保留这些信息，避免改成内部 HTTP 协议。明确配置 HTTPS 的 `DSH_PUBLIC_URL` 及代理 IP/CIDR，应用不从 `X-Forwarded-Prefix` 猜测对外前缀。流式响应关闭缓冲和缓存，资源隧道允许 WebSocket 升级，上传大小限制与安装包限制保持一致。网络放行、证书信任及外层网关策略仍是现场部署条件。

管理页面使用独立域名时填写 `DSH_ADMIN_URL`，两个域名分别转发对应路径，并将管理页面来源加入 CORS。HTTP 来源不能带 `/dsh-admin` 或 `/dsh-api` 路径。

## 一次构建，原样导出

通用构建入口只接受版本、架构及镜像标识，不接受单位域名或部署前缀。构建网络需要的镜像仓库、代理仍可通过 Dockerfile 已有基础设施参数调整。在独立环境构建和验证，正式服务升级另行安排。

```sh
python deploy.py build --image registry.example/one-api:VERSION-amd64 --version VERSION --platform linux/amd64
# Test the image in isolation; retain this exact image identity after Internet validation.
python deploy.py export --image registry.example/one-api:VERSION-amd64 --output one-api-VERSION-amd64.tar
sha256sum -c one-api-VERSION-amd64.tar.sha256
docker load --input one-api-VERSION-amd64.tar
```

ARM64 使用 `--platform linux/arm64` 和同版本的独立架构标签。导出生成镜像 tar、SHA256 文件及 JSON 身份清单，包含镜像 ID、仓库摘要、版本标签和架构；Windows 可用 `Get-FileHash -Algorithm SHA256` 校验 tar。交付脚本和模板时不要带入现场 `.env` 或数据，也不要针对环境重新构建镜像。`scripts/oneapi-release` 中的特定服务器发布流程保留其网络和专家检查，通用入口不依赖该流程。

## 升级与恢复

```sh
# Pull or load the approved candidate first, then back up databases, data and .env.
python deploy.py update --image registry.example/one-api:NEXT-amd64
# Program-only recovery, after checking database-schema compatibility:
python deploy.py rollback --image registry.example/one-api:PREVIOUS-amd64
```

两个操作都会先检查本地候选镜像，以私有权限备份 `.env`，只替换其中的 `DSH_IMAGE` 行，并使用原数据挂载重建同一个 Compose 服务，不用模板覆盖现场配置，也不删除卷。如果重建失败，原配置保存在 `.env.before-image-*`；修复失败原因或明确选择上一个镜像。恢复时不要使用 `docker compose down -v`。

容器恢复使用保留的配置、密钥、数据挂载和兼容镜像，不自动恢复数据库。数据库恢复需要单独执行：停止写入，恢复批准的业务库、账号库备份及对应文件和加密密钥，再启动结构兼容的镜像。回退程序不能撤销数据库迁移。SQLite 复制或恢复前先停止后台，同时处理 WAL/SHM 状态；外部数据库使用自身的备份、恢复及验证流程。

## 本地验证与限制

本地运行 `python -m unittest discover -s deploy`、Go 部署及控制器定向测试、管理端 `src/deployment.test.js`。生产前端构建使用 `PUBLIC_URL=.` 和空的 `REACT_APP_SERVER`，Docker 对两个管理端固定使用这些值。`go test . -run TestRuntimeDeploymentBuiltAssets` 检查实际嵌入的构建 HTML 和资源。`smoke-built-web.mjs` 使用 Playwright，在根路径和两组不同前缀下检查同一份前端构建及 mock 接口；Playwright 单独安装，本地工具可通过 `PLAYWRIGHT_MODULE`、`DSH_SMOKE_BROWSER` 指定模块和浏览器。

这些本地检查覆盖配置、URL 生成、产物资源、登录退出跳转、按需脚本和深链接刷新，不等于同镜像容器升级、真实桌面与模型流式问答、代理互通、上传持久化或数据库恢复验收。按用户要求，这类部署验收暂缓，开发及上述测试不调整稳定互联网服务。
