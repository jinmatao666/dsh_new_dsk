# Agent Note: 管理工作台个人知识库目录视觉对齐

Status: implemented

[English](2026-11-04-workbench-personal-knowledge-directory-design.md) | 中文

## Problem

管理工作台「个人知识库」标签虽已按组织 → 人员 → 文件浏览，但页头水色、页签、操作图标、组织选中态与人员卡片仍偏离 js.design 个人目录画板，线上管理端仍像更早的扁平名册。

## Decision

在不改目录接口与可见性规则的前提下，把管理工作台个人标签对齐 js.design 个人目录画板。页面水色为 `#e9f1fd` 加柔光径向高光；粘性顶栏在水色上保持透明。页签为 18px 文案、`#106af3` 下划线与实心计数胶囊。顶栏操作以 `services/one-api/web/air/public/knowledge-icons/` 下透明 PNG（`icon-subscription-review.png`、`icon-new-category.png`、`icon-new-library.png`）替换 Lucide 图标。组织侧栏为白底 15px 圆角面板；选中节点用 `#e9f1fd` 与深色文字（不再用蓝色渐变铺满）。人员卡片为约 246px 高的渐变底板，实心色姓氏头像（白字）、分行的「组织 / 路径」与「注册 / 日期」，以及数字在上、`知识库` / `总大小` 标签在下的居中统计。分类标签目录画板（页头装饰、扁平工具条、头图更多菜单）见[管理工作台公开知识库目录视觉对齐](2026-11-04-workbench-public-knowledge-catalog-design.zh.md)。

## Alternatives considered

**把个人目录拆成独立路由或包。** 否决：现有 `Knowledge/index.js` 已承载组织、人员与文件下钻，拆分只会重复鉴权与目录加载。

**保留 Lucide 图标、仅用 CSS 近似。** 否决：三个顶栏操作以产品切图为视觉真源，与桌面端 knowledge-covers 做法一致。

**给人员卡片网格分页。** 该面此前已否决；个人目录自有人员文件分页，设计稿对选中组织节点展示未分页卡片马赛克。

## Consequences

管理工作台构建需带上 `public/knowledge-icons/`，否则三枚顶栏图标 404，但布局仍可用。目录数据源与超管 / 普通用户范围仍见[个人知识库按组织架构浏览](2026-10-29-knowledge-personal-directory-by-organization.zh.md)与[组织同事个人目录](2026-10-30-knowledge-personal-directory-org-peers.zh.md)。
