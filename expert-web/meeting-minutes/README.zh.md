# 会议纪要专家（开发中）

任务轮询仅在首次返回或任务数据变化时重绘页面；准备表单打开期间只更新缓存，不替换当前表单。较早请求的响应不能覆盖较新成功请求的数据；手动结果刷新使用相同的顺序保护。

[English](README.md) | 中文

任务、预览或成果请求返回 HTTP 401 时，工作台锁定并清除任务和材料缓存；迟到响应不能恢复页面。下载过程中登录失效会取消成果读取，不再调用原生保存。需关闭 Tab，从桌面专家库重新打开以交换新票据；这些前端检查不撤销提供方已经接收的任务。

模型材料名称和 Word 报告来源列表使用上传原名。读取文件和音频处理使用内部编号路径，不使用展示名称。没有原名的任务保留其存储名称；来源名称列表无效时拒绝生成文档。

普通 `compose.yml` 固定容器监听端口，使其与仅绑定本机的端口映射一致；修改 `.env` 中的 `PORT` 不会改变该配置的端口。如需其他本机代理端口，修改 `ports` 的宿主机端口；公网 HTTP/HTTPS 地址通过 `EXPERT_PUBLIC_URL` 配置。

### 同机 Xinference 语音模型（Linux）

构建下载默认使用 DaoCloud 的 Python 镜像代理和清华 TUNA 的 Debian/PyPI 镜像。Docker 构建参数 `PYTHON_IMAGE`、`DEBIAN_MIRROR`、`PIP_INDEX_URL` 可覆盖它们，不修改宿主机 Docker、apt 或 pip 的全局配置。保留 Debian 发行版/签名检查和 HTTPS 证书检查；安全更新镜像可能滞后。Python 依赖仍固定版本，依赖安装层位于业务代码之前以复用缓存。下载速度和包的可用性取决于部署网络。替换 Dockerfile 前先停止正在运行的构建；保留 `.env`、Compose 项目名称和数据卷。

同机模板的文本模型已设置为 `http://127.0.0.1:20330/v1/chat/completions`，UID 为 `qwen3.8-27b-fp8`。本机未启用认证时文本与语音密钥均可留空。专用 Compose 从 `.env` 的 `PORT` 读取网页端口，默认 `3301`；该模板不使用普通 Compose 的固定 `4303` 端口。以下同机部署探针应访问 `3301`。

如果服务器本机 `127.0.0.1:20330` 运行 Xinference、模型 UID 为 `Qwen3-ASR-1.7B`，使用 `.env.xinference-local.example` 作为 `.env` 模板。模板已填入公网地址 `http://ac.zjugis.com:3301`、核验地址 `http://ac.zjugis.com:3300/api/expert-web/redeem` 和两种本机模型接口。提供方凭据需填写后台新建或重置时仅显示一次的值。已有包含密钥的 `.env` 不要覆盖，直接修改对应配置。本机 Xinference 无认证时模型密钥可留空；启用了认证则填真实密钥，不要提交 `.env`。

这个场景使用 `compose.local-xinference.yml`：Linux host network 使容器访问同机回环 Xinference，网页默认只监听 `127.0.0.1:3301`，由 HTTP/HTTPS 反向代理或 SSH 转发访问。只有路由端口映射不能访问回环监听，需宿主机代理配合。普通桥接配置不能访问宿主机回环接口。执行下面的配置与健康检查后，还需实际提交录音；就绪探针不测试真实模型。不要把无认证的 Xinference 暴露到公网。更新时保持相同 Compose 项目名称，以保留命名数据卷；不要执行 `down -v`。

```bash
cp .env.xinference-local.example .env
chmod 600 .env
docker compose -f compose.local-xinference.yml config -q
docker compose -f compose.local-xinference.yml up --build -d
docker compose -f compose.local-xinference.yml exec -T meeting python deployment.py
curl -fsS http://127.0.0.1:3301/healthz
curl -fsS http://127.0.0.1:3301/readyz
```

`/readyz` 仅检查配置，不证明 Xinference 可达或模型可以转写。实际录音任务仍须联调；纪要文本生成还需要单独配置 `EXPERT_MODEL_*`。如果 Xinference 不在同一台 Linux 主机上，不要套用此模板或把无认证的 `20330` 暴露到公网。

## 独立迁出验证

网站、后台登记和已更新桌面端均支持 HTTP。批准来源仍区分协议、域名和端口，票据核验拒绝重定向。HTTP 会明文传输票据、提供方凭据、会话 Cookie 和上传数据；这些检查不能消除窃听或篡改风险，仍建议 HTTPS。从只支持 HTTPS 的代码升级时，除网站外还需重新构建 OneAPI 镜像和桌面安装包。重部署先修改已有 `.env`，执行上述相同 Compose 命令，再在后台登记准确的公网工作台地址。SSH 测试时登记地址必须与桌面实际可访问地址一致；只建立本地隧道不会使公网地址自动可达。

运维可执行 `python deployment.py` 检查配置和本地处理依赖；只输出检查名及通过状态，不打印密钥或接口地址。`/healthz` 验证 HTTP 与数据库可用，`/readyz` 检查所有已提供功能的必要配置，未配置返回 503；后者不是远程服务真实连通性测试。Dockerfile 配置了存活检查。

在已更新的桌面专家 Tab 中，成果下载通过 `save_expert_artifact` 原生接口写入用户下载目录，最大 128 MB，不接受本机路径且不覆盖同名文件；普通浏览器继续使用浏览器下载。此链路有前端字节转发和原生文件保存测试，但三平台实际点击下载仍待验收。

在本目录执行 `python verify_portability.py`。脚本只复制本专家目录到临时位置，排除本地数据和凭据，再创建全新虚拟环境、安装自身依赖并执行 Python/Node 测试，不读取 DSH 根目录或其他专家代码。Node.js 需要已安装。

`python verify_portability.py --deployment` 还要求 Docker Compose 配置校验和镜像构建；缺少 Docker 会明确失败，不将未执行的部署检查算作通过。容器实际启动、HTTPS、真实业务接口和桌面同窗联调仍须在目标环境验收。

工作台已接入自有旧版图标和背景，任务列表可打开详情，成果文件独立汇总。原始文件名仅保存为任务元数据；服务器上传路径始终使用内部编号。已有数据库会自动增加文件名字段，不复写旧记录；历史记录没有原名时显示原存储名称。视觉逐状态验收仍未完成。

独立网页、HTTP 服务、SQLite 会话和任务、录音标准化/转写、模型纪要生成、最终 Word 下载均位于本项目。没有 DSH、OneAPI 或其他专家的源码依赖。模型真实接入、容器实跑、旧版资源与逐状态视觉对照尚未完成，不可正式上架。

一次任务支持最多一个 WAV/MP3/M4A 录音及多份 DOCX/PDF/Excel/UTF-8 文字材料；也可仅提交文字材料。最多 30 文件、合计 100 MB；录音最大 60 分钟，标准化为单声道 16 kHz PCM WAV，按 120 秒分段转写。材料/转写合计最多 6 万字符，超过时拒绝而不是截断。转写失败不发布部分纪要。任务只发布最终 `会议纪要.docx`；临时标准化与分段录音处理后删除，不发布中间文本。

会议名称可留空。纪要模型必须保留未明确字段和原文相对日期，不得补造事实；用户仍须复核数字、决策、责任人与时间。Word 包含会议基本信息表、行动项表与中文样式。任务默认保留 30 天，按服务启动或新任务提交清理过期终态任务。

任务成功后，详情页可通过仅归属用户可访问、限制长度的摘要接口展示模型实际生成的纪要正文。这是私有预览，不是第二份发布成果；下载列表仍只有最终 Word 文件，预览也不能代替核对 Word 内容。

## 运行与验证

任务详情沿用旧版紧凑状态条、摘要／成果列和来源信息列。摘要预览识别标题、项目／编号列表和竖线表格，所有文字均转义；表格只在自身容器中滚动，窄窗口将来源信息排到摘要下方。任务归本独立服务器管理，因此浏览器下载替代旧版本地目录操作；这些差异说明不代表完整旧版视觉验收通过。

身份交换只接受对象，且其中 `user_id` 必须是非空、最多 180 字符的字符串。平台返回无效身份时不创建会话，返回 401。会话八小时后过期；过期或伪造 Cookie 不能读取或提交任务。重新交换身份签发不同 Cookie，不会恢复过期 Cookie。

Python 3.13，安装 requirements.txt 后执行 `python -m unittest -v test_minutes test_server`。音频测试实际调用 FFmpeg，但转写与纪要正文使用明确注入的测试替身，不能证明真实模型质量。缺少模型配置的 HTTP 任务明确失败，不生成演示成果。

服务由进程管理器注入 `.env.example` 所列配置后运行 `python server.py`，不自动加载 `.env`。纪要模型使用 HTTPS chat completions 或上述同机 HTTP Xinference 接口；ASR 可选 multipart 音频转写接口或 dashscope 原生协议，必须显式设置 endpoint 和 model。远程 HTTPS ASR 必须配置 key；仅上述同机回环 Xinference 无认证时可留空。所有密钥仅服务端持有；FFmpeg 子进程不继承模型或平台凭据。

容器部署使用独立 Dockerfile/compose.yml，把示例复制为 `.env` 并配置后执行 `docker compose up --build -d`。默认端口 4303 仅绑定本机，使用 nginx.conf.example HTTPS 代理；本机未安装 Docker，尚未构建实跑。任务最长 3600 秒；超时时回收整个转换进程组。运维须配置磁盘容量、速率限制、备份并审核镜像 digest，不得多实例同时打开同一数据目录。

取消任务现在会停止本地工作进程树，也不会发布部分纪要；远程 ASR 或模型已接收的请求仍可能继续在服务端运行。尚缺：真实 ASR/纪要模型端到端任务、中文 Word 渲染核验、旧版图标/背景和专用工作台逐页对照、用户存储配额和三平台桌面 Tab 联调。
左栏四个导航图标是旧版专家原始 PNG 的本站独立副本。使用说明采用顶部介绍和四张步骤卡片，保留本专家的输入限制与复核要求；运行时不引用其他专家的资源或样式。
