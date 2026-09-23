# DSH Desktop

English | [中文](README.zh.md)

Tauri 2 shell for the `desktop` DSH profile. It starts a loopback-only DSH
Sidecar on an OS-assigned port, waits for the `dsh web:` readiness line, then
opens that URL in the main WebView. The WebView receives no Tauri IPC grants;
local file operations stay in the DSH Sidecar and model calls go directly from
the Sidecar to the configured OneAPI server.

## Development

### Fast daily startup on Windows

After one successful full build, run this in PowerShell:

```powershell
Set-Location 'E:\code\dsh\deepseek-harness-master\apps\desktop'
pnpm exec tauri dev --config src-tauri/tauri.dev.conf.json
```

Keep the terminal open. Tauri launches the development window and starts the frontend watcher. The development app has a separate identifier and data directory; `dev/cordis.patch.yml` supplies a local development identity without server login. After `Running target\debug\dsh-desktop.exe`, wait for the Sidecar's `dsh web:` line before expecting the window to finish loading. Do not launch a separate `node` server.

This command skips the repository-wide `dev:prepare` build. On a fresh checkout or after changing non-client Host-side TypeScript, run `pnpm --filter @deepseek-ai/dsh-desktop-app dev` from the repository root once for a full build. The quick start compares client source timestamps with both Host and page plugin bundles and rebuilds stale artifacts before the watcher handles later UI edits. Tauri incrementally compiles Rust changes. Check for an existing development window before starting another process.

Daily startup still includes incremental Rust compilation, frontend bundling, and Sidecar/WebView startup. One local run took about 9 seconds for Rust and 5 seconds for the frontend; timings vary with changes and cache state. If startup fails, inspect the terminal near the `cargo`, `vite`, or `dsh web:` output. A browser preview does not establish that the desktop app started.

1. Use Node 22.19+ and install the workspace dependencies.
2. Run `corepack enable pnpm` once so `pnpm` uses the repository's `packageManager` version.
3. Run `pnpm --filter @deepseek-ai/dsh-desktop-app dev` from the repository root.

The command builds the current checkout, starts the client-plugin rebuild watcher, and launches the real Tauri debug shell under the separate `com.wanwei.harness.development` application identifier. It can run beside an installed release without sharing the single-instance lock or WebView profile. The shell composes the production `desktop` profile and mounts every production client plugin; only the OneAPI RPC reports a local development identity, so the workspace opens without a server login. Client UI edits rebuild and reload in the existing window. Rust edits use Tauri's normal debug rebuild. Host-side TypeScript changes take effect after restarting the command, which rebuilds them before launch.

Development sessions and marketplace installations use the persistent `development/dsh-home` directory under Tauri's application-data directory. The startup log prints its exact path. This keeps development changes out of `~/.dsh` while retaining them across debug launches. File selection, file opening, marketplace installation, Session export, window behavior, and other native commands remain the real Tauri implementations rather than browser mocks.

The authentication overlay uses the normal production behavior in release builds. The source-only `dev/cordis.patch.yml` overlay is selected by Rust only in debug builds and is not listed in the Tauri bundle resources.

The debug Tauri resource list includes only the server configuration and bundled skills. Its Sidecar runs from the checkout, so the staged release runtime is copied only for installer builds.

Release builds set `DSH_HOME` to the current user's `~/.dsh` for credentials, settings, sessions, profiles, and skills, regardless of an inherited `DSH_HOME`. Debug builds use the separate application-data `development/dsh-home`.

## Installers

Set `DSH_NODE_BINARY` to the Node executable for the target platform and
optionally set `DSH_DESKTOP_SERVER_CONFIG` to a production JSON file, then run
the app's `build` script on Windows, macOS, or Linux. Packaging is native:
Windows builds NSIS installers, macOS builds `.app`/DMG artifacts, and Linux
builds x64 `.AppImage` and Debian `.deb` artifacts. The release workflow's
`all-platforms` option runs each target on its matching hosted runner.

The staged runtime is intentionally not committed. `prepare:runtime` builds
DSH, deploys the CLI's production dependency closure, and copies Node into the
Tauri resources before the installer build.
