# Agent Note: 万维桌面打包运行时必须剔除包内测试

Status: implemented

[English](2026-10-20-wanwei-desktop-runtime-strip-tests.md) | 中文

## 问题

Windows NSIS 安装包在解压类似 `resources\runtime-*\app\node_modules\@deepseek-ai\dsh-api-session-controller\tests\*.host.spec.ts` 的路径时报 `Extract: error writing to file`。暂存阶段把工作区包整棵拷进 runtime，测试文件路径过长，触发 Windows MAX_PATH。

## 决策

`prepare:runtime` 在恢复 workspace 包时跳过开发专用条目，并在钉钉资源落盘前从暂存 app 树剔除 `tests/`、`__tests__/` 以及 `*.spec.*` / `*.test.*`。辅助函数在 `products/wanwei-desktop/scripts/runtime-files.mjs`。

## 考虑过的替代方案

**仅在安装器开启 Windows 长路径：** 否决，不完整；测试文件运行时无用且增大包体。

**只依赖各包 `files` 字段：** 否决，因 `restoreWorkspaceClosure` 会绕过 npm pack 过滤拷贝工作区源码。

## 后果

此后的安装包构建必须重新跑 `prepare:runtime`。已嵌入 `tests/` 的旧安装包在深路径下仍会失败，需重打。
