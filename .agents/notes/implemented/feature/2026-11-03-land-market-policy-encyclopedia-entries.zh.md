# Agent Note: 土地市场与政策宝典入口

Status: implemented

[English](2026-11-03-land-market-policy-encyclopedia-entries.md) | 中文

## 问题

管理员需要新增土地市场与政策宝典两个桌面入口：显示隐藏跟随现有分环境功能开关，页面地址单独配置。若没有独立配置面和桌面插件，这两个门户无法从管理工作台出现或更新。

## 决策

在 `SystemDeploymentSettings.features` 增加互联网/纯内网的 `landMarket`、`policyEncyclopedia` 布尔开关；旧记录缺省为隐藏（`false`）。新增 `featurePages`，分别为两个入口保存 http(s) 地址（允许空）。管理工作台「系统设置 → 功能设置」同时管可见性与地址：土地市场、政策宝典旁的蓝色「地址配置」打开页面地址弹框（原「功能配置」页签已去掉）。公开 `/api/desktop-config` 同时下发。桌面包 `@deepseek-ai/dsh-wanwei-portals` 注册两个功能面板，通过 `wanweiNetwork` 观察可见性与地址，用 iframe 嵌入页面并设置 `headerChrome: 'back-only'`（不显示 WANWEI Buddy / 标题 / 副标题，仅保留浮层返回），打开时经 `maximize_expert_window` 最大化窗口。iframe 加载期间，`PortalPage` 显示与知识库 `ViewerLoading` 视觉一致的全屏加载指示（本地 CSS 复制，不引入包依赖），在 frame 的 `load` 事件后清除，并在配置地址变更时重新显示。

## 考虑过的替代方案

**复用专家原生子 webview：** 这两个入口不需要专家票据，且要接受管理员配置的任意地址，因此不采用专家启动路径。

**两个门户共用一个开关：** 管理员可能只开启其中一个，因此不采用。

## 后果

管理工作台、OneAPI desktop-config 解析与万维桌面 profile 需同步更新。旧桌面端升级前会忽略新开关。拒绝 iframe 的站点会空白，直到后续提供原生嵌入；若浏览器在被拒嵌入后仍触发 `load`，加载指示会清除并留下空白框架。管理工作台、Go、deployment 与 Client 测试覆盖默认值、校验、可见性、已配置地址与加载层生命周期。
