---
description: "Package committed OneAPI backend sources and update the existing server with a fixed deployment command."
---

# OneAPI source releases

English | [中文](oneapi-release.zh.md)

## Summary

Use one release command to create a version directory with source, checksums and server commands. The server builds the Docker image from that source before updating OneAPI. The package is a source tar, not an exported Docker image. Desktop installers and expert services are outside this workflow.

## Table of Contents

- [Prepare and package](#prepare-and-package)
- [Update the server](#update-the-server)
- [Failures and scope](#failures-and-scope)
- [Maintainer verification](#maintainer-verification)
- [Dev Note](#dev-note)

-----

<a id="prepare-and-package"></a>

## Prepare and package

Run these commands in the intended repository root with Node.js 22 or newer and Git available. The packaging tool uses only Node.js built-ins and does not require installing the desktop workspace dependencies. Review and commit the backend changes before packaging; the tool never commits, pulls, merges, pushes or uploads for you. Coordinate with other contributors before selecting a release commit.

```powershell
node scripts/oneapi-release/release.mjs --status
node scripts/oneapi-release/release.mjs --version 0.0.77-release.1 --ref HEAD --check
node scripts/oneapi-release/release.mjs --version 0.0.77-release.1 --ref HEAD
```

The default output is `../delivery/oneapi/0.0.77-release.1/`. Use a new version for each release. `--repo PATH` selects a different repository; `--output PATH` selects a delivery parent outside that repository. `--ref` accepts a committed branch, tag or SHA and resolves it to a full commit hash. The selected commit must contain the release tooling, backend and both npm lockfiles.

If an npm lockfile is missing or stale, update it in its frontend directory, review the dependency changes, and commit it with the matching package manifest. Use `git add -f` for a lockfile excluded by repository ignore rules. Never copy a lockfile from a different repository without checking dependency compatibility.

The package contains `release.json`, `SHA256SUMS`, `deploy-oneapi.sh`, `organize-oneapi.py`, a source tar, an operation guide and version-specific `COMMANDS.txt`. Only committed backend files are archived. Environment files, credentials with recognized filenames, caches and runtime data are excluded; this filename filter is not a full secret scanner, so review committed source before release.

-----

<a id="update-the-server"></a>

## Update the server

Server-owned OneAPI files use `/root/dsh`: `releases/` holds version packages, `builds/` holds temporary Docker build sources, `updates/` holds deployment state and diagnostics, `backups/database/` holds operator-created SQL backups, `backups/gateway/` holds gateway rollback files, and `backups/migrations/` holds migration archives and private configuration snapshots. `data/` holds persistent installer uploads and offline resources. Runtime preparation rejects symlinked storage parents. Existing container mounts and the container-side upload/download paths remain authoritative; this layout does not rewrite current mounts or database artifact records.

The release includes `organize-oneapi.py` in its checksum list. On the Linux server, run `python3 organize-oneapi.py check` to list recognized legacy `/root/dsh-one-api-build.*`, update-state and backup entries, then `python3 organize-oneapi.py apply` to move the reviewed entries into this layout. The tool shares deployment/gateway locks, inspects mounts on running and stopped containers, rejects overlapping mounts and destination conflicts, and retains a private move journal under `updates/`. It renames files rather than deleting them, reverses completed moves after a rename failure, and leaves unrelated services and `/root/dsh/data` untouched. No server invocation is performed by local packaging or these offline tests.

Upload the entire output directory into `/root/dsh/releases/0.0.77-release.1/`. The server needs Linux, root access, a local Docker daemon, Bash, Python 3, curl, sha256sum, tar, flock and network access for build dependencies. Use the commands generated in `COMMANDS.txt`; the following example uses a real, existing database backup path supplied by the operator.

```bash
cd /root/dsh/releases/0.0.77-release.1
sha256sum -c SHA256SUMS
bash deploy-oneapi.sh verify --package ./dsh-server-source-0.0.77-release.1.tar.gz
bash deploy-oneapi.sh check --package ./dsh-server-source-0.0.77-release.1.tar.gz
bash deploy-oneapi.sh update --package ./dsh-server-source-0.0.77-release.1.tar.gz --db-backup /root/dsh/backups/database/backup.sql
```

`verify` checks the package without Docker. `check` checks the existing container, persistence and gateway/expert readiness without replacing containers. `update` builds the image and deploys it. `build` and `deploy` are also available separately. Only after explicitly accepting database migration risk may the operator replace `--db-backup /root/dsh/backups/database/backup.sql` with `--skip-db-backup`; the script does not create or restore a database backup.

A successful update prints `Updated: zjugis-one-api:<version>`, retains the stopped old container and prints a private recovery directory. The new `/api/status` must report the expected version and success. After deployment, the operator verifies admin login, the changed feature, usage statistics and expert submissions. Never share the private recovery directory: it contains the container environment and may contain credentials.

-----

<a id="failures-and-scope"></a>

## Failures and scope

Uncommitted backend changes, missing committed lockfiles, incompatible package manifests and existing release directories stop packaging. A failed package can leave `INCOMPLETE.txt`; do not upload or deploy it. Inspect and remove that exact failed output directory manually, or choose a new version. The tool does not delete prior releases.

The deployer supports the existing `dsh-one-api` on network `dsh-internal`, bound only to `127.0.0.1:13300`, behind `dsh-experts-gateway`. It preserves the old mounts and runtime configuration. A legacy container without mounts can receive a dedicated persistent resource bind. Other incompatible storage or topology requires manual review; the deployer does not reconfigure the gateway, database or six expert sites.

The checksummed deployer carries the desktop update public key and initializes `DESKTOP_UPDATE_PUBLIC_KEY` when absent or empty. An existing different key stops deployment for explicit key rotation. Private signing keys and passwords are never needed on the server. Desktop clients check and download through their configured OneAPI backend, including its reverse-proxy prefix. No separate download address or public Internet access is required; the backend must remain reachable on the deployment network.

Desktop updates require a writable persistent mount covering `DESKTOP_UPDATE_DIR` (default `/data/wanwei/desktop-updates`). An existing compatible mount is retained. Otherwise, only the default path can receive a new dedicated bind from `/root/dsh/data/one-api-updates.XXXXXXXX`; existing files, directories or symlinks at the unmounted container path stop deployment before the old container is stopped. Migrate those files manually rather than hiding them with a mount. The final container inspection verifies the public key and storage mount. A successful deployment still requires an operator to upload and publish a signed package in the admin panel and test a desktop update through the connected backend. Both server and desktop binaries must contain the connected-backend download implementation.

The Dockerfile owns frontend and backend build checks; packaging checks do not prove that Docker compilation or application acceptance passed. A reused image version must have matching commit and source-checksum labels. Startup failure attempts to restore the old container and retains diagnostics, but container rollback cannot reverse database migrations. New environment variables, external services or storage requirements require an explicit deployment change, not merely a new image.

-----

<a id="maintainer-verification"></a>

## Maintainer verification

Run the focused packaging and offline deployment regression tests after changing the tooling. They use temporary Git repositories and mocked Docker transport, not a production daemon. Linux Docker build, real container replacement and rollback remain server-side verification requirements.

```powershell
node --test scripts/oneapi-release/release.test.mjs
```

The entry points are [release.mjs](../../scripts/oneapi-release/release.mjs), [deploy-oneapi.sh](../../scripts/oneapi-release/deploy-oneapi.sh), and the committed [Dockerfile](../../services/one-api/Dockerfile). The process rationale is recorded in the [Agent Note](../../.agents/notes/implemented/process/2026-10-20-oneapi-source-release-workflow.md).

<a id="dev-note"></a>

## Dev Note

No production deployment is performed by the local packaging command.
