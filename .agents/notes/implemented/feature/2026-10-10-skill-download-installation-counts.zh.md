# Agent Note: Separate skill downloads from distinct installations

Status: implemented

[English](2026-10-10-skill-download-installation-counts.md) | 中文

## Problem

桌面热门下载量和管理员安装量描述不同的数量。未携带登录凭证的安装上报被 OneAPI 拒绝，静默失败又隐藏了计数缺失。

## Decision

桌面使用 Host 保存的登录令牌上报平台技能成功安装或更新。OneAPI 在同一事务中递增原有下载总量，并保留一条账户与技能组合的安装记录。管理员安装量列统计去重账户数；桌面卡片显示累计总量。卸载不扣减任何计数。调用统计和 SkillHub 下载量保持不变。

## Alternatives considered

**共用一个计数器：** 按用户去重会隐藏桌面重复下载，累计计数则会夸大管理员列表中的独立安装人数。

**从历史总量推测身份：** 历史下载没有账户身份，回填去重人数会编造数据。

## Consequences

去重安装量从带登录凭证的上报开始累计；原有下载总量保留。完整功能需要同时更新 OneAPI 和桌面端。上报失败保留已完成的本地安装，并显示同步失败提示。下载上报不会自动重试，未送达记录也不会在重启后补报。
