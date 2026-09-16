# 万维 Buddy 预览版桌面端

[English](README.md) | 中文

这个私有产品目录持有万维桌面壳和安装器。它特意放在 `apps/` 与 `packages/` 之外，这两个目录继续作为上游 DSH 的应用层和包层。

## 当前边界

Tauri 2 桌面壳会以本地回环 DSH Sidecar 的形式启动新的 `wanwei-desktop` profile，等待其输出带鉴权信息的 Web 地址，再创建主 WebView。它始终把 `DSH_HOME` 放在预览版自己的本地应用数据目录下。旧桌面端命令尚未开放。

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

源码开发模式直接运行当前 checkout 中的 TypeScript CLI。`prepare:runtime` 会在 `src-tauri/resources/runtime` 中创建自包含生产运行时：部署经过评审的 DSH 生产依赖闭包，把所需 workspace 对等包恢复为普通文件，复制 Node 22，并预检暂存后的 `wanwei-desktop` profile。生成的运行时文件由 Git 忽略，每次制作安装包时重新构建。

```sh
pnpm --filter @wanwei/dsh-desktop-preview prepare:runtime
pnpm --filter @wanwei/dsh-desktop-preview check:runtime
pnpm --filter @wanwei/dsh-desktop-preview build
```

默认 `build` 会重新构建官方 DSH 产物、暂存并验证运行时，再通过 `tauri build --no-bundle` 生成本地 release 二进制，不制作安装包。GitHub Actions 使用受 `GITHUB_ACTIONS=true` 保护的 `build:runner` 制作对应平台的安装包；本地调用会立即失败。文件导入、技能管理、登录窗口行为和其他旧版命令分别在后续步骤迁移。
