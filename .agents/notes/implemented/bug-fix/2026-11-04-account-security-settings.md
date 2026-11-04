# Agent Note: Desktop account security settings

Status: implemented

English | [中文](2026-11-04-account-security-settings.zh.md)

## Problem

Account settings showed a model inventory but did not provide the phone, password or WeChat management needed by new registrations.

## Decision

Replace the inventory with three settings rows and modal verification forms with focus restoration and draft clearing. Keep identity and logout. Reuse existing server endpoints through a fixed Host allowlist; keep credentials and full profiles outside the browser. Request a bound-phone code for password changes and WeChat binding/unbinding, and separate old/new codes for phone replacement. Password status is not inferred from legacy generated passwords.

## Alternatives considered

A model list does not manage sign-in identity. Treating a nonempty password hash as user-created gives misleading status. Opening an external account page would require another authentication handoff.

## Consequences

No backend schema change is needed. Compact 420px account modals omit graphical challenges. A new authenticated bind-SMS route and existing authenticated reset/change routes retain login checks and SMS rate limits; public captcha policy is unchanged. Backend and desktop must be deployed together. Real SMS and WeChat success depend on server configuration and connectivity. Existing WeChat QR endpoints signal already-bound identities separately; the UI never switches the desktop account from a binding scan. The page does not implement public registration or the login gate's SMS/QR entry points.

## Testing

Ten focused tests cover logout, removed inventory, password submission, two-code phone replacement, status failure, sanitized results, endpoint restrictions and QR origin rejection. Two controller tests additionally verify authentication, the preserved public captcha challenge and the authenticated SMS rate limiter. Type checking and focused lint pass. Desktop and narrow-width browser fixtures render the actual component and CSS; real SMS and WeChat authorization were not invoked.
