# DSH Desktop

[English](README.md) | 中文

用于 `desktop` DSH profile 的 Tauri 2 壳。它在操作系统分配的端口上启动仅监听回环地址的 DSH Sidecar，等待 `dsh web:` 就绪信息，再在主 WebView 中打开该地址。WebView 不获取 Tauri IPC 权限；本地文件操作留在 DSH Sidecar 中，模型调用由 Sidecar 直接发送到配置的 OneAPI 服务。

## 开发

### 日常快速启动（Windows）

已有一次成功的完整构建后，在 PowerShell 中运行：

```powershell
Set-Location 'E:\code\dsh\deepseek-harness-master\apps\desktop'
pnpm exec tauri dev --config src-tauri/tauri.dev.conf.json
```

保持终端运行；Tauri 会启动开发版窗口，并自动运行前端文件监视器。开发版使用独立的应用标识和数据目录，`dev/cordis.patch.yml` 提供仅供本地开发的免登录身份。看到 `Running target\debug\dsh-desktop.exe` 后，还需等待 Sidecar 输出 `dsh web:`，窗口才会加载完成。无需另起 `node` 服务。

这个命令跳过 `dev:prepare` 的整仓构建。首次检出或修改了非客户端 Host 侧 TypeScript 后，先在仓库根目录运行 `pnpm --filter @deepseek-ai/dsh-desktop-app dev` 完整构建一次。快速启动会检查客户端源码与 Host／页面插件产物的时间；发现过期产物时先重建，再由监视器处理后续 UI 修改。Rust 修改由 Tauri 增量编译。启动前检查是否已有开发版窗口，已有窗口时直接使用，避免重复启动。

日常启动仍会进行 Rust 增量编译、前端打包以及 Sidecar/WebView 启动。本机一次快速启动的日志显示 Rust 约 9 秒、前端约 5 秒；这些时间会随变更和缓存情况变化。若启动失败，先看终端中 `cargo`、`vite` 或 `dsh web:` 附近的错误，不要把前端网页预览当作桌面版启动成功。

1. 使用 Node 22.19 或更高版本，并安装工作区依赖。
2. 运行一次 `corepack enable pnpm`，让 `pnpm` 使用仓库 `packageManager` 声明的版本。
3. 在仓库根目录运行 `pnpm --filter @deepseek-ai/dsh-desktop-app dev`。

该命令构建当前检出内容，启动客户端插件重新构建监视器，并使用独立的 `com.wanwei.harness.development` 应用标识运行真实 Tauri debug 壳。它可以与已安装的正式版同时运行，不共享单实例锁或 WebView 配置。壳会组合正式版的 `desktop` profile 并挂载所有正式客户端插件；只有 OneAPI RPC 返回本地开发身份，因此无需服务器登录即可打开工作区。客户端 UI 修改会在现有窗口中重新构建和刷新。Rust 修改使用 Tauri 的常规 debug 重新构建。Host 侧 TypeScript 修改需要重启该命令，启动前构建会刷新对应产物。

开发会话和技能市场安装使用 Tauri 应用数据目录下持久化的 `development/dsh-home`。启动日志会输出其准确路径。该目录让开发修改与 `~/.dsh` 隔离，同时在多次 debug 启动之间保留状态。文件选择、文件打开、技能市场安装、Session 导出、窗口行为和其他原生命令继续使用真实 Tauri 实现，不使用浏览器 Mock。

release 构建中的认证层保持正常的正式行为。仅存在于源码中的 `dev/cordis.patch.yml` 覆盖层只由 Rust debug 构建选择，并且不在 Tauri 安装包资源清单中。

Debug Tauri 的资源清单仅包含服务器配置和内置技能。它的 Sidecar 从当前检出内容运行，因此暂存的正式版 runtime 只在生成安装包时复制。

正式版将 `DSH_HOME` 固定为当前用户的 `~/.dsh`，凭据、设置、会话、Profile 和技能均使用该目录，不受继承的 `DSH_HOME` 影响。Debug 构建使用独立的应用数据目录 `development/dsh-home`。

## 安装包

把 `DSH_NODE_BINARY` 设置为目标平台的 Node 可执行文件，并可选地通过 `DSH_DESKTOP_SERVER_CONFIG` 指定正式 JSON 配置文件，然后在 Windows、macOS 或 Linux 上运行应用的 `build` 脚本。打包必须在目标平台原生执行：Windows 生成 NSIS 安装包，macOS 生成 `.app`/DMG 产物，Linux 生成 x64 `.AppImage` 和 Debian `.deb` 产物。发布工作流的 `all-platforms` 选项会在各目标对应的托管 runner 上构建。

暂存 runtime 不提交到仓库。`prepare:runtime` 会构建 DSH、部署 CLI 的正式依赖闭包，并在生成安装包前把 Node 复制到 Tauri 资源目录。
