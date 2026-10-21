# Agent Note: Preserve expert workbench height through the panel body

Status: implemented

English | [中文](2026-10-21-expert-workbench-flex-height.zh.md)

## Problem

An active expert tab can have a zero-height native-view holder. The panel and expert container use flex sizing, but the intermediate panel body is a block container. Removing minimum heights for the active workspace therefore collapses its content. The valid-bounds guard prevents or hides the native child, leaving a blank workbench on both desktop platforms.

## Decision

Only active-workbench mode makes the panel body a column flex container with no bottom padding or independent scrolling. The expert container and native holder fill the available height. Returning to the catalog removes that mode and restores ordinary catalog scrolling. Keep the native minimum-size validation: an invalid view must not be opened merely to conceal a layout defect.

Native child operations are serialized within each mounted launch. Creation hides the child before returning; the renderer awaits bounds before showing it. Cleanup drains pending operations before hiding and closing, preventing a late show from covering another feature page. Failed visibility calls do not commit cached state. The catalog removes failed tabs, close retries once, and native hiding or closing restores main-view focus. Native geometry and visibility commands are asynchronous so their UI-thread dispatch does not block a synchronous command handler.

## Alternatives considered

A fixed workbench height can overflow smaller windows and waste space in larger windows. Removing the native size guard leaves the underlying layout invalid. Completing the flex chain gives the native holder usable bounds after launch, sidebar changes and resizing.

Resizing the window can refresh native bounds but does not repair view ownership or request ordering. Caching visibility before native acknowledgement suppresses recovery after a failed hide. Fire-and-forget close permits a pending show to outlive the component. Serializing these operations retains native website sessions without relying on resizing as recovery.

## Consequences

The fix is shared Client CSS and does not change expert URLs, tickets or server deployment. The browser regression boots the desktop profile, uses the real panel and expert plugins, mocks only the external backend and native bridge, and measures actual element bounds through launch, resize, tab reuse, closure and catalog restoration. Component tests with mocked rectangles alone cannot detect this failure. Native Windows and macOS packages still require platform acceptance after rebuilding.
