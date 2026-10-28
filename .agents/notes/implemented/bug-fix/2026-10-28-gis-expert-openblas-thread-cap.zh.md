# Agent Note: GIS 专家容器限制 OpenBLAS 线程数

Status: implemented

[English](2026-10-28-gis-expert-openblas-thread-cap.md) | 中文

## Problem

坐标转换、GIS 格式转换、红线提取容器设置了 `pids_limit: 128`。导入 `ezdxf` 会带入 NumPy/OpenBLAS，后者试图创建数十个线程并以 `pthread_create ... Resource temporarily unavailable` 失败。转换子进程非零退出后，worker 只展示通用「文件处理失败」并把 stderr 丢弃，Docker 日志常只剩无关的 ezdxf 缓存警告。本机 preview 没有同等 PID 上限，同一文件在开发机可成功。

## Decision

在三个专家各自的 `compose.yml`、`compose.local-xinference.yml` 以及 `Dockerfile` 的 `ENV` 中，将 `OPENBLAS_NUM_THREADS`、`OMP_NUM_THREADS`、`MKL_NUM_THREADS`、`NUMEXPR_NUM_THREADS` 设为 `1`，使 Compose 重建与重新构建镜像都在现有 PID 预算下保持 BLAS 单线程。

## Alternatives considered

仅提高 `pids_limit` — 不作为主修复：相对两 CPU 配额，BLAS 仍会过度开线程，并占用嵌套转换工具可能需要的 PID。

## Consequences

生产环境拉取更新后的 compose 后重建服务即可（或把相同变量写入 `.env`），不必等待完整镜像重建；重建镜像仍会把默认值写入镜像。同样会导入 `ezdxf` 的 GIS 转换与红线任务一并受益。

## Required verification

部署主机重建后：`docker compose -p wanwei-coordinate-transform exec expert python -c "import ezdxf, pyproj; print('ok')"` 成功，且小型 EPSG CSV 任务不再出现通用处理失败提示。
