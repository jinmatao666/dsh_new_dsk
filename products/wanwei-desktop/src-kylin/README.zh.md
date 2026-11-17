# 麒麟桌面壳

[English](README.md) | 中文

此 Linux 壳使用 Tauri 1 编译 [src-tauri](../src-tauri/src/lib.rs) 中的业务命令，在主 GTK 窗口内嵌专家 WebKit 视图。Windows、macOS 和现代 Linux 使用现有 Tauri 2 壳。业务页面、API、技能和 Node Sidecar 共用一份源码；GTK 视图管理和原生通信需要单独维护。新增原生命令需要在两个壳中注册。

桌面预览工作流的 build_scope 默认为 all。无需在 main 注册工作流：打开已有的 Wanwei Buddy desktop 入口，选择 new-version 工作流分支，再选择 build_scope=kylin，即可仅构建麒麟。此模式跳过常规桌面矩阵并始终启用麒麟，仍执行共享的官方组合校验。Release 发布要求完整桌面矩阵成功，因此仅麒麟模式跳过发布。

容器在持久 Git 配置中仅信任当前挂载的仓库目录，并在安装依赖前验证 HEAD。checkout action 使用临时 HOME，后续 shell 步骤仍能读取源码提交信息。

[桌面预览工作流](../../../.github/workflows/wanwei-desktop-preview.yml)通过默认开启的 build_kylin 参数启用麒麟构建。[共享麒麟工作流](../../../.github/workflows/wanwei-kylin.yml)实现该入口调用的兼容构建任务。两个架构均在 Ubuntu 20.04 容器中构建。虽然仓库通常优先 Windows runner，用户授权的此次兼容构建需要 Linux runner 完成 GTK 原生链接和图形测试。

用户提供的麒麟 aarch64 机器应选择 wanwei-buddy-VERSION-kylin-arm64-deb 产物。安装包文件名包含 -kylin，与现代 Linux 产物区分。DEB 声明系统依赖；AppImage 包含额外运行库，但仍有系统 ABI 下限。两个格式均在上传前解包审计。审计拒绝架构错误、缺失运行库、WebKit 4.1、libsoup 3，以及高于 GLIBC 2.31、GLIBCXX 3.4.28、CXXABI 1.3.12 的符号要求。

DEB 和 AppImage 分别构建、审计及上传，产物名分别以 -deb 和 -appimage 结尾。DEB 在 AppImage 开始前上传，因此 AppImage 失败时仍可下载已通过审计的 DEB 进行测试，任务保持失败状态。证据产物包含独立构建日志、各格式审计报告，以及生成的 AppImage 脚本（若已生成）。构建启用 Tauri 详细日志，并在日志捕获过程中保留打包器退出码。仅已知的 ARM64 架构识别错误会使用旧工具的 arm_aarch64 别名重试生成脚本中的最后封装命令；其他错误仍会终止构建，生成的安装包仍须通过完整审计。

麒麟通过替换安装包更新，此壳不提供 Tauri 2 自动更新包。关闭主窗口会隐藏应用；托盘菜单可退出并停止 Sidecar。

麒麟壳在 GTK 启动前将 WEBKIT_DISABLE_COMPOSITING_MODE 和 LIBGL_ALWAYS_SOFTWARE 默认设为 1，同时保留显式环境变量覆盖。软件渲染用于避开目标机上观察到的白屏，但可能增加 CPU 使用量。专家覆盖层将空白区域的鼠标事件传给主页面，内嵌专家仍可接收输入。原生命令仅在桌面 WebView 内可用；在普通浏览器打开本地回环地址不会提供桌面专家或技能安装命令。

## 验证

WSL Ubuntu 20.04 x86_64 验证通过编译、Rust 业务测试和真实 WebKit 冒烟测试，覆盖两个内嵌专家、原生文件读取、专家命令授权、票据注入、尺寸缩小、显隐、JavaScript 状态保持、关闭和注销。桥接测试覆盖来源与文档隔离、错误传递及超时。完整暂存 Sidecar 在 Linux 原生文件系统通过启动、认证交换和清理退出检查。完整 x64 DEB 构建成功，并通过依赖声明及解包载荷审计，覆盖 11 个 ELF 文件。本地 AppImage 构建因辅助工具下载受阻尚未完成验证。冒烟测试使用本地测试页面、Xvfb 和软件渲染，不能证明真实专家登录、安装后的输入焦点、GPU、Wayland 或 ARM64 兼容性。发布构建和目标机测试需要覆盖这些剩余条件。[决策记录](../../../.agents/notes/proposed/architecture/2026-11-16-kylin-desktop-shell-isolation.zh.md)说明剩余验收条件。
