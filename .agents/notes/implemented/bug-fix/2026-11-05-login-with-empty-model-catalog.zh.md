# Agent Note: 允许空模型目录账号登录

Status: implemented

[English](2026-11-05-login-with-empty-model-catalog.md) | 中文

## Problem

账号认证成功但模型目录为空时，桌面拒绝进入，并可能强制要求首次模型配置。

## Decision

当前模型详情接口及旧版模型接口返回空目录时仍保留有效登录。同步仅修改托管路由，不从空目录设置默认模型；凭证失效仍退出登录。Buddy的模型设置策略跳过首次引导，并覆盖策略晚注册的情况。

## Alternatives considered

将空目录视为凭证无效会混淆账号身份和模型权限。

## Consequences

用户可以先进入设置配置本地模型，发送问答仍需可用模型；网络和认证错误保留原有处理。
