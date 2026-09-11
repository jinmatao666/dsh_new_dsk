# Agent Note: 桌面端旧安装包迁移

Status: implemented

[English](2026-09-11-desktop-legacy-installer-migration.md) | 中文

## Problem

将桌面端产品名称从 ZJUGIS Harness 改为万维Buddy 后，Tauri 在 Windows 中使用了新的安装目录、卸载注册表项和快捷方式名称。因此 Windows 会保留旧版本，同时单独安装改名后的版本。

## Decision

NSIS 的安装后钩子会从当前用户的卸载注册表项中定位 ZJUGIS Harness；未找到时使用其原来的默认安装目录。万维Buddy 安装完成后，除非新版本被刻意安装到相同目录，否则钩子会以静默方式运行旧版本的卸载程序。

迁移会保留用户数据。旧卸载程序在静默运行时仅移除自身的安装文件和快捷方式，不会选择其可选的应用数据删除项。稳定的 bundle identifier 仍为 `com.wanwei.harness`，新版本继续使用原有的应用数据。

## Alternatives considered

**保留旧版本，仅删除桌面快捷方式。** 旧安装仍会注册在 Windows 中，并可从开始菜单或应用列表启动，导致两个产品身份并存。

**恢复旧产品名称。** 这样能避免重复安装，但新安装包、快捷方式和 Windows 应用列表仍会显示 ZJUGIS Harness。

**直接删除旧安装目录。** 旧卸载程序才是其文件和注册表项的所有者；调用它无需猜测旧版本创建了哪些文件或快捷方式。

## Consequences

首个包含该迁移逻辑的万维Buddy 安装包会在新版本成功安装后移除旧的 ZJUGIS Harness 版本。后续升级走万维Buddy 的正常升级路径。若旧版本无法被找到或卸载，新版本仍可正常使用，旧版本仍可在 Windows 应用列表中单独移除。
