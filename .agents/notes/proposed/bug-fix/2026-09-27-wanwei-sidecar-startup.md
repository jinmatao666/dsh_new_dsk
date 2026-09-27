# Agent Note: Wanwei sidecar startup ownership

Status: proposed

English | [中文](2026-09-27-wanwei-sidecar-startup.zh.md)

## Problem

The desktop stdout reader exits after the readiness URL, closing the pipe while Node can still write to it. Startup errors also drop the child handle without terminating its process, potentially retaining runtime files on Windows and leaving an unused service on macOS or Linux.

## Proposal

Drain stdout until EOF while announcing readiness once. On startup failure, kill and wait for the direct child before returning the original error. Keep this product behavior in the Wanwei desktop directory.

## Alternatives considered

**Only increase the startup timeout.** This does not prevent pipe closure or recover a failed child.

**Drop the child handle on error.** Rust child handles do not terminate processes when dropped.

## Acceptance criteria

Regression tests consume output after readiness even with a disconnected receiver, publish readiness once, and prove a failed startup has reaped a real test child. Windows tests and macOS/Linux release smoke checks remain separate evidence.

## Risks

The direct-child cleanup is not process-tree ownership. Closing the tray application with running descendant tasks requires separate platform verification. Native cross-platform runtime acceptance remains pending.
