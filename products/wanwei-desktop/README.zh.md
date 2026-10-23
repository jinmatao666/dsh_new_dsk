# 万维Buddy桌面端

[English](README.md) | 中文

这个私有产品目录持有万维桌面壳和安装器。它特意放在 `apps/` 与 `packages/` 之外，这两个目录继续作为上游 DSH 的应用层和包层。

## 当前边界

Windows 快照还读取鼠标命中是否属于客户端、主 UI 线程的焦点／鼠标捕获句柄，以及最多 64 个后代原生窗口的范围、可见性和启用状态。控制器父句柄可将 WebView2 记录关联到原生窗口。窗口类名仅保留固定类别，不读取标题和文本；鼠标命中外部应用时不枚举对方窗口。采样不改变焦点或模拟输入；点击后的快照可能看到稍后的鼠标位置。

诊断修订版 2 使用 SHA-256 派生的视图标识关联原生操作和快照，不保存含票据片段的原始标签。记录包含进程／版本／系统／架构、序号、请求尺寸、派发与确认、耗时、原生错误、导航／加载阶段、视图缺失、关闭后查询及主视图焦点派发。WebView2 查询失败和超时均明确记录。DOM 记录区分捕获、冒泡及处理后点击，并记录禁用／inert 状态、目标命中是否一致和弹窗数量。达到进程上限时输出截断标记。Windows 未向页面转发输入时，这些观测不能证明真实鼠标送达。

Windows 主视图和专家 WebView 使用相同的浏览器参数，因为两者共享 WebView2 数据目录。专家创建返回前检查原生尺寸；Windows 可见性变更会回读控制器状态，而非仅确认派发成功。在仓库根目录运行 `pnpm --dir products/wanwei-desktop run check:expert-window`，可复现参数不一致，并用本地回环测试页验证五轮修复后的创建／加载／显示／隐藏／关闭／缩放，无需安装或启动业务 sidecar。隐藏窗口使用临时、隔离的浏览器数据。DOM 处理函数检查采用程序触发，不代表真实鼠标输入验证；生产登录及安装版实机验收仍须单独进行。

专家输入诊断在打开专家库时启动，早于任何工作台创建。本地应用数据目录的 `logs/expert-input-diagnostics.jsonl` 记录结构化指针／点击信息、固定的取消／开始处理函数及启动检查点，以及原生视图数量、尺寸和焦点；Windows 还在 UI 线程查询 WebView2 可见性和尺寸。不记录文字、按键值、网址或票据。每个文档最多报告 300 个事件，每个进程最多写入 2,000 条记录。仅主视图可提交白名单字段。复现时打开专家详情，先不缩放，点击取消／开始，再缩放并重试同一控件。如果能打开工作台，也采集返回目录的过程。保留此文件和 `logs/expert-webviews.log`。延迟采样只是观测，不是完成确认。这些记录不修复点击故障，仍需安装包实机复现。

手动 Runner 工作流可通过 `build_update_bundles` 导出各平台签名更新上传 ZIP，默认关闭。OneAPI 管理员独立于 GitHub Release 发布这些包，详见[桌面端更新分发](../../services/one-api/docs/desktop-updates.md)。即使关闭签名导出，安装包也嵌入已配置的 `DSH_DESKTOP_UPDATE_PUBLIC_KEY`；缺少公钥时不提供更新。

账户设置提供安装版本、手动检查和持久化的自动检查开关，默认开启。原生端在启动十五秒后及之后每六小时检查。下载和安装各自需要确认。原生更新器验证清单签名及其版本、平台和文件签名，再按签名字节数限制下载，并校验 SHA-256 和 Minisign。检查与下载复用配置的 OneAPI 后台及代理路径前缀，不需要独立公网下载地址或访问互联网。服务器返回的相对文件路径不能改变该后台。允许 HTTP，但检查和下载均不跟随重定向。下载文件仅保留在内存，最多 2 GiB，退出后丢弃。HTTP 下的更新说明和更新可用性未经认证。

更新命令只接受 `main` 原生窗口内的 `main` WebView，即使该窗口同时包含专家子 WebView 也适用。专家子页面不能读取更新状态、修改自动检查开关或请求更新。

安装通过私有 stdin 请求所属后台进程检查运行中的 Agent、空闲维护、后台作业、工具执行以及自动化认领／执行区间；存在任一活动就拒绝。Host 冻结新工作，等待整个插件树清理后才确认正常退出。原生父进程要求三十秒内收到确认，并在随后十五秒内确认进程成功退出；更新流程不强杀后台。忙碌、超时或退出状态不明确时不安装，并保留下载供重试。确认退出后若安装失败，会重启当前应用；Windows 启动 NSIS，macOS 和 Linux 在替换后重启。代码及隔离进程检查不代表安装版升级兼容性，Windows、macOS 和 Linux 仍需发布实机验收。

专家原生视图和 SkillHub 压缩包安装不根据部署网络标签拒绝操作。原有网址、票据、压缩包及安装校验继续有效；实际请求失败由所属功能页面展示。[服务连通性](../../.agents/notes/implemented/feature/2026-10-16-service-reachability-placeholders.zh.md)说明功能行为。

Windows NSIS 安装、升级和卸载保留应用数据目录，包括已安装技能、会话、设置和迁移标记。产品固定版本的[安装器模板](src-tauri/windows/installer.nsi)移除删除数据的复选框和删除命令；卸载仍移除程序文件。`check:installer-data` 拒绝重新引入数据删除或改变正式版标识，并在安装包 CI 中运行。既有旧卸载程序不会自动获得保护：替换旧版时须保留应用数据。主动手动删除和磁盘故障不属于此保证。

技能自动工作区保存在产品 Harness home 的 `workspaces` 目录，不在安装器、运行资源或临时目录中。仅限主窗口的 `create_automatic_workspace` 命令接受本地时间的十四位 `YYYYMMDDHHmmss` 名称，以独占方式创建目录；重名追加 ` (2)`、` (3)` 后缀，不修改已有内容。普通工作区索引持久化侧边栏成员关系。替换安装版本保持此用户数据位置；主动删除用户数据不属于更新保留保证。

macOS 保留继承的系统临时目录，将随包 Node 的目录放到 Sidecar PATH 首位，保留现有工具路径并补充 Homebrew 目录。Python 用户依赖及 pip 下载使用宿主临时目录下按产品隔离的私有目录，该区域已在工作区写入模式的允许范围内。缓存可跨启动复用，但可能被系统清理，不属于持久用户数据。只读限制和扩大访问范围的审批保持有效。Windows 和 Linux 保持既有启动环境；Mac 安装版行为仍需实机验证。

Tauri 2 桌面壳会以本地回环 DSH Sidecar 的形式启动 `wanwei-desktop` profile，等待其输出带鉴权信息的 Web 地址，再创建主 WebView。它把 `DSH_HOME` 放在应用的本地数据目录下。万维自有桌面命令通过明确的 WebView 权限提供。连接器页的钉钉卡片在桌面 runtime 随包 `dingtalk-workspace-cli`（`dws`，WorkBuddy 式连接），并把 `dws-cli` 技能写入同一 `DSH_HOME`。微信助理使用腾讯 iLink 扫码绑定与入站聊天桥接（凭据在 `$DSH_HOME/wechat-assistant`）。产品仅保留 `@dingtalk-real-ai/dsh-dingtalk` 作为 `dws-cli` 技能资源；不挂载钉钉 Stream IM，也不要求填写机器人 Client ID / Secret。

聊天框文件粘贴复用有容量限制的工作区导入器。仅限主窗口的 `import_clipboard_workspace_files` 命令通过禁用图片特性的 [clipboard-rs](https://github.com/ChurchTao/clipboard-rs) 读取系统剪贴板文件列表，接受绝对路径或本地文件 URL。不读取剪贴板纯文本、不移动源文件，也不向专家 WebView 授予剪贴板权限。原有同名处理、符号链接拒绝和大小限制保持有效。Windows 编译及路径测试已自动化，Windows 和 macOS 安装版复制粘贴仍需发布前实机验证。

主 WebView 的新窗口请求会在系统默认浏览器打开 HTTP(S) 链接。其他 URL 协议不会启动外部程序，对话链接也不会创建第二个应用内 WebView。

独立专家网页仍在实施。已上架专家在主窗口内的独立子 WebView 打开；桌面壳按每次打开的具体 HTTP 或 HTTPS 来源和视图标签登记权限。macOS 安装包仅允许 `ac.zjugis.com` 通过不安全的 HTTP 加载，以便当前 HTTP 网关能在 WKWebView 中显示；此例外不会加密传输，网关改用 HTTPS 后应移除。目录、一次性身份票据、桌面桥与视图关闭/定位还须在 Windows、macOS、Linux 实机验证后才能发布。专家网站是高权限代码，上架前必须审核其 iframe 与跳转行为。六个正式网站及一次性切换尚未完成，详见 `WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md`。

正式构建使用 `<com.wanwei.harness 本地数据目录>/dsh-home`。首次启动 Sidecar 前，迁移旧版 `~/.dsh` 和此前独立应用的 `com.wanwei.harness.preview/dsh-home`；优先级为正式目录已有数据、此前独立应用数据、旧版数据。原始目录与恢复副本均保留。工作区 v2 索引按文件系统路径合并，会话 ID 去重；相同日志去重，字节前缀相同的续写日志保留较长版本。分叉日志和冲突技能完整保留在来源副本中，路径写入 `.wanwei-formal-migration-v2.json`；只有优先版本处于使用状态，不会展示为两条会话。不同版本的技能脚本不混合。历史登录凭据与可执行 Profile 补丁不导入。原始工作区文件及绝对路径引用不搬动；外部文件缺失与不支持的会话格式仍需恢复，迁移不重新解释会话事件。完整暂存目录发布后才启动，中断发布可恢复；工作区索引不兼容时停止迁移，不以缺失历史的状态启动。升级前请关闭两个旧应用。

| 通道 | 产品名称 | 应用标识 |
|---|---|---|
| 已安装正式版 | 万维Buddy | `com.wanwei.harness` |
| 本地开发版 | 万维Buddy | `com.wanwei.harness.development` |

正式版沿用原产品的安装身份；开发版的单实例锁、WebView profile 和数据目录继续隔离。开发数据与 Mock 配置不作为迁移来源。

## 验证

Linux 原生更新仅接受 AppImage 安装。DEB 安装版在下载或停止后台之前拒绝自动安装，需要手动安装升级包。实机验收须同时核对安装格式、操作系统和架构。

本地及 SkillHub 技能 ZIP 最多接受 4096 个条目，包括显式目录条目；本地目录及文件列表导入最多接受 4096 个文件。压缩和解压后的大小限制各为 16 MB，目录深度限制为 16 层，不安全路径及符号链接仍被拒绝。SkillHub 导入错误标明来源，条目超限时报告压缩包的实际数量。这些原生校验需要更新桌面二进制，服务器技能包限制单独管理。

手动触发的[桌面工作流](../../.github/workflows/wanwei-desktop-preview.yml)包含 Linux x64 和 ARM64 的原生 Ubuntu 22.04 构建，按架构分别保存安装包产物。每个 Linux 任务请求生成 DEB 和 AppImage，并暂存当前架构的 Node 运行时和依赖。生成安装包不代表已经兼容 UOS 系统库；安装和启动需要在目标 UOS 版本上测试。

```sh
pnpm --filter @wanwei/dsh-desktop check:identity
pnpm --filter @wanwei/dsh-desktop check:sidecar
pnpm --filter @wanwei/dsh-desktop check:rust
```

源码开发模式直接运行当前 checkout 中的 TypeScript CLI。`prepare:runtime` 会在 `src-tauri/resources/runtime-<version>` 中创建自包含生产运行时：部署万维专用生产依赖闭包（DSH 运行时、万维产品包及其传递 npm 依赖，加上 PDF、DOCX、XLSX 解析器），把所需 workspace 对等包恢复为普通文件，剔除 `tests/` 与 `*.spec.ts` 等开发残留（避免 Windows NSIS 因路径过长解压失败），复制 Node 22，并预检暂存后的 `wanwei-desktop` profile。`check:runtime` 会用随包 Node 启动文档辅助程序和产品 profile，缺少解析器或插件依赖时会在制作安装包之前失败。官方 Python 运行时清单保持不变。生成的运行时文件由 Git 忽略，每次制作安装包时重新构建。

```sh
pnpm --filter @wanwei/dsh-desktop prepare:runtime
pnpm --filter @wanwei/dsh-desktop check:runtime
pnpm --filter @wanwei/dsh-desktop build
```

默认 `build` 会重新构建官方 DSH 产物、暂存并验证运行时，再通过 `tauri build --no-bundle` 生成本地 release 二进制，不制作安装包。GitHub Actions 使用受 `GITHUB_ACTIONS=true` 保护的 `build:runner` 制作对应平台的安装包；本地调用会立即失败。文件导入、技能管理、登录窗口行为和其他旧版命令分别在后续步骤迁移。

已上架的专家 Webview 通过桌面桥调用 `save_expert_artifact({ fileName, bytesBase64 })`。接口仅接受专家 Webview，校验成果字节（最大 128 MB）、文件名和支持的扩展名，并打开原生“另存为”窗口。只有用户选择目标路径和确认覆盖，网站不能提交本机路径。保存后返回绝对路径，取消返回 null，拒绝更改原始扩展名。普通浏览器使用浏览器下载；原生交互仍需逐平台验收。
原生桌面收到就绪地址后继续读取后台服务 stdout。启动失败时，先终止并等待直接后台进程退出，再返回错误；这不保证终止用户任务启动的所有后代进程。
原生文件导入以独占方式创建目标文件和目录。如果选名后出现同名目标，导入失败，不覆盖或删除已有目标。目录复制失败只清理本次调用创建的目录。
关闭主窗口会隐藏窗口；macOS Dock 重新打开事件会恢复并聚焦已有窗口。正常应用退出会停止直接后台进程，包括不经过托盘菜单的退出；强制终止不在此保证范围内。
运行时打包解除依赖符号链接和 Windows junction，不递归删除它们指向的目录。旧文件迁移先创建各来源的备份目录，再复制根目录的设置与身份文件，写入并同步临时文件后以不覆盖目标的硬链接方式发布；目标文件系统必须支持硬链接。复制失败不会留下半份正式文件，强制中断可能留下未被引用的临时文件。
