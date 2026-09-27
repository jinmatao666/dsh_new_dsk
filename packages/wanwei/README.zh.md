---
description: "私有桌面产品插件：认证、目录、文档工具、视觉和界面呈现。"
kind: "package-group"
---

# wanwei/ — 私有产品插件

[English](README.md) | 中文

## 概述

这些插件提供桌面产品的登录、受管目录、本地文档工具、图像识别和界面呈现。桌面 Bundle 通过公开的 DSH 扩展接口组装它们。这些包保持私有，不参与官方 npm 发布。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

每个包负责自身的配置和行为。

| 包 | 提供的能力 |
|---|---|
| [oneapi-auth](oneapi-auth/README.zh.md) | 登录、受管模型和管理服务访问 |
| [product-ui](product-ui/README.zh.md) | 品牌、文件导入和成果呈现 |
| [skill-marketplace](skill-marketplace/README.zh.md) | 技能目录和独立专家网站 |
| [skillhub](skillhub/README.zh.md) | 外部技能发现和安装 |
| [document-local](document-local/README.zh.md) | 本地文档工具 |
| [vision](vision/README.zh.md) | 服务器管理的图像识别 |

<a id="related-documentation"></a>
## 相关文档

- [Web Client](../../docs/subsystems/web-client.zh.md) — 共享浏览器服务和插件组装。
- [桌面 Bundle](../bundle/wanwei-desktop/README.zh.md) — 产品组装。
- [解耦规范](../../WANWEI_DECOUPLING_RULES.md) — 依赖方向和所有权要求。

<a id="dev-note"></a>
## 开发备注

无。
