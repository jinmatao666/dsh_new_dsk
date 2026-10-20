---
description: "打包已提交的 OneAPI 后台源码，并使用固定部署命令更新现有服务器。"
---

# OneAPI 源码发布

[English](oneapi-release.md) | 中文

## 概述

用一条发布命令生成包含源码、校验值和服务器命令的版本目录。服务器先从该源码构建 Docker 镜像，再更新 OneAPI。交付的 tar 是源码包，不是导出的 Docker 镜像。桌面安装包和专家服务不属于此流程。

## 目录

- [准备与打包](#prepare-and-package)
- [更新服务器](#update-the-server)
- [失败处理与范围](#failures-and-scope)
- [维护者验证](#maintainer-verification)
- [开发备注](#dev-note)

-----

<a id="prepare-and-package"></a>

## 准备与打包

在目标仓库根目录执行下列命令，电脑需要 Node.js 22 或更新版本和 Git。打包工具仅使用 Node.js 内置模块，不需要安装桌面工作区的依赖。打包前先审查并提交后台改动；工具不会代替你提交、拉取、合并、推送或上传。选择发布提交前，应与其他开发者协调确认。

```powershell
node scripts/oneapi-release/release.mjs --status
node scripts/oneapi-release/release.mjs --version 0.0.77-release.1 --ref HEAD --check
node scripts/oneapi-release/release.mjs --version 0.0.77-release.1 --ref HEAD
```

默认输出为 `../delivery/oneapi/0.0.77-release.1/`。每次发布使用新版本号。`--repo PATH` 可选择其他仓库，`--output PATH` 可指定该仓库以外的交付父目录。`--ref` 接受已提交的分支、标签或 SHA，并解析为完整提交号。所选提交必须包含发布工具、后台源码和两个 npm 锁文件。

若缺少 npm 锁文件或锁文件已过期，请在对应前端目录更新，审查依赖变化后，将其与匹配的依赖清单一起提交。对于被仓库忽略规则排除的锁文件，使用 `git add -f`。未核对依赖兼容性时，不要从其他仓库复制锁文件。

交付包包含 `release.json`、`SHA256SUMS`、`deploy-oneapi.sh`、源码 tar、操作说明和针对该版本的 `COMMANDS.txt`。归档只包含已提交的后台文件。环境文件、能按文件名识别的凭证、缓存和运行数据会被排除；文件名过滤不是完整的秘密扫描，发布前仍需审查已提交源码。

-----

<a id="update-the-server"></a>

## 更新服务器

将整个输出目录上传至 `/root/dsh/releases/0.0.77-release.1/`。服务器需要 Linux、root 权限、本地 Docker 服务、Bash、Python 3、curl、sha256sum、tar、flock，以及下载构建依赖所需的网络。使用生成的 `COMMANDS.txt`；以下示例中的数据库备份路径须由操作员替换为真实存在的文件。

```bash
cd /root/dsh/releases/0.0.77-release.1
sha256sum -c SHA256SUMS
bash deploy-oneapi.sh verify --package ./dsh-server-source-0.0.77-release.1.tar.gz
bash deploy-oneapi.sh check --package ./dsh-server-source-0.0.77-release.1.tar.gz
bash deploy-oneapi.sh update --package ./dsh-server-source-0.0.77-release.1.tar.gz --db-backup /absolute/backup.sql
```

`verify` 无需 Docker 即可校验交付包。`check` 检查现有容器、持久化目录和网关及专家就绪状态，不替换容器。`update` 构建镜像并部署，也可分别执行 `build` 和 `deploy`。只有明确接受数据库迁移风险时，操作员才可将 `--db-backup /absolute/backup.sql` 改为 `--skip-db-backup`；脚本不会生成或恢复数据库备份。

更新成功会打印 `Updated: zjugis-one-api:<version>`，保留已停止的旧容器，并打印私有恢复目录。新版本 `/api/status` 必须返回预期版本号和成功状态。部署后由操作员验收后台登录、改动功能、使用统计和专家提交。不要分享私有恢复目录：其中包含容器环境，可能含有凭证。

-----

<a id="failures-and-scope"></a>

## 失败处理与范围

存在未提交后台改动、所选提交缺少锁文件、依赖清单不匹配或版本目录已存在时，打包会停止。失败的交付目录可能留下 `INCOMPLETE.txt`，不要上传或部署。请人工检查并清理那个确切的失败输出目录，或更换版本号；工具不会删除历史交付包。

部署脚本支持现有拓扑：`dsh-one-api` 位于 `dsh-internal` 网络，仅绑定 `127.0.0.1:13300`，由 `dsh-experts-gateway` 转发。它保留原环境变量、挂载和运行配置。无挂载的旧容器可以补充专用资源持久化挂载；其他不兼容存储或拓扑需人工审查。脚本不会重新配置网关、数据库或六个专家站点。

前后端构建检查由 Dockerfile 维护；打包检查通过不代表 Docker 编译或应用验收通过。复用已有镜像版本时，提交号和源码校验标签必须匹配。启动失败会尝试恢复旧容器并保留诊断信息，但容器回滚不能撤销数据库迁移。新增环境变量、外部服务或存储需求时，必须明确调整部署配置，不能只更换镜像。

-----

<a id="maintainer-verification"></a>

## 维护者验证

修改工具后执行专项打包和离线部署回归测试。测试使用临时 Git 仓库和模拟 Docker 传输，不连接生产 Docker。Linux Docker 构建、真实容器替换和回滚仍需在服务器侧验证。

```powershell
node --test scripts/oneapi-release/release.test.mjs
```

执行入口为 [release.mjs](../../scripts/oneapi-release/release.mjs)、[deploy-oneapi.sh](../../scripts/oneapi-release/deploy-oneapi.sh) 和已提交的 [Dockerfile](../../services/one-api/Dockerfile)。流程取舍记录在 [Agent Note](../../.agents/notes/implemented/process/2026-10-20-oneapi-source-release-workflow.zh.md) 中。

<a id="dev-note"></a>

## 开发备注

本地打包命令不会执行生产部署。
