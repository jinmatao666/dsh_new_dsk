# Agent Note: Desktop development parity shell

Status: implemented

English | [中文](2026-09-03-desktop-development-parity-shell.zh.md)

## Problem

The desktop workspace is assembled from runtime client plugins served by a loopback Node process. A browser-only management page cannot exercise that composition, and a standalone frontend server lacks the injected boot manifest. UI work therefore needs a development entry that renders the installer’s plugin tree and native interactions without requiring a packaged build or a live regional login service.

An authentication shortcut must not introduce a second workspace implementation or become part of the release launcher. Development also needs isolated persistent state so skill installation and settings tests do not alter the user’s release data.

## Decision

`pnpm --filter @deepseek-ai/dsh-desktop-app dev` builds the current checkout, starts the repository client-plugin watcher through Tauri’s `beforeDevCommand`, and launches the real Tauri debug shell with the separate `com.wanwei.harness.development` identifier. It can run beside an installed release without sharing the single-instance lock or WebView profile. The debug shell starts the same `desktop` profile as a release and applies the source-only `apps/desktop/dev/cordis.patch.yml` overlay. The overlay retains the production authentication plugin and changes only its Host RPC configuration to return a local development identity.

The authentication plugin accepts that configuration only when the Rust debug launcher supplies `DSH_DESKTOP_DEVELOPMENT=1`. The development overlay is outside the Tauri resource list, and release builds neither select it nor set the marker. The bypass grants no OneAPI token or managed model; it opens local workspace UI without creating server authority.

The debug launcher sets `DSH_HOME` to a persistent `development/dsh-home` directory beneath Tauri application data. Native marketplace commands resolve the same directory in debug builds. Release builds retain the user’s normal `~/.dsh` location and the existing packaged sidecar path.

Client UI changes rebuild through `pnpm run dev:web` and reload in the existing Tauri WebView. Native file operations, marketplace installation, Session export, tray behavior, and window behavior remain the real Tauri implementations. Host-side TypeScript changes require restarting the development command, whose initial build refreshes those products.

Every desktop-only client plugin has a `tsconfig.base.json` source mapping. Source launches and static checks therefore resolve the current checkout instead of silently falling back to an older built `lib` product.

## Verification

The desktop composition test compares the production and development entry identifiers and requires every non-authentication row to remain identical. Authentication tests reject the bypass without the debug marker and exercise the mounted `/desktop-auth` RPC with the marker. Rust tests cover the native marketplace filesystem operations independently of the selected user root.

## Alternatives considered

**Maintain a separate mock desktop page.** This gives fast rendering but duplicates components and interaction state, so it cannot predict the installed application.

**Disable the authentication plugin in development.** This opens the workspace but removes its client contributions and makes the plugin tree differ from an authenticated release session.

**Require a local OneAPI deployment for every UI edit.** This exercises login and model synchronization but makes unrelated layout work depend on external services and credentials.

**Use the release `~/.dsh` directory.** This displays existing data but allows development installation, settings, and migration tests to alter the installed application’s state.

## Consequences

- UI layout and interaction work runs in the real desktop WebView with the release client-plugin composition and native commands.
- A development launch performs a repository build before opening, then keeps client bundles current without rebuilding an installer.
- Development state persists across debug launches but is intentionally separate from release conversations, settings, and installed skills.
- Login-screen changes and live OneAPI model synchronization still require the normal authenticated path; the development identity proves only the post-login desktop workspace.
- Installer resources, signing, NSIS lifecycle, and upgrade behavior remain installer-only verification responsibilities.
