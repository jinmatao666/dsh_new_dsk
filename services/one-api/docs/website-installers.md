# Website installer distribution

English | [中文](website-installers.zh.md)

## Summary

Root administrators upload and publish first-install packages from Version Release → Website Installers. The marketing website deploys separately and reads the public catalog. Website installers and signed desktop updates have separate records and publication controls.

## Table of Contents

- [Publish an installer](#publish-an-installer)
- [Storage and deployment](#storage-and-deployment)
- [Connect a separate website](#connect-a-separate-website)
- [Verification and limits](#verification-and-limits)
- [Dev Note](#dev-note)

## Publish an installer

Select Windows x64 (EXE), macOS x64 (DMG), or macOS ARM64 (DMG). Enter the stable `x.y.z` version and upload the actual installer, rather than a Runner artifact wrapper or signed updater ZIP. Upload saves a draft. Confirm Publish to select that file for its platform. Other platforms keep their own selection.

Withdraw hides the selected package without reverting to an older upload. Published packages require withdrawal before deletion. Deletion removes the record and attempts to remove its file; a cleanup failure reports a warning. The management list shows the latest 200 uploads without automatically deleting older records.

## Storage and deployment

Files use `${DESKTOP_UPDATE_DIR}/website-installers/<id>/installer`. The parent directory defaults to `/data/wanwei/desktop-updates`; the deployment's existing `DESKTOP_UPDATE_DIR` and persistent mount take precedence. Reuse that mount and preserve its host source when updating the container. Back up both the database and this directory. Startup adds the installer and publication tables; a container rollback does not undo database changes.

The file limit inherits `DESKTOP_UPDATE_MAX_BYTES` (default 2 GiB). The gateway must allow the file plus multipart overhead and enough upload time; its smaller limit takes precedence. Proxy `/api/website-installers` and `/downloads/installers/` to OneAPI through the existing backend entry. Do not expose the storage directory directly. Multiple server instances need shared database and storage.

## Connect a separate website

`GET /api/website-installers` returns `{ "packages": [] }` when nothing is published. Each published package includes `platform`, `arch`, its own `version`, `size`, `size_bytes`, `sha256`, `notes`, `publishedAt`, `filename`, and a `url`. With `DSH_PUBLIC_URL` configured, it is a complete URL retaining the API prefix; otherwise it is a relative path including `DSH_API_PREFIX`, preserving the default root behavior. The website must accept both absolute URLs and relative paths. The three targets publish independently; the catalog has no global version field.

The catalog permits cross-origin, credential-free GET requests. The website must omit credentials and resolve the returned URL before linking the download button. An HTTPS website requires an HTTPS backend or a same-origin HTTPS proxy. Public downloads support GET, HEAD, and byte ranges. Draft, deleted, and withdrawn packages return 404. Responses disable caching. Management requests use root authentication under `/api/admin/website-installers` and record upload, publication, withdrawal, and deletion operations in the audit log.

## Verification and limits

From `services/one-api`, run `go test ./controller ./router -run '^Test(WebsiteInstaller|DesktopUpdate)' -count=1`. From `services/one-api/web/air`, run `npm test -- --watchAll=false --runInBand --runTestsByPath src/pages/VersionRelease/WebsiteInstallers.test.js src/pages/VersionRelease/DesktopUpdates.test.js` with `CI=true`. The tests exercise publication, withdrawal, replacement, deletion, downloads, authentication, rejected uploads, file integrity, and management interactions. They do not install a real package or deploy the marketing website.

The server checks executable format and Windows x64 metadata or the DMG trailer, then computes SHA-256. Publication rechecks the stored hash. These checks do not certify application version, DMG architecture, operating-system signatures, or installation success. Trusted administrators must check those against the build artifacts. Abrupt process termination can leave staging or unreferenced directories; inspect and clean them only while uploads are stopped.

## Dev Note

The [installer publication decision](../../../.agents/notes/implemented/feature/2026-10-30-website-installer-publication.md) records the separation from desktop updates and the verification scope.
