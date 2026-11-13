# Agent Note: Desktop public registration and unified login

Status: implemented

English | [中文](2026-11-04-desktop-public-registration.zh.md)

## Problem

SMS and QR tabs only showed unavailable notices. Public registrations lacked an administrator-selected role, and SMS verification ignored the configured phone-code lifetime.

## Decision

Connect the existing card to fixed Host-owned SMS login, explicit registration, password recovery and WeChat QR operations. Unknown phones require consent and an optional password. Existing phones retain account ID and role. Unlinked WeChat identities sign in by phone or register before linking. Existing WeChat accounts lacking both a verified phone and username/password credentials complete phone binding through a short-lived Host-held cookie. Cancel requests on exit and invalidate replaced QR states.

Resolve new public-registration roles on the server, defaulting to the existing 注册用户 role by name. Accept only enabled ordinary member roles and protect the selected role against deletion, disabling or implicit-name changes. Existing accounts and administrator-created users keep their role logic. Provide root-only login configuration and a default-role selector in the same configuration page; preserve other workbench option access. Enforce configured SMS expiry, a one-minute send interval and hourly limits.

The desktop QR tab now uses the public authentication capability and shows the server-generated WeChat QR image when enabled. Root administrators configure WeChatAppID, a write-only WeChatAppSecret, WeChatAuthEnabled and an optional complete WeChatCallbackURL in the login settings. The callback override is independent of the backend API base, so an HTTPS callback can coexist with the current HTTP desktop API. Blank overrides retain the existing API-base callback. Callback URLs reject credentials, query parameters, fragments and paths other than /api/oauth/wechat. Failed QR extraction returns a readable error and deletes its pending state. Account-settings WeChat binding remains unavailable pending its separate release.

Verified new phone users now enter the workspace directly after consent. A native dialog offers optional password setup. A ten-minute, single-use server grant permits this first setup without another SMS and rejects accounts that already have a password; later changes use the existing verified flow. The grant is process-local, so restart or routing to another replica requires the ordinary account-settings flow. The admin page groups registration, SMS and policies in one form, uses On/Off dropdowns, and hides fixed technical parameters. Login forms share field/button positions and three footer lines without inner scrolling.

The admin SMS login dropdown synchronizes PhoneLoginEnabled and SMSEnabled on save; the signature is hidden and preserved. Account security actions use bundled licensed icons and a keyboard-accessible phone-binding hint. Credit history retains post-change balances and adds first/last navigation with bounded page jumps.

SMS submission is the acceptance action described by the visible login notice; no separate checkbox is required. Footer links open versioned, bundled agreement/privacy documents in a native top-layer dialog without network access. The registration server still requires acceptance but no longer depends on optional administrator text fields; the admin form explains that documents ship with desktop releases. The documents identify WanweiBuddy as the service, route contact requests through the login administrator entry, and use complete user-facing terms without placeholder addresses or unverified deployment details. The options row shows the five-minute code lifetime; account, connectivity, SMS, recovery and unavailable-QR errors use the same dismissible native dialog to avoid overlapping the footer. Closing it preserves form input.

Existing username/password accounts can link an unbound WeChat identity by authenticating with their existing credentials, without a phone. Subsequent QR login exempts only accounts with both a managed username and a stored password credential from phone completion. New registrations still require verified SMS; username-only accounts without a password still require a verified phone. Database read failures do not grant an exemption.

The desktop QR surface embeds the official WeChat authorization page using the iframe parameters published by Tencent's wxLogin.js (login_type=jssdk, self_redirect=true). A detached QR image cannot execute WeChat's confirmation polling and callback navigation. The Host validates the exact authorization origin, path, state and callback before exposing the frame URL. Application polling still completes the Host-owned session; loading the frame alone does not establish login. Live scan acceptance remains required.

The QR card keeps its authorization frame, scan hint and refresh action within the fixed login-content height. Unlinked identities complete phone verification or existing-password account linking in a separate native dialog; closing it requests a new QR state and does not bypass verification.

QR expiration is shown over the authorization frame with a refresh action, stops state polling and does not open an error dialog. Explicit service errors continue to use the native dialog.

## Alternatives considered

Automatic creation on unknown login omits consent. Creating a new user for an existing WeChat account splits identity. Guessing a role by number risks wrong permissions. UI-only configuration restrictions do not protect direct API calls.

## Consequences

Deploy backend and desktop together. Aliyun credentials, approved signature/template, a WeChat website application and reachable callback, and finalized agreement/privacy text remain configuration prerequisites. None were activated. No real SMS, WeChat authorization or production account mutation occurred. Tests use isolated SQLite account-center tables and mocked authentication responses. The default requires an existing enabled 注册用户 role or an explicit ordinary-role selection.

## Testing

Focused tests cover login/token/model compatibility, SMS registration session establishment, consent, onboarding, recovery, cancellation and WeChat phone completion. Backend tests verify role assignment, existing-user preservation, single-use codes, persisted password reset, privileged configuration, authenticated SMS/rate limits and expiry. Admin tests verify changed-field saves, secret preservation, retryable errors, default-role selection and existing system tabs. Type checks, focused lint and browser PNG previews validate changed surfaces. Live SMS and OAuth remain unverified until configured.
