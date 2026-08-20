# DSH Desktop

Tauri 2 shell for the `desktop` DSH profile. It starts a loopback-only DSH
Sidecar on an OS-assigned port, waits for the `dsh web:` readiness line, then
opens that URL in the main WebView. The WebView receives no Tauri IPC grants;
local file operations stay in the DSH Sidecar and model calls go directly from
the Sidecar to the configured OneAPI server.

## Development

1. Use Node 22.19+ and install the workspace dependencies.
2. Copy `server.example.json` to `src-tauri/resources/server.json` and set the
   regional DSH OneAPI origin. This file is bundled into each regional build,
   so end users do not configure it individually.
3. Build the web frontend once, then run `pnpm --filter
   @deepseek-ai/dsh-desktop-app dev`.

## Installers

Set `DSH_NODE_BINARY` to the Node executable for the target platform and
optionally set `DSH_DESKTOP_SERVER_CONFIG` to a production JSON file, then run
the app's `build` script on Windows or macOS. Packaging is native: Windows
builds Windows installers and macOS builds `.app`/DMG artifacts.

The staged runtime is intentionally not committed. `prepare:runtime` builds
DSH, deploys the CLI's production dependency closure, and copies Node into the
Tauri resources before the installer build.
