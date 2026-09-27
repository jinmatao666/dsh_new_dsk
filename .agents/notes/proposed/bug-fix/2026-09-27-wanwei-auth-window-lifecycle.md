# Agent Note: Desktop authentication and hidden-window lifecycle

Status: proposed

English | [中文](2026-09-27-wanwei-auth-window-lifecycle.zh.md)

## Problem

Status RPCs overlap login and logout and can return old snapshots after a newer action. Hiding the macOS window on close also requires handling the Dock reopen event; the tray-only restore handler does not receive that event.

## Proposal

Track authentication mutations and refresh request order in the Wanwei controller. Obsolete or cancelled refreshes cannot publish state or offline errors. Handle macOS Reopen by restoring the main window, and normal Exit by stopping the direct sidecar.

## Alternatives considered

**Disable focus refresh.** This loses useful session validation and does not fix already pending responses.

**Require tray-only reopening.** This leaves normal macOS Dock interaction unsupported.

## Acceptance criteria

Controller tests cover late refresh success, late failure, cancellation and login overtaken by logout. Native compilation and existing shell regressions pass on Windows. Dock reopen and system exit require actual macOS verification.

## Risks

Client ordering does not serialize remote Host operations. Normal exit cleanup does not cover forced process termination or guarantee descendant process-tree cleanup.
