# Agent Note: 原生 Linux ARM64 桌面构建

Status: implemented

[English](2026-10-09-wanwei-linux-arm64-build.md) | 中文

## 问题

万维桌面预览版需要为客户电脑提供 Linux ARM64 安装包。x64 安装包无法提供 ARM64 Node 运行时或原生桌面可执行文件。

## 决策

[桌面预览版工作流](../../../../.github/workflows/wanwei-desktop-preview.yml)包含原生 `ubuntu-22.04-arm` 矩阵项。Linux 依赖安装按宿主架构选择 musl 路径，安装包上传和诊断步骤覆盖两个 Linux 构建项。请求平台与 Linux Runner 架构不一致时，配置生成拒绝继续。Runner 暂存自身的 Node 可执行文件和生产依赖闭包。

## 考虑过的替代方案

**在 x64 Runner 交叉编译。** 原生构建避免为 Node 依赖及运行时验证维护额外的交叉工具链和模拟执行路径。

## 影响

Linux ARM64 和 x64 使用独立的缓存与产物名称，两者均请求生成 DEB 和 AppImage。配置测试覆盖可接受的 ARM64 和 x64 Runner，以及架构不匹配时的拒绝行为。工作流构建成功不代表已验证 UOS 1041 运行库兼容性；目标机器安装仍需单独验证。
