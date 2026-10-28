# Agent Note: 按正文大小与 2 KiB URL 上限拆分 client-modules 启动 combo

Status: implemented

[English](2026-10-28-client-modules-combo-body-partition.md) | 中文

## 问题

Windows 上的打包 Wanwei 桌面端报 `Failed to load plugins`，伴随
`client-modules: bundle script /plugins/??…&rev=… failed to load`。application
阶段被压成单个 combo：请求目标约 2.6 KiB，可执行正文约 7 MiB，主要由
`@deepseek-ai/dsh-wanwei-knowledge-base` 内联 `pdfjs-dist` 及其 worker（约 2.7 MiB）
撑大。Chromium 仍能拉取并解析该脚本；打包 WebView 路径触发 script 元素的
`error`，并在共享该 URL 的首个 loader entry 处中止启动。

## 决策

保留按 URL 长度分区，但将上限从 3 KiB 降到 2 KiB，使生成的 combo 目标落在部分
Windows WebView 仍会碰到的经典约 2083 字节 request-target 范围之下。同时在合计
client bundle 字节将超过 2 MiB 时分区；单个过大正文仍可独占一个 chunk，因为路由
无法拆分单个文件。启动协议已支持多个 application preload 与 batch URL，因此除
partitioner 外无需改 client loader。

## 考虑过的替代方案

**只缩小 knowledge-base / 懒加载 pdf.js。** 对页面体积仍有必要，但不能防止下一个
肥胖 client 再次拼出单个数兆字节的启动脚本。

**保持 3 KiB URL 上限。** 失败的桌面 combo 已低于 3 KiB，却超过经典 request-target
范围，因此单靠该上限抓不住这次故障。

**在生产环境去掉 combo source map。** map 是独立的不可变响应；它们不驱动此处观察到
的 script 元素 `error` 路径。

## 影响

Wanwei 桌面 application 插件以多个较小的 classic script 加载，而不再是单个约 7 MiB
的 combo。此变更之后构建的安装包必须包含重建后的 `@deepseek-ai/dsh-client-modules`
node 半侧。在把 pdf.js 移出关键 client bundle 之前，knowledge-base 仍可能单独产生
超过 2 MiB 的 combo；该后续工作独立。

## 测试

`packages/client/modules/tests/node-half.client.spec.ts` 覆盖 2 KiB 的 URL 分区与
2 MiB 的正文分区，并断言相邻 batch 若合并会超过 URL 上限。
