# Agent Note: 隔离麒麟桌面壳

Status: proposed

[English](2026-11-16-kylin-desktop-shell-isolation.md) | 中文

## Problem

目标麒麟 ARM64 提供 glibc 2.31、最高 GLIBCXX 3.4.28 和 WebKitGTK 4.0。用户提供的安装与运行日志显示，Tauri 2 产物要求更新的库。Windows 和 macOS 必须保留现有壳，同时麒麟必须保留内嵌专家视图。

## Proposal

共享业务源码和原生命令参数，使用独立[麒麟壳](../../../../products/wanwei-desktop/src-kylin/README.zh.md)和构建入口。其 Cargo 包通过包级条件编译标记编译生产 Rust 业务模块；Windows/macOS 保留 Tauri 2。Linux 适配层管理 GTK 内嵌视图、按来源和文档隔离的原生桥接、专家命令授权、托盘生命周期及共享 Sidecar 启动。新增原生命令需要在两个壳中注册，常规业务修改仍共用一份源码。

[麒麟工作流](../../../../.github/workflows/wanwei-kylin.yml)在 Ubuntu 20.04 容器中构建 x64 和 ARM64，检查运行库符号及安装后载荷，生成名称独立的麒麟安装包。桌面预览工作流与原有矩阵并行调用它。原生 GTK 库和图形验证需要 Linux runner；用户要求的 Linux 兼容构建授权了对常规 Windows runner 偏好的这一例外。更新通过替换安装包完成，适配层不使用 Tauri 2 自动更新包。

[仅麒麟手动入口](../../../../.github/workflows/wanwei-kylin-preview.yml)调用 new-version 上共享的工作流，需要在默认分支注册才能通过 GitHub 手动运行。这将界面入口与业务代码合入 main 分开。容器仅在持久 Git 配置中信任 GITHUB_WORKSPACE，并在检出后立即验证 HEAD。第 126 和 128 次运行均在读取源码提交信息时失败；Ubuntu 20.04 / Git 2.25.1 临时仓库复现了宿主 UID 所有的仓库返回 128，并验证限定目录的信任配置可修复。原构建隐藏 Git stderr，因此复现证明了失败机制，但不代表已观察到 runner 中被隐藏的原始错误。

已有桌面工作流提供 build_scope=all（默认）或 kylin。仅麒麟模式保留官方组合校验，跳过 Tauri 2 桌面矩阵，无论 build_kylin 如何设置都启用麒麟复用任务，并跳过全平台 Release 发布。未提供 build_scope 时保留全平台行为。这满足用户不改动 main 的要求，独立入口在默认分支注册仅为可选方式。

## Alternatives considered

单独添加 YAML 而不改变 Tauri 2 源码，仍然保留不兼容依赖。常规 Tauri 1 窗口移植不能替代内嵌专家 API，独立窗口违反用户要求。GTK 实验使用 Tauri 1 的平台 WebView 访问接口和父容器尺寸分配。若生产 GTK 集成无法达到验收条件，Electron Linux 壳仍是备选。

## Acceptance criteria

Linux 壳必须在目标运行库基线上运行，正确嵌入多个专家视图并同步位置与显隐、保持会话、授权原生命令，并启动实际业务运行时。现有 Windows/macOS 行为必须保持。Ubuntu 20.04 x86_64 编译、共享 Rust 测试和真实 WebKit 测试通过原生文件读取、专家授权、票据注入、双视图尺寸、显隐、状态保持、关闭和注销。暂存 Sidecar 通过启动、认证交换和清理退出检查；完整 x64 DEB 通过依赖声明及载荷审计。本地 AppImage 构建受辅助工具下载阻断。两种安装包格式和 ARM64 目标机通过验收前，此提案保持开放。

## Risks

图形测试使用本地 HTML、Xvfb/X11 和软件合成。真实专家认证及 Cookie、输入与焦点、高 DPI、Wayland、GPU、托盘集成和完整打包 Node Sidecar 仍需要安装后的设备检查。x86_64 证据不能证明 ARM64 兼容性。生产壳共用条件编译修改，发布工作流包含新任务；本地尚未重新执行 Windows/macOS 原生构建。适配层增加 GTK 嵌入和桥接注册的维护成本，Tauri 1 的旧依赖栈需要持续审查。
