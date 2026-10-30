# 官网安装包分发

[English](website-installers.md) | 中文

## 摘要

系统超级管理员在“版本发布 → 官网安装包”上传和发布首次安装包。官网单独部署并读取公开目录。官网安装包与签名桌面更新包分别存储记录、控制发布。

## 目录

- [发布安装包](#发布安装包)
- [存储与部署](#存储与部署)
- [接入独立官网](#接入独立官网)
- [验证与限制](#验证与限制)
- [开发备注](#开发备注)

## 发布安装包

选择 Windows x64（EXE）、macOS x64（DMG）或 macOS ARM64（DMG）。填写正式 `x.y.z` 版本号，上传实际安装程序，不能上传 Runner 产物外层压缩包或签名更新 ZIP。上传保存为待发布；确认发布后，该文件成为对应平台的下载版本，其他平台的选择保持独立。

撤下会隐藏当前安装包，不会回退到旧版本。已发布安装包必须先撤下才能删除。删除移除记录并尝试清理文件，清理失败时显示警告。管理列表显示最近 200 次上传，不会自动删除更早的记录。

## 存储与部署

文件保存为 `${DESKTOP_UPDATE_DIR}/website-installers/<id>/installer`。父目录默认 `/data/wanwei/desktop-updates`，以部署中实际配置的 `DESKTOP_UPDATE_DIR` 和持久化挂载为准。复用已有挂载，更新容器时保留宿主机源目录。数据库和该目录都需要备份。启动会添加安装包及发布状态表，回滚容器不会撤销数据库变更。

文件大小限制复用 `DESKTOP_UPDATE_MAX_BYTES`（默认 2 GiB）。网关需允许文件及 multipart 额外开销，并提供足够上传时间；网关更小的限制优先生效。通过现有后台入口将 `/api/website-installers` 和 `/downloads/installers/` 转发到 OneAPI，不直接公开存储目录。多个服务实例必须共用数据库和存储。

## 接入独立官网

没有已发布安装包时，`GET /api/website-installers` 返回 `{ "packages": [] }`。每个已发布安装包包含 `platform`、`arch`、独立的 `version`、`size`、`size_bytes`、`sha256`、`notes`、`publishedAt`、`filename` 和 `url`。配置 `DSH_PUBLIC_URL` 时返回包含接口前缀的完整地址；未配置时返回带 `DSH_API_PREFIX` 的相对路径，默认根路径行为保持不变。官网应同时支持完整 URL 和相对路径。三个平台独立发布，目录没有全局版本号字段。

目录允许不携带凭据的跨域 GET 请求。官网应省略凭据，解析返回地址后再设置下载按钮链接。HTTPS 官网需要 HTTPS 后台或同源 HTTPS 代理。公开下载支持 GET、HEAD 和字节范围请求。待发布、已删除和已撤下文件返回 404，响应禁止缓存。管理请求位于 `/api/admin/website-installers`，需要系统超级管理员身份；上传、发布、撤下和删除写入操作审计日志。

## 验证与限制

在 `services/one-api` 运行 `go test ./controller ./router -run '^Test(WebsiteInstaller|DesktopUpdate)' -count=1`。在 `services/one-api/web/air` 设置 `CI=true` 后运行 `npm test -- --watchAll=false --runInBand --runTestsByPath src/pages/VersionRelease/WebsiteInstallers.test.js src/pages/VersionRelease/DesktopUpdates.test.js`。测试覆盖发布、撤下、替换、删除、下载、鉴权、无效上传、文件完整性和管理页面交互，不会安装实际安装包或部署官网。

服务端检查可执行文件格式及 Windows x64 信息，或 DMG 尾部标记，再计算 SHA-256；发布时重新核对文件哈希。这些检查不认证应用版本、DMG 架构、系统签名或安装成功。可信管理员必须对照构建产物核实。进程突然终止可能遗留暂存或无引用目录，只能在停止上传期间检查清理。

## 开发备注

[安装包发布决策](../../../.agents/notes/implemented/feature/2026-10-30-website-installer-publication.zh.md)说明与桌面更新分离的原因和验证范围。
