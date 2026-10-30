# Agent Note: 个人知识库目录按政务组织架构浏览

Status: implemented

[English](2026-10-29-knowledge-personal-directory-by-organization.md) | 中文

## Problem

管理员已在「用户权限 → 组织架构」维护层级组织树与成员归属。管理工作台「个人知识库」仍按扁平的 `department_name` 分组，并默认打开「全部人员」名册，既忽略真实组织树，又在筛选前把全部账号铺开。

## Decision

管理员在「个人知识库」标签下，左侧目录读取 `/api/government-organization/` 与 `/api/government-organization/memberships`，按组织编辑器同一邻接树展示（仅节点，导航中不挂人员叶子）。选中节点后，右侧列出在该节点或其子孙节点上有直属归属的人员；页面不再提供「全部人员」入口，未选中节点时不渲染人员网格。无任何归属的账号在集合非空时出现在「未分配组织」。普通用户通过 scoped 目录接口使用相同的左树右人布局；见[组织同事个人目录](2026-10-30-knowledge-personal-directory-org-peers.zh.md)。分类标签与点开人员后的文件清单不变；本决策只替换个人目录「谁出现在何处」的数据源。另见[知识库分类](2026-10-23-knowledge-library-categories.zh.md)与[政务组织架构树](2026-10-24-government-organization-tree.zh.md)。

## Alternatives considered

**保留「全部人员」加扁平 department_name 分组：** 否决。政务组织树已成为归属模型后，再维护第二套过时层级会重复且失真。

**在个人知识库导航里像组织编辑器一样把人员挂成树叶：** 否决。本页要求按结构浏览且不在树中铺开全部人员；人员只在选中节点后出现在右侧。

**只显示已有个人知识库的人员：** 暂缓。节点下仍按归属决定可见性，便于管理员打开尚无库的账号；知识库数量仍显示在人员卡片上。

## Consequences

个人浏览依赖组织节点与成员维护；空树显示引导文案，不再回退为全员名册。一人多归属时，选中任一相关路径都能看到该人。选中上级节点会包含子孙成员，公司级点击仍可能列出较多人员——这是有意的向下继承，不是「全部人员」快捷入口。

## Testing

管理工作台 React 测试 mock 组织与成员接口，断言加载时无「全部人员」名册、可按节点与「未分配组织」过滤，并保留人员文件清单与预览路径。普通用户 scoped 同事目录的覆盖见[组织同事个人目录](2026-10-30-knowledge-personal-directory-org-peers.zh.md)。
