# 麒麟 Tauri 1 可行性验证

本文记录独立最小实验，文中的未移植项与未修改范围仅描述该实验。生产集成及其当前验证范围见[麒麟壳说明](../../src-kylin/README.zh.md)。

验证日期：2026-11-16。结论：Tauri 1 加 Linux 专用 GTK/WebKit 适配层已在 Ubuntu 20.04 x86_64 上通过同窗两个原生网页视图的最小验证。这为共享业务、Windows/macOS 保留 Tauri 2、麒麟单独使用 Tauri 1 提供了技术证据；完整业务移植和麒麟 ARM64 运行仍未验证。

## 原生结果

| 检查项 | 结果 |
|---|---|
| 框架 | Tauri 1.8.3、tauri-build 1.5.6，锁定依赖后编译运行通过 |
| 环境 | 独立 WSL 发行版 Wanwei-Kylin-Validation，Ubuntu 20.04.6，x86_64，glibc 2.31 |
| 图形库 | WebKitGTK 4.0 / 2.38.6，GTK 3.24.20，GLib 2.64.6，libsoup 2.4 |
| 主页面 IPC | JavaScript → Rust → JavaScript → Rust 确认返回值，通过 |
| 同窗嵌入 | 两个专家原生视图与主页面同属一个顶层窗口，具有预期 GTK 父容器 |
| 移动和缩小 | 从 360×400 缩至 340×380，实际位置分别为 (40,170) 与 (440,170) |
| 显隐与状态 | 隐藏恢复通过，各自保留 JavaScript 计数器，读取值均为 42 |
| 符号上限 | 程序及 ldd 解析出的库，所需最高 GLIBC 2.30、GLIBCXX 3.4.26；低于目标上限 2.31 / 3.4.28 |

[运行日志](native-probe/validation.log)和[机器可读证据](native-probe/evidence.json)保存真实结果与编译输入 SHA-256。盘点脚本会标识输入变化后的过期证据。符号检查不覆盖尚未构建的生产程序、Node 或原生模块。

## 适配范围

Tauri 1 标准窗口 API 不能直接替代 Tauri 2 子 WebView。本实验通过 with_webview 访问 Linux GTK/WebKit 对象，重组容器嵌入两个额外视图。父容器负责最终边界分配，避免 WebKit 固有尺寸覆盖缩小请求。没有使用独立窗口或替换系统 WebKit。

正式版本需要 Linux 专用视图管理、原生命令授权和生命周期适配。业务接口可以共享，平台壳实现仍有两套。主壳的 34 个原生命令尚未逐一移植。

6 项 Node VM 测试验证模拟 Tauri 1 下的桥接缺口及候选脚本的命令和错误传递；4 个业务客户端直接读取 Tauri 2 调用入口，候选脚本通过别名覆盖，业务源码未改。原生程序仅验证主页面测试命令往返，专家视图尚未接入生产命令或远程页面授权。

## 未验证项

测试使用 Xvfb/X11、软件合成、本地测试 HTML，以独立 WSL 环境的 root 身份运行。未验证麒麟 ARM64、Wayland、GPU、输入与焦点、弹窗遮挡、高 DPI、真实专家页面、登录票据和 Cookie、子视图原生命令授权、生产 Node Sidecar、文件和技能、托盘、更新或安装包。计数器保持证明隐藏恢复没有重建视图，不证明登录会话兼容。

Ubuntu 与麒麟的架构和发行版补丁不同，符号上限通过不能替代 ARM64 真机验证。

## 复现

在仓库根目录执行：

~~~powershell
node --test products/wanwei-desktop/compatibility/tauri1/bridge.test.mjs
node products/wanwei-desktop/compatibility/tauri1/audit.mjs
~~~

原生环境需要 Rust、build-essential、pkg-config、libwebkit2gtk-4.0-dev、libgtk-3-dev、libssl-dev、librsvg2-dev、xvfb、xauth、dbus-x11 和 Python 3。已建立的 WSL 环境可执行：

~~~powershell
wsl -d Wanwei-Kylin-Validation -- sh -c 'cd /mnt/d/万维buddy/dsh_new_dsk/products/wanwei-desktop/compatibility/tauri1/native-probe && CARGO_TARGET_DIR=/root/wanwei-tauri1-probe/target python3 verify.py'
~~~

入口执行锁定依赖构建、40 秒超时图形测试和依赖符号检查，成功后写入证据。Cargo 和编译缓存留在独立 WSL 环境中。

## 保护范围与后续条件

生产 Tauri 2 壳、Cargo/Node 锁文件、共享业务源码及发布工作流均未修改。实验单独的 Cargo.lock 仅属于最小验证程序。候选桥接未接入生产，没有发布或触发 Actions。

可继续推进 Linux 专用 Tauri 1/GTK 壳：先在 ARM64 旧基线复现，再接真实业务页面与 Node，验证授权、输入和生命周期，通过后增加麒麟打包 YAML，与 Windows/macOS 原流程并行。当前证据无需立即转向 Electron，也不代表麒麟安装包已修复。
