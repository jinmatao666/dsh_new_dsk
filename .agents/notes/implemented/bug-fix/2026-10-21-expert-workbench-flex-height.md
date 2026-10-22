# Agent Note: Preserve expert workbench height through the panel body

Status: implemented

English | [中文](2026-10-21-expert-workbench-flex-height.zh.md)

## Problem

An active expert tab can have a zero-height native-view holder. The panel and expert container use flex sizing, but the intermediate panel body is a block container. Removing minimum heights for the active workspace therefore collapses its content. The valid-bounds guard prevents or hides the native child, leaving a blank workbench on both desktop platforms.

## Decision

Only active-workbench mode makes the panel body a column flex container with no bottom padding or independent scrolling. The expert container and native holder fill the available height. Returning to the catalog removes that mode and restores ordinary catalog scrolling. Keep the native minimum-size validation: an invalid view must not be opened merely to conceal a layout defect.

Native child operations are serialized within each mounted launch. Creation hides the child before returning; the renderer awaits bounds before showing it. Cleanup drains pending operations before hiding and closing, preventing a late show from covering another feature page. Failed visibility calls do not commit cached state. The catalog removes failed tabs, close retries once, and native hiding or closing restores main-view focus. Native geometry and visibility commands are asynchronous so their UI-thread dispatch does not block a synchronous command handler.

Windows main and expert views share a browser-argument constant. WebView2 rejects a second environment with different arguments for the same browser data directory. Tauri's child builder can return a dispatcher even when Wry's native creation fails; Wry creates a visible child container before creating the browser environment. This permits an unusable child to cover the main page without a navigable WebView. Creation therefore reads native bounds before succeeding, and Windows show/hide commands confirm actual controller visibility. Geometry errors retain their cause in diagnostics, whose JSON-line writes are serialized.

## Alternatives considered

A fixed workbench height can overflow smaller windows and waste space in larger windows. Removing the native size guard leaves the underlying layout invalid. Completing the flex chain gives the native holder usable bounds after launch, sidebar changes and resizing.

Resizing the window can refresh native bounds but does not repair view ownership or request ordering. Caching visibility before native acknowledgement suppresses recovery after a failed hide. Fire-and-forget close permits a pending show to outlive the component. Serializing these operations retains native website sessions without relying on resizing as recovery.

## Consequences

Read-only Windows samples connect controller parent handles with the main window's bounded descendant tree, cursor hit ownership and UI-thread focus/capture. They retain only fixed class categories and geometry/state, not window text or external application trees. This supplies evidence for native occlusion even when no DOM click arrives, but post-event sampling is not a record of the exact hit at the instant of a missing click.

Diagnostic revision 2 separates queued operations from read-back results and correlates them by a hashed view identifier. Operation durations, requested bounds, native errors, lifecycle stages, callback timeouts and post-close queries identify the stage at which an instance stops progressing. Capture/bubble/settled DOM facts include disabled state and modal counts without collecting user content. The process cap records truncation explicitly. Failure to observe DOM input alone does not establish which native window intercepted a physical click.

The Windows `check:expert-window` probe isolates its browser data and loopback HTML fixture from installed user data. It reproduces the mismatched-argument failure and verifies five corrected create/load/show/bounds/hide/close cycles, main-view resizing and programmatic DOM handlers. It uses the production browser arguments and visibility confirmation helper. It does not verify physical mouse hit-testing, production tickets or macOS/Linux behavior.

Native input investigation uses bounded, content-free telemetry rather than inferring disposal success from queued command results. The main view alone reports structural click facts after expert activation, while native snapshots read view enumeration, geometry, focus and Windows controller visibility. Sampling after hide/close and resize permits comparison with DOM hit delivery. The trace does not establish that parent-window message handling causes the failure; that remains a hypothesis requiring installed Windows reproduction.

The fix is shared Client CSS and does not change expert URLs, tickets or server deployment. The browser regression boots the desktop profile, uses the real panel and expert plugins, mocks only the external backend and native bridge, and measures actual element bounds through launch, resize, tab reuse, closure and catalog restoration. Component tests with mocked rectangles alone cannot detect this failure. Native Windows and macOS packages still require platform acceptance after rebuilding.
