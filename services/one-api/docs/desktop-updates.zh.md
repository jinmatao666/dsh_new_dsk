# 桌面端更新分发

[English](desktop-updates.md) | 中文

## 管理员操作

版本发布页面上方为统一上传表单，下方为发布列表。列表标题旁的系统和架构筛选只影响记录，不改变上传字段。只有系统超级管理员可以查看、上传、发布或撤下版本。填写正式版本号、系统和架构，再上传解压 `wanwei-update` Runner 产物后得到的单平台签名发布 ZIP，不要上传 `wanwei-buddy` 普通安装包产物。Multipart 上传必须提供 `version` 和 `platform`，两者须与签名清单完全一致，不能为包重新标记版本或架构；不一致时拒绝上传并清理暂存文件。上传不等于发布；发布需单独确认，并使用配置的公钥再次验签。Windows ARM64 尚无构建目标；Windows 支持 x64，macOS 和 Linux 支持 x64 与 ARM64。原移动应用、网站和服务重启记录保留在 `/operation/version-release/legacy`，桌面发布页不显示其入口，也不删除历史数据。

发布 ZIP 必须恰好包含 `release.json`、`release.json.sig` 和清单指定的一个更新文件。清单和更新文件都使用兼容 Tauri 的 Base64 Minisign 预哈希签名。清单绑定产品 `com.wanwei.harness`、正式 `x.y.z` 版本、平台、文件名、字节数、SHA-256 和文件签名；新版导出同时绑定编译后的构建标识。未配置公钥时禁止上传和发布；后台页面不接收私钥。

每个系统／架构独立维护发布指针。缺少该平台发布版本时不返回更新。撤下隐藏当前版本，不回退到旧包。仅当对应平台／版本的上传记录仍存在时，发布低于历史最高版本的更新才须由管理员额外确认；已删除记录不触发提示，旧部署遗留的历史值也适用。该情况显示提示，不弹错误通知。客户端检查允许相同或更高版本，拒绝更低版本。每次上传均使用独立发布标识，同平台同版本可上传多条记录；发布只选择一条，不覆盖历史。新版桌面端根据已安装包的签名 SHA-256 避免重复更新。列表显示最近 200 次上传；更早记录和文件不会自动删除。

超级管理员可在确认后永久删除未发布或已撤下的更新包；正在发布的更新包须先撤下。删除会移除数据库记录及对应更新文件目录，不会卸载客户端；上传记录已删除的历史版本值不会要求低版本发布确认。文件清理失败时记录仍保持删除，接口提示警告并记录文件标识，供运维清理。已删除记录不能发布或下载。列表操作保留当前页，最后一页失效时回到最后一个有效页；改变筛选则回到第一页。更新说明弹窗居中显示，限制在视口内，长文本可滚动。

## 服务端配置

| 变量 | 含义 |
|---|---|
| `DESKTOP_UPDATE_DIR` | 私有更新文件目录，默认 `/data/wanwei/desktop-updates` |
| `DESKTOP_UPDATE_PUBLIC_KEY` | Tauri 生成的 Base64 公钥文件内容，绝不能填写私钥 |
| `DESKTOP_UPDATE_MAX_BYTES` | 更新文件最大字节数，默认 2147483648，可配置为 1024 至 8589934592 |

共用 Compose 将 `DSH_DESKTOP_UPDATE_HOST_DIR`（默认 `/root/dsh/data/desktop-updates`）挂载到容器 `/data/desktop-updates`，将 `DSH_DESKTOP_RESOURCE_HOST_DIR`（默认 `/root/dsh/data/desktop-resources`）挂载到 `/data/desktop-resources`。上传下载处理器使用容器内环境变量指定的路径，不使用宿主机路径。同时传入 `DSH_DESKTOP_UPDATE_PUBLIC_KEY` 和 `DSH_DESKTOP_UPDATE_MAX_BYTES`。重新创建已有 Compose 部署前，必须把两个宿主机目录变量设为实际持久化目录；改变挂载来源，或在已有 `/data` 卷上增加子挂载，都可能隐藏已上传文件。源码发布部署脚本会保留已有挂载，包括 `/root/dsh/data` 下独立创建的随机后缀目录。OneAPI 启动时在现有数据库新增 `desktop_updates`、`desktop_update_channels`。须同时备份数据库和文件目录。签名依赖要求 Go 1.21 或更新版本。新增测试在 Windows 使用纯 Go SQLite 驱动，生产 SQLite 驱动不变。

在现有 OneAPI 入口转发 `/desktop-updates/`，不要开启文件目录浏览。检查地址为 `/desktop-updates/{target}/{arch}/{currentVersion}`，返回 Tauri 更新 JSON 或 HTTP 204。相对路径 `download_path` 指向该后台的更新文件。原生客户端以检查更新所用的后台地址解析它，保留代理路径前缀，不使用 Tauri 响应解析器要求的绝对 `url` 中的主机。不读取下载地址环境变量；网络须能连通配置的后台，但无需访问互联网。草稿和已撤下文件返回 404。版本和下载响应均使用 `Cache-Control: no-store`。管理员接口位于 `/api/desktop-updates`，受超级管理员鉴权保护并登记操作审计。

代理须允许相应上传大小并设置足够的请求时间。上传有大小限制，流式写入私有临时文件；每个服务进程同时接收一次上传。成功上传先移入唯一目录，再写数据库；失败会清理暂存文件。进程或主机突然故障可能留下 `.upload-*` 或未被数据库引用的文件目录，仅可在没有上传运行时人工检查清理。多实例须共享数据库和存储。PostgreSQL／MySQL 使用行锁串行发布同平台；SQLite 写竞争会让请求失败，需管理员重试，不会发布部分状态。

## Runner 分发

手动桌面构建工作流提供 `build_update_bundles`，默认关闭。普通安装包构建不需要签名密钥。签名构建要求仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY`、可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，以及公开仓库变量 `DSH_DESKTOP_UPDATE_PUBLIC_KEY`。工作流不生成密钥。须单独安全备份；更换 Git 仓库无需更换密钥对。

工作流启用 Tauri 更新产物，并为每个平台分别导出 `wanwei-update-*.zip` 产物。下载并解开 GitHub 产物外层包装，再将内部发布 ZIP 上传后台。Windows 使用 NSIS EXE，macOS 使用 `.app.tar.gz` 而不是 DMG，Linux 使用 AppImage。导出器接受正式版本和不超过 2 GiB 的文件，流式生成 ZIP，并拒绝覆盖已有输出 ZIP。构建发布包不会向服务器发布。

## 验证与限制

在 `services/one-api` 运行 `go test ./controller -run '^TestDesktopUpdate' -count=1`；在仓库根目录运行 `node --test products/wanwei-desktop/scripts/package-update.test.mjs products/wanwei-desktop/scripts/prepare-runner-config.test.mjs`。后者生成一次性测试密钥，用真实 Tauri CLI 签名，经真实上传处理器导入 ZIP 并检查发布。测试密钥会清理，不写入生产配置。

公开更新 JSON 包含原始清单文本及其签名，让原生客户端独立于 HTTP 验证版本和平台元信息。原生检查、下载确认、任务互斥和后台正常退出由桌面壳持有，不由此服务实现。测试不配置正式密钥、不部署服务器，也不执行 Windows／macOS／Linux 实机升级。签名 HTTP 下载不提供传输保密，也不能认证未签名的更新可用性及更新说明。应优先使用 HTTPS；签名不能代替 TLS 或 Windows／macOS 系统代码签名。
