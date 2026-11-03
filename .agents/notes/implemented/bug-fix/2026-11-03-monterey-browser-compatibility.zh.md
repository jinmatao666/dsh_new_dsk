# Agent Note: 桌面构建中的 Monterey 浏览器兼容处理

Status: implemented

[English](2026-11-03-monterey-browser-compatibility.md) | 中文

## Problem

一台 macOS 12.6.6 的 M1 Mac 出现桌面窗口和本地浏览器页面白屏。Sidecar 已输出监听地址，Cookie 清理也已完成。未拿到渲染器错误，因此尚未确认原始异常。

## Decision

万维产品在官方构建后，将壳的 JS/CSS 和动态插件的 JS/CSS 产物转换为 Safari 15.6 目标。阻塞式普通脚本在模块求值前安装 `core-js/stable`，覆盖客户端插件使用的 `Promise.withResolvers`、数组搜索和复制方法、结构化克隆等新 API。Node 包和官方源文件保持不变，兼容依赖和构建工具归私有桌面产品所有。

根节点仍为空时，启动加载错误或三十秒超时会显示重载提示。提示不展示错误内容或含令牌的地址，已有渲染内容予以保留。

## Alternatives considered

**要求升级浏览器。** 桌面端使用操作系统 WebView，与安装的 Chrome 独立。因此由产品构建提供兼容语法和缺失的标准 API，同时保留共用的 Node 产物。

## Consequences

Node 回归在执行生成的启动脚本和动态 CommonJS 插件前删除新 API，验证 Map 结构化克隆、CSS 嵌套和静态块转换、Node 产物不变、HTML 注入幂等和重载提示。兼容处理也已在本地现有浏览器产物上完成。这些检查不能证明 macOS 12.6.6 安装包兼容，也不能证明原始根因。需要重新构建后在异常 Mac 上验证；由于生成的浏览器资产共用，Windows 安装包也仍需验收。
