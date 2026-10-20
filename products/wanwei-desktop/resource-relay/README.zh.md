# 内网资源

[English](README.md) | 中文

## 概述

管理员在 OneAPI 系统设置 → 网络设置中选择离线 Python wheel 依赖包或联网中转。中转可通过带认证的后台通道，或单独部署的 HTTP 正向代理接入。两种方式都需要更新后台和桌面端。资源方式不会改写模型、登录及专家服务地址。

## 离线依赖包

后台接收根目录包含 wheel 文件的 ZIP，最大 512 MiB、2,000 个条目。需包含间接依赖，并匹配桌面 Python 版本、操作系统和架构。此包不提供仅源码发布的包、原生应用、字体或 npm 包。

打包脚本下载二进制依赖，拒绝覆盖已有输出。以下命令已用通用 wheel 实测：

```powershell
python products/wanwei-desktop/resource-relay/build-offline-python.py --output E:/code/dsh_newversion/delivery/resource-test-six-20261019.zip six==1.17.0
```

正式使用时换一个输出文件名，并填写实际需要的包。跨平台参数为 `--platform`、`--python-version` 和 `--abi`；选择参数前先检查桌面实际使用的 Python。将 ZIP 上传到“离线依赖包”，再保存资源方式。上传会立即替换共享资源包；取消设置不会撤销上传。

OneAPI 将资源包存放在 `/data/desktop-resources`，或 `DESKTOP_RESOURCE_DIR`。必须持久化此目录。旧的按内容寻址资源包会保留供进行中的下载使用；运维负责磁盘容量监控和保留策略。依赖下载在服务内公开，所以只上传依赖制品，不上传客户私密文件。

## 复用现有入口的托管通道

选择内网 → 联网中转 → 复用后台入口，地址留空使用登录后台，强制中转测试时关闭自动检测。填写地址时须与登录后台同源，不会向其他来源发送登录凭证。独立资源服务器可由同一公网网关转发接入。桌面端内置仅监听回环地址的 HTTP 代理，将 HTTP/CONNECT 流量通过 WebSocket 发送到 `/api/desktop-resources/tunnel`。OneAPI 提供认证后的 TCP 中转，不需要 Squid 或新增公网端口。

网关须在该精确路径转发 WebSocket Upgrade 头，路由片段为 `gateway-tunnel.location.conf`。发布运维先通过 `docker inspect dsh-experts-gateway --format '{{json .Mounts}}'` 确认宿主机主配置文件的真实路径。以下命令由运维在服务器执行，本 Windows 环境未运行：`bash update-gateway.sh check /absolute/host/nginx.conf ac.zjugis.com` 生成私有候选文件；`bash update-gateway.sh apply /absolute/host/nginx.conf ac.zjugis.com` 备份原文件、验证挂载和配置、重载 Nginx，并检查后台和六个专家服务，失败则恢复原配置。可将输出的备份目录传给 `bash update-gateway.sh rollback /root/dsh-gateway-tunnel.XXXXXXXX` 回退。Python 辅助脚本和路由片段须与 sh 放在同一目录，不重启容器。

中转只连接公网目标的 80/443 端口，校验 DNS 全部结果，并固定实际连接的 IP。拒绝带浏览器 Origin 的握手和未认证连接。部署限制为 `DSH_RELAY_CONNECTIONS`（64）、`DSH_RELAY_PER_USER`（8）、`DSH_RELAY_BYTES`（单连接双向合计 1 GiB）、`DSH_RELAY_IDLE_SECONDS`（90）及 `DSH_RELAY_LIFETIME_SECONDS`（3600），配置非法时拒绝新通道。日志只记录用户 ID、目标主机/端口及字节数，不记录请求正文或认证头。

通道不增加额外加密。HTTPS 目标保持端到端 TLS 和证书校验，HTTP 目标为明文。公网 HTTP/WS 入口会向网络旁观者及主动攻击者暴露中转认证信息和连接信息，身份校验不能消除该风险。不进行内容分类或网站名单限制。可选直连主机最多 32 个，只填单个 IP 或 DNS 名称，不含协议、路径或端口；本机及平台主机默认包含，实际绕过行为取决于子进程对 NO_PROXY 的支持。切换来源会关闭既有托管中转连接，已有进程仍可能保留原环境变量，需要重新启动。

## 正向代理

服务器必须运行正向代理服务，不能只提供 IP。本目录提供 Squid 配置及部署脚本，只允许指定客户端网段访问公网目标的 80/443 端口，不解密 HTTPS。还需限制主机防火墙。禁止将无认证的代理暴露到公网。首版不接收内嵌代理账号密码。

以下由服务器管理员验收，本 Windows 机器没有 Docker，尚未验证：修改 `squid.conf` 中的 `clients` 网段，然后执行 `bash deploy.sh <服务器内网IPv4> <已批准的镜像引用>`。脚本先校验配置再启动，拒绝替换已有容器。生产环境固定已批准的镜像摘要。验证允许的桌面能下载 HTTPS 资源、未授权机器被拒绝，并查看 `docker logs wanwei-resource-relay`。此服务器可与 OneAPI 分开部署。

系统设置填写 `http://<服务器内网IPv4>:3128`。关闭自动检测时，遵循代理的子进程命令直接使用中转。开启时，由桌面端并发检查所有 HTTPS 204 地址，单次超时 2.5 秒。全部通过才直连，否则使用中转。结果缓存 60 秒。单个目标网站访问失败不会切换资源方式，也不代表整体断网。

## 桌面验收

保存后停止旧任务并新建会话。认证、窗口聚焦以及 Shell 命令执行前会刷新配置，Shell 刷新缓存一分钟。刷新失败时拒绝启动新的 Shell 命令。已运行进程保留原环境。

1. 离线：上传 six 测试包，选择离线并保存。让智能体执行 `python -m pip download six==1.17.0 --no-deps -d resource-check`。即使公网被阻断，wheel 也应来自后台。检查后只删除测试生成的文件。
2. 离线缺包：请求包中不存在的依赖。应报告依赖不可用，不能换源或使用中转。
3. 强制中转：选择中转并关闭自动检测。重复依赖下载及 Python HTTP(S) 资源下载；确认中转日志中有请求，且没有读取 wheel 依赖库。
4. 自动检测：分别在允许和阻断公网的情况下测试。切换后等待 60 秒让检测缓存过期。前者应直连，后者应使用中转。门户登录页或重定向不能视为成功。
5. 切回外网：确认登录及模型服务正常，新的子进程不再使用内网资源变量。

上述安装版设备测试由发布运维负责。本地自动测试覆盖配置、ZIP 校验、真实离线 pip 安装、Python 经过测试中转下载、路由切换及 Loader 组装的提示词快照。本地互操作冒烟还使用实际 TypeScript 桥接和 Go 中转：Python HTTPS 访问成功，pip 禁用缓存后从 PyPI 下载 six 1.17.0，中转记录了两个目标主机。生产网关部署、Squid 和签名安装包仍需发布验收。

## 限制

这是进程环境变量路由，不是防火墙或 VPN。覆盖 pip 和标准 Python 中遵循代理的下载。原生 PowerShell 请求、Node fetch、浏览器、自定义客户端及已有终端会话可能不读取这些变量。公网搜索和链接限制仍独立生效。禁止通过关闭 TLS 校验让代理工作。
