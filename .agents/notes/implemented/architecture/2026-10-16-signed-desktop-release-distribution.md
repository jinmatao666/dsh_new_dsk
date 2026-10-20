# Agent Note: Signed desktop release distribution

Status: implemented

English | [中文](2026-10-16-signed-desktop-release-distribution.zh.md)

## Problem

Manual installer distribution has no durable distinction between an uploaded candidate and an administrator-approved release. Artifact-only signatures do not bind a package to the version and platform advertised by an upload.

## Decision

The OneAPI service owns immutable platform/version uploads and transactional per-platform publication pointers. A Runner-produced ZIP carries both a signed manifest and signed artifact. The service verifies both before accepting a draft, and again before publication. Only root administrators mutate releases, using the existing authentication and operation-audit mechanisms. Neither server nor upload UI stores signing private keys.

The manifest binds the product identity, stable version, platform, artifact name, byte count, SHA-256 and artifact signature. The upload requires an administrator-declared version and OS/architecture that exactly match the verified manifest; declarations never overwrite signed metadata. This check prevents accidental cross-platform uploads without granting the administrator authority to relabel artifacts. The exporter uses the actual Tauri signer rather than a separate signature format. The public endpoint returns only a strictly newer release for the exact OS/architecture. Withdrawal preserves the high-water version and disables availability without falling back. Unique platform/version rows forbid replacement of previously uploaded bytes.

The native shell verifies both signatures with its embedded public key, preserving the manifest binding across HTTP transport. Checks are automatic, but downloading and installation are explicit user decisions. A private parent/child stdin exchange performs the final busy veto and freezes new work in one synchronous admission interval. The Host awaits complete plugin-tree disposal before acknowledging clean shutdown; the native parent also waits for successful process exit before calling the maintained Tauri installer. A timeout cannot authorize installation.

Checks and artifact downloads use the desktop's configured OneAPI backend, including any reverse-proxy prefix. The service returns a relative artifact path; the native shell accepts only the update-artifact route with a fixed-format ID and resolves it under that backend. The absolute URL field satisfies Tauri parsing but cannot select the native download host. Check and download requests reject redirects. This removes dependence on public DNS or a separate download origin in disconnected intranets without trusting proxy headers to choose a host. Server storage remains private and persistent; the administrator upload handler writes the artifact, and the active-release download handler serves it.

## Alternatives considered

**Publish straight from GitHub.** The operator needs a visual approval step on the existing self-hosted backend, independent of repository migration. Runner output is therefore an upload artifact, not an automatic release.

**Verify only the installer signature.** A legitimate old binary can be relabelled with a higher version in an unsigned manifest. A second signature binds the release metadata without requiring the server to possess the private key.

## Consequences

The server requires a configured public key, shared durable artifact storage and additive database tables. HTTP remains possible but does not protect availability or unsigned release notes from network tampering. Full-size uploads require matching proxy limits. The server retains historical data; abrupt termination can leave unreferenced staging directories. Failed publication leaves the previous pointer intact.

Real Tauri CLI signing and real Gin/root-auth upload/publication handlers are exercised together using disposable keys and an isolated SQLite database. The same release ZIP exercises native manifest and package verification. UI tests cover administrator publication and native check controls. Loader-composed real agents prove running and maintenance vetoes and disposal ordering; the isolated product sidecar proves clean acknowledgement followed by exit. Actual Windows/macOS/Linux installer upgrades remain a manual release requirement. Buffered native downloads can occupy up to 2 GiB and are not durable. A cleanup failure can leave the current runtime unavailable; the updater refuses installation and asks for a manual restart rather than forcing it. No active decision is superseded; product-overlay ownership remains unchanged.
