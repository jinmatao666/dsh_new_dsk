# 麒麟桌面壳

[English](README.md) | 中文

此 Linux 壳使用 Tauri 1 编译 [src-tauri](../src-tauri/src/lib.rs) 中的业务命令，在主 GTK 窗口内嵌专家 WebKit 视图。Windows、macOS 和现代 Linux 使用现有 Tauri 2 壳。业务页面、API、技能和 Node Sidecar 共用一份源码；GTK 视图管理和原生通信需要单独维护。新增原生命令需要在两个壳中注册。

[仅麒麟入口](../../../.github/workflows/wanwei-kylin-preview.yml)名为 Wanwei Buddy Kylin only，只运行 x64 和 ARM64 兼容构建任务。该入口需要加入仓库默认分支，才会显示 Run workflow 按钮；选择 source_ref=new-version、填写所需版本号，测试时不勾选 official_release。它调用 new-version 中共享的麒麟工作流。桌面预览工作流保留完整平台矩阵。

容器在持久 Git 配置中仅信任当前挂载的仓库目录，并在安装依赖前验证 HEAD。checkout action 使用临时 HOME，后续 shell 步骤仍能读取源码提交信息。

[桌面预览工作流](../../../.github/workflows/wanwei-desktop-preview.yml)通过默认开启的 build_kylin 参数启用麒麟构建。[专用工作流](../../../.github/workflows/wanwei-kylin.yml)也可独立运行。两个架构均在 Ubuntu 20.04 容器中构建。虽然仓库通常优先 Windows runner，用户授权的此次兼容构建需要 Linux runner 完成 GTK 原生链接和图形测试。

用户提供的麒麟 aarch64 机器应选择 wanwei-buddy-VERSION-kylin-arm64 产物。安装包文件名包含 -kylin，与现代 Linux 产物区分。DEB 声明系统依赖；AppImage 包含额外运行库，但仍有系统 ABI 下限。两个格式均在上传前解包审计。审计拒绝架构错误、缺失运行库、WebKit 4.1、libsoup 3，以及高于 GLIBC 2.31、GLIBCXX 3.4.28、CXXABI 1.3.12 的符号要求。

麒麟通过替换安装包更新，此壳不提供 Tauri 2 自动更新包。关闭主窗口会隐藏应用；托盘菜单可退出并停止 Sidecar。

## 验证

WSL Ubuntu 20.04 x86_64 验证通过编译、Rust 业务测试和真实 WebKit 冒烟测试，覆盖两个内嵌专家、原生文件读取、专家命令授权、票据注入、尺寸缩小、显隐、JavaScript 状态保持、关闭和注销。桥接测试覆盖来源与文档隔离、错误传递及超时。完整暂存 Sidecar 在 Linux 原生文件系统通过启动、认证交换和清理退出检查。完整 x64 DEB 构建成功，并通过依赖声明及解包载荷审计，覆盖 11 个 ELF 文件。本地 AppImage 构建因辅助工具下载受阻尚未完成验证。冒烟测试使用本地测试页面、Xvfb 和软件渲染，不能证明真实专家登录、安装后的输入焦点、GPU、Wayland 或 ARM64 兼容性。发布构建和目标机测试需要覆盖这些剩余条件。[决策记录](../../../.agents/notes/proposed/architecture/2026-11-16-kylin-desktop-shell-isolation.zh.md)说明剩余验收条件。
