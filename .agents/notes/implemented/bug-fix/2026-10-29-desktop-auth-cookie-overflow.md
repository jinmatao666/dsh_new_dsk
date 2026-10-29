# Agent Note: Desktop startup clears stale browser authentication cookies

Status: implemented

English | [中文](2026-10-29-desktop-auth-cookie-overflow.zh.md)

## Problem

The desktop Sidecar chooses an available loopback port at startup. Browser authentication names its persistent cookie for the request authority, including the port, while WebView2 sends cookies to the host regardless of port. Repeated launches can accumulate enough cookies to exceed the local HTTP server's request header limit before token exchange, producing HTTP 431.

## Decision

The native main window starts on `about:blank` and remains hidden until a background thread enumerates cookies for the Sidecar URL and removes names beginning with `dsh-auth-`. It then navigates to the tokenized startup URL and shows the window. Cookie enumeration runs outside the Windows UI thread because WebView2 completes that operation asynchronously. Cleanup failures are logged without logging token values.

## Alternatives considered

**Delete the entire WebView profile.** This would also discard unrelated browser state and makes recovery less precise.

**Increase HTTP header limits.** This permits continued cookie growth and affects every request to the local server.

## Consequences

Authentication is renewed from the current Sidecar launch token after cleanup. Workspace data is untouched. Native compilation verifies API use; installed Windows startup with an already accumulated WebView2 profile still requires release testing.
