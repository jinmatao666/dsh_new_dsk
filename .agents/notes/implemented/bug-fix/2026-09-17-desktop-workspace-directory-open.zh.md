# Agent Note: 桌面端打开 Workspace 目录

Status: implemented

[English](2026-09-17-desktop-workspace-directory-open.md) | 中文

## Problem

Workspace 行提供了“打开工作空间”，但桌面端渲染层会把操作交给 Node sidecar 的通用 `host.openPath` 实现。原生交接失败时只会写入渲染层控制台，因此用户点击菜单项后可能既看不到目录打开，也看不到失败提示。

## Decision

安装后的桌面壳通过范围受限的 Tauri 命令打开 Workspace 目录。该命令验证传入的 Workspace 路径存在且是目录，然后在不启动 shell 的情况下启动平台文件管理器。Windows 使用 `explorer.exe`，macOS 使用 `open`，Linux 使用 `xdg-open`。

Workspace UI 在桌面桥接存在时优先调用该命令。浏览器与远程组装仍以 `host.openPath` 作为回退。两条路径的打开失败都会在 Workspace 面板中显示，不再仅依赖控制台输出。

## Alternatives considered

**继续统一通过 `host.openPath` 打开。** 对安装后的桌面端予以否决，因为这项操作由原生壳拥有，额外的渲染层到 sidecar 交接没有必要，且失败时产品 UI 无法感知。

**通过 Tauri 打开每个文件。** 予以否决，因为产出文件链接与浏览器部署已经依赖 Host 打开器的跨平台文件关联行为。原生命令仅用于 Workspace 目录。

## Consequences

桌面端菜单由拥有可见窗口的进程打开目录，非桌面端客户端保持现有 Host 行为。渲染层增加了一项桌面命令依赖，不受支持或无法访问的路径会显示错误。
