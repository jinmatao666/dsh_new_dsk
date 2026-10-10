# Agent Note: Server-owned login settings

Status: implemented

English | [中文](2026-10-10-server-owned-login-settings.zh.md)

## Problem

Desktop users must follow their deployment's network environment rather than choose an incompatible local mode. Password assistance needs a real maintenance contact; unfinished sign-in methods must not simulate authentication.

## Decision

The configured OneAPI backend owns network classification and maintenance contacts through SystemDeploymentSettings. Its public `/api/desktop-config` returns only network, operator and phone, without authentication or other administrative options. The authentication Host validates this response and updates its existing durable policy during Client authentication refresh and before login. A failed lookup blocks login without replacing the confirmed policy. Reading support contacts does not mutate policy.

The login page has no network selector. Forgot password and the footer administrator link open the same contact dialog and restore focus to their respective trigger. SMS and QR buttons retain account login and announce that the feature is unavailable. Registration and simulated QR/SMS controls are absent. Remember me saves only the username in browser-local storage after successful login, never the password; unchecking it removes the saved account. Storage failures do not block authentication. Existing card dimensions and reserved vertical space are retained.

This partially supersedes [desktop network environment](2026-09-30-desktop-network-environment.md): that note still owns feature restrictions, link classification and restoration, while this note owns the server-selected mode.

## Alternatives considered

**Local selection:** rejected because the administrator's deployment setting is authoritative.

**Assuming Internet when configuration is unavailable:** rejected because it can expose unavailable public capabilities in private deployments.

**Displaying contacts inside the form:** rejected because it changes login-card height.

## Consequences

The account form redistributes 30 pixels from the removed network selector's reserved space into its three internal gaps. Account and password fields move upward while the outer card and the submit/legal area retain their geometry; no extra placeholder copy is added.

Unavailable sign-in notices float above the login layout with a decorative blue information icon, a pale blue border and a restrained shadow. After three seconds they fade out and rise 12 pixels over 240 milliseconds before removal; reduced-motion mode omits movement and transitions. Repeated clicks restart the timer, including during dismissal, without changing account inputs or card geometry.

The backend with the public configuration endpoint must be deployed alongside the desktop update. Operator name and phone are intentionally visible before login; administrators must enter work contact details. Mode refresh occurs on focus, visibility, the five-minute authentication timer and login, not through a server push. The policy remains an application restriction, not a firewall.

Focused UI and configuration tests cover unchanged account inputs, contact display and invalid responses. Native Windows/macOS visual acceptance remains manual.
