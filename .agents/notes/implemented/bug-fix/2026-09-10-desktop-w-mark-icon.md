# Agent Note: Desktop W mark icon
English | [中文](2026-09-10-desktop-w-mark-icon.zh.md)

Status: implemented

## Problem

The desktop title bar and installed Windows shortcut still used an older product mark while the application interface showed the 万维Buddy W mark.

## Decision

The desktop bundle generates every platform icon, including the Windows `.ico`, from the supplied W-mark vector on a transparent square canvas. Tauri uses the generated icon for the title bar, taskbar, tray, installer, and desktop shortcut.

## Alternatives considered

**Change only the window icon.** The shortcut and installed application would retain the old mark, leaving multiple identities on the same Windows desktop.

**Use the horizontal wordmark as an application icon.** Small Windows icon surfaces need a square mark; the horizontal asset is retained for in-product branding.

## Consequences

New desktop builds show one consistent W mark across native Windows surfaces. Existing installed builds keep their embedded icon until reinstalled.
