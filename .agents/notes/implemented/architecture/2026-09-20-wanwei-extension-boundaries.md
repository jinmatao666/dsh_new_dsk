# Wanwei extension boundaries

English | [中文](2026-09-20-wanwei-extension-boundaries.zh.md)

The official browser packages expose product-neutral platform-action and deliverable-extension registries. Product shells register native directory opening, native file saving, additional artifact parsers, and artifact presenters through those registries.

Wanwei owns the Tauri command mapping, `WANWEI_RESULT` parsing, analysis presentation, OneAPI vision provider, and skill marketplace. Those implementations live under `packages/wanwei` and enter the application only through the Wanwei bundle.

This arrangement keeps the official Workspace, Session export, and Deliverables packages usable without a desktop provider. A missing provider removes the optional action or falls back to browser downloading. It also leaves official runtime artifact detection independent of private wire markers.

Future upstream updates should preserve the two generic registries or replace them with equivalent upstream extension points. Product protocol and native-command changes must remain in the Wanwei packages.
