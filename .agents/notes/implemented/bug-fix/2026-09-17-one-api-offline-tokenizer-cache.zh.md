# Agent Note: 为 One API 离线启动内置分词数据

Status: implemented

[English](2026-09-17-one-api-offline-tokenizer-cache.md) | 中文

## Problem

One API 在开放 HTTP 监听端口之前会初始化 GPT-3.5、GPT-4 和 GPT-4o 的分词器。分词库会在初始化期间下载缺失的 BPE 数据，因此当部署主机无法访问公共编码服务时，全新容器会一直无法提供服务。

## Decision

One API 运行时镜像在 `/opt/tiktoken-cache` 中内置 `cl100k_base` 和 `o200k_base` BPE 文件，并将 `TIKTOKEN_CACHE_DIR` 指向该目录。缓存文件名使用 `tiktoken-go` 预期的 SHA-1 键，纳入仓库的文件内容保持上游 SHA-256 值。服务启动时会直接从镜像加载两套编码，不需要访问网络。

## Alternatives considered

**在容器启动时下载编码文件。** 不采用，因为 HTTP 监听端口开放之前，服务可用性仍会依赖外部主机。

**每次构建镜像时下载编码文件。** 不采用，因为部署构建会新增外部依赖，并可能在源码包未变化时独立失败或发生变化。

**异步初始化分词器。** 不采用，因为请求可能在所需分词器可用之前进入 token 统计路径。

## Consequences

源码包和运行时镜像会增加约五兆字节的分词数据。全新容器可在受限网络中稳定启动；更新分词数据时必须明确替换内置文件，并核对其上游校验值。
