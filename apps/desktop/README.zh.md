# DSH Desktop

[English](README.md) | 中文

用于 `desktop` DSH profile 的 Tauri 2 壳。它在操作系统分配的端口上启动仅监听回环地址的 DSH Sidecar，等待 `dsh web:` 就绪信息，再在主 WebView 中打开该地址。WebView 不获取 Tauri IPC 权限；本地文件操作留在 DSH Sidecar 中，模型调用由 Sidecar 直接发送到配置的 OneAPI 服务。

## 开发

1. 使用 Node 22.19 或更高版本，并安装工作区依赖。
2. 运行一次 `corepack enable pnpm`，让 `pnpm` 使用仓库 `packageManager` 声明的版本。
3. 在仓库根目录运行 `pnpm --filter @deepseek-ai/dsh-desktop-app dev`。

该命令构建当前检出内容，启动客户端插件重新构建监视器，并使用独立的 `com.wanwei.harness.development` 应用标识运行真实 Tauri debug 壳。它可以与已安装的正式版同时运行，不共享单实例锁或 WebView 配置。壳会组合正式版的 `desktop` profile 并挂载所有正式客户端插件；只有 OneAPI RPC 返回本地开发身份，因此无需服务器登录即可打开工作区。客户端 UI 修改会在现有窗口中重新构建和刷新。Rust 修改使用 Tauri 的常规 debug 重新构建。Host 侧 TypeScript 修改需要重启该命令，启动前构建会刷新对应产物。

开发会话和技能市场安装使用 Tauri 应用数据目录下持久化的 `development/dsh-home`。启动日志会输出其准确路径。该目录让开发修改与 `~/.dsh` 隔离，同时在多次 debug 启动之间保留状态。文件选择、文件打开、技能市场安装、Session 导出、窗口行为和其他原生命令继续使用真实 Tauri 实现，不使用浏览器 Mock。

release 构建中的认证层保持正常的正式行为。仅存在于源码中的 `dev/cordis.patch.yml` 覆盖层只由 Rust debug 构建选择，并且不在 Tauri 安装包资源清单中。

## 安装包

把 `DSH_NODE_BINARY` 设置为目标平台的 Node 可执行文件，并可选地通过 `DSH_DESKTOP_SERVER_CONFIG` 指定正式 JSON 配置文件，然后在 Windows 或 macOS 上运行应用的 `build` 脚本。打包必须在目标平台原生执行：Windows 生成 Windows 安装包，macOS 生成 `.app`/DMG 产物。

暂存 runtime 不提交到仓库。`prepare:runtime` 会构建 DSH、部署 CLI 的正式依赖闭包，并在生成安装包前把 Node 复制到 Tauri 资源目录。
