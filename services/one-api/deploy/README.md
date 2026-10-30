# Generic backend delivery

English | [中文](README.zh.md)

The same release image for one CPU architecture serves Internet and private deployments. Public paths are validated at startup and injected into HTML before immutable frontend bundles load. Nginx does not modify JavaScript. The [configuration template](.env.example) documents every delivered variable; existing database, integration and policy variables can be appended to the same local `.env`.

## Runtime configuration

| Variable | Meaning and default |
| --- | --- |
| `DSH_ADMIN_PREFIX` | Management path, empty or `/` for root; example `/dsh-admin`. No trailing slash. |
| `DSH_API_PREFIX` | External browser/API path, empty for root; example `/dsh-api`. All API paths follow this prefix, including `/api`, `/v1`, `/dashboard/billing`, `/downloads` and `/desktop-updates`. |
| `DSH_PUBLIC_URL` | Complete external API base URL including that prefix; required by the delivery tool. Desktop clients use this exact base, without appending `/v1`. |
| `DSH_ADMIN_URL` | Optional complete management URL for another host. Defaults to the API origin plus management prefix. Its path must match `DSH_ADMIN_PREFIX`. |
| `DSH_ORG_PREFIX` | Separate organization portal path, default `/business`, internal port 3001. |
| `CORS_ALLOW_ORIGINS` | Comma-separated origins including scheme and optional port, never paths. Include separate management origins and desktop origins. Empty retains the backend policy: public mode allows origins; private mode permits the built-in desktop origins. |
| `DSH_TRUSTED_PROXIES` | Last-hop proxy IPs/CIDRs; absent defaults to loopback, explicitly empty trusts none. This controls forwarded client-IP interpretation. Public link generation uses the canonical URL rather than forwarded host/prefix headers. |

Admin and API prefixes must not contain each other. Full URL paths must equal their corresponding prefixes. Prefixes include every external gateway path component. Changing configuration requires container recreation, never frontend compilation. The canonical URL overrides legacy database `ServerAddress` for generated links; without it, legacy settings remain the fallback for authentication links and direct requests supply update-download addresses. Complete third-party URLs remain unchanged.

## Install without touching another deployment

Requires Python 3.10+, Docker with Compose v2 and a locally loaded image matching `DSH_PLATFORM`. Use a dedicated deployment directory and unique project name, ports and data directory for testing. The tool never discovers or replaces another project's containers.

```sh
python deploy.py init --image registry.example/one-api:VERSION-amd64
# Edit .env: public URL, paths, origins, proxy networks, database and integrations.
python deploy.py check
python deploy.py up
```

`init` creates random persistent session/encryption secrets once and refuses to overwrite `.env`. Keep existing site keys when migrating an existing database. `check` validates Compose configuration, required secrets, public paths, encryption-key format and image architecture. It runs the image's `--check-deployment` with no network or persistent mounts and never opens a database. It cannot establish database reachability, credentials, certificates or upstream model health. `up` uses the local image with `--no-build --pull never`; load or pull the image explicitly first.

The [Compose file](compose.yaml) mounts the entire local data directory at `/data`, including SQLite, logs, desktop resources, signed updates and website installers. External databases retain their existing DSNs. If existing storage uses other paths, add persistent mounts and the corresponding existing environment settings before first startup. Do not change storage paths during an image-only upgrade. Existing databases, account databases and uploaded files all need their own backups. Experts, MCP, Redis and RAGFlow are optional integrations, not deployment prerequisites.

## Reverse proxies

Adapt [the Nginx template](nginx.conf.example) on site. It preserves prefixes: `proxy_pass http://dsh_backend;` has no trailing slash. Root deployments use `location /` with that upstream. The organization portal has a separate upstream. Do not remove prefixes in front of the main backend. The organization portal also accepts prefix-stripped requests for existing gateways.

Every proxy hop preserves the external Host including port, query string and full path. The TLS-terminating gateway sets trusted HTTPS forwarding information; inner gateways preserve it only from trusted upstreams. Configure the complete HTTPS `DSH_PUBLIC_URL` and proxy IP/CIDR list explicitly. The application does not infer a canonical prefix from `X-Forwarded-Prefix`. Disable buffering/caching for streaming responses, allow WebSocket upgrades for resource tunnels, and align upload limits with the artifact limits. Network access rules, trusted certificates and outer-gateway policies remain site prerequisites.

For a separate management domain, set `DSH_ADMIN_URL`, configure both hosts to proxy their corresponding prefixes, and allow the management origin in CORS. HTTP origins do not contain `/dsh-admin` or `/dsh-api`.

## Build once, export unchanged

The build entry accepts only version/architecture/image identity, not customer domains or deployment prefixes. Build registries/proxies can be set through the Dockerfile's existing infrastructure arguments when needed. Build and validate in isolation; production upgrades remain a separately scheduled operation.

```sh
python deploy.py build --image registry.example/one-api:VERSION-amd64 --version VERSION --platform linux/amd64
# Test the image in isolation; retain this exact image identity after Internet validation.
python deploy.py export --image registry.example/one-api:VERSION-amd64 --output one-api-VERSION-amd64.tar
sha256sum -c one-api-VERSION-amd64.tar.sha256
docker load --input one-api-VERSION-amd64.tar
```

ARM64 uses `--platform linux/arm64` and its own same-version tag. Export creates an image tar, SHA256 file and JSON identity manifest with image ID, registry digests, version label and architecture. On Windows use `Get-FileHash -Algorithm SHA256` for the tar. Transfer the deployment scripts/templates without local `.env` or data. Never rebuild an environment-specific image. The specialized server release tools under `scripts/oneapi-release` retain their own network/expert checks and are not prerequisites for this entry.

## Upgrade and recovery

```sh
# Pull or load the approved candidate first, then back up databases, data and .env.
python deploy.py update --image registry.example/one-api:NEXT-amd64
# Program-only recovery, after checking database-schema compatibility:
python deploy.py rollback --image registry.example/one-api:PREVIOUS-amd64
```

Both operations preflight the local candidate, back up `.env` privately, replace only its `DSH_IMAGE` line, and recreate the same Compose service with the same data mounts. They never copy the configuration template over site values or delete volumes. If recreation fails, the previous configuration remains in `.env.before-image-*`; correct the failure or select the previous image explicitly. Do not use `docker compose down -v` for recovery.

Container recovery uses the retained configuration, keys, data mount and a compatible image; databases are not restored automatically. Database recovery is separate: stop writers, restore the approved database/account-database backup with its matching files and encryption key, then start a schema-compatible image. A program rollback cannot undo schema migrations. For SQLite, stop the backend before copying/restoring the database together with WAL/SHM state; for external databases use their native backup/restore procedures and verification.

## Local verification and limits

Run `python -m unittest discover -s deploy`, focused Go deployment/controller tests, and the admin `src/deployment.test.js` tests. Production frontend builds use `PUBLIC_URL=.` and an empty `REACT_APP_SERVER`; Docker enforces those values for both portals. `go test . -run TestRuntimeDeploymentBuiltAssets` consumes embedded built HTML/assets. `smoke-built-web.mjs` uses Playwright against the same built frontend and mock APIs under root and two distinct prefix pairs; install Playwright separately and optionally set `PLAYWRIGHT_MODULE` and `DSH_SMOKE_BROWSER` for local tooling.

These local checks cover configuration, URL generation, emitted assets, login/logout navigation, lazy chunks and deep-link refresh. They do not establish same-image container upgrades, real desktop/model streaming, proxy interoperability, upload persistence or database recovery. Those deployment acceptance checks are deferred at the user's request. Stable Internet services are not changed by development or these tests.
