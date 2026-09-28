# Wanwei Buddy preview desktop

English | [中文](README.zh.md)

This private product directory owns the Wanwei desktop shell and installer. It deliberately sits outside `apps/` and `packages/`, which remain the upstream DSH application and package tiers.

## Current boundary

Runtime staging unlinks dependency symlinks and Windows junctions without recursively deleting their targets. Legacy file migration writes and syncs a temporary file before non-replacing hard-link publication; the target filesystem must support hard links. A failed copy leaves no partial final file, while a force interruption may leave an unreferenced temporary file.

Closing the main window hides it. macOS Dock reopen restores and focuses the existing window. Normal application exit stops the direct sidecar, including exits outside the tray menu; force termination is outside this guarantee.

Native file imports exclusively create destination files and directories. If a same-name destination appears after name selection, the import fails without replacing or deleting it. Failed directory copies clean up only the directory created by that invocation.

The native shell drains sidecar stdout after the readiness URL is received. A failed startup kills and waits for the direct sidecar process before returning its error. This cleanup does not promise termination of every descendant spawned by user tasks.

The Tauri 2 shell starts the new `wanwei-desktop` profile as a loopback DSH Sidecar, waits for its authenticated Web URL, and then creates the main WebView. It always places `DSH_HOME` under the preview application's own local-data directory. Wanwei-owned desktop commands are exposed through explicit WebView capabilities.

New-window requests from the main WebView open HTTP(S) links in the system default browser. Other URL schemes do not launch an external application, and no second in-app WebView is created for a conversation link.

Independent expert websites are an implementation-in-progress. A published expert opens in a separate child WebView within the main window; the shell registers a per-launch capability for that view's exact HTTPS origin, not a static all-HTTPS grant. The desktop catalog, one-use identity ticket, bridge behavior, and close/reposition lifecycle require real Windows, macOS, and Linux verification before release. Expert websites are privileged code: their iframe and navigation behavior must be reviewed before publication. The six production websites and one-time cutover are not yet complete; see `WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md`.

Release builds use `<preview app local data>/dsh-home` for credentials, settings, sessions, and skills. On the first launch, if the existing `~/.dsh` directory exists, the preview copies its settings, sessions, storage, attachments, skills, compatible agent presets, and anonymous user ID into the isolated home without overwriting preview files. It never writes to the old directory. Credentials are deliberately not imported: each installer build requires a fresh sign-in. If the old directory is absent or import fails, preview startup continues with its own data. The preview's product profile is always generated separately. A migration marker prevents repeated imports; an incompatible old session may still require manual recovery.

| Channel | Product name | Application identifier |
|---|---|---|
| Installed preview | Wanwei Buddy Preview | `com.wanwei.harness.preview` |
| Local development | Wanwei Buddy Preview | `com.wanwei.harness.preview.development` |
| Existing production | Wanwei Buddy | `com.wanwei.harness` |

The distinct identifiers separate the single-instance lock, WebView profile, platform application-data directory, cache, and installer identity from the existing production client.

## Verify

```sh
pnpm --filter @wanwei/dsh-desktop-preview check:identity
pnpm --filter @wanwei/dsh-desktop-preview check:sidecar
pnpm --filter @wanwei/dsh-desktop-preview check:rust
```

Source development runs the TypeScript CLI from the current checkout. `prepare:runtime` creates a self-contained production runtime under `src-tauri/resources/runtime`: it deploys the reviewed DSH production dependency closure, restores required workspace peer packages as ordinary files, copies Node 22, and preflights the staged `wanwei-desktop` profile. Generated runtime files are ignored by Git and are rebuilt for each installer.

```sh
pnpm --filter @wanwei/dsh-desktop-preview prepare:runtime
pnpm --filter @wanwei/dsh-desktop-preview check:runtime
pnpm --filter @wanwei/dsh-desktop-preview build
```

The default `build` command rebuilds official DSH artifacts, stages and verifies the runtime, and runs `tauri build --no-bundle` to produce a local release binary without an installer. GitHub Actions uses `build:runner`, guarded by `GITHUB_ACTIONS=true`, to create the platform installer; local invocation fails immediately. File import, skill management, login window behavior, and other legacy commands remain separate follow-up migrations.

Published expert webviews can call `save_expert_artifact({ fileName, bytesBase64 })` through the desktop bridge. The command accepts only an expert webview, decodes bounded output bytes (128 MB), validates the filename and supported document/image/archive extension, and exclusively creates a file in Downloads. It returns the saved absolute path and never accepts a destination path or overwrites a previous download. Ordinary browser execution uses browser downloads; native download interaction still requires platform acceptance.
