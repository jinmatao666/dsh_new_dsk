# Intranet resources

English | [中文](README.zh.md)

## Summary

Administrators select an offline Python wheel bundle or a network relay in OneAPI System Settings → Network. Relay transport is either the authenticated backend tunnel or a separately deployed HTTP forward proxy. Both require the updated backend and desktop. The resource source does not change model, login or expert service addresses.

## Offline bundle

The backend accepts a ZIP with wheel files at its root, up to 512 MiB and 2,000 entries. Include transitive dependencies and match the desktop Python version, OS and architecture. Source-only packages, native applications, fonts and npm packages are not provided by this bundle.

The builder downloads binary dependencies and refuses to overwrite an existing output. This command has been exercised with a universal wheel:

```powershell
python products/wanwei-desktop/resource-relay/build-offline-python.py --output E:/code/dsh_newversion/delivery/resource-test-six-20261019.zip six==1.17.0
```

For production, choose a new output filename and the required package list. Cross-target options are `--platform`, `--python-version` and `--abi`; inspect the actual desktop interpreter before selecting values. Upload the ZIP under Offline dependency bundle, then save the resource selection. Upload replaces the shared bundle immediately; cancelling settings does not undo the upload.

OneAPI stores bundles under `/data/desktop-resources`, or `DESKTOP_RESOURCE_DIR`. Persist this directory. Old content-addressed bundles remain for in-flight downloads; operators own disk-capacity monitoring and retention. Downloads are public within the service, so upload dependency artifacts only, never private customer files.

## Managed tunnel over the existing entry

Select Intranet → Network relay → Reuse backend entry, leave the address blank to use the login backend, and disable automatic detection for a forced-relay test. A configured address must have the same origin as the login backend; credentials are never sent to a different origin. A separate resource server can be placed behind this same public gateway. The desktop owns a loopback-only HTTP proxy and bridges its HTTP/CONNECT traffic through `/api/desktop-resources/tunnel` using WebSocket. OneAPI owns the authenticated TCP relay. Squid and another public port are not required.

The gateway must forward WebSocket Upgrade headers at this exact path. `gateway-tunnel.location.conf` is the route snippet. The release operator first obtains the real host-side main configuration path with `docker inspect dsh-experts-gateway --format '{{json .Mounts}}'`. Operator-only commands, not run against this Windows host: `bash update-gateway.sh check /absolute/host/nginx.conf ac.zjugis.com` generates a private candidate; `bash update-gateway.sh apply /absolute/host/nginx.conf ac.zjugis.com` backs up the original, validates the mount and configuration, reloads Nginx and checks the backend and six experts. Failure restores the original. The printed backup directory can be passed to `bash update-gateway.sh rollback /root/dsh-gateway-tunnel.XXXXXXXX`. Keep the Python helper and location snippet beside the shell script. No container is restarted.

The relay only connects to public destinations on ports 80/443. DNS answers are validated and the selected IP is pinned before dialing. Browser-origin handshakes and unauthenticated connections are refused. Deployment limits are `DSH_RELAY_CONNECTIONS` (64), `DSH_RELAY_PER_USER` (8), `DSH_RELAY_BYTES` (1 GiB per connection, both directions), `DSH_RELAY_IDLE_SECONDS` (90), and `DSH_RELAY_LIFETIME_SECONDS` (3600). Malformed values disable new tunnels. Logs contain user ID, target host/port and byte count, never request bodies or authorization headers.

The tunnel adds no encryption. HTTPS target traffic keeps end-to-end TLS and certificate verification; HTTP target traffic is plaintext. A public HTTP/WS entry exposes relay authentication and connection metadata to network observers and active attackers. Authentication does not remove that risk. No content classification or website allowlist is applied. Optional bypass hosts accept up to 32 individual IPs or DNS names, without protocol, path or port; localhost and the platform host are included automatically. Actual bypass behavior follows the child client's NO_PROXY support. Source changes close existing managed bridges; running processes may still retain old environment variables and must be restarted.

## Forward proxy

The server must run a forward proxy, not just expose an IP. This directory contains a Squid configuration and a deployment script. It allows only the configured client subnet, public destinations and ports 80/443; it does not decrypt HTTPS. Restrict the host firewall as well. Do not expose this unauthenticated service to the Internet. The first release accepts no embedded proxy credentials.

Server-administrator acceptance, not verified on this Windows machine without Docker: edit `squid.conf`'s `clients` subnet, then run `bash deploy.sh <server-LAN-IPv4> <approved-image-reference>`. The script validates configuration before starting and refuses to replace an existing container. Pin an approved image digest for production. Validate HTTPS downloads from an allowed desktop and denial from a disallowed host; inspect `docker logs wanwei-resource-relay`. The server may be separate from OneAPI.

Enter `http://<server-LAN-IPv4>:3128` in System Settings. With automatic detection off, proxy-aware child commands use the proxy immediately. With detection on, the desktop checks all configured HTTPS 204 URLs concurrently with a 2.5-second timeout. All must pass for direct access; otherwise commands use the proxy. Results cache for 60 seconds. A failed target site does not switch sources or imply total Internet failure.

## Desktop acceptance

Stop old tasks and start a new conversation after saving. Configuration refreshes on authentication/focus and before shell commands, with a one-minute shell refresh cache. A failed refresh refuses new shell commands. Already running processes keep their original environment.

1. Offline: upload the six test bundle, select Offline and save. Ask the agent to run `python -m pip download six==1.17.0 --no-deps -d resource-check`. The wheel must come from the backend, even if Internet is blocked. Remove only test-generated files after inspection.
2. Offline missing package: request a package absent from the bundle. It must report the missing dependency, not change indexes or use the proxy.
3. Forced proxy: select the relay with detection off. Repeat a dependency download and a Python HTTP(S) resource download; verify requests in the relay logs and no request to the wheel library.
4. Automatic: test with public access allowed and blocked. Allow 60 seconds for detection-cache expiry between changes. Verify direct access in the first case and relay use in the second. A captive-login response or redirect must not count as success.
5. Return to Internet mode: verify normal login/model access and that intranet resource variables no longer apply to new child processes.

These installed-device checks belong to the release operator. Local automated tests cover settings, ZIP validation, a real offline pip installation, a Python request through a test relay, route switching and a Loader-composed prompt snapshot. A local interoperability smoke also exercises the shipping TypeScript bridge with the Go relay: Python HTTPS succeeds and pip downloads six 1.17.0 from PyPI with cache disabled, with both target hosts recorded by the relay. Production gateway deployment, Squid and signed installers still require release acceptance.

## Specified websites and file downloads

In intranet relay mode, new Shell commands can use the bundled standard-library client: `python -m wanwei_resource "https://example.com/page"` returns bounded page text and discovered HTTP(S) links. Append `--output "downloads/report.pdf"` to save a file inside the current workspace. The client follows at most five redirects, rejects HTTPS downgrades, checks certificates, reports actual bytes and SHA-256, and never overwrites an existing file. Binary responses require an explicit output path; HTML responses cannot masquerade as non-HTML downloads. Content is untrusted data, not instructions. Complete downloads are published atomically; failed transfers remove their temporary files. Defaults are 100 MiB and a 60-second read/elapsed budget, adjustable with `--max-bytes` and `--timeout` (maximum 3600 seconds).

The client inherits the selected forward proxy or authenticated tunnel; successful automatic probes select direct access. Offline mode does not expose this client or switch to the relay. Neither login credentials nor browser cookies are sent to target sites. Login, CAPTCHA, JavaScript-only navigation, arbitrary browser networking and general Internet search remain outside this client. Use `deliver_files` only after a successful download. Backend UI copy and a desktop rebuild are required; there is no new server API. For acceptance, force relay mode, request a public page, follow a returned file link, verify the local file/hash and relay log, then repeat with offline mode and automatic detection.

## Limits

This is process-environment routing, not a firewall or VPN. Pip and standard Python proxy-aware downloads are covered. Native PowerShell requests, Node fetch, browser traffic, custom clients and existing terminal sessions may ignore these variables. Public search/link restrictions remain independent; in relay mode, blocked public `web_fetch` calls point to the resource client instead of silently fetching directly. Never bypass TLS validation to make a proxy work.
