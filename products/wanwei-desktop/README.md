# Wanwei Buddy desktop

English | [中文](README.zh.md)

This private product directory owns the Wanwei desktop shell and installer. It deliberately sits outside `apps/` and `packages/`, which remain the upstream DSH application and package tiers.

## Current boundary

Expert native views and SkillHub archive installation do not reject the deployment network label. Existing URL, ticket, archive and installation validation remains effective; actual request failures appear in the owning feature page. [Service reachability](../../.agents/notes/implemented/feature/2026-10-16-service-reachability-placeholders.md) defines the feature behavior.

Windows NSIS installation, upgrade and uninstall preserve the application data directory, including installed skills, Sessions, settings and migration markers. The product's pinned [installer template](src-tauri/windows/installer.nsi) removes the data-deletion checkbox and deletion commands; uninstall still removes program files. `check:installer-data` rejects restoring data deletion or changing the release identity and runs in installer CI. Existing older uninstallers are not retroactively protected: keep application data when replacing them. Explicit manual deletion and disk failures remain outside this guarantee.

Automatic skill workspaces live under the product Harness home's `workspaces` directory, outside installer/runtime and temporary directories. The main-window-only `create_automatic_workspace` command accepts a fourteen-digit local `YYYYMMDDHHmmss` name and exclusively creates a directory; collisions receive ` (2)`, ` (3)` suffixes without modifying existing contents. The normal Workspace registry persists their sidebar membership. Replacing the installation keeps this user-data location; explicitly deleting user data is not an update-preservation guarantee.

macOS preserves the inherited system temporary directory and prepends bundled Node to the sidecar PATH, retaining existing tool paths and adding Homebrew locations. Python user packages and pip downloads use a private, product-specific directory under the host temporary directory, which workspace-write already permits. The cache is reused across launches but can be cleared by the OS; it is not durable user data. Read-only restrictions and approval for wider access remain in force. Windows and Linux retain their existing launch environment. Installed Mac behavior requires real-device verification.

Runtime staging unlinks dependency symlinks and Windows junctions without recursively deleting their targets. Legacy file migration creates each source backup directory before copying root-level settings and identity files, then writes and syncs a temporary file before non-replacing hard-link publication; the target filesystem must support hard links. A failed copy leaves no partial final file, while a force interruption may leave an unreferenced temporary file.

Closing the main window hides it. macOS Dock reopen restores and focuses the existing window. Normal application exit stops the direct sidecar, including exits outside the tray menu; force termination is outside this guarantee.

Native file imports exclusively create destination files and directories. If a same-name destination appears after name selection, the import fails without replacing or deleting it. Failed directory copies clean up only the directory created by that invocation.

The native shell drains sidecar stdout after the readiness URL is received. A failed startup kills and waits for the direct sidecar process before returning its error. This cleanup does not promise termination of every descendant spawned by user tasks.

The Tauri 2 shell starts the `wanwei-desktop` profile as a loopback DSH Sidecar, waits for its authenticated Web URL, and then creates the main WebView. It places `DSH_HOME` under the application's local-data directory. Wanwei-owned desktop commands are exposed through explicit WebView capabilities.

Composer file pastes use the existing bounded workspace importer. The main-window-only `import_clipboard_workspace_files` command reads OS file-list clipboard content through [clipboard-rs](https://github.com/ChurchTao/clipboard-rs), with image features disabled, and accepts absolute paths or local file URLs. It does not read plain-text clipboard contents, move source files, or grant expert WebViews clipboard access. Existing filename collision, link rejection and import size limits apply. Windows compilation and path tests are automated; installed Windows and macOS copy/paste behavior still requires manual release verification.

New-window requests from the main WebView open HTTP(S) links in the system default browser. Other URL schemes do not launch an external application, and no second in-app WebView is created for a conversation link.

Independent expert websites are an implementation-in-progress. A published expert opens in a separate child WebView within the main window; the shell registers a per-launch capability for that view's exact HTTP or HTTPS origin. The macOS bundle permits insecure HTTP loads for `ac.zjugis.com` only, so the current HTTP gateway can load in WKWebView; this exception does not encrypt traffic and should be removed when the gateway uses HTTPS. The desktop catalog, one-use identity ticket, bridge behavior, and close/reposition lifecycle require real Windows, macOS, and Linux verification before release. Expert websites are privileged code: their iframe and navigation behavior must be reviewed before publication. The six production websites and one-time cutover are not yet complete; see `WANWEI_EXPERT_WEB_INTEGRATION_PLAN.md`.

Release builds use `<com.wanwei.harness local data>/dsh-home`. Before the first sidecar launch, migration imports the old `~/.dsh` and the previous separate application's `com.wanwei.harness.preview/dsh-home`. Priority is existing formal data, previous separate data, then legacy data. Originals and recovery snapshots remain intact. Workspace v2 registries merge by filesystem path and union session IDs; identical logs deduplicate, byte-prefix continuations retain the longer log. Divergent logs and conflicting skills remain in source snapshots with paths recorded in `.wanwei-formal-migration-v2.json`; only the preferred variant is active, not two displayed conversations. Skills never combine scripts from different versions. Credentials and executable profile patches are not imported from historical homes. Original workspace files and absolute references are not relocated. Missing external files and unsupported session formats still require recovery; migration does not reinterpret session events. A fully staged home is published before startup, interrupted publication resumes, and incompatible workspace registries stop migration rather than start with missing history. Close both old applications before upgrading.

| Channel | Product name | Application identifier |
|---|---|---|
| Installed release | 万维Buddy | `com.wanwei.harness` |
| Local development | 万维Buddy | `com.wanwei.harness.development` |

The release shares the original product's installer identity; development retains a separate single-instance lock, WebView profile and data directory. Development data and Mock configuration are never migration sources.

## Verify

Local and SkillHub skill ZIPs accept at most 4096 entries, including explicit directory entries; local directory and file-list imports accept at most 4096 files. Compressed and expanded byte limits remain 16 MB each, directory depth remains 16, and unsafe paths and symbolic links are rejected. SkillHub importer failures identify the source and report the archive's entry count when it exceeds the limit. These native checks require an updated desktop binary; server skill-package limits are separate.

The manual [desktop workflow](../../.github/workflows/wanwei-desktop-preview.yml) includes native Ubuntu 22.04 builds for Linux x64 and ARM64, with separate installer artifacts for each architecture. Each Linux job requests DEB and AppImage bundles and stages its own Node runtime and dependencies. Installer generation does not establish compatibility with UOS system libraries; installation and startup require testing on the target UOS release.

```sh
pnpm --filter @wanwei/dsh-desktop check:identity
pnpm --filter @wanwei/dsh-desktop check:sidecar
pnpm --filter @wanwei/dsh-desktop check:rust
```

Source development runs the TypeScript CLI from the current checkout. `prepare:runtime` creates a self-contained production runtime under `src-tauri/resources/runtime-<version>`: it deploys the Wanwei-only production closure (the DSH runtime, the Wanwei product bundle and its transitive npm dependencies, plus the PDF, DOCX, and XLSX parsers), restores required workspace peer packages as ordinary files, copies Node 22, and preflights the staged `wanwei-desktop` profile. `check:runtime` runs the copied document helper and boots the product profile with that bundled Node executable, so missing parser or plugin dependencies fail before an installer is built. The upstream Python runtime manifest is unchanged. Generated runtime files are ignored by Git and are rebuilt for each installer.

```sh
pnpm --filter @wanwei/dsh-desktop prepare:runtime
pnpm --filter @wanwei/dsh-desktop check:runtime
pnpm --filter @wanwei/dsh-desktop build
```

The default `build` command rebuilds official DSH artifacts, stages and verifies the runtime, and runs `tauri build --no-bundle` to produce a local release binary without an installer. GitHub Actions uses `build:runner`, guarded by `GITHUB_ACTIONS=true`, to create the platform installer; local invocation fails immediately. File import, skill management, login window behavior, and other legacy commands remain separate follow-up migrations.

Published expert webviews call `save_expert_artifact({ fileName, bytesBase64 })` through the desktop bridge. The command accepts only an expert webview, validates bounded bytes (128 MB), filenames and supported extensions, and opens the native Save As dialog. Only the user selects the destination and confirms replacement; websites cannot submit local paths. It returns the saved absolute path or null on cancellation and rejects changing the original extension. Ordinary browsers use browser downloads; native interaction still requires platform acceptance.
