# 桌面端更新分发

[English](desktop-updates.md) | 中文

## 管理员操作

版本发布页面包含“桌面端更新包”页签。只有系统超级管理员可以查看、上传、发布或撤下桌面版本。上传 Runner 生成的单平台 ZIP，填写纯文本更新说明并等待校验。上传不等于发布；发布需单独确认，并使用配置的公钥再次验签。

发布 ZIP 必须恰好包含 `release.json`、`release.json.sig` 和清单指定的一个更新文件。清单和更新文件都使用兼容 Tauri 的 Base64 Minisign 预哈希签名。清单绑定产品 `com.wanwei.harness`、正式 `x.y.z` 版本、平台、文件名、字节数、SHA-256 和文件签名。未配置公钥时禁止上传和发布；后台页面不接收私钥。

每个系统／架构独立维护发布指针。缺少该平台发布版本时不返回更新。撤下隐藏当前版本，不回退到旧包。持久化的历史最高版本可阻止撤下后发布低版本。重复上传同平台同版本会被拒绝，应提高版本号。列表显示最近 200 次上传；更早记录和文件不会自动删除。

## 服务端配置

| 变量 | 含义 |
|---|---|
| `DESKTOP_UPDATE_DIR` | 私有更新文件目录，默认 `/data/wanwei/desktop-updates` |
| `DESKTOP_UPDATE_PUBLIC_KEY` | Tauri 生成的 Base64 公钥文件内容，绝不能填写私钥 |
| `DESKTOP_UPDATE_PUBLIC_URL` | 公网服务根地址，可含反向代理前缀；未设置时使用 `SERVER_ADDRESS` |
| `DESKTOP_UPDATE_MAX_BYTES` | 更新文件最大字节数，默认 2147483648，可配置为 1024 至 8589934592 |

共用 Compose 将 `DSH_DESKTOP_UPDATE_HOST_DIR`（默认 `/data/wanwei/desktop-updates`）挂载到容器 `/data/desktop-updates`，并传入 `DSH_DESKTOP_UPDATE_PUBLIC_KEY` 和 `DSH_DESKTOP_UPDATE_MAX_BYTES`。OneAPI 启动时在现有数据库新增 `desktop_updates`、`desktop_update_channels`。须同时备份数据库和文件目录。签名依赖要求 Go 1.21 或更新版本。新增测试在 Windows 使用纯 Go SQLite 驱动，生产 SQLite 驱动不变。

在现有 OneAPI 公网入口转发 `/desktop-updates/`，不要开启文件目录浏览。检查地址为 `/desktop-updates/{target}/{arch}/{currentVersion}`，返回 Tauri 更新 JSON 或 HTTP 204。下载地址从配置的根地址生成，不采信请求头。草稿和已撤下文件返回 404。版本和下载响应均使用 `Cache-Control: no-store`。管理员接口位于 `/api/desktop-updates`，受超级管理员鉴权保护并登记操作审计。

代理须允许相应上传大小并设置足够的请求时间。上传有大小限制，流式写入私有临时文件；每个服务进程同时接收一次上传。成功上传先移入唯一目录，再写数据库；失败会清理暂存文件。进程或主机突然故障可能留下 `.upload-*` 或未被数据库引用的文件目录，仅可在没有上传运行时人工检查清理。多实例须共享数据库和存储。PostgreSQL／MySQL 使用行锁串行发布同平台；SQLite 写竞争会让请求失败，需管理员重试，不会发布部分状态。

## Runner 分发

手动桌面构建工作流提供 `build_update_bundles`，默认关闭。普通安装包构建不需要签名密钥。签名构建要求仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY`、可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，以及公开仓库变量 `DSH_DESKTOP_UPDATE_PUBLIC_KEY`。工作流不生成密钥。须单独安全备份；更换 Git 仓库无需更换密钥对。

工作流启用 Tauri 更新产物，并为每个平台分别导出 `wanwei-update-*.zip` 产物。下载并解开 GitHub 产物外层包装，再将内部发布 ZIP 上传后台。Windows 使用 NSIS EXE，macOS 使用 `.app.tar.gz` 而不是 DMG，Linux 使用 AppImage。导出器接受正式版本和不超过 2 GiB 的文件，流式生成 ZIP，并拒绝覆盖已有输出 ZIP。构建发布包不会向服务器发布。

## 验证与限制

在 `services/one-api` 运行 `go test ./controller -run '^TestDesktopUpdate' -count=1`；在仓库根目录运行 `node --test products/wanwei-desktop/scripts/package-update.test.mjs products/wanwei-desktop/scripts/prepare-runner-config.test.mjs`。后者生成一次性测试密钥，用真实 Tauri CLI 签名，经真实上传处理器导入 ZIP 并检查发布。测试密钥会清理，不写入生产配置。

公开更新 JSON 包含原始清单文本及其签名，让原生客户端独立于 HTTP 验证版本和平台元信息。原生检查、下载确认、任务互斥和后台正常退出由桌面壳持有，不由此服务实现。测试不配置正式密钥、不部署服务器，也不执行 Windows／macOS／Linux 实机升级。签名 HTTP 下载不提供传输保密，也不能认证未签名的更新可用性及更新说明。应优先使用 HTTPS；签名不能代替 TLS 或 Windows／macOS 系统代码签名。
