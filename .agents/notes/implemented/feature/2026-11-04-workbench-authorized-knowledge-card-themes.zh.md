# Agent Note: 管理工作台授权知识库卡片名称主题

Status: implemented

[English](2026-11-04-workbench-authorized-knowledge-card-themes.md) | 中文

## Problem

管理工作台授权分类下的知识库卡片原先共用一块头图底板和单一默认标（或上传封面）。js.design 授权画板为每个设计名称库指定独立圆角标，并以标的色系匹配头图水色，同时要求图标与标题块垂直居中。

## Decision

在 `services/one-api/web/air/src/pages/Knowledge/index.js` 按库名解析分类卡片的标与头图。名称包含设计关键词时，使用 `public/knowledge-icons/icon-theme-*.png` 中对应标，以及与色系匹配的头图：

| 标色系 | 头图资源 |
|---|---|
| 绿（占补平衡 / 占卜平衡 / 占比平衡） | `card-banner-mint.png`（图4） |
| 黄 / 珊瑚（土地征收、地灾防治） | `card-banner-pink.png`（图3） |
| 蓝系（闲置土地、土地市场、耕地保护、规划实施、规划评估、临时用地、低效用地） | `card-banner-blue.png` |

关键词与标：占补/占卜/占比平衡 → grid，闲置土地 → clock，土地征收 → zheng，土地市场 → layout，地灾防治 → landslide，耕地保护 → seedling，规划实施 → draft，规划评估 → edit，临时用地 → schedule，低效用地 → gear。未命中关键词的名称保留默认标与蓝色头图；上传封面仅替换未命中时的标。卡片 `header` 叠在横幅上，标与标题块垂直居中。页头装饰与工具条仍见[管理工作台公开知识库目录视觉对齐](2026-11-04-workbench-public-knowledge-catalog-design.zh.md)。

## Alternatives considered

**所有卡片继续共用 `card-banner.png`。** 否决：设计水色是四块按标色配对的底板，不是单板。

**按卡片序号轮换四块头图。** 否决：同一设计名称在翻页与排序后必须保持同一底板。

**上传封面优先于设计关键词标。** 否决：设计名称库即使早先存过封面，也必须显示指定标。

## Consequences

Air 构建须带上十个 `icon-theme-*.png` 标与四块 `card-banner-*.png`，否则主题卡片 404，但布局仍可用。部分命中（如仅有「规划编制」）不会套用 规划* 主题，除非完整关键词出现。
