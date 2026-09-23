# Wanwei Buddy preview desktop

English | [中文](README.zh.md)

This private product directory owns the Wanwei desktop shell and installer. It deliberately sits outside `apps/` and `packages/`, which remain the upstream DSH application and package tiers.

## Current boundary

The Tauri 2 shell starts the new `wanwei-desktop` profile as a loopback DSH Sidecar, waits for its authenticated Web URL, and then creates the main WebView. It always places `DSH_HOME` under the preview application's own local-data directory. Legacy desktop commands are not exposed yet.

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
