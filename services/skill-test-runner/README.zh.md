# Skill 审核沙箱

[English](README.md) | 中文

本文参考说明介绍可信沙箱管理服务及其临时 Linux 执行容器。[后台审核 API](../one-api/controller/skill_test_session.go) 负责模型调用、审核人权限、上传快照和 transcript（文本记录）。管理服务没有模型凭据，也不在自己的进程中执行上传脚本。

## 生命周期与安全

明确点击“新建测试”后，每个审核会话创建一个容器。多轮问答复用该容器；结束、停止、触发执行限制或达到配置时限后删除容器。关闭浏览器会停止轮询，但不立即终止执行；独立管理服务仍执行到期清理。只有待审核的公开投稿可以新建测试或继续问答。上传内容发生变化后，已有快照失效。测试不修改已通过 skill（技能）、发布流程和正式使用事件。

执行容器使用 UID 65532，无网络、生产目录挂载和 Docker socket，根文件系统只读，移除 capabilities，并限制 CPU、内存和进程数量。上传的 skill 文件归 root 所有且只读；带 sticky 标记的工作目录阻止替换这些文件。输入与输出目录可写。文件访问拒绝路径穿越和符号链接。Shell 命令可以检查执行镜像，但不能通过挂载文件访问生产目录或凭据。

管理服务挂载宿主 Docker socket，因此拥有宿主级权限。其 API 由部署管理员配置，使用 bearer 认证，不发布宿主端口。上传代码既拿不到 socket，也拿不到该认证密钥。Docker 共享宿主内核；这不能防御容器或内核漏洞。接收高度不可信代码时，建议使用独立 Docker 主机或 daemon。仅从可信来源构建运行时镜像。

管理服务最多保留 output 根目录中的20个普通文件，单个不超过20 MB，总计不超过80 MB。不导出嵌套输出目录。产物在 named volume 中保留到指定期限；输入和过程文件随容器删除。数据库审核快照与文本记录采用独立的数据库保留策略。管理服务重启时清除具有精确托管标签的容器，但无法恢复其中的 tmpfs 内容。不要让两个管理服务同时操作同一个 Docker daemon。

## 配置

将 [.env.example](.env.example) 复制为私有 `.env`，把密钥替换为至少32个随机字符。不要提交该文件，也不要打印展开后的完整 Compose 配置。

| 管理服务变量 | 默认值 | 含义 |
|---|---|---|
| `SKILL_TEST_RUNNER_SECRET` | 必填 | 内部共享 bearer 密钥 |
| `SKILL_TEST_IMAGE` | `wanwei-skill-test-runtime:1` | 可信执行模板 |
| `SKILL_TEST_SESSION_SECONDS` | `600` | 绝对生命周期，60–3600秒 |
| `SKILL_TEST_CONCURRENCY` | `2` | 全局并发1–20；每个审核人一个会话 |
| `SKILL_TEST_MEMORY` | `2g` | 每个执行容器的内存与 swap 限额 |
| `SKILL_TEST_CPUS` | `2` | 每个执行容器的 CPU 配额 |
| `SKILL_TEST_WORKSPACE_SIZE` | `1g` | 内存工作目录大小 |
| `SKILL_TEST_RETENTION_SECONDS` | `604800` | 产物保留时间，至少3600秒 |

OneAPI 需要配置 `SKILL_TEST_RUNNER_URL=http://skill-test-runner:9080` 和相同的 `SKILL_TEST_RUNNER_SECRET`。`SKILL_TEST_TOKEN_QUOTA` 限制每轮临时模型令牌的额度；默认1000000个现有额度单位，允许范围为1–100000000。`SKILL_TEST_RELAY_URL` 可选覆盖可信聊天补全地址；默认使用 OneAPI 自身的 `127.0.0.1:$PORT/v1/chat/completions`，未设置 `PORT` 时使用3000。这些配置不接受浏览器或上传 skill 提供的值。

现有 `DefaultModel` 必须指向已启用、支持工具调用且审核人分组和角色有权使用的对话模型。调用使用正常模型转发、额度与日志；令牌名称以 `技能审核测试:` 开头。测试不写入技能或专家使用事件。OneAPI 启动时自动迁移 `skill_test_sessions`。需要更新后台及前端并部署管理服务；不修改桌面安装包。

## 部署教程

前提是 Linux 测试主机、带 Compose 的 Docker、已有 `dsh-internal` 网络，以及可信构建依赖的访问条件。以下命令在本目录运行，只部署测试管理服务和运行时模板：

```sh
install -m 600 .env.example .env
# Edit .env and replace the placeholder with a random shared secret.
docker build -f runtime.Dockerfile -t wanwei-skill-test-runtime:1 .
docker compose config --quiet
docker compose up -d --build skill-test-runner
docker compose exec -T skill-test-runner python3 smoke.py
```

[Compose 文件](compose.yml) 不发布宿主端口。保留网关公网3300端口、OneAPI 的 `127.0.0.1:13300 → 3000` 映射及六个专家的访问地址。通过现有 OneAPI 部署流程添加两个 runner 变量，并保留完整的环境变量与网络配置。不要用不完整的独立 `docker run` 命令重建 OneAPI。

冒烟测试只创建并删除自己的带标签测试会话，验证真实执行、非 root 身份、无外部连接、上传指令不可变、拒绝符号链接、产物保留和容器删除，不消耗模型额度。请在测试主机运行，不要在审核真实投稿时运行。随后对一个待审核投稿点击“测试”：上传文件、提出任务、回答澄清问题、下载真实产物、停止执行中的任务，并刷新查看保留记录。确认模型日志具有测试令牌标记，正式使用量不变。

## 限制与验证

运行时模板包含 Python 和常见文档、表格、图片处理库。Windows 专用命令、Microsoft Office 自动化、外部 API，以及镜像中没有安装的依赖不可用。测试接受各种上传 skill，但不能保证每个 skill 都兼容此 Linux 镜像。缺少能力会显示为测试失败，不代表审核成功。有需要时，应在测试会话之外扩展可信镜像。

模型回复不采用流式输出；页面轮询持久化进度。每轮最多20次模型请求，每条回复最多8个工具调用，每条 shell 命令最多60秒、128 KB输出，模型上下文最多2 MB，执行事件最多4 MB。每轮最多上传10个输入文件，单个20 MB，总计80 MB。不提供自动评分、自动通过、批量测试系统或完整桌面能力复制。

```sh
python3 -m unittest -v test_server
cd ../one-api
go test ./controller -run '^TestSkillTest' -count=1
cd web/air
npm test -- --watchAll=false --runInBand src/pages/SkillTest/index.test.js src/components/SkillReviewTable.test.js
```

数据库测试需要 CGO 和 SQLite。Windows 单元测试替换 Docker 调用，不能证明 Linux 容器验收通过。生产使用前仍须运行真实冒烟测试，并用已配置的默认模型验证审核链路。
