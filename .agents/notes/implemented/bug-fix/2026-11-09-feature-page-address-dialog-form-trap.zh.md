# Agent Note: 功能页地址弹框必须离开设置表单

Status: implemented

[English](2026-11-09-feature-page-address-dialog-form-trap.md) | 中文

## 问题

管理工作台「功能设置」里土地市场 / 政策宝典的地址弹框挂在部署 `<form>` 内部。回车会提交外层表单却不写入地址草稿，再打开仍是旧地址。遮罩点击关闭还会在输入法选词点到遮罩时把弹框关掉。

## 决策

将 `FeaturePageAddressDialog` portal 到 `document.body`，并提高 z-index 盖过管理工作台壳层。取消点遮罩关闭；回车确认草稿（忽略 IME composition）；Escape 关闭；弹框打开时外层 `save` 直接返回。凭据状态错误留在弹框内，避免把 AxiosError 401 传给会跳转登录页的 `showError`。

## 曾考虑的方案

**弹框仍留在表单内，仅在输入框 `preventDefault` 回车：** 拒绝。输入法与误提交外层表单的路径仍在，遮罩也会与壳层叠层抢点击。

**在「确定」时单独写入 `/api/option/`：** 拒绝。功能设置继续用页脚一次「保存设置」提交整份部署配置，与知识库容量弹框一致。

## 后果

运维在「确定」后仍需点页脚「保存设置」。知识库容量弹框暂不改挂载方式，除非出现同类报告。
