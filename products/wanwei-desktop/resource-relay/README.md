# Intranet resources

English | [中文](README.zh.md)

## Summary

Administrators select an offline Python wheel bundle or an HTTP forward proxy in OneAPI System Settings → Network. Both require the updated backend and desktop. The resource source does not change model, login or expert service addresses.

## Offline bundle

The backend accepts a ZIP with wheel files at its root, up to 512 MiB and 2,000 entries. Include transitive dependencies and match the desktop Python version, OS and architecture. Source-only packages, native applications, fonts and npm packages are not provided by this bundle.

The builder downloads binary dependencies and refuses to overwrite an existing output. This command has been exercised with a universal wheel:

```powershell
python products/wanwei-desktop/resource-relay/build-offline-python.py --output E:/code/dsh_newversion/delivery/resource-test-six-20261019.zip six==1.17.0
```

For production, choose a new output filename and the required package list. Cross-target options are `--platform`, `--python-version` and `--abi`; inspect the actual desktop interpreter before selecting values. Upload the ZIP under Offline dependency bundle, then save the resource selection. Upload replaces the shared bundle immediately; cancelling settings does not undo the upload.

OneAPI stores bundles under `/data/desktop-resources`, or `DESKTOP_RESOURCE_DIR`. Persist this directory. Old content-addressed bundles remain for in-flight downloads; operators own disk-capacity monitoring and retention. Downloads are public within the service, so upload dependency artifacts only, never private customer files.

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

These installed-device checks belong to the release operator. Local automated tests cover settings, ZIP validation, a real offline pip installation, a Python request through a test relay, route switching and a Loader-composed prompt snapshot. Squid deployment and signed installers still require release acceptance.

## Limits

This is process-environment routing, not a firewall or VPN. Pip and standard Python proxy-aware downloads are covered. Native PowerShell requests, Node fetch, browser traffic, custom clients and existing terminal sessions may ignore these variables. Public search/link restrictions remain independent. Never bypass TLS validation to make a proxy work.
