# Agent Note: Desktop public registration and unified login

Status: implemented

English | [中文](2026-11-04-desktop-public-registration.zh.md)

## Problem

SMS and QR tabs only showed unavailable notices. Public registrations lacked an administrator-selected role, and SMS verification ignored the configured phone-code lifetime.

## Decision

Connect the existing card to fixed Host-owned SMS login, explicit registration, password recovery and WeChat QR operations. Unknown phones require consent and an optional password. Existing phones retain account ID and role. Unlinked WeChat identities sign in by phone or register before linking. Existing WeChat accounts missing a phone bind it to their original account through a short-lived Host-held cookie. Cancel requests on exit and invalidate replaced QR states.

Resolve new public-registration roles on the server, defaulting to the existing 注册用户 role by name. Accept only enabled ordinary member roles and protect the selected role against deletion, disabling or implicit-name changes. Existing accounts and administrator-created users keep their role logic. Provide root-only login configuration and a default-role selector in the same configuration page; preserve other workbench option access. Enforce configured SMS expiry, a one-minute send interval and hourly limits.

The desktop QR tab is temporarily held at its original unavailable toast pending the chosen WeChat integration route. It preserves the active form and does not invoke public QR operations. Password and SMS entry points remain enabled.

## Alternatives considered

Automatic creation on unknown login omits consent. Creating a new user for an existing WeChat account splits identity. Guessing a role by number risks wrong permissions. UI-only configuration restrictions do not protect direct API calls.

## Consequences

Deploy backend and desktop together. Aliyun credentials, approved signature/template, a WeChat website application and reachable callback, and finalized agreement/privacy text remain configuration prerequisites. None were activated. No real SMS, WeChat authorization or production account mutation occurred. Tests use isolated SQLite account-center tables and mocked authentication responses. The default requires an existing enabled 注册用户 role or an explicit ordinary-role selection.

## Testing

Focused tests cover login/token/model compatibility, SMS registration session establishment, consent, onboarding, recovery, cancellation and WeChat phone completion. Backend tests verify role assignment, existing-user preservation, single-use codes, persisted password reset, privileged configuration, authenticated SMS/rate limits and expiry. Admin tests verify changed-field saves, secret preservation, retryable errors, default-role selection and existing system tabs. Type checks, focused lint and browser PNG previews validate changed surfaces. Live SMS and OAuth remain unverified until configured.
