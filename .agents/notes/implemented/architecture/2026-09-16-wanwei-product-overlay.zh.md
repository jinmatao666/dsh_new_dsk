# Agent Note: 万维产品 Overlay

Status: implemented

[English](2026-09-16-wanwei-product-overlay.md) | 中文

## 问题

万维桌面行为需要一个位于官方 base 与 Web bundle 之外的稳定所有者。直接修改这些 bundle 会在每次上游升级时混合产品策略与框架变化，使维护者无法识别最小兼容工作范围。

## 决策

随附的 `wanwei-desktop` profile 依次组装 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app` 与 `@deepseek-ai/dsh-wanwei-desktop`。最后一个私有 bundle 持有所有万维特有配置项与覆盖项，各功能包则持有自身运行时行为和可变 invariant。

产品 bundle 最初从空 patch 开始。每项私有能力都通过独立包和一个显式 patch 配置项接入，因此其依赖、测试与移除不会和官方组装混合。首项能力为 `@deepseek-ai/dsh-wanwei-oneapi-auth`：Host 侧负责登录、凭证、模型同步与 Provider 策略，Client 侧通过官方 Slot 与 Locale 服务负责阻塞式登录门禁和账户页面。Client 侧还完整持有万维产品介绍与登录界面，并以紫色预览主题区分本代产品，而不修改官方 Web 主题；账号登录保持真实可用，尚未配置的短信、扫码、找回密码、协议与申请开通操作则保持可见但不可用。

现有包中只有 profile 发现、CLI 安装闭包与 Host 构建聚合引用产品 bundle。这些接入点不承载产品行为。

仅支持手动触发的 `wanwei-desktop-preview.yml` workflow 负责跨平台安装包生产。其矩阵将 `products/wanwei-desktop` 分别构建为 Windows x64 NSIS、macOS arm64 DMG 与 Linux x64 DEB/AppImage 产物。每个矩阵项都通过产品脚本准备平台原生的自包含运行时；macOS 预览包使用 ad-hoc 签名，可选预发行版本会在产品专用标签下汇总全部平台 Artifact。该 workflow 没有 push 触发器，也不包含容器、OneAPI 部署或数据库 job。

## 考虑过的替代方案

**继续修改官方包。** 这种方式让每次即时修改靠近当前消费者，但会重新产生产品层原本要消除的全升级冲突集合。

**把完整官方 Web patch 复制进万维 bundle。** 这种方式立即得到自包含配置树，却会复制上游组装，并要求每次官方配置项变化后手工同步。

**只在安装器脚本中维护产品 profile。** 这种方式避免仓库接入点，却会让源码启动、配置 dump、测试与安装包启动分别使用不同的组装所有者。

## 后果

万维功能获得一个有序的组装边界，并可以独立迁移。仓库永久保留一小组集成差异，包括 profile 模板、CLI 依赖、构建引用、文档、真实构建 profile 测试与手动安装包 workflow。产品认证及其品牌入口页面现已隔离在一个可独立移除的包中；它们复用现有 OneAPI 协议和持久化，不要求修改服务镜像、数据库或官方 Web 主题。因此，安装包发布可以独立于现有 OneAPI 服务及其数据推进。
