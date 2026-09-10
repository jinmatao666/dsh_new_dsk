# Agent Note: 桌面端 W 标识图标
[English](2026-09-10-desktop-w-mark-icon.md) | 中文

Status: implemented

## Problem

桌面端标题栏和已安装的 Windows 快捷方式仍使用旧产品标识，而应用界面已显示万维Buddy 的 W 标识。

## Decision

桌面端打包从提供的 W 标识矢量图生成全部平台图标，包括 Windows `.ico`，并使用透明的正方形画布。Tauri 将生成的图标用于标题栏、任务栏、托盘、安装包和桌面快捷方式。

## Alternatives considered

**只修改窗口图标。** 快捷方式和已安装应用仍会保留旧标识，使同一个 Windows 桌面出现多种身份。

**将横版文字 Logo 用作应用图标。** Windows 小尺寸图标需要正方形标识；横版资源继续用于应用内品牌展示。

## Consequences

新构建的桌面端会在 Windows 原生位置统一显示 W 标识。已安装版本会保持嵌入的旧图标，直到重新安装。
