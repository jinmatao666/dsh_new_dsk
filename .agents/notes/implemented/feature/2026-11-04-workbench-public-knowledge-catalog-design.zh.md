# Agent Note: 管理工作台公开知识库目录视觉对齐

Status: implemented

[English](2026-11-04-workbench-public-knowledge-catalog-design.md) | 中文

## Problem

管理工作台分类标签（公开与授权库网格）虽已有头图卡片与顶栏操作，但页头缺少 js.design 装饰条，分类工具条仍包在磨砂底板里，卡片「更多」菜单位于标题行而非头图右上，公开标签画板仍像更早的扁平目录。

## Decision

在不改分类接口、页签归属（个人 + 各已创建分类）与可见性规则的前提下，把分类标签目录对齐 js.design 公开知识库画板。在 `services/one-api/web/air/public/knowledge-icons/` 暂存 `page-header-art.png`，作为页标题右侧装饰图。分类工具条改为透明的搜索 / 排序 / 新建一行。分类卡片的标与色系匹配头图按库名解析，见[管理工作台授权知识库卡片名称主题](2026-11-04-workbench-authorized-knowledge-card-themes.zh.md)；保留首标签副标题，管理员「更多」菜单固定在头图右上。个人目录顶栏与组织 → 人员浏览仍见[管理工作台个人知识库目录视觉对齐](2026-11-04-workbench-personal-knowledge-directory-design.zh.md)。

## Alternatives considered

**把分类收成固定的「个人 / 授权 / 公开」三页签。** 否决：产品页签仍是个人加各已创建分类；设计稿里的「授权知识库」「公开知识库」是示例分类名，不是新的分组模型。

**省略头图、只用 CSS 渐变近似。** 否决：文件夹 / 文档装饰条才是公开标签页头的视觉真源，与其他 knowledge-icons 切图一致。

**保留个人水色时代的磨砂工具条底板。** 否决：公开标签画板是水色上的扁平操作行。

## Consequences

管理工作台构建需带上 `page-header-art.png`，否则头图 404，但布局仍可用。分类页「新建知识库」仍用 Lucide 加号；个人目录新建仍用 `icon-new-library.png`。
