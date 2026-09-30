# 万维 Buddy 预览版桌面端

[English](README.md) | 中文

这个私有产品目录持有万维桌面壳和安装器。它特意放在 `apps/` 与 `packages/` 之外，这两个目录继续作为上游 DSH 的应用层和包层。

## 当前边界

macOS 保留继承的系统临时目录，将随包 Node 的目录放到 Sidecar PATH 首位，保留现有工具路径并补充 Homebrew 目录。Python 用户依赖及 pip 下载使用宿主临时目录下按产品隔离的私有目录，该区域已在工作区写入模式的允许范围内。缓存可跨启动复用，但可能被系统清理，不属于持久用户数据。只读限制和扩大访问范围的审批保持有效。Windows 和 Linux 保持既有启动环境；Mac 安装版行为仍需实机验证。

Tauri 2 桌面壳会以本地回环 DSH Sidecar 的形式启动新的 `wanwei-desktop` profile，等待其输出带鉴权信息的 Web 地址，再创建主 WebView。它始终把 `DSH_HOME` 放在预览版自己的本地应用数据目录下。万维自有桌面命令通过明确的 WebView 权限提供。

主 WebView 的新窗口请求会在系统默认浏览器打开 HTTP(S) 链接。其他 URL 协议不会启动外部程序，对话链接也不会创建第二个应用内 WebView。

独立专家网页仍在实施。已上架专家在主窗口内的独立子 WebView 打开；桌面壳按每次打开的具体 HTTP 或 HTTPS 来源和视图标签登记权限。macOS 安装包仅允许 `ac.zjugis.com` 通过不安全的 HTTP 加载，以便当前 HTTP 网关能在 WKWebView 中显示；此例外不会加密传输，网关改用 HTTPS 后应移除。目录、一次性身份票据、桌面桥与视图关闭/定位还须在 Windows、macOS、Linux 实机验证后才能发布。专家网站是高权限代码，上架前必须审核其 iframe 与跳转行为。六个正式网站及一次性切换尚未完成，详见 `WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md`。

正式构建将凭据、设置、会话和技能保存在 `<预览版本地应用数据目录>/dsh-home`。首次启动时，如果存在旧版 `~/.dsh`，预览版会将设置、会话、存储、附件、技能、兼容的智能体预设和匿名用户 ID 复制到独立目录，不覆盖预览版已有文件，也不写入旧目录。凭据不会迁移：每次安装新构建仍需重新登录。旧目录不存在或复制失败时，预览版继续使用自己的数据启动。新版产品 Profile 始终单独生成；迁移标记避免重复导入。不兼容的旧会话仍可能需要人工处理。

| 通道 | 产品名称 | 应用标识 |
|---|---|---|
| 已安装预览版 | 万维 Buddy 预览版 | `com.wanwei.harness.preview` |
| 本地开发版 | 万维 Buddy 预览版 | `com.wanwei.harness.preview.development` |
| 现有正式版 | 万维 Buddy | `com.wanwei.harness` |

不同应用标识会把单实例锁、WebView profile、平台应用数据目录、缓存和安装器身份与现有正式客户端隔离开来。

## 验证

```sh
pnpm --filter @wanwei/dsh-desktop-preview check:identity
pnpm --filter @wanwei/dsh-desktop-preview check:sidecar
pnpm --filter @wanwei/dsh-desktop-preview check:rust
```

源码开发模式直接运行当前 checkout 中的 TypeScript CLI。`prepare:runtime` 会在 `src-tauri/resources/runtime` 中创建自包含生产运行时：部署万维专用生产依赖闭包（既有 DSH 运行时加上 PDF、DOCX、XLSX 解析器），把所需 workspace 对等包恢复为普通文件，复制 Node 22，并预检暂存后的 `wanwei-desktop` profile。`check:runtime` 还会用随包 Node 启动暂存的文档辅助程序，缺少解析依赖时会在制作安装包之前失败。官方 Python 运行时清单保持不变。生成的运行时文件由 Git 忽略，每次制作安装包时重新构建。

```sh
pnpm --filter @wanwei/dsh-desktop-preview prepare:runtime
pnpm --filter @wanwei/dsh-desktop-preview check:runtime
pnpm --filter @wanwei/dsh-desktop-preview build
```

默认 `build` 会重新构建官方 DSH 产物、暂存并验证运行时，再通过 `tauri build --no-bundle` 生成本地 release 二进制，不制作安装包。GitHub Actions 使用受 `GITHUB_ACTIONS=true` 保护的 `build:runner` 制作对应平台的安装包；本地调用会立即失败。文件导入、技能管理、登录窗口行为和其他旧版命令分别在后续步骤迁移。

已上架的专家 Webview 通过桌面桥调用 `save_expert_artifact({ fileName, bytesBase64 })`。接口仅接受专家 Webview，校验成果字节（最大 128 MB）、文件名和支持的扩展名，并打开原生“另存为”窗口。只有用户选择目标路径和确认覆盖，网站不能提交本机路径。保存后返回绝对路径，取消返回 null，拒绝更改原始扩展名。普通浏览器使用浏览器下载；原生交互仍需逐平台验收。
原生桌面收到就绪地址后继续读取后台服务 stdout。启动失败时，先终止并等待直接后台进程退出，再返回错误；这不保证终止用户任务启动的所有后代进程。
原生文件导入以独占方式创建目标文件和目录。如果选名后出现同名目标，导入失败，不覆盖或删除已有目标。目录复制失败只清理本次调用创建的目录。
关闭主窗口会隐藏窗口；macOS Dock 重新打开事件会恢复并聚焦已有窗口。正常应用退出会停止直接后台进程，包括不经过托盘菜单的退出；强制终止不在此保证范围内。
运行时打包解除依赖符号链接和 Windows junction，不递归删除它们指向的目录。旧文件迁移先写入并同步临时文件，再以不覆盖目标的硬链接方式发布；目标文件系统必须支持硬链接。复制失败不会留下半份正式文件，强制中断可能留下未被引用的临时文件。
